import { describe, expect, it } from "vitest";
import { botNodeId } from "../../../shared/project-canvas";
import { buildBoard } from "./board";
import type { Board } from "./types";
import { layoutBoard, type BoardCardSizes, type BoardRect } from "./layout";
import { BOARD_BOTS, productionBoardSample } from "@/testing/production-board-sample";

const SIZES: BoardCardSizes = {
  bot: { width: 320, height: 280 },
  brief: { width: 330, height: 300 },
  plan: { width: 330, height: 260 },
  episode: { width: 400, height: 320 },
  stack: { width: 400, height: 220 },
  character: { width: 400, height: 240 },
  scene: { width: 340, height: 260 },
  shot: { width: 470, height: 300 },
  result: { width: 320, height: 230 },
  final: { width: 620, height: 420 },
  other: { width: 340, height: 240 },
};
const sizeOf = (card: Board["cards"][number]) => SIZES[card.kind];
const LEAD = botNodeId(BOARD_BOTS.lead);
const WRITER = botNodeId(BOARD_BOTS.writer);
const overlap = (a: BoardRect, b: BoardRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("the board's layout", () => {
  const snapshot = productionBoardSample();
  const board = buildBoard(snapshot);
  const layout = layoutBoard(board, sizeOf);
  const rect = (id: string) => layout.rects.get(id)!;
  const ofKind = (kind: Board["cards"][number]["kind"]) => board.cards.filter((card) => card.kind === kind).map((card) => rect(card.id));

  it("places every card at its kind's size, none on another", () => {
    expect(layout.rects.size).toBe(board.cards.length);
    for (const card of board.cards) expect(rect(card.id)).toMatchObject(SIZES[card.kind]);
    const rects = [...layout.rects.entries()];
    for (const [at, [id, one]] of rects.entries()) {
      for (const [other, two] of rects.slice(at + 1)) expect(overlap(one, two), `${id} on ${other}`).toBe(false);
    }
  });

  it("runs the stages from left to right", () => {
    const right = (rects: BoardRect[]) => Math.max(...rects.map((one) => one.x + one.width));
    const left = (rects: BoardRect[]) => Math.min(...rects.map((one) => one.x));
    expect(right([rect(LEAD), ...ofKind("brief"), ...ofKind("plan")])).toBeLessThan(rect(WRITER).x);
    expect(right([rect(WRITER)])).toBeLessThan(left(ofKind("episode")));
    expect(right(ofKind("episode"))).toBeLessThan(left(ofKind("character")));
    expect(right(ofKind("shot"))).toBeLessThan(left(ofKind("result")));
    expect(right(ofKind("result"))).toBeLessThan(left(ofKind("final")));
    for (const stage of ["brief", "script", "library", "storyboard", "post"] as const) expect(layout.stages[stage]).toBeDefined();
  });

  it("puts the characters above the episodes' rows and the scenes below", () => {
    const rows = [...layout.lanes.values()];
    const top = Math.min(...rows.map((one) => one.y));
    const bottom = Math.max(...ofKind("stack").map((one) => one.y + one.height));
    for (const one of ofKind("character")) expect(one.y + one.height).toBeLessThan(top);
    for (const one of board.cards.filter((card) => card.kind === "scene" && !card.refinedBy)) expect(rect(one.id).y).toBeGreaterThan(bottom);
  });

  it("gives each unfolded episode a row, its results beside its shots", () => {
    expect([...layout.lanes.keys()]).toEqual(board.unfolded);
    for (const card of board.cards) {
      if (card.kind !== "result") continue;
      const shot = rect(card.shotId);
      const result = rect(card.id);
      expect(result.y + result.height / 2).toBeCloseTo(shot.y + shot.height / 2);
      const lane = layout.lanes.get(card.episode)!;
      expect(shot.y).toBeGreaterThanOrEqual(lane.y);
      expect(shot.y + shot.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
  });

  it("keeps a card where the person put it", () => {
    const moved = productionBoardSample();
    const node = moved.nodes.find((one) => one.id === WRITER)!;
    node.position = { x: -5000, y: 7000 };
    node.arranged = true;
    const again = layoutBoard(buildBoard(moved), sizeOf);
    expect(again.rects.get(WRITER)).toMatchObject({ x: -5000, y: 7000 });
    expect(again.rects.get(LEAD)).toEqual(rect(LEAD));
  });

  it("does not move the rows above an episode the person unfolds", () => {
    const opened = layoutBoard(buildBoard(snapshot, { opened: new Set([board.folded.at(-1)!]) }), sizeOf);
    const first = board.unfolded[0]!;
    expect(opened.lanes.get(first)).toEqual(layout.lanes.get(first));
    expect(opened.rects.get(LEAD)).toEqual(rect(LEAD));
  });
});
