import { describe, expect, it } from "vitest";
import type { BoardCard, BoardEdge } from "./types";
import { edgePaths } from "./edge-paths";
import type { BoardRect } from "./layout";

const rect = (x: number, y: number, width = 100, height = 100): BoardRect => ({ x, y, width, height });
const edge = (from: string, to: string, kind: BoardEdge["kind"] = "output"): BoardEdge => ({ id: `${kind}:${from}>${to}`, kind, state: "done", from, to });
const start = (d: string) => d.slice(1, d.indexOf(" ")).split(",").map(Number);
const end = (d: string) => d.slice(d.lastIndexOf(" ") + 1).split(",").map(Number);

describe("the board's lines", () => {
  it("leave a card by its side facing the other and stop short of it for the arrowhead", () => {
    const rects = new Map([["a", rect(0, 0)], ["b", rect(300, 0)], ["c", rect(0, 400)]]);
    const paths = edgePaths([edge("a", "b"), edge("a", "c", "dispatch")], rects, new Map());
    const across = paths.get("output:a>b")!;
    expect(start(across.d)).toEqual([100, 50]);
    expect(end(across.d)).toEqual([293, 50]);
    expect(across.label.x).toBeCloseTo(196.5);
    const down = paths.get("dispatch:a>c")!;
    expect(start(down.d)).toEqual([50, 100]);
    expect(end(down.d)).toEqual([50, 393]);
    expect(down.bounds.y).toBeLessThanOrEqual(100);
    expect(down.bounds.y + down.bounds.height).toBeGreaterThanOrEqual(400);
  });

  it("spread along a side in the order of the cards they go to", () => {
    const rects = new Map([["a", rect(0, 0, 100, 300)], ["top", rect(400, -200)], ["low", rect(400, 400)]]);
    const paths = edgePaths([edge("a", "low"), edge("a", "top")], rects, new Map());
    expect(start(paths.get("output:a>top")!.d)[1]).toBeLessThan(start(paths.get("output:a>low")!.d)[1]);
  });

  it("spread the same way on cards named as a bot's and a result's are", () => {
    const rects = new Map([["bot:lena", rect(0, 0, 100, 300)], ["result:shot-1", rect(400, -200)], ["result:shot-2", rect(400, 400)]]);
    const paths = edgePaths([edge("bot:lena", "result:shot-2"), edge("bot:lena", "result:shot-1")], rects, new Map());
    expect(start(paths.get("output:bot:lena>result:shot-1")!.d)[1]).toBeLessThan(start(paths.get("output:bot:lena>result:shot-2")!.d)[1]);
  });

  it("bring a character's reference into a shot above the middle and a scene's below", () => {
    const rects = new Map([["hero", rect(0, -400)], ["pier", rect(0, 400)], ["shot", rect(400, 0, 200, 200)]]);
    const cards = new Map<string, BoardCard>([
      ["hero", { kind: "character" } as BoardCard],
      ["pier", { kind: "scene" } as BoardCard],
    ]);
    const paths = edgePaths([edge("hero", "shot", "ref"), edge("pier", "shot", "ref")], rects, cards);
    expect(end(paths.get("ref:hero>shot")!.d)[1]).toBeLessThan(100);
    expect(end(paths.get("ref:pier>shot")!.d)[1]).toBeGreaterThan(100);
  });
});
