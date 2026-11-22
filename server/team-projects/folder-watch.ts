import type { TeamProjectsEvent, TeamProjectWire } from "../../shared/team-projects.ts";
import { teamProjectFolderReadyAsync } from "../team-project-folders.ts";

type FolderState = TeamProjectWire["folderState"];
export type FolderChange = Required<Omit<TeamProjectsEvent, "kind">>;

const folderStateOf = async (folder: string): Promise<FolderState> => ((await teamProjectFolderReadyAsync(folder)) ? "ready" : "missing");

/** Each project's folder as last seen. A look returns the projects whose folder went missing or came back since the look
 * before. A project is new to its first look while its folder is there, as it was when made; one already missing is
 * returned, as whoever read the list before saw it there. */
export class ProjectFolderStates {
  private readonly seen = new Map<string, FolderState>();
  private readonly stateOf: (folder: string) => Promise<FolderState>;

  constructor(stateOf: (folder: string) => Promise<FolderState> = folderStateOf) {
    this.stateOf = stateOf;
  }

  /** One folder at a time, so a drive that never answers holds up one look and nothing else. */
  async look(projects: ReadonlyArray<{ id: string; folder: string }>): Promise<FolderChange[]> {
    const listed = new Set(projects.map((project) => project.id));
    for (const id of this.seen.keys()) if (!listed.has(id)) this.seen.delete(id);
    const changes: FolderChange[] = [];
    for (const project of projects) {
      const folderState = await this.stateOf(project.folder);
      const before = this.seen.get(project.id) ?? "ready";
      this.seen.set(project.id, folderState);
      if (before !== folderState) changes.push({ projectId: project.id, folderState });
    }
    return changes;
  }
}

const listeners = new Set<(change: FolderChange) => void>();

/** Calls `listener` when a project's folder goes missing or comes back, as `watchProjectFolders` sees it. */
export function onTeamProjectFolderChange(listener: (change: FolderChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Looks at every project's folder now and every `everyMs`, a look at a time, and tells the listeners what changed.
 * Returns how to stop. */
export function watchProjectFolders(projects: () => ReadonlyArray<{ id: string; folder: string }>, everyMs: number, states = new ProjectFolderStates()): () => void {
  let looking = false;
  const look = async () => {
    if (looking) return;
    looking = true;
    try {
      for (const change of await states.look(projects())) for (const listener of listeners) listener(change);
    } catch (error) {
      // Security: the error's name only; its message can hold a project's folder path.
      console.error(`team projects: a look at the project folders failed (${error instanceof Error ? error.name : "unknown"})`);
    } finally {
      looking = false;
    }
  };
  void look();
  const timer = setInterval(() => void look(), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
