import { randomUUID } from "node:crypto";
import { watchFile } from "node:fs";
import { join } from "node:path";

import type { TeamProjectLookup, TeamProjectsApi } from "../../shared/team-projects.ts";
import { DATA_DIR } from "../config.ts";
import type { PackageImportDeps } from "../package-import.ts";
import { createTeamProjectRoutes } from "../routes/team-projects.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { Routine, RoutineManager } from "../routines.ts";
import { SECTION_CONTEXTS_FILE, ensureSectionMemoryKey, readSectionContext, sectionOfMemoryKey, writeSectionContext } from "../section-context.ts";
import type { ShareTarget } from "../share.ts";
import type { BotRecord, Store } from "../store.ts";
import type { TeamMemory } from "../team-memory.ts";
import { ensureWorkspace } from "../workspace.ts";
import type { ExportedTeam } from "./create.ts";
import { TeamProjectRegistry } from "./registry.ts";
import { TeamProjects } from "./service.ts";

export interface TeamProjectsHostDeps {
  store: Store;
  routines(): RoutineManager | null;
  teamMemory: TeamMemory;
  importDeps(): Promise<PackageImportDeps>;
  /** Deletes a bot as a person deleting it would. Null when it is gone; else why it could not be deleted now. */
  deleteBot(botId: string): Promise<string | null>;
  /** The share export of a department or of one bot, with these routines and carrying the skills `carries` picks. */
  exportDocument(target: ShareTarget, routines: readonly Routine[], carries: (bot: BotRecord, skill: string) => boolean): ExportedTeam;
  /** The names of the skills a bot learned itself. */
  ownSkillNames(botId: string): readonly string[];
  /** The app's language, for the first lines of a new bot's memory. */
  language(): string | undefined;
}

export interface TeamProjectsHost {
  api: TeamProjectsApi;
  /** The folder new projects are made in; null until a person chooses one. Throws while the list of projects cannot be read. */
  root(): string | null;
  /** For whoever places a project bot's own files and decides whether it may run. */
  lookup: TeamProjectLookup;
  routes: RouteHandler;
  /** For a Chief's team setup: throws when a change would move a bot into or out of a project, or the main bot into a department. */
  checkSetupChange: TeamProjects["checkSetupChange"];
  /** Why a change to these fields of a bot is refused: it is a copy that shows what its source shows. Null otherwise. */
  copyRefusal: TeamProjects["copyRefusal"];
  setupRefusal: TeamProjects["setupRefusal"];
}

const COPIES_SETTLE_MS = 1000;
const SOURCE_POLL_MS = 2000;
const TEAM_MEMORY_FILE = join(DATA_DIR, "team-memory.json");

/** Projects for this installation: the list in `<data dir>/projects.json`, followed from the moment this returns. */
export function createTeamProjectsHost(deps: TeamProjectsHostDeps): TeamProjectsHost {
  let timer: NodeJS.Timeout | undefined;
  const projects = new TeamProjects({
    registry: new TeamProjectRegistry(join(DATA_DIR, "projects.json")),
    store: deps.store,
    dataDir: DATA_DIR,
    routines: deps.routines,
    ensureWorkspace: (botId) => { ensureWorkspace(botId, deps.language()); },
    importDeps: deps.importDeps,
    deleteBot: deps.deleteBot,
    exportDocument: (target, carries) => deps.exportDocument(target, deps.routines()?.listRoutines() ?? [], carries),
    ownSkillNames: deps.ownSkillNames,
    teamKey: ensureSectionMemoryKey,
    teamOfKey: sectionOfMemoryKey,
    context: (section) => readSectionContext(section)?.text ?? "",
    setContext: (section, text) => { writeSectionContext(section, text); },
    memory: (section) => deps.teamMemory.list(section),
    schedule: (flush) => {
      timer ??= setTimeout(() => { timer = undefined; flush(); }, COPIES_SETTLE_MS);
      timer.unref();
    },
    newId: randomUUID,
  });
  projects.start();
  // fs.watch follows the file it opened, and both files are replaced by a rename on every save, so only polling by
  // path keeps seeing them (Node.js docs, fs.watch caveats, "Inodes").
  watchFile(SECTION_CONTEXTS_FILE, { interval: SOURCE_POLL_MS, persistent: false }, () => projects.contextsChanged());
  watchFile(TEAM_MEMORY_FILE, { interval: SOURCE_POLL_MS, persistent: false }, () => projects.touchAll());
  return {
    api: projects, root: () => projects.listWire().root, lookup: projects.lookup, routes: createTeamProjectRoutes(projects),
    checkSetupChange: (before, fields) => projects.checkSetupChange(before, fields),
    copyRefusal: (botId, fields) => projects.copyRefusal(botId, fields),
    setupRefusal: (target, fields) => projects.setupRefusal(target, fields),
  };
}
