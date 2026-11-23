import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../../../shared/project-canvas";
import { canvasOutline, filmClock, shotLengthMs } from "./outline";

const node = (id: string, patch: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 340, height: 240, ...patch });
const group = (id: string, title: string, y: number): CanvasNode => node(id, { type: "group", title, position: { x: 0, y } });
const shot = (id: string, y: number): CanvasNode => node(id, { type: "shot", title: id, position: { x: 0, y } });
const take = (id: string, shotId: string, durationMs?: number, selected = false): CanvasNode =>
  node(id, { type: "video", metadata: { role: "take", shotId, ...(selected ? { selected: true } : {}), ...(durationMs === undefined ? {} : { durationMs }) } });
const creation = (shotId: string, seconds: number): CanvasNode => node(`${shotId}-creation`, { type: "config", metadata: { role: "creation", shotId, generationMode: "video", settings: { seconds } } });

describe("a canvas's outline", () => {
  it("lists each character once, by the group it is in when it has one, and the groups that are nobody's", () => {
    const outline = canvasOutline([
      group("alan-group", "Alan", 0),
      node("alan", { position: { x: 40, y: 52 }, groupId: "alan-group", metadata: { role: "character" } }),
      node("alan-again", { position: { x: 40, y: 400 }, groupId: "alan-group", metadata: { role: "character" } }),
      node("zhou", { title: "Zhou", position: { x: 0, y: 800 }, metadata: { role: "character" } }),
      group("rooftop", "Rooftop", 1200),
      node("notes", { position: { x: 0, y: 1600 } }),
    ]);
    expect(outline.characters.map((entry) => [entry.nodeId, entry.node.title])).toEqual([["alan-group", "Alan"], ["zhou", "Zhou"]]);
    expect(outline.scenes.map((entry) => [entry.nodeId, entry.node.title])).toEqual([["rooftop", "Rooftop"]]);
    expect(outline.shots).toEqual([]);
  });

  it("puts the shots in the canvas's order, each with its selected take's length and where it starts in the film", () => {
    const outline = canvasOutline([
      shot("s2", 400),
      shot("s1", 0),
      take("s1-long", "s1", 999_000),
      take("s1-selected", "s1", 5_000, true),
      take("s2-selected", "s2", 10_000, true),
      take("s2-short", "s2", 4_000),
    ]);
    expect(outline.shots.map((entry) => [entry.nodeId, entry.durationMs, entry.fromMs])).toEqual([["s1", 5_000, 0], ["s2", 10_000, 5_000]]);
  });

  it("falls back to the newest take with a length, then to the seconds the shot asks for", () => {
    expect(shotLengthMs([shot("s1", 0), take("selected", "s1", undefined, true), take("later", "s1", 8_000)], "s1")).toBe(8_000);
    expect(shotLengthMs([shot("s2", 0), creation("s2", 6)], "s2")).toBe(6_000);
    expect(shotLengthMs([shot("s3", 0)], "s3")).toBeUndefined();
  });

  it("gives a length it knows but no place in the film once a shot before it has none", () => {
    const outline = canvasOutline([shot("s1", 0), shot("s2", 400), shot("s3", 800), take("s1-take", "s1", 5_000, true), take("s3-take", "s3", 7_000, true)]);
    expect(outline.shots.map((entry) => [entry.nodeId, entry.durationMs, entry.fromMs])).toEqual([["s1", 5_000, 0], ["s2", undefined, undefined], ["s3", 7_000, undefined]]);
  });

  it("writes a moment as minutes and seconds, and hours past the hour", () => {
    expect(filmClock(0)).toBe("00:00");
    expect(filmClock(59_900)).toBe("00:59");
    expect(filmClock(65_000)).toBe("01:05");
    expect(filmClock(3_725_000)).toBe("1:02:05");
    expect(filmClock(-1)).toBe("00:00");
  });
});
