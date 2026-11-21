import { useEffect, useRef } from "react";

import type { Action, AppState } from "./store";
import { useTeamProjectSide } from "./team-projects";

export const LAST_PROJECT_KEY = "openmausbot.lastProject.v1";

function readLastProject(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_PROJECT_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function rememberProject(id: string | null): void {
  try {
    if (id) globalThis.localStorage?.setItem(LAST_PROJECT_KEY, id);
    else globalThis.localStorage?.removeItem(LAST_PROJECT_KEY);
  } catch {
  }
}

type Shown = Pick<AppState, "activeView" | "project" | "hydrated" | "selectedId">;

/** A window closed on a project's view opens on it again, once the list of projects is read, if the project is still
 * there and the person opened nothing else first. */
export function useLastProject(shown: Shown, dispatch: (action: Action) => void): void {
  const side = useTeamProjectSide();
  const waiting = useRef<string | null | undefined>(undefined);
  if (waiting.current === undefined) waiting.current = readLastProject();
  const startedOn = useRef<string | null>(null);
  const open = shown.activeView === "project" ? shown.project?.id ?? null : null;
  const place = `${shown.activeView}:${shown.selectedId}`;

  useEffect(() => {
    const id = waiting.current;
    if (!id || shown.hydrated !== true) return;
    startedOn.current ??= place;
    if (startedOn.current !== place) {
      waiting.current = null;
      rememberProject(open);
      return;
    }
    if (!side.shown) return;
    waiting.current = null;
    if (side.projects.some((project) => project.id === id)) dispatch({ type: "showProject", projectId: id });
    else rememberProject(null);
  }, [shown.hydrated, place, open, side, dispatch]);

  useEffect(() => {
    if (!waiting.current) rememberProject(open);
  }, [open]);
}
