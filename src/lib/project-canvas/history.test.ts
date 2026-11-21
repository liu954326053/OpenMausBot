import { describe, expect, it } from "vitest";
import type { CanvasOp } from "../../../shared/project-canvas";
import { emptyHistory, HISTORY_LIMIT, recordHistory, redoHistory, undoHistory } from "./history";

const op = (title: string): CanvasOp => ({ type: "update_node", id: "a", patch: { title } });
const entry = (n: number) => ({ forward: [op(`after ${n}`)], inverse: [op(`before ${n}`)] });

describe("canvas history", () => {
  it("undoes the latest change first and redoes it again", () => {
    let history = recordHistory(recordHistory(emptyHistory(), entry(1)), entry(2));
    const undone = undoHistory(history)!;
    expect(undone.entry).toEqual(entry(2));
    history = undone.history;
    expect(history.past).toEqual([entry(1)]);
    const redone = redoHistory(history)!;
    expect(redone.entry).toEqual(entry(2));
    expect(redone.history.past).toEqual([entry(1), entry(2)]);
    expect(redone.history.future).toEqual([]);
  });

  it("forgets what could be redone once something new happens", () => {
    const undone = undoHistory(recordHistory(emptyHistory(), entry(1)))!.history;
    expect(recordHistory(undone, entry(2))).toEqual({ past: [entry(2)], future: [] });
  });

  it("keeps the last 50 changes", () => {
    let history = emptyHistory();
    for (let n = 0; n < HISTORY_LIMIT + 5; n += 1) history = recordHistory(history, entry(n));
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toEqual(entry(5));
  });

  it("ignores a change that did nothing and has nothing to undo or redo when empty", () => {
    expect(recordHistory(emptyHistory(), { forward: [op("x")], inverse: [] })).toEqual(emptyHistory());
    expect(undoHistory(emptyHistory())).toBeNull();
    expect(redoHistory(emptyHistory())).toBeNull();
  });
});
