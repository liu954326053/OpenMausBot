// The two project-menu actions, opened imperatively the way the app opens its other one-at-a-time dialogs (see
// src/lib/bot-limit.ts): the project menu calls an opener, and a single <TemplateSyncHost/> the app mounts once shows
// the dialog. The deposits are not here; they are buttons inside the bot's own skills and memory.
import { useSyncExternalStore, type ReactElement } from "react";

import { SaveBackToTemplate } from "./SaveBackToTemplate";
import { UpdateFromTemplate } from "./UpdateFromTemplate";

type OpenDialog =
  | { kind: "update"; projectId: string; projectName: string }
  | { kind: "saveBack"; projectId: string; projectName: string; templateName: string };

let current: OpenDialog | null = null;
const listeners = new Set<() => void>();
const emit = (): void => { for (const listener of listeners) listener(); };

/** Open "从模板更新" for a project. */
export function openUpdateFromTemplate(projectId: string, projectName: string): void {
  current = { kind: "update", projectId, projectName };
  emit();
}

/** Open "存回模板" for a project. */
export function openSaveBackToTemplate(projectId: string, info: { projectName: string; templateName: string }): void {
  current = { kind: "saveBack", projectId, projectName: info.projectName, templateName: info.templateName };
  emit();
}

export function closeTemplateSyncDialog(): void {
  current = null;
  emit();
}

const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = (): OpenDialog | null => current;

export function useTemplateSyncDialog(): OpenDialog | null {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Mounted once by the app; shows whichever action a project menu opened. */
export function TemplateSyncHost(): ReactElement | null {
  const open = useTemplateSyncDialog();
  if (!open) return null;
  if (open.kind === "update") {
    return <UpdateFromTemplate projectId={open.projectId} projectName={open.projectName} onClose={closeTemplateSyncDialog} />;
  }
  return <SaveBackToTemplate projectId={open.projectId} projectName={open.projectName} templateName={open.templateName} onClose={closeTemplateSyncDialog} />;
}
