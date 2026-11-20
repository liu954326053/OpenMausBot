import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import type { TeamTemplateContent } from "../../shared/template-library.ts";
import type { PackageImportDeps } from "../package-import.ts";
import type { TeamMemoryLine } from "./copies.ts";
import type { TeamProjectsDeps } from "./service.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "shared", "package-fixtures", "full-team.v2.json");

export type TeamProjectsTestApp = Awaited<ReturnType<typeof teamProjectsInstallation>>;

/**
 * A whole installation in a throwaway home: the real bot store, routines and package importer under the projects
 * service, with a template library, a skills library and a team memory the test fills by hand.
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
  const { saveImage } = await import("../attachments.ts");
  const { botAvatarUrlFromStoredPath } = await import("../../shared/bot-avatar.ts");
  const { parsePackageDocument } = await import("../../shared/package-format.ts");
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

  const templates = new Map<string, TeamTemplateContent>();
  const librarySkills = ["beat-sheet"];
  const memory = new Map<string, TeamMemoryLine[]>();
  const logged: string[] = [];
  let clock = 1_800_000_000_000;
  let ids = 0;
  let scheduled = 0;
  const placed: string[] = [];
  const hooks: { onPlace?: (botId: string) => void } = {};
  const registryFile = join(DATA_DIR, "projects.json");
  const registry = new TeamProjectRegistry(registryFile, (line) => logged.push(line));
  const deps: TeamProjectsDeps = {
    registry, store, dataDir: DATA_DIR,
    routines: () => routines,
    ensureWorkspace: (botId) => { placed.push(botId); hooks.onPlace?.(botId); },
    templates: { readTeam: (id) => templates.get(id) ?? null },
    importDeps: async () => importDeps,
    librarySkillNames: () => librarySkills,
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

  /** The team of the package fixture as a team template: a lead, two members, a room, two routines, skills and a connection. */
  const salesTemplate = (patch: Partial<TeamTemplateContent> = {}): TeamTemplateContent => {
    const document = parsePackageDocument(JSON.parse(readFileSync(FIXTURE, "utf8")), { trust: "file" });
    return {
      id: "sales", name: "Sales crew", genre: "Selling to companies", version: 3, updatedAt: 1, lead: "lead",
      roles: document.package.agents.map((agent) => ({ key: agent.key, name: agent.name, title: agent.title ?? "" })),
      document,
      extras: {
        lead: { model: { instanceId: "codex", model: "gpt-test", effort: "high" }, librarySkills: ["beat-sheet", "not-in-library"], mcpServers: ["drive"] },
        scout: { librarySkills: ["beat-sheet", "also-missing"] },
        writer: { librarySkills: [], look: { mascotFaceColor: "black", avatarZoom: 2, avatarFocusX: 0.25, avatarFocusY: 0.75 } },
      },
      ...patch,
    };
  };

  const snapshot = () => JSON.stringify({
    bots: store.bots.map((bot) => bot.id).sort(), groups: store.groups.map((group) => group.id).sort(),
    routines: routines.listRoutines().map((routine) => routine.id).sort(), sections: store.sections, servers: mcp.servers,
    projects: registry.readable ? registry.projects().map((project) => project.id) : "unreadable",
  });
  const botsOf = (projectId: string) => store.bots.filter((bot) => bot.teamProject?.id === projectId);
  const byRole = (projectId: string) => new Map(botsOf(projectId).map((bot) => [bot.teamProject!.role, bot]));

  return {
    home, dataDir: DATA_DIR, root, store, routines, skills, workspace, sections, importDeps, mcp, templates, librarySkills, memory, logged,
    registry, registryFile, projects, restarted, salesTemplate, snapshot, botsOf, byRole,
    scheduled: () => scheduled,
    /** The bots whose own files were put in place, in the order it happened. */
    placed,
    set onPlace(hook: ((botId: string) => void) | undefined) { hooks.onPlace = hook; },
  };
}

export async function closeTeamProjectsInstallation(app: TeamProjectsTestApp | undefined): Promise<void> {
  const { closeMessageDb } = await import("../message-db.ts");
  closeMessageDb();
  vi.unstubAllEnvs();
  if (app) rmSync(app.home, { recursive: true, force: true });
}
