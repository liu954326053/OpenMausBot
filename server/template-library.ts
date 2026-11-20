// Security: an input is checked here and then passes the package gate before it is written. A bot or a department
// becomes a template through the share export, which leaves out chats, memory, keys and connection addresses.
import type { ZodError } from "zod";

import { takeImportName } from "../shared/import-name.ts";
import { PackageFormatError, parsePackageDocument, type PackageDocument } from "../shared/package-format.ts";
import type { ServerErrorBody, ServerTextParams } from "../shared/server-text.ts";
import { isSkillName } from "../shared/skill-md.ts";
import {
  TEMPLATE_LIMITS,
  type BotTemplateSummary, type TeamTemplateSummary, type TemplateKind, type TemplateLibraryEditor, type TemplateRole, type TemplateRoleExtras,
} from "../shared/template-library.ts";
import type { Routine } from "./routines.ts";
import { ShareError, type ShareHost, type ShareTarget } from "./share.ts";
import type { BotRecord } from "./store.ts";
import {
  botContent, botSummary, botTemplateDocument, botTemplateInputSchema, botWire, extrasOf, teamContent, teamSummary, teamTemplateDocument,
  lookExtrasOf, teamTemplateInputSchema, teamWire, templateMeta, templateRecord, withRoleKeys, type TemplateProblem, type TemplateRecord,
} from "./template-library-document.ts";
import { createTemplateStore, isMcpServerName, isTemplateId, newTemplateId, templateModelSchema } from "./template-library-store.ts";
import { refusalText, userError, type UserErrorKey } from "./user-errors.ts";

/** A request the template library refuses, with the sentence for the person and the HTTP status that goes with it. */
export class TemplateLibraryError extends Error {
  readonly body: ServerErrorBody;
  readonly status: number;
  constructor(body: ServerErrorBody, status: number) {
    super(body.error);
    this.body = body;
    this.status = status;
  }
}

const refusal = (status: number, key: UserErrorKey, params?: ServerTextParams) => new TemplateLibraryError(userError(key, params), status);

export interface TemplateLibraryDeps {
  /** `<data dir>/templates`. */
  root: string;
  bots(): readonly BotRecord[];
  routines(): readonly Routine[];
  /** The share export of a bot or a department as a document, with nothing written or recorded. */
  exportDocument: ShareHost["document"];
  /** The names of the skills that are the bot's own: not the skills library's, not this computer's. */
  ownSkillNames(botId: string): readonly string[];
  now?(): number;
}

function inputRefusal(error: ZodError, kind: TemplateKind): TemplateLibraryError {
  const issue = error.issues[0];
  const path = issue?.path ?? [];
  const templateName = kind === "bot" ? path[0] === "role" && path[1] === "name" : path[0] === "name";
  if (templateName) return refusal(400, "serverError.templateLibrary.nameRule");
  if (path[0] === "roles" && path[2] === "name") return refusal(400, "serverError.templateLibrary.roleNameRule");
  return refusal(400, "serverError.templateLibrary.invalid", { detail: `${path.join(".") || "template"}: ${issue?.message ?? "not valid"}`.slice(0, 300) });
}

function problemRefusal(found: TemplateProblem): TemplateLibraryError {
  if (found.problem === "roleName") return refusal(409, "serverError.templateLibrary.roleNameTaken", { name: found.name });
  if (found.problem === "picture") return refusal(400, "serverError.templateLibrary.picture", { name: found.name });
  if (found.problem === "skill") return refusal(400, "serverError.templateLibrary.skill", { name: found.name });
  return refusal(400, "serverError.templateLibrary.invalid", { detail: found.problem === "lead" ? "the lead is not one of the roles" : "two roles share a key" });
}

/** The document as the package gate returns it: what is written is always what a reader will accept. */
function gated(document: PackageDocument): PackageDocument {
  try {
    return parsePackageDocument(document, { trust: "file" });
  } catch (error) {
    if (!(error instanceof PackageFormatError)) throw error;
    if (error.code === "too_large") throw refusal(413, "serverError.templateLibrary.tooLarge");
    throw refusal(400, "serverError.templateLibrary.invalid", { detail: error.message.slice(0, 300) });
  }
}

/** What a bot's settings say beyond what the share export carries. */
function botExtras(bot: BotRecord, own: ReadonlySet<string>, pictured: boolean): TemplateRoleExtras {
  const model = templateModelSchema.safeParse(bot.modelSelection);
  const librarySkills = [...new Set((bot.assignedSkills ?? []).filter((name) => isSkillName(name) && !own.has(name)))].slice(0, TEMPLATE_LIMITS.references);
  const mcpServers = bot.mcpServers ? [...new Set(bot.mcpServers.filter(isMcpServerName))].slice(0, TEMPLATE_LIMITS.references) : undefined;
  const look = lookExtrasOf(bot, pictured);
  return { ...(model.success ? { model: model.data } : {}), librarySkills, ...(mcpServers ? { mcpServers } : {}), ...(look ? { look } : {}) };
}

