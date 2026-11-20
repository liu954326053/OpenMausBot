import { lstatSync, mkdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { takeImportName } from "../../shared/import-name.ts";
import {
  TEAM_PROJECT_FOLDER, TEAM_PROJECT_NAME_MAX, isTeamProjectName, type CreateTeamProjectInput, type TeamProjectRefusal,
} from "../../shared/team-projects.ts";
import { isTemplateRoleKey, templateRoleKey, type TeamTemplateContent, type TemplateLibraryApi } from "../../shared/template-library.ts";
import { importPackageDocument, type PackageImportDeps, type PackageImportResult } from "../package-import.ts";
import { sectionKey, type BotRecord } from "../store.ts";
import { userError, type UserError, type UserErrorKey } from "../user-errors.ts";
import type { StoredTeamProject, TeamProjectRegistry } from "./registry.ts";
import { isInAppData } from "./root.ts";
import { applyTemplateRole } from "./template-role.ts";

export type TeamProjectCreateRefusal = UserError & { code: TeamProjectRefusal };
export type TeamProjectCreated = { project: StoredTeamProject; missingSkills: string[] };

export interface TeamProjectCreateContext {
  registry: TeamProjectRegistry;
  dataDir: string;
  templates: Pick<TemplateLibraryApi, "readTeam">;
  importDeps(): Promise<PackageImportDeps>;
  librarySkillNames(): readonly string[];
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

const REFUSAL_KEYS: Record<TeamProjectRefusal, UserErrorKey> = {
  no_root: "serverError.teamProject.noRoot",
  root_missing: "serverError.teamProject.rootMissing",
  bad_name: "serverError.teamProject.badName",
  name_taken: "serverError.teamProject.nameTaken",
  folder_exists: "serverError.teamProject.folderExists",
  no_template: "serverError.teamProject.noTemplate",
  failed: "serverError.teamProject.failed",
};

const refusal = (code: TeamProjectRefusal, params?: Record<string, string | number>): TeamProjectCreateRefusal =>
  ({ ...userError(REFUSAL_KEYS[code], params), code });

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

function rolesFor(template: TeamTemplateContent): Map<string, string> {
  const roles = new Map<string, string>();
  const taken = new Set<string>();
  for (const agent of template.document.package.agents) {
    const role = isTemplateRoleKey(agent.key) && !taken.has(agent.key) ? agent.key : templateRoleKey(agent.key, taken);
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
 * Makes a project from a team template: its folder, its team and its department, its record and its copies. Whatever
 * stops it part-way, everything made so far is taken back.
 */
export async function createTeamProject(input: CreateTeamProjectInput, context: TeamProjectCreateContext): Promise<TeamProjectCreated | TeamProjectCreateRefusal> {
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
  const template = typeof input.templateId === "string" ? context.templates.readTeam(input.templateId) : null;
  if (!template) return refusal("no_template");

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

    const document = structuredClone(template.document);
    if (!document.package.team || !document.package.agents.length) throw new Error("the template holds no team");
    document.package.name = name;
    document.package.team = { ...document.package.team, name };
    const roles = rolesFor(template);

    const misplaced: unknown[] = [];
    const stopAdopting = store.onChange((change) => {
      if (change.type !== "bot") return;
      const bot = store.bots.find((candidate) => candidate.id === change.botId);
      const role = bot?.installedPackage?.agentKey && roles.get(bot.installedPackage.agentKey);
      if (!bot || !role || bot.teamProject || sectionKey(bot.section) !== name) return;
      store.patchBot(bot.id, { teamProject: { id, role }, cwd: folder });
      try {
        context.ensureWorkspace(bot.id);
      } catch (error) {
        misplaced.push(error);
      }
    });
    let result: PackageImportResult;
    try {
      const imported = importPackageDocument(document, { trust: "file", mode: "add" }, deps);
      if (imported.alreadyAdded) throw new Error("the template's team is already here");
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
      if (made.get(agent.key)?.teamProject?.id !== id) throw new Error(`the bot for ${agent.key} did not join the project`);
    }
    const lead = made.get(template.lead) ?? made.get(document.package.team.leader ?? "");
    if (!lead) throw new Error("the template names no lead");
    if (!lead.chiefOfStaff) store.setChiefOfStaff(lead.id);

    const roleHost = { store, skills: deps.skills, librarySkillNames: context.librarySkillNames };
    const missingSkills: string[] = [];
    const namesInProject = new Set<string>();
    for (const agent of document.package.agents) {
      const bot = made.get(agent.key)!;
      const templateName = takeImportName(agent.name, namesInProject);
      if (bot.name !== templateName) store.patchBot(bot.id, { name: templateName });
      const applied = applyTemplateRole(bot.id, { agent, extras: template.extras[agent.key], keepServers: bot.mcpServers }, roleHost);
      for (const skill of applied.missingSkills) if (!missingSkills.includes(skill)) missingSkills.push(skill);
    }

    const project: StoredTeamProject = {
      id, name, folder, section: name,
      template: { id: template.id, name: template.name, version: template.version },
      leadBotId: lead.id, createdAt: context.now(),
    };
    context.registry.add(project);
    undo.push(() => context.registry.remove(id));
    context.writeCopies(project);
    return { project, missingSkills };
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
