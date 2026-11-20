import { useEffect, useSyncExternalStore } from "react";

import type { TemplateLibraryWire } from "../../shared/template-library";
import { listTemplates } from "../lib/template-library";
import type { BotDraft, TeamDraft } from "../lib/template-library-draft";

/** `shown` of a team template's editor while it shows the team itself, not one of its roles. */
export const TEAM_PAGE = "team";

export interface TeamTemplateEditing {
  kind: "team";
  /** Absent: a template not saved yet. */
  id?: string;
  /** Whether the person changed anything since it was opened. */
  changed: boolean;
  draft: TeamDraft;
  /** `TEAM_PAGE`, or the `id` of the role the editor shows. */
  shown: string;
  carried: { groupChats: number; routines: number };
}

export interface BotTemplateEditing {
  kind: "bot";
  id?: string;
  changed: boolean;
  draft: BotDraft;
}

export type TemplateEditing = TeamTemplateEditing | BotTemplateEditing;

interface TemplateLibraryState {
  /** Null until the first answer. */
  library: TemplateLibraryWire | null;
  failed: boolean;
  /** Kept here, not in the page, so leaving Settings for a moment (to add an MCP server) does not lose what was typed. */
  editing: TemplateEditing | null;
  /** What closing the editor without saving left behind, for as long as the page offers to go on with it. */
  discarded: TemplateEditing | null;
}

let current: TemplateLibraryState = { library: null, failed: false, editing: null, discarded: null };
let asked = 0;
const listeners = new Set<() => void>();
const snapshot = () => current;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function show(next: Partial<TemplateLibraryState>): void {
  current = { ...current, ...next };
  for (const listener of listeners) listener();
}

/** Reads the list again. Of two reads on their way, only the later one's answer is shown. */
export async function refreshTemplateLibrary(): Promise<void> {
  const mine = ++asked;
  try {
    const library = await listTemplates();
    if (mine === asked) show({ library, failed: false });
  } catch {
    if (mine === asked) show({ failed: true });
  }
}

export const editTemplate = (editing: TemplateEditing): void => show({ editing, discarded: null });

/** Changes the open template. Each change starts from the one before it, also when two arrive before the page draws again. */
export function changeEditedTemplate<Editing extends TemplateEditing>(kind: Editing["kind"], change: (editing: Editing) => Editing): void {
  const editing = current.editing;
  if (editing?.kind === kind) show({ editing: change(editing as Editing) });
}

/** Closes the editor. Unsaved changes stay within reach until `forgetDiscardedTemplate`. */
export const closeTemplateEditor = (): void => show({ editing: null, discarded: current.editing?.changed ? current.editing : null });

export const templateSaved = (): void => show({ editing: null, discarded: null });

export const forgetDiscardedTemplate = (): void => show({ discarded: null });

export const currentTemplateLibrary = (): TemplateLibraryState => current;

export function useTemplateLibrary(): TemplateLibraryState {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void refreshTemplateLibrary(); }, []);
  return state;
}
