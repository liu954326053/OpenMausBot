import { describe, expect, it } from "vitest";
import { drawMinimap, minimapColor, minimapFrame, minimapPoint, type MinimapColors } from "./minimap";

const COLORS: MinimapColors = { bg: "bg", plain: "plain", working: "working", done: "done", idle: "idle", sheet: "sheet", view: "view", viewFill: "fill" };

describe("the minimap", () => {
  it("is as wide as its box and as tall as the world's shape", () => {
    expect(minimapFrame({ x: -60, y: -60, w: 2000, h: 1000 }, 208)).toEqual({ world: { x: -60, y: -60, w: 2000, h: 1000 }, scale: 0.104, width: 208, height: 104 });
  });

  it("turns a point of it into a point of the world", () => {
    const frame = minimapFrame({ x: -60, y: -60, w: 2000, h: 1000 }, 208);
    const at = minimapPoint(frame, 104, 52);
    expect(at.x).toBeCloseTo(940, 6);
    expect(at.y).toBeCloseTo(440, 6);
  });

  it("colours a bot by its state, paper as paper and a video by its state", () => {
    expect(minimapColor("bot", "working", COLORS)).toBe("working");
    expect(minimapColor("bot", "done", COLORS)).toBe("done");
    expect(minimapColor("bot", "waiting", COLORS)).toBe("idle");
    expect((["brief", "plan", "episode", "stack", "shot"] as const).map((kind) => minimapColor(kind, undefined, COLORS))).toEqual(["sheet", "sheet", "sheet", "sheet", "sheet"]);
    expect(minimapColor("result", "done", COLORS)).toBe("done");
    expect(minimapColor("result", "working", COLORS)).toBe("working");
    expect(minimapColor("result", "waiting", COLORS)).toBe("plain");
    expect(minimapColor("character", undefined, COLORS)).toBe("plain");
  });

  it("draws its ground, each card no smaller than two pixels, and what the camera shows as a frame", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      setTransform: (...at: number[]) => calls.push(`transform ${at.join(" ")}`),
      clearRect: (...at: number[]) => calls.push(`clear ${at.join(" ")}`),
      fillRect(...at: number[]) {
        calls.push(`fill ${this.fillStyle} ${at.join(" ")}`);
      },
      strokeRect(...at: number[]) {
        calls.push(`stroke ${this.strokeStyle} ${this.lineWidth} ${at.join(" ")}`);
      },
    };
    const frame = minimapFrame({ x: -100, y: -100, w: 1000, h: 500 }, 250);
    const items = [
      { rect: { x: 100, y: 300, w: 400, h: 200 }, color: "sheet" },
      { rect: { x: -100, y: -100, w: 4, h: 4 }, color: "plain" },
    ];
    drawMinimap(ctx as unknown as CanvasRenderingContext2D, frame, 2, items, { x: -200, y: -100, z: 2 }, { width: 800, height: 400 }, COLORS);
    expect(calls).toEqual([
      "transform 2 0 0 2 0 0",
      "clear 0 0 250 125",
      "fill bg 0 0 250 125",
      "fill sheet 50 100 100 50",
      "fill plain 0 0 2 2",
      "fill fill 50 37.5 100 50",
      "stroke view 1.25 50.5 38 99 49",
    ]);
  });
});
