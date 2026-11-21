import type { CanvasOp } from "../../../shared/project-canvas";

export const HISTORY_LIMIT = 50;

/** One undoable change: the ops that made it and the ops that take it back. */
export interface HistoryEntry {
  forward: CanvasOp[];
  inverse: CanvasOp[];
}

export interface CanvasHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const emptyHistory = (): CanvasHistory => ({ past: [], future: [] });

export function recordHistory(history: CanvasHistory, entry: HistoryEntry): CanvasHistory {
  if (!entry.forward.length || !entry.inverse.length) return history;
  return { past: [...history.past.slice(-(HISTORY_LIMIT - 1)), entry], future: [] };
}

/** The entry to take back, and the history once it is. */
export function undoHistory(history: CanvasHistory): { history: CanvasHistory; entry: HistoryEntry } | null {
  const entry = history.past.at(-1);
  if (!entry) return null;
  return { entry, history: { past: history.past.slice(0, -1), future: [...history.future, entry] } };
}

export function redoHistory(history: CanvasHistory): { history: CanvasHistory; entry: HistoryEntry } | null {
  const entry = history.future.at(-1);
  if (!entry) return null;
  return { entry, history: { past: [...history.past, entry], future: history.future.slice(0, -1) } };
}
