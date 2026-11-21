// Adapted from basketikun/infinite-canvas@9cd3deac web/src/pages/canvas/project.tsx (keyboard shortcuts), MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useEffect, useRef } from "react";
import type { CanvasTool } from "./canvas-ui";

export interface CanvasShortcutActions {
  undo(): void;
  redo(): void;
  selectAll(): void;
  copy(): boolean;
  duplicate(): void;
  group(): void;
  ungroup(): void;
  remove(): void;
  escape(): void;
  tool(tool: CanvasTool): void;
  /** Space held down or let go. */
  panning(held: boolean): void;
  /** Pastes what was copied on the canvas; false when nothing was, so the system clipboard pastes instead. */
  pasteCopy(): boolean;
  /** The system clipboard's files or text. */
  paste(event: ClipboardEvent): void;
}

const IGNORED = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-canvas-no-zoom], [data-canvas-shortcuts-ignore], [role='dialog'], [role='menu']";

/** A key press the canvas leaves alone: typing in a field or a panel, or in a dialog over it. */
export function ignoresShortcut(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.(IGNORED));
}

export function useCanvasShortcuts(enabled: boolean, actions: CanvasShortcutActions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || ignoresShortcut(event.target)) return;
      const act = latest.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === " " && !mod) {
        event.preventDefault();
        if (!event.repeat) act.panning(true);
        return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) act.redo();
        else act.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        act.redo();
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        act.selectAll();
        return;
      }
      if (mod && key === "c") {
        if (window.getSelection()?.toString()) return;
        if (act.copy()) event.preventDefault();
        return;
      }
      if (mod && key === "v") {
        if (act.pasteCopy()) event.preventDefault();
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        act.duplicate();
        return;
      }
      if (mod && key === "g") {
        event.preventDefault();
        if (event.shiftKey) act.ungroup();
        else act.group();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        act.remove();
        return;
      }
      if (event.key === "Escape") {
        act.escape();
        return;
      }
      if (!mod && !event.altKey && key === "v") act.tool("select");
      if (!mod && !event.altKey && key === "h") act.tool("pan");
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") latest.current.panning(false);
    };
    const onBlur = () => latest.current.panning(false);
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || ignoresShortcut(event.target)) return;
      latest.current.paste(event);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("paste", onPaste);
    };
  }, [enabled]);
}