/** How many retired keys a template remembers: the latest. */
const RETIRED_KEYS_KEPT = 200;

/** The keys of roles a team template had once and, now that its roles are those of `kept`, has no more. */
function retiredKeys(previous: TemplateRecord | null, kept: readonly string[]): string[] {
  if (!previous) return [];
  const once = new Set([...previous.retiredKeys, ...previous.document.package.agents.map((agent) => agent.key)]);
  for (const key of kept) once.delete(key);
  return [...once].slice(-RETIRED_KEYS_KEPT);
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function createTemplateLibrary(deps: TemplateLibraryDeps): TemplateLibraryEditor {
  const store = createTemplateStore(deps.root);
  const now = deps.now ?? Date.now;
  const warned = new Set<string>();

  const record = (kind: TemplateKind, id: string): TemplateRecord | null => {
    const stored = isTemplateId(id) ? store.read(kind, id) : null;
    return stored && templateRecord(kind, id, stored);
  };
  /** One template that cannot be read is left out and named in the log once; the rest are listed. */
  const records = (kind: TemplateKind): TemplateRecord[] => store.ids(kind).flatMap((id) => {
    const made = record(kind, id);
    if (made) return [made];
    if (!warned.has(`${kind}/${id}`)) {
      warned.add(`${kind}/${id}`);
      console.warn(`[templates] The ${kind} template in folder ${id} can't be read and is left out of the list.`);
    }
    return [];
  });
  const written = (kind: TemplateKind, id: string): TemplateRecord => {
    const made = record(kind, id);
    if (!made) throw new Error(`The ${kind} template ${id} could not be read back after it was written.`);
    return made;
  };
  const nameOf = (made: TemplateRecord) => made.document.package.name;
  const requireFree = (kind: TemplateKind, name: string, except?: string) => {
    if (records(kind).some((other) => other.id !== except && sameName(nameOf(other), name))) throw refusal(409, "serverError.templateLibrary.nameTaken", { name });
  };
  const requireRoom = (kind: TemplateKind) => {
    if (store.ids(kind).length >= TEMPLATE_LIMITS.templates) throw refusal(409, "serverError.templateLibrary.full", { count: TEMPLATE_LIMITS.templates });
  };
  const previousOf = (kind: TemplateKind, id: string | undefined): TemplateRecord | null => {
    if (id === undefined) return null;
    const previous = record(kind, id);
    if (!previous) throw refusal(404, "serverError.templateLibrary.notFound");
    return previous;
  };

  /**
   * A bot's or a department's share export as a template: the bots' own skills as copies, the rest by name. `into` is
   * the template it becomes the next version of: that one keeps its name and genre, a bot keeps the key of the role it
   * was made from, and a role whose key stays keeps its starter memory, which the export leaves out.
   */
  function saveExported(kind: TemplateKind, target: ShareTarget, bots: readonly BotRecord[], wanted: string, into: TemplateRecord | null = null): TemplateRecord {
    if (!into) requireRoom(kind);
    const own = new Map(bots.map((bot) => [bot.id, new Set(deps.ownSkillNames(bot.id))]));
    let exported: ReturnType<ShareHost["document"]>;
    try {
      exported = deps.exportDocument(target, kind === "team" ? deps.routines() : [], (bot, skill) => own.get(bot.id)?.has(skill) ?? false);
    } catch (error) {
      if (error instanceof ShareError) throw new TemplateLibraryError(refusalText(error.message), error.status);
      throw error;
    }
    const madeFrom = new Map<string, string>();
    for (const bot of bots) {
      const role = bot.teamProject?.role ?? (into && bot.installedPackage?.id === into.document.package.id ? bot.installedPackage.agentKey : undefined);
      const exportedAs = exported.keys[bot.id];
      if (role && exportedAs) madeFrom.set(exportedAs, role);
    }
    const { document, keys } = withRoleKeys(exported.document, madeFrom, new Set(into?.retiredKeys));
    const pkg = document.package;
    const id = into?.id ?? newTemplateId();
    const version = (into?.version ?? 0) + 1;
    const name = into ? nameOf(into) : takeImportName(wanted, new Set(records(kind).map((other) => nameOf(other).trim().toLowerCase())), TEMPLATE_LIMITS.name);
    const lead = pkg.team?.leader ?? (into && pkg.agents.some((agent) => agent.key === into.lead) ? into.lead : pkg.agents[0]!.key);
    const starterMemory = new Map(into?.document.package.agents.map((agent) => [agent.key, agent.seed]));
    const extras: Record<string, TemplateRoleExtras> = {};
    for (const bot of bots) {
      const key = keys.get(exported.keys[bot.id] ?? "");
      if (key) extras[key] = botExtras(bot, own.get(bot.id)!, Boolean(pkg.agents.find((agent) => agent.key === key)?.appearance.avatar));
    }
    const stamped = gated({
      ...document,
      package: {
        ...pkg, id: `template-${id}`, release: `${version}.0.0`, name,
        team: { ...pkg.team, name, leader: lead },
        agents: pkg.agents.map((agent) => {
          const seed = starterMemory.get(agent.key);
          return { ...agent, ...(kind === "bot" ? { name } : {}), ...(seed ? { seed } : {}) };
        }),
      },
    });
    const team = kind === "team" ? { lead, genre: into?.genre, retiredKeys: retiredKeys(into, pkg.agents.map((agent) => agent.key)) } : {};
    store.write(kind, id, stamped, templateMeta(stamped, extras, { version, updatedAt: now(), ...team }));
    return written(kind, id);
  }

  return {
    list() {
      const bots: BotTemplateSummary[] = records("bot").map(botSummary).sort(byName);
      const teams: TeamTemplateSummary[] = records("team").map(teamSummary).sort(byName);
      return { bots, teams };
    },

    readTeam(id) {
      const made = record("team", id);
      return made && teamContent(made);
    },

    readBot(id) {
      const made = record("bot", id);
      return made && botContent(made);
    },

    botTemplate(id) {
      const made = record("bot", id);
      return made && botWire(made);
    },

    teamTemplate(id) {
      const made = record("team", id);
      return made && teamWire(made);
    },

    saveBot(input, id) {
      const checked = botTemplateInputSchema.safeParse(input);
      if (!checked.success) throw inputRefusal(checked.error, "bot");
      const previous = previousOf("bot", id);
      if (!previous) requireRoom("bot");
      requireFree("bot", checked.data.role.name, id);
      const templateId = id ?? newTemplateId();
      const version = (previous?.version ?? 0) + 1;
      const built = botTemplateDocument(checked.data, previous?.document.package, templateId, version);
      if ("problem" in built) throw problemRefusal(built);
      const document = gated(built);
      store.write("bot", templateId, document, templateMeta(document, { [checked.data.role.key]: extrasOf(checked.data.role) }, { version, updatedAt: now() }));
      return botWire(written("bot", templateId));
    },

    saveTeam(input, id) {
      const checked = teamTemplateInputSchema.safeParse(input);
      if (!checked.success) throw inputRefusal(checked.error, "team");
      const previous = previousOf("team", id);
      if (!previous) requireRoom("team");
      requireFree("team", checked.data.name, id);
      const templateId = id ?? newTemplateId();
      const version = (previous?.version ?? 0) + 1;
      const built = teamTemplateDocument(checked.data, previous?.document.package, templateId, version);
      if ("problem" in built) throw problemRefusal(built);
      const document = gated(built);
      const extras = Object.fromEntries(checked.data.roles.map((role) => [role.key, extrasOf(role)]));
      const retired = retiredKeys(previous, checked.data.roles.map((role) => role.key));
      store.write("team", templateId, document, templateMeta(document, extras, { version, updatedAt: now(), genre: checked.data.genre, lead: checked.data.lead, retiredKeys: retired }));
      return teamWire(written("team", templateId));
    },

    remove(kind, id) {
      const undo = isTemplateId(id) ? store.remove(kind, id) : null;
      if (!undo) throw refusal(404, "serverError.templateLibrary.notFound");
      return { undo };
    },

    restore(undo) {
      const removed = store.readRemoved(undo);
      const made = removed && templateRecord(removed.kind, removed.id, removed);
      if (made && records(made.kind).some((other) => sameName(nameOf(other), nameOf(made)))) {
        throw refusal(409, "serverError.templateLibrary.restoreNameTaken", { name: nameOf(made) });
      }
      const restored = store.restore(undo);
      if (!restored) throw refusal(409, "serverError.templateLibrary.undoGone");
      return restored;
    },

    saveFromBot(botId) {
      const bot = deps.bots().find((each) => each.id === botId);
      if (!bot) throw refusal(404, "serverError.bot.missing");
      return botWire(saveExported("bot", { scope: "bot", bot }, [bot], bot.name));
    },

    saveFromDepartment(department, into) {
      const section = department.trim();
      const bots = deps.bots().filter((bot) => !bot.hidden && (bot.section?.trim() ?? "") === section);
      if (!section || !bots.length) throw refusal(404, "serverError.templateLibrary.noBots");
      return teamWire(saveExported("team", { scope: "department", section, bots }, bots, section, previousOf("team", into)));
    },

    addStarterMemory(kind, id, role, text) {
      const entry = text.trim();
      const withEntry = <Role extends TemplateRole>(each: Role): Role => each.key !== role ? each : { ...each, memory: each.memory.trim() ? `${each.memory.trimEnd()}\n\n${entry}\n` : `${entry}\n` };
      if (kind === "bot") {
        const template = this.botTemplate(id);
        if (!template || template.role.key !== role) throw refusal(404, "serverError.templateLibrary.notFound");
        if (entry) this.saveBot({ ...template, role: withEntry(template.role) }, id);
      } else {
        const template = this.teamTemplate(id);
        if (!template?.roles.some((each) => each.key === role)) throw refusal(404, "serverError.templateLibrary.notFound");
        if (entry) this.saveTeam({ ...template, roles: template.roles.map(withEntry) }, id);
      }
    },
  };
}
