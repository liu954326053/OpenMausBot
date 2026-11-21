import { lstatSync, mkdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { PackageDocument } from "../../shared/package-format.ts";
import {
  TEAM_PROJECT_FOLDER, TEAM_PROJECT_NAME_MAX, isTeamProjectName, isTeamProjectRole, teamProjectRole,
  type CreateTeamProjectInput, type ProjectTeamUnusable, type ProjectTeamWire, type TeamProjectRefusal,
} from "../../shared/team-projects.ts";
import { importPackageDocument, type PackageImportDeps, type PackageImportResult } from "../package-import.ts";
import { sectionKey, type BotRecord } from "../store.ts";
import { userError, type UserError, type UserErrorKey } from "../user-errors.ts";
import type { StoredTeamProject, TeamProjectRegistry } from "./registry.ts";
import { isInAppData } from "./root.ts";

export type TeamProjectCreateRefusal = UserError & { code: TeamProjectRefusal };

/** A share export, and the key in it of each bot it holds, by the bot's id. */
export interface ExportedTeam {
  document: PackageDocument;
  keys: Readonly<Record<string, string>>;
}

export interface TeamProjectCreateContext {
  registry: TeamProjectRegistry;
  dataDir: string;
  importDeps(): Promise<PackageImportDeps>;
  /** The team of that name; undefined when there is none. */
  team(name: unknown): ProjectTeamWire | undefined;
  /** The team's share export with each bot's own skills only. Throws when it cannot be exported. */
  exportTeam(section: string): ExportedTeam;
  /** The memory key of a department, made fast so a rename keeps it. */
  teamKey(section: string): string;
  /** Brings a copy in line with its source. */
  syncCopy(botId: string): void;
  /** Puts a project bot's own files where its project keeps them. Throws when the project folder cannot take them. */
  ensureWorkspace(botId: string): void;
  /** Answers for the project while it is being made, so its bots' own files land in its folder from the first one. */
  pending: Map<string, { folder: string }>;
  /** Throws when the copies cannot be written. */
  writeCopies(project: StoredTeamProject): void;
  newId(): string;
  now(): number;
  log(line: string): void;
}

const REFUSAL_KEYS: Record<Exclude<TeamProjectRefusal, "team_unusable">, UserErrorKey> = {
  no_root: "serverError.teamProject.noRoot",
  root_missing: "serverError.teamProject.rootMissing",
  bad_name: "serverError.teamProject.badName",
  name_taken: "serverError.teamProject.nameTaken",
  folder_exists: "serverError.teamProject.folderExists",
  no_team: "serverError.teamProject.noTeam",
  failed: "serverError.teamProject.failed",
};

const UNUSABLE_KEYS: Record<ProjectTeamUnusable, UserErrorKey> = {
  empty: "serverError.teamProject.teamEmpty",
  no_chief: "serverError.teamProject.teamNoChief",
  main_bot_chief: "serverError.teamProject.teamMainBotChief",
};

const refusal = (code: Exclude<TeamProjectRefusal, "team_unusable">, params?: Record<string, string | number>): TeamProjectCreateRefusal =>
  ({ ...userError(REFUSAL_KEYS[code], params), code });

/** Why no project can be made from `team`; null when one can. */
export function unusableTeamRefusal(team: ProjectTeamWire): TeamProjectCreateRefusal | null {
  return team.unusable ? { ...userError(UNUSABLE_KEYS[team.unusable], { team: team.name, reason: team.unusable }), code: "team_unusable" } : null;
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function somethingAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

function nameTaken(name: string, context: TeamProjectCreateContext, store: PackageImportDeps["store"]): boolean {
  const wanted = name.toLowerCase();
  const same = (other?: string | null) => other?.trim().toLowerCase() === wanted;
  return context.registry.projects().some((project) => same(project.name) || same(project.section)) ||
    store.sections.some(same) || store.bots.some((bot) => same(bot.section)) || store.groups.some((group) => same(group.section));
}

/** Each bot's role in the project, by its key in the export: the key itself when it can name a folder. */
function rolesFor(document: PackageDocument): Map<string, string> {
  const roles = new Map<string, string>();
  const taken = new Set<string>();
  for (const agent of document.package.agents) {
    const role = isTeamProjectRole(agent.key) && !taken.has(agent.key) ? agent.key : teamProjectRole(agent.key, taken);
    taken.add(role);
    roles.set(agent.key, role);
  }
  return roles;
}

/** Only what this call made goes: a folder that holds anything else by then is left, and reported. */
function removeProjectFolder(folder: string): void {
  rmSync(join(folder, TEAM_PROJECT_FOLDER), { recursive: true, force: true });
  rmdirSync(folder);
}

function removeTeam(result: PackageImportResult, deps: PackageImportDeps): void {
  const failures: string[] = [];
  const attempt = (step: () => void) => {
    try { step(); } catch (error) { failures.push(detailOf(error)); }
  };
  for (const routine of result.routines) attempt(() => deps.routines.remove(routine.id));
  for (const group of result.groups) attempt(() => deps.store.deleteGroup(group.id));
  for (const bot of result.bots) attempt(() => deps.store.deleteBot(bot.id));
  if (result.connections.length) {
    attempt(() => {
      const next: Record<string, unknown> = { ...deps.mcp.servers() };
      for (const connection of result.connections) delete next[connection.name];
      deps.mcp.persist(next);
    });
  }
  attempt(() => {
    if (!deps.store.sections.includes(result.section)) return;
    const refused = deps.store.changeEmptySection(result.section, null);
    if (refused) throw new Error(refused);
  });
  if (failures.length) throw new Error(failures.join("; "));
}

/**
 * Makes a project from a team: its folder, a copy of the team in its own department, its record and its copies. Each
 * copy remembers the team member it was made from. Whatever stops it part-way, everything made so far is taken back.
 */
export async function createTeamProject(input: CreateTeamProjectInput, context: TeamProjectCreateContext): Promise<{ project: StoredTeamProject } | TeamProjectCreateRefusal> {
  let deps: PackageImportDeps;
  try {
    deps = { ...(await context.importDeps()), presets: undefined };
  } catch (error) {
    return refusal("failed", { detail: detailOf(error) });
  }
  const { store } = deps;

  if (!context.registry.readable) return { ...userError("serverError.teamProject.unreadable"), code: "failed" };
  const root = context.registry.root();
  if (!root) return refusal("no_root");
  if (!isFolder(root)) return refusal("root_missing");
  if (isInAppData(root, context.dataDir)) return refusal("failed", { detail: "the folder for your projects is inside the app's own data folder" });
  const name = typeof input?.name === "string" ? input.name.normalize("NFC").trim() : "";
  if (!isTeamProjectName(name)) return refusal("bad_name", { max: TEAM_PROJECT_NAME_MAX });
  if (nameTaken(name, context, store)) return refusal("name_taken", { name });
  const folder = join(root, name);
  if (somethingAt(folder)) return refusal("folder_exists", { name });
  const team = context.team(input.team);
  if (!team) return refusal("no_team", { team: typeof input.team === "string" ? input.team.trim().slice(0, 60) : "" });
  const unusable = unusableTeamRefusal(team);
  if (unusable) return unusable;
  let exported: ExportedTeam;
  try {
    exported = context.exportTeam(team.name);
  } catch (error) {
    return refusal("failed", { detail: detailOf(error) });
  }

  const id = context.newId();
  const undo: Array<() => void> = [];
  context.pending.set(id, { folder });
  try {
    try {
      mkdirSync(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return refusal("folder_exists", { name });
      throw error;
    }
    undo.push(() => removeProjectFolder(folder));
    mkdirSync(join(folder, TEAM_PROJECT_FOLDER));

    const document = structuredClone(exported.document);
    const leader = document.package.team?.leader;
    if (!document.package.team || !leader) throw new Error(`${team.name} has no Chief in its export`);
    document.package.name = name;
    document.package.team = { ...document.package.team, name };
    const roles = rolesFor(document);
    const sources = new Map(Object.entries(exported.keys).map(([botId, key]) => [key, botId]));

    const misplaced: unknown[] = [];
    const stopAdopting = store.onChange((change) => {
      if (change.type !== "bot") return;
      const bot = store.bots.find((candidate) => candidate.id === change.botId);
      const key = bot?.installedPackage?.agentKey;
      const role = key && roles.get(key);
      const source = key && sources.get(key);
      if (!bot || !role || !source || bot.teamProject || sectionKey(bot.section) !== name) return;
      store.patchBot(bot.id, { teamProject: { id, role, source }, cwd: folder });
      try {
        context.ensureWorkspace(bot.id);
      } catch (error) {
        misplaced.push(error);
      }
    });
    let result: PackageImportResult;
    try {
      const imported = importPackageDocument(document, { trust: "file", mode: "add" }, deps);
      if (imported.alreadyAdded) throw new Error(`${team.name} is already here`);
      result = imported;
    } finally {
      stopAdopting();
    }
    undo.push(() => removeTeam(result, deps));
    if (misplaced.length) throw misplaced[0];
    if (result.section !== name) throw new Error(`the department was named ${result.section}`);

    const made = new Map<string, BotRecord>();
    for (const bot of result.bots) {
      const current = store.bots.find((candidate) => candidate.id === bot.id);
      if (current?.installedPackage?.agentKey) made.set(current.installedPackage.agentKey, current);
    }
    for (const agent of document.package.agents) {
      if (made.get(agent.key)?.teamProject?.id !== id) throw new Error(`the copy of ${agent.name} did not join the project`);
    }
    const lead = made.get(leader);
    if (!lead) throw new Error(`${team.name} has no Chief in its export`);
    if (!lead.chiefOfStaff) store.setChiefOfStaff(lead.id);
    for (const agent of document.package.agents) context.syncCopy(made.get(agent.key)!.id);

    const project: StoredTeamProject = {
      id, name, folder, section: name, team: { key: context.teamKey(team.name), name: team.name }, leadBotId: lead.id, createdAt: context.now(),
    };
    context.registry.add(project);
    undo.push(() => context.registry.remove(id));
    context.writeCopies(project);
    return { project };
  } catch (error) {
    const leftovers: string[] = [];
    for (const step of undo.reverse()) {
      try { step(); } catch (failure) { leftovers.push(detailOf(failure)); }
    }
    context.log(`${name} was not made: ${detailOf(error)}${leftovers.length ? `; not everything could be taken back: ${leftovers.join("; ")}` : ""}`);
    return { ...userError(leftovers.length ? "serverError.teamProject.failedLeftovers" : "serverError.teamProject.failed", { detail: detailOf(error) }), code: "failed" };
  } finally {
    context.pending.delete(id);
  }
}
