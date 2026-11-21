// The projects as the sidebar, the New project dialog and Settings show them: one copy of the server's list. It is read
// again when the server says a project's folder went missing or came back, when the set of bots or departments changes,
// after every change made here, and when the window gets focus again. A server without projects answers 404 and is not
// asked again.
import { useEffect, useSyncExternalStore } from "react";
import type { CreateTeamProjectInput, TeamChangesInput, TeamChangesResult, TeamProjectsEvent, TeamProjectsListWire, TeamProjectWire } from "../../shared/team-projects";
import { listenLiveFrames } from "../lib/live-events";
import { teamProjectSide, type TeamProjectSide } from "../lib/team-projects";
import {
  archiveTeamProject, createTeamProject, decideTeamChanges, listTeamProjects, restoreTeamProject, saveTeamProjectsRoot, type CreateTeamProjectOutcome,
} from "../lib/team-projects-api";

let list: TeamProjectsListWire | null = null;
let creating: string | null = null;
let side = teamProjectSide(list, creating);
let offered = true;
const listeners = new Set<() => void>();

function show(next: TeamProjectsListWire | null, making: string | null = creating): void {
  list = next;
  creating = making;
  side = teamProjectSide(list, creating);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const currentTeamProjectSide = (): TeamProjectSide => side;
export const useTeamProjectSide = (): TeamProjectSide => useSyncExternalStore(subscribe, currentTeamProjectSide, currentTeamProjectSide);

// Every read and every change takes the next number, and a list from the server lands only if nothing later was shown:
// an answer that set out before a change never undoes it.
let sent = 0, shown = 0;
let reading: Promise<void> | null = null;
let readAgain = false;
let quiet = true;
let unasked: AbortController | null = null;

/** Reads the list now, or once more after the read on its way, so the newest answer lands last. A read nobody asked for
 * (`background`) waits while the page is out of sight; one the person's own change asks for takes its place at once.
 * The first read never waits: until it lands a project's department is drawn as a department. */
export function refreshTeamProjects(init?: { background?: boolean }): Promise<void> {
  if (!offered) return Promise.resolve();
  if (!init?.background || list === null) {
    quiet = false;
    unasked?.abort();
  }
  if (reading) { readAgain = true; return reading; }
  reading = (async () => {
    try {
      do {
        readAgain = false;
        const seq = ++sent, background = quiet;
        quiet = true;
        unasked = background ? new AbortController() : null;
        const answer = await listTeamProjects({ background, signal: unasked?.signal }).catch((error: { status?: number }) => {
          if (error.status === 404 || error.status === 403) { offered = false; show(null); }
          return null;
        });
        if (answer && Array.isArray(answer.projects) && seq >= shown) { shown = seq; show(answer); }
      } while (readAgain && offered);
    } finally {
      reading = null;
      unasked = null;
    }
  })();
  return reading;
}

function change(next: (current: TeamProjectsListWire) => TeamProjectsListWire, making: string | null = creating): void {
  shown = ++sent;
  show(list && next(list), making);
}

const placed = (project: TeamProjectWire) => (current: TeamProjectsListWire): TeamProjectsListWire => ({
  ...current,
  projects: current.projects.some((other) => other.id === project.id)
    ? current.projects.map((other) => (other.id === project.id ? project : other))
    : [...current.projects, project],
});

/** While the project is made its department is already kept out of the departments: its bots arrive before the answer. */
export async function createProject(input: CreateTeamProjectInput): Promise<CreateTeamProjectOutcome> {
  show(list, input.name.trim());
  try {
    const outcome = await createTeamProject(input);
    if ("project" in outcome) change(placed(outcome.project), null);
    return outcome;
  } finally {
    if (creating !== null) show(list, null);
    void refreshTeamProjects();
  }
}

async function changed(request: Promise<TeamProjectWire>): Promise<TeamProjectWire> {
  try {
    const project = await request;
    change(placed(project));
    return project;
  } finally {
    void refreshTeamProjects();
  }
}

export const archiveProject = (id: string): Promise<TeamProjectWire> => changed(archiveTeamProject(id));
export const restoreProject = (id: string): Promise<TeamProjectWire> => changed(restoreTeamProject(id));

export async function decideProjectTeamChanges(id: string, input: TeamChangesInput): Promise<TeamChangesResult> {
  const result = decideTeamChanges(id, input);
  await changed(result.then((decided) => decided.project));
  return result;
}

export async function saveProjectsRoot(path: string): Promise<{ root: string } | { error: string }> {
  const saved = await saveTeamProjectsRoot(path);
  if ("root" in saved) change((current) => ({ ...current, root: saved.root }));
  void refreshTeamProjects();
  return saved;
}

const isFolderEvent = (frame: unknown) => (frame as Partial<TeamProjectsEvent>).kind === "team-projects";

/** Reads the list when the server says a project's folder went missing or came back, and when the live stream came back
 * without the frames it missed. Returns how to stop. */
export function followTeamProjectEvents(): () => void {
  const again = () => { void refreshTeamProjects({ background: true }); };
  return listenLiveFrames({ onFrame: (frame) => { if (isFolderEvent(frame)) again(); }, onMissedFrames: again });
}

/** Reads the list when `version` changes (`teamProjectsVersion`), when the server says a folder changed, and when the
 * window gets focus again. */
export function useTeamProjectsLoader(version: string): void {
  useEffect(() => { void refreshTeamProjects({ background: true }); }, [version]);
  useEffect(followTeamProjectEvents, []);
  useEffect(() => {
    const again = () => { void refreshTeamProjects({ background: true }); };
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
}

/** Tests and previews show a list of their own. */
export function setTeamProjects(next: TeamProjectsListWire | null): void {
  offered = true;
  reading = null;
  unasked = null;
  readAgain = false;
  quiet = true;
  shown = ++sent;
  show(next, null);
}
