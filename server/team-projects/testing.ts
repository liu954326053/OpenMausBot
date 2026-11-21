import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import type { PackageImportDeps, PackageImportResult } from "../package-import.ts";
import type { CommunityPublisher } from "../share-publish.ts";
import type { SkillListing } from "../skills.ts";
import type { BotRecord } from "../store.ts";
import type { TeamMemoryLine } from "./copies.ts";
import type { TeamProjectsDeps } from "./service.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "shared", "package-fixtures", "full-team.v2.json");

export type TeamProjectsTestApp = Awaited<ReturnType<typeof teamProjectsInstallation>>;

/** What the skills library holds in these tests: a skill a bot is given from it never travels with a copy. */
const LIBRARY_SKILL = "---\nname: beat-sheet\ndescription: Plans an episode's beats.\n---\nList the beats.\n";

/**
 * A whole installation in a throwaway home: the real bot store, routines, package importer and share export under the
 * projects service, with a skills library and a team memory the test fills by hand.
 */
export async function teamProjectsInstallation(options: { maxBots?: number } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omb-team-projects-")));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const { DATA_DIR } = await import("../config.ts");
  const { Store } = await import("../store.ts");
  const { RoutineManager } = await import("../routines.ts");
  const skills = await import("../skills.ts");
  const workspace = await import("../workspace.ts");
  const sections = await import("../section-context.ts");
  const { readAttachment, saveImage } = await import("../attachments.ts");
  const { botAvatarUrlFromStoredPath } = await import("../../shared/bot-avatar.ts");
  const { parsePackageDocument } = await import("../../shared/package-format.ts");
  const { importPackageDocument } = await import("../package-import.ts");
  const { createShareHost } = await import("../share.ts");
  const { skillExport } = await import("../skill-export.ts");
  const { TeamProjectRegistry } = await import("./registry.ts");
  const { TeamProjects } = await import("./service.ts");

  const store = new Store(() => ({ instanceId: "claude", model: "default-model" }));
  const routines = new RoutineManager({
    file: join(DATA_DIR, "routines.json"),
    botState: (id) => (store.bot(id) && !store.bot(id)!.hidden ? "ready" : "missing"),
    goalState: (groupId, botId) => (store.group(groupId ?? "")?.memberIds.includes(botId) ? "ready" : "missing"),
    createTask: () => null,
    startTurn: async () => {},
  });
  const mcp = { servers: {} as Record<string, unknown> };
  const importDeps: PackageImportDeps = {
    store,
    routines,
    skills: { install: skills.installSkill, setEnabled: skills.setSkillEnabled, installOrg: skills.installOrgSkill },
    memory: { writeIndex: workspace.writeMemoryFile, writeTopic: workspace.writeMemoryTopic },
    mcp: { servers: () => mcp.servers, refusal: () => undefined, persist: (next) => { mcp.servers = next; } },
    sections: { writeBrief: (section, text) => void sections.writeSectionContext(section, text) },
    images: { save: (bytes, mime) => botAvatarUrlFromStoredPath(saveImage(Buffer.from(bytes), mime).path)! },
    defaultSelection: () => ({ instanceId: "claude", model: "default-model" }),
    ...(options.maxBots === undefined ? {} : { maxBots: options.maxBots }),
  };

  const libraryListing = (name: string): SkillListing => ({
    name, description: "Plans an episode's beats.", enabled: true, editable: false, source: "library", sha256: "", importedAt: "", warnings: [], skippedFiles: [],
  });
  const exporting = skillExport({
    listBotSkills: (bot) => [...skills.listSkills(bot.id), ...(bot.assignedSkills ?? []).map(libraryListing)],
    readBotSkillFile: (bot, name) => skills.readSkillFile(bot.id, name) ?? (bot.assignedSkills?.includes(name) ? LIBRARY_SKILL : null),
  });
  const share = createShareHost({
    dataDir: DATA_DIR,
    bots: () => store.bots,
    groups: () => store.groups,
    routines: () => routines.listRoutines(),
    brief: (section) => sections.readSectionContext(section)?.text,
    collectTeamSkills: exporting.collectTeamSkills,
    picture: (bot) => {
      const stored = bot.avatarUrl ? readAttachment(bot.avatarUrl.split("/").pop() ?? "") : null;
      return stored ? `data:${stored.mime};base64,${stored.bytes.toString("base64")}` : undefined;
    },
    botFolder: (botId) => join(DATA_DIR, "bots", botId),
    publisher: {} as CommunityPublisher,
    patch: () => {},
  });

  const memory = new Map<string, TeamMemoryLine[]>();
  const logged: string[] = [];
  const exports: string[] = [];
  let clock = 1_800_000_000_000;
  let ids = 0;
  let scheduled = 0;
  const placed: string[] = [];
  const hooks: { onPlace?: (botId: string) => void; onExport?: () => void } = {};
  const registryFile = join(DATA_DIR, "projects.json");
  const registry = new TeamProjectRegistry(registryFile, (line) => logged.push(line));
  const deps: TeamProjectsDeps = {
    registry, store, dataDir: DATA_DIR,
    routines: () => routines,
    ensureWorkspace: (botId) => { placed.push(botId); hooks.onPlace?.(botId); },
    importDeps: async () => importDeps,
    exportDocument: (target, carries) => {
      hooks.onExport?.();
      exports.push(target.scope === "bot" ? target.bot.id : target.section);
      return share.document(target, routines.listRoutines(), carries);
    },
    ownSkillNames: (botId) => skills.listSkills(botId).map((skill) => skill.name),
    teamKey: sections.ensureSectionMemoryKey,
    teamOfKey: sections.sectionOfMemoryKey,
    context: (section) => sections.readSectionContext(section)?.text ?? "",
    memory: (section) => memory.get(section) ?? [],
    schedule: () => { scheduled += 1; },
    newId: () => `project-${++ids}`,
    now: () => ++clock,
    log: (line) => logged.push(line),
  };
  const projects = new TeamProjects(deps);
  const services = [projects];
  workspace.setTeamProjectLookup((projectId) => services.map((service) => service.lookup(projectId)).find(Boolean));
  /** The service as the app builds it after a restart: over the same installation, reading `projects.json` again. */
  const restarted = (overrides: Partial<TeamProjectsDeps> = {}) => {
    services.unshift(new TeamProjects({ ...deps, registry: new TeamProjectRegistry(registryFile, (line) => logged.push(line)), ...overrides }));
    return services[0]!;
  };

  const root = join(home, "dramas");
  mkdirSync(root);

  /**
   * The team of the package fixture, added as a department of this installation: Morgan its Chief, Scout and Quill, a
   * group chat, two routines, own skills, a context, Morgan's memory and picture, and a connection.
   */
  const salesTeam = (): { section: string; byKey: Map<string, BotRecord>; result: PackageImportResult } => {
    const document = parsePackageDocument(JSON.parse(readFileSync(FIXTURE, "utf8")), { trust: "file" });
    const result = importPackageDocument(document, { trust: "file", mode: "add" }, importDeps);
    if (result.alreadyAdded) throw new Error("the sales team is already here");
    const byKey = new Map(result.bots.map((bot) => [bot.installedPackage?.agentKey ?? bot.id, store.bot(bot.id)!]));
    return { section: result.section, byKey, result };
  };

  const snapshot = () => JSON.stringify({
    bots: store.bots.map((bot) => bot.id).sort(), groups: store.groups.map((group) => group.id).sort(),
    routines: routines.listRoutines().map((routine) => routine.id).sort(), sections: store.sections, servers: mcp.servers,
    projects: registry.readable ? registry.projects().map((project) => project.id) : "unreadable",
  });
  const botsOf = (projectId: string) => store.bots.filter((bot) => bot.teamProject?.id === projectId);
  const byRole = (projectId: string) => new Map(botsOf(projectId).map((bot) => [bot.teamProject!.role, bot]));

  return {
    home, dataDir: DATA_DIR, root, store, routines, skills, workspace, sections, importDeps, mcp, memory, logged,
    registry, registryFile, projects, restarted, salesTeam, snapshot, botsOf, byRole,
    scheduled: () => scheduled,
    /** The bots whose own files were put in place, in the order it happened. */
    placed,
    /** What was exported, a department by its name and a bot by its id, in order. */
    exports,
    set onPlace(hook: ((botId: string) => void) | undefined) { hooks.onPlace = hook; },
    set onExport(hook: (() => void) | undefined) { hooks.onExport = hook; },
  };
}

export async function closeTeamProjectsInstallation(app: TeamProjectsTestApp | undefined): Promise<void> {
  const { closeMessageDb } = await import("../message-db.ts");
  closeMessageDb();
  vi.unstubAllEnvs();
  if (app) rmSync(app.home, { recursive: true, force: true });
}
