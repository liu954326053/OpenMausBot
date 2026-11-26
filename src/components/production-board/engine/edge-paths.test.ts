import { describe, expect, it } from "vitest";
import type { BoardCard, BoardEdge } from "@/lib/production-board/types";
import type { Rect } from "./camera";
import { edgePaths } from "./edge-paths";

const edge = (id: string, from: string, to: string, kind: BoardEdge["kind"] = "output"): BoardEdge => ({ id, kind, state: "done", from, to });
const box = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });
const kinds = (entries: Array<[string, BoardCard["kind"]]> = []) => new Map(entries);

describe("a line between two cards", () => {
  it("leaves by the right, enters by the left 7 short of the edge, with an arrowhead and its label halfway", () => {
    const path = edgePaths([edge("e", "a", "b")], new Map([["a", box(0, 0)], ["b", box(300, 0)]]), kinds()).get("e")!;
    expect(path.d).toBe("M100,50 C196.5,50 196.5,50 293,50");
    expect(path.arrow).toBe("M300,50 L291,45.5 L291,54.5 Z");
    expect(path.start).toEqual({ x: 100, y: 50 });
    expect(path.label).toEqual({ x: 196.5, y: 50 });
    expect(path.bounds).toEqual({ x: 100, y: 50, w: 200, h: 0 });
  });

  it("is not drawn when a card of it has no place", () => {
    expect(edgePaths([edge("e", "a", "gone")], new Map([["a", box(0, 0)]]), kinds()).size).toBe(0);
  });

  it("bends by half the gap between its ends, no less than 40 and no more than 300, in numbers of one decimal", () => {
    const near = edgePaths([edge("e", "a", "b")], new Map([["a", box(0, 0)], ["b", box(150.25, 30, 100, 45)]]), kinds()).get("e")!;
    expect(near.d).toBe("M100,50 C140,50 103.3,52.5 143.3,52.5");
    expect(near.arrow).toBe("M150.3,52.5 L141.3,48 L141.3,57 Z");
    expect(near.label).toEqual({ x: 121.6, y: 51.3 });
    expect(near.bounds).toEqual({ x: 100, y: 50, w: 50.3, h: 2.5 });

    const far = edgePaths([edge("e", "a", "b")], new Map([["a", box(0, 0)], ["b", box(1000, 0)]]), kinds()).get("e")!;
    expect(far.d).toBe("M100,50 C400,50 693,50 993,50");
  });

  it("rounds a number just below zero to a plain zero", () => {
    const path = edgePaths([edge("e", "a", "b")], new Map([["a", box(0, -50.04)], ["b", box(300, -50.04)]]), kinds()).get("e")!;
    expect(Object.is(path.start.y, 0)).toBe(true);
    expect(Object.is(path.label.y, 0)).toBe(true);
  });
});

describe("lines that share a side of a card", () => {
  it("spread along it in the order of the cards at their other ends", () => {
    const rects = new Map([["a", box(0, 100)], ["up", box(300, 0)], ["down", box(300, 200)]]);
    const paths = edgePaths([edge("to-down", "a", "down"), edge("to-up", "a", "up")], rects, kinds());
    expect(paths.get("to-up")!.start).toEqual({ x: 100, y: 139 });
    expect(paths.get("to-down")!.start).toEqual({ x: 100, y: 161 });
  });

  it("spread along the side they enter too", () => {
    const rects = new Map([["up", box(0, 0)], ["down", box(0, 200)], ["b", box(300, 100)]]);
    const paths = edgePaths([edge("from-down", "down", "b"), edge("from-up", "up", "b")], rects, kinds());
    expect(paths.get("from-up")!.arrow).toBe("M300,139 L291,134.5 L291,143.5 Z");
    expect(paths.get("from-down")!.arrow).toBe("M300,161 L291,156.5 L291,165.5 Z");
  });

  it("leave no room for a line that is not drawn", () => {
    const paths = edgePaths([edge("lost", "a", "gone"), edge("kept", "a", "b")], new Map([["a", box(0, 0)], ["b", box(300, 0)]]), kinds());
    expect(paths.get("kept")!.start).toEqual({ x: 100, y: 50 });
  });

  it("keep clear of the reference lines, which take no place among them", () => {
    const rects = new Map([["a", box(0, 0, 100, 200)], ["b", box(300, 0, 100, 200)]]);
    const paths = edgePaths([edge("plain", "a", "b"), edge("reference", "a", "b", "ref")], rects, kinds([["a", "character"], ["b", "shot"]]));
    expect(paths.get("plain")!.start).toEqual({ x: 100, y: 100 });
    expect(paths.get("reference")!.start).toEqual({ x: 100, y: 154 });
  });
});

describe("a reference line", () => {
  it("leaves its card by one port toward the shots, a character's entering a shot above the middle and a scene's below", () => {
    const rects = new Map([["face", box(0, 0, 100, 200)], ["place", box(0, 400, 100, 200)], ["shot", box(400, 200, 100, 100)]]);
    const paths = edgePaths([edge("c", "face", "shot", "ref"), edge("s", "place", "shot", "ref")], rects, kinds([["face", "character"], ["place", "scene"], ["shot", "shot"]]));
    expect(paths.get("c")!.start).toEqual({ x: 100, y: 154 });
    expect(paths.get("s")!.start).toEqual({ x: 100, y: 446 });
    expect(paths.get("c")!.arrow.startsWith("M400,214 ")).toBe(true);
    expect(paths.get("s")!.arrow.startsWith("M400,280 ")).toBe(true);
  });

  it("enters a shot below the line of the character above it", () => {
    const rects = new Map([["lower", box(0, 300, 100, 200)], ["upper", box(0, 0, 100, 200)], ["shot", box(400, 200, 100, 100)]]);
    const paths = edgePaths([edge("second", "lower", "shot", "ref"), edge("first", "upper", "shot", "ref")], rects, kinds([["lower", "character"], ["upper", "character"], ["shot", "shot"]]));
    expect(paths.get("first")!.arrow.startsWith("M400,214 ")).toBe(true);
    expect(paths.get("second")!.arrow.startsWith("M400,226 ")).toBe(true);
  });

  it("leaves by the same port as the card's other reference lines, on the side their shots are on average", () => {
    const rects = new Map([["face", box(0, 400, 100, 200)], ["above", box(400, 0)], ["level", box(400, 450)], ["below", box(400, 1200)]]);
    const paths = edgePaths(["above", "level", "below"].map((shot) => edge(shot, "face", shot, "ref")), rects, kinds([["face", "character"]]));
    expect(["above", "level", "below"].map((shot) => paths.get(shot)!.start)).toEqual([{ x: 100, y: 554 }, { x: 100, y: 554 }, { x: 100, y: 554 }]);
  });
});
