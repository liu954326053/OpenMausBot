import { afterEach, describe, expect, it, vi } from "vitest";
import { CANVAS_NODE_SIZE } from "../../../shared/project-canvas";
import { freeSpot, PLACEMENT_GAP, uploadedNodeSize } from "./placement";

type Frame = { position: { x: number; y: number }; width: number; height: number };

const TEXT = CANVAS_NODE_SIZE.text;
const at = (x: number, y: number, size = TEXT): Frame => ({ position: { x, y }, ...size });
const clearOf = (a: Frame, b: Frame) =>
  a.position.x >= b.position.x + b.width + PLACEMENT_GAP || b.position.x >= a.position.x + a.width + PLACEMENT_GAP
  || a.position.y >= b.position.y + b.height + PLACEMENT_GAP || b.position.y >= a.position.y + a.height + PLACEMENT_GAP;

afterEach(() => vi.unstubAllGlobals());

describe("where a node placed for the person goes", () => {
  it("is centred on the spot asked for when that is free", () => {
    expect(freeSpot({ x: 500, y: 300 }, TEXT, [at(2000, 2000)])).toEqual({ x: 500 - TEXT.width / 2, y: 300 - TEXT.height / 2 });
  });

  it("fills the row around a node in the way, right before left, before the rows below and above it", () => {
    const center = { x: 0, y: 0 };
    const taken: Frame[] = [];
    for (let count = 0; count < 5; count += 1) taken.push({ position: freeSpot(center, TEXT, taken), ...TEXT });
    const origin = { x: -TEXT.width / 2, y: -TEXT.height / 2 };
    const offsets = taken.map((frame) => ({ x: frame.position.x - origin.x, y: frame.position.y - origin.y }));
    expect(offsets[0]).toEqual({ x: 0, y: 0 });
    expect(offsets[1]!.y).toBe(0);
    expect(offsets[1]!.x).toBeGreaterThanOrEqual(TEXT.width + PLACEMENT_GAP);
    expect(offsets[2]).toEqual({ x: -offsets[1]!.x, y: 0 });
    expect(offsets[3]!.x).toBe(0);
    expect(offsets[3]!.y).toBeGreaterThanOrEqual(TEXT.height + PLACEMENT_GAP);
    expect(offsets[4]).toEqual({ x: 0, y: -offsets[3]!.y });
    expect(offsets[1]!.x - TEXT.width).toBeLessThan(PLACEMENT_GAP * 2);
  });

  it("keeps the gap from every node whatever is around, nodes of every size among them", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const taken: Frame[] = Array.from({ length: 40 }, () => at(random() * 3000 - 1500, random() * 2000 - 1000, { width: 220 + random() * 500, height: 120 + random() * 400 }));
    for (let count = 0; count < 30; count += 1) {
      const size = count % 3 === 0 ? CANVAS_NODE_SIZE.group : count % 3 === 1 ? CANVAS_NODE_SIZE.video : TEXT;
      const placed = { position: freeSpot({ x: random() * 1000 - 500, y: random() * 800 - 400 }, size, taken), ...size };
      expect(taken.filter((frame) => !clearOf(frame, placed))).toEqual([]);
      taken.push(placed);
    }
  });

  it("goes to the right of everything when nothing near is free", () => {
    const wall = at(-50_000, -50_000, { width: 100_000, height: 100_000 });
    expect(freeSpot({ x: 0, y: 0 }, TEXT, [wall])).toEqual({ x: 50_000 + PLACEMENT_GAP, y: -TEXT.height / 2 });
  });
});

describe("the size an uploaded file's node grows to", () => {
  it("is a picture's own shape, and its type's size for any other file or a picture that can't be read", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2000, height: 1000, close })));
    expect(await uploadedNodeSize(new File(["png"], "wide.png", { type: "image/png" }))).toEqual({ width: 640, height: 320 });
    expect(close).toHaveBeenCalledOnce();
    expect(await uploadedNodeSize(new File(["mp4"], "take.mp4", { type: "video/mp4" }))).toEqual(CANVAS_NODE_SIZE.video);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("not a picture"); }));
    expect(await uploadedNodeSize(new File(["?"], "broken.png", { type: "image/png" }))).toEqual(CANVAS_NODE_SIZE.image);
  });
});
