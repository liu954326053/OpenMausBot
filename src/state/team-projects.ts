// The projects as the sidebar, the New project dialog and Settings show them: one copy of the server's list. It is read
// again when the server says the list or a project's folder changed, when the set of bots or departments changes, after
// every change made here, when the window gets focus again, and shortly after a read that failed. A server without
// projects answers 404 and is not asked again.
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

type ReadOutcome = "landed" | "failed";
const readOutcomes = new Set<(outcome: ReadOutcome) => void>();
const tell = (outcome: ReadOutcome) => { for (const listener of readOutcomes) listener(outcome); };
const worthRetrying = (error: { status?: number; name?: string }) => error.name !== "AbortError" && (error.status === undefined || error.status >= 500);

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
        const answer = await listTeamProjects({ background, signal: unasked?.signal }).catch((error: { status?: number; name?: string }) => {
          if (error.status === 404 || error.status === 403) { offered = false; show(null); }
          else if (worthRetrying(error)) tell("failed");
          return null;
        });
        if (answer && Array.isArray(answer.projects) && seq >= shown) { shown = seq; show(answer); tell("landed"); }
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

const isProjectsEvent = (frame: unknown) => (frame as Partial<TeamProjectsEvent>).kind === "team-projects";

/** Reads the list when the server says a project was added, changed or taken off, or its folder went missing or came back,
 * and when the live stream came back without the frames it missed. Returns how to stop. */
export function followTeamProjectEvents(): () => void {
  const again = () => { void refreshTeamProjects({ background: true }); };
  return listenLiveFrames({ onFrame: (frame) => { if (isProjectsEvent(frame)) again(); }, onMissedFrames: again });
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/** Reads the list again after a read that failed on the way or on the server, once after each of `delaysMs`, until a
 * read lands. Returns how to stop. */
export function retryFailedTeamProjectReads(delaysMs: readonly number[] = RETRY_DELAYS_MS): () => void {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onOutcome = (outcome: ReadOutcome) => {
    clearTimeout(timer);
    timer = undefined;
    if (outcome === "landed") { failures = 0; return; }
    const delay = delaysMs[failures++];
    if (delay !== undefined) timer = setTimeout(() => { timer = undefined; void refreshTeamProjects({ background: true }); }, delay);
  };
  readOutcomes.add(onOutcome);
  return () => {
    clearTimeout(timer);
    readOutcomes.delete(onOutcome);
  };
}

/** Reads the list when `version` changes (`teamProjectsVersion`), when the server says the list or a folder changed, when
 * the window gets focus again, and again shortly after a read that failed. */
export function useTeamProjectsLoader(version: string): void {
  useEffect(() => { void refreshTeamProjects({ background: true }); }, [version]);
  useEffect(followTeamProjectEvents, []);
  useEffect(() => retryFailedTeamProjectReads(), []);
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
