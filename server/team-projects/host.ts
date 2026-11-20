import { randomUUID } from "node:crypto";
import { watchFile } from "node:fs";
import { join } from "node:path";

import type { TeamProjectLookup, TeamProjectTemplateSetter, TeamProjectsApi } from "../../shared/team-projects.ts";
import type { TemplateLibraryApi } from "../../shared/template-library.ts";
import { DATA_DIR } from "../config.ts";
import type { PackageImportDeps } from "../package-import.ts";
import { createTeamProjectRoutes } from "../routes/team-projects.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { RoutineManager } from "../routines.ts";
import { SECTION_CONTEXTS_FILE, readSectionContext } from "../section-context.ts";
import { readSkillLibraryIndex } from "../skill-library.ts";
import type { Store } from "../store.ts";
import type { TeamMemory } from "../team-memory.ts";
import { ensureWorkspace } from "../workspace.ts";
import { TeamProjectRegistry } from "./registry.ts";
import { TeamProjects } from "./service.ts";

export interface TeamProjectsHostDeps {
  store: Store;
  routines(): RoutineManager | null;
  teamMemory: TeamMemory;
  templates: Pick<TemplateLibraryApi, "readTeam">;
  importDeps(): Promise<PackageImportDeps>;
  /** The app's language, for the first lines of a new bot's memory. */
  language(): string | undefined;
}

export interface TeamProjectsHost {
  api: TeamProjectsApi & TeamProjectTemplateSetter;
  /** The folder new projects are made in; null until a person chooses one. Throws while the list of projects cannot be read. */
  root(): string | null;
  /** For whoever places a project bot's own files and decides whether it may run. */
  lookup: TeamProjectLookup;
  routes: RouteHandler;
  /** For a Chief's team setup: throws when a change would move a bot into or out of a project. */
  checkSetupChange: TeamProjects["checkSetupChange"];
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
    templates: deps.templates,
    importDeps: deps.importDeps,
    librarySkillNames: () => Object.values(readSkillLibraryIndex()).map((skill) => skill.name),
    context: (section) => readSectionContext(section)?.text ?? "",
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
  for (const file of [SECTION_CONTEXTS_FILE, TEAM_MEMORY_FILE]) watchFile(file, { interval: SOURCE_POLL_MS, persistent: false }, () => projects.touchAll());
  return { api: projects, root: () => projects.listWire().root, lookup: projects.lookup, routes: createTeamProjectRoutes(projects), checkSetupChange: (before, fields) => projects.checkSetupChange(before, fields) };
}
