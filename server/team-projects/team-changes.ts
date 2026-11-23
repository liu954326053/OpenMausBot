import {
  isTeamProjectRole, teamProjectRole, type TeamChangesInput, type TeamMemberWire, type TeamProjectChanges, type TeamProjectMembership,
} from "../../shared/team-projects.ts";
import { importPackageDocument, type PackageImportDeps } from "../package-import.ts";
import type { BotRecord } from "../store.ts";
import { removeImported, type ExportedTeam } from "./create.ts";
import { copyName } from "./follow.ts";
import type { StoredTeamProject } from "./registry.ts";
import { teamBots } from "./teams.ts";

const MAX_DECISIONS = 200;

const memberOf = (bot: BotRecord): TeamMemberWire => ({ id: bot.id, name: bot.name, title: bot.title ?? "" });

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * What changed in a project's team since its copies were made: the members it has no following copy of, and the copies
 * whose source left. `teamSection` is the team's department now: null when the team was deleted, undefined when that
 * cannot be told. Null when nothing changed.
 */
export function teamChangesOf(bots: readonly BotRecord[], projectId: string, teamSection: string | null | undefined): TeamProjectChanges | null {
  const copies = bots.filter((bot) => bot.teamProject?.id === projectId);
  const followed = new Set(copies.flatMap((copy) => (copy.teamProject?.source && !copy.teamProject.sourceLeft ? [copy.teamProject.source] : [])));
  const joined = teamSection ? teamBots(bots, teamSection).filter((member) => !followed.has(member.id)).map(memberOf) : [];
  const left = copies.filter((copy) => copy.teamProject?.source && copy.teamProject.sourceLeft).map(memberOf);
  return joined.length || left.length ? { joined, left } : null;
}

const ids = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length <= MAX_DECISIONS && value.every((id) => typeof id === "string") ? [...new Set(value as string[])] : null;

/** The person's decisions in a request's body; null when the body is not a list of them. */
export function teamChangesInput(body: unknown): TeamChangesInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { add = [], remove = [], keep = [] } = body as Record<string, unknown>;
  const [adding, removing, keeping] = [ids(add), ids(remove), ids(keep)];
  return adding && removing && keeping ? { add: adding, remove: removing, keep: keeping } : null;
}

export interface AddCopyContext {
  importDeps(): Promise<PackageImportDeps>;
  /** The share export of the team holding only `source`, with its own skills. Throws when it cannot be made. */
  exportMember(source: BotRecord, teamSection: string): ExportedTeam;
  /** Puts a project bot's own files where its project keeps them. Throws when the project folder cannot take them. */
  ensureWorkspace(botId: string): void;
  /** Brings a copy in line with its source. Throws when it cannot. */
  syncCopy(botId: string): void;
}

/** What sets a copy apart from the project's first ones: the episode the production makes it for, and whether it
 * follows the bot it is a copy of. */
export interface CopyPlace {
  episode?: NonNullable<TeamProjectMembership["episode"]>;
  /** False for a copy of a bot that is no team member: it follows nobody. */
  follows?: boolean;
}

/**
 * Makes a copy of a team member in the project, as the project's copies were made, less the group chats: it remembers
 * its source and follows it. Whatever stops it part-way, what was made is taken back.
 */
export async function addCopy(project: StoredTeamProject, source: BotRecord, teamSection: string, context: AddCopyContext, place: CopyPlace = {}): Promise<BotRecord> {
  const deps: PackageImportDeps = { ...(await context.importDeps()), presets: undefined };
  const exported = context.exportMember(source, teamSection);
  const key = exported.keys[source.id];
  if (!key) throw new Error(`${source.name} is not in the export of ${teamSection}`);
  const document = structuredClone(exported.document);
  delete document.package.rooms;
  if (document.package.routines) document.package.routines = document.package.routines.filter((routine) => routine.room === undefined);
  const taken = new Set(deps.store.bots.flatMap((bot) => (bot.teamProject?.id === project.id ? [bot.teamProject.role] : [])));
  const role = isTeamProjectRole(key) && !taken.has(key) ? key : teamProjectRole(key, taken);

  const imported = importPackageDocument(document, { trust: "file", mode: "add", noDepartment: true }, deps);
  if (imported.alreadyAdded) throw new Error(`${source.name} is already here`);
  try {
    const [made, ...more] = imported.bots;
    if (!made || more.length) throw new Error(`the export of ${source.name} held ${imported.bots.length} bots`);
    const follows = place.follows !== false;
    const membership: TeamProjectMembership = { id: project.id, role, ...(follows ? { source: source.id } : {}), ...(place.episode ? { episode: place.episode } : {}) };
    const others = deps.store.bots.filter((bot) => bot.teamProject?.id === project.id && bot.id !== made.id).map((bot) => bot.name);
    const name = place.episode ? { name: copyName(source, others, place.episode.number) } : {};
    deps.store.patchBot(made.id, { section: project.section, teamProject: membership, cwd: project.folder, ...name });
    context.ensureWorkspace(made.id);
    if (follows) context.syncCopy(made.id);
    return deps.store.bot(made.id)!;
  } catch (error) {
    try {
      removeImported(imported, deps);
    } catch (failure) {
      throw new Error(`${detailOf(error)}; not everything could be taken back: ${detailOf(failure)}`);
    }
    throw error;
  }
}
