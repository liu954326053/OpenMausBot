import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraStore, FAR, GRID, ZMAX, ZMIN, centreOn, clampZoom, fitRect, gridStep, intersects, lineScale, toScreen, tween, visibleWorld, wheelFactor, zoomAbout, zoomAt } from "./camera";

const SIZE = { width: 1200, height: 800 };

describe("the board's camera", () => {
  it("keeps the mockup's limits", () => {
    expect([ZMIN, ZMAX, FAR, GRID]).toEqual([0.07, 2, 0.32, 28]);
    expect([0.01, 0.5, 5].map(clampZoom)).toEqual([0.07, 0.5, 2]);
  });

  it("zooms about a point of the screen, between 7% and 200%", () => {
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 100, 50, 2)).toEqual({ x: -100, y: -50, z: 2 });
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0, 0, 5).z).toBe(2);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0, 0, 0.01).z).toBe(0.07);
    expect(zoomAbout({ x: 0, y: 0, z: 1 }, SIZE, 2)).toEqual({ x: -600, y: -400, z: 2 });
  });

  it("fits a rect between the stage bar above and the toolbar below", () => {
    expect(fitRect({ x: 0, y: 0, w: 1000, h: 500 }, SIZE)).toEqual({ x: 100, y: 152, z: 1 });
    const wide = fitRect({ x: 0, y: 0, w: 4000, h: 500 }, SIZE);
    expect(wide.z).toBeCloseTo(0.276, 5);
    expect(wide.x).toBeCloseTo(48, 5);
    expect(wide.y).toBeCloseTo(333, 5);
    expect(fitRect({ x: 0, y: 0, w: 4000, h: 500 }, SIZE, { minZ: 0.6, anchorLeft: true })).toMatchObject({ x: 48, z: 0.6 });
  });

  it("fits within the padding, the top inset and the zoom ceiling it is given", () => {
    expect(fitRect({ x: 0, y: 0, w: 1000, h: 500 }, SIZE, { pad: 0, top: 0, maxZ: 2 })).toEqual({ x: 0, y: 72, z: 1.2 });
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { width: 100, height: 100 }, { maxZ: 2 })).toEqual({ x: 40, y: 42, z: 2 });
  });

  it("centres a rect at a zoom", () => {
    expect(centreOn({ x: 100, y: 100, w: 200, h: 100 }, SIZE, 0.5)).toEqual({ x: 500, y: 325, z: 0.5 });
  });

  it("moves between two views with the zoom changing by ratio", () => {
    const from = { x: 0, y: 0, z: 1 };
    const to = { x: 0, y: 0, z: 4 };
    const size = { width: 800, height: 600 };
    expect(tween(from, to, size, 0)).toEqual(from);
    expect(tween(from, to, size, 1)).toEqual(to);
    const half = tween(from, to, size, 0.5);
    expect(half.z).toBeCloseTo(2, 9);
    expect(half.x).toBeCloseTo(-100, 9);
    expect(half.y).toBeCloseTo(-75, 9);
  });

  it("eases a move: slow away, slow home", () => {
    const from = { x: 0, y: 0, z: 1 };
    const to = { x: -800, y: 0, z: 1 };
    const size = { width: 800, height: 600 };
    expect(tween(from, to, size, 0.25).x).toBeCloseTo(-50, 9);
    expect(tween(from, to, size, 0.75).x).toBeCloseTo(-750, 9);
  });

  it("reads a wheel: a pinch is stronger, a line is sixteen pixels", () => {
    expect(wheelFactor(100, 0, false)).toBeCloseTo(Math.exp(-0.16), 12);
    expect(wheelFactor(10, 0, true)).toBeCloseTo(Math.exp(-0.12), 12);
    expect(wheelFactor(3, 1, false)).toBeCloseTo(Math.exp(-0.0768), 12);
  });

  it("coarsens the grid and thickens the lines as it zooms out", () => {
    expect([1, 0.5, 0.3, 0.1].map(gridStep).map((step) => Math.round(step * 10) / 10)).toEqual([28, 28, 33.6, 22.4]);
    expect(lineScale(1)).toEqual({ ew: 1, ls: 1 });
    expect(lineScale(0.25)).toEqual({ ew: 3, ls: 4 });
    expect(lineScale(0.05)).toEqual({ ew: 10, ls: 13 });
  });

  it("says what of the world is in view", () => {
    expect(visibleWorld({ x: -100, y: -50, z: 2 }, SIZE, 0)).toEqual({ x: 50, y: 25, w: 600, h: 400 });
    expect(visibleWorld({ x: -100, y: -50, z: 2 }, SIZE)).toEqual({ x: 50, y: 25, w: 600, h: 400 });
    expect(visibleWorld({ x: -100, y: -50, z: 2 }, SIZE, 100)).toEqual({ x: 0, y: -25, w: 700, h: 500 });
    expect(toScreen({ x: 50, y: 25, w: 600, h: 400 }, { x: -100, y: -50, z: 2 })).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});

describe("the camera's store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFrames(): { run(now: number): void; pending(): number; cancelled: number[] } {
    const queued = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let next = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queued.set(next, callback);
      return next++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
      queued.delete(id);
    });
    vi.spyOn(performance, "now").mockReturnValue(1000);
    return {
      run(now) {
        const callbacks = [...queued.values()];
        queued.clear();
        for (const callback of callbacks) callback(now);
      },
      pending: () => queued.size,
      cancelled,
    };
  }

  it("tells who listens of each view, and goes straight to a view when motion is reduced or no time is given", () => {
    const store = new CameraStore({ x: 0, y: 0, z: 1 }, { reduced: () => true });
    store.size = SIZE;
    const told = vi.fn();
    const stop = store.subscribe(told);
    store.set({ x: 5, y: 5, z: 1 });
    store.glide({ x: 9, y: 9, z: 2 }, 700);
    expect(store.cam).toEqual({ x: 9, y: 9, z: 2 });
    expect(store.animating).toBe(false);
    expect(told).toHaveBeenCalledTimes(2);
    stop();
    store.set({ x: 0, y: 0, z: 1 });
    expect(told).toHaveBeenCalledTimes(2);
  });

  it("starts at the origin at 100% and goes straight to a view where there are no frames to draw", () => {
    const store = new CameraStore();
    expect(store.cam).toEqual({ x: 0, y: 0, z: 1 });
    store.glide({ x: 9, y: 9, z: 2 }, 700);
    expect(store.cam).toEqual({ x: 9, y: 9, z: 2 });
    expect(store.animating).toBe(false);
  });

  it("glides to a view a frame at a time", () => {
    const frames = stubFrames();
    const from = { x: 0, y: 0, z: 1 };
    const to = { x: 0, y: 0, z: 4 };
    const store = new CameraStore(from, { reduced: () => false });
    store.size = { width: 800, height: 600 };
    const seen: boolean[] = [];
    const { subscribe } = store;
    subscribe(() => seen.push(store.animating));

    store.glide(to, 700);
    expect(store.cam).toEqual(from);
    expect(store.animating).toBe(true);

    frames.run(1350);
    expect(store.cam).toEqual(tween(from, to, store.size, 0.5));
    expect(store.animating).toBe(true);

    frames.run(1700);
    expect(store.cam).toEqual(to);
    expect(store.animating).toBe(false);
    expect(frames.pending()).toBe(0);
    expect(seen).toEqual([true, false]);
  });

  it("goes straight to a view when no time is given, though motion is allowed", () => {
    const frames = stubFrames();
    const store = new CameraStore({ x: 0, y: 0, z: 1 }, { reduced: () => false });
    store.glide({ x: 9, y: 9, z: 2 }, 0);
    expect(store.cam).toEqual({ x: 9, y: 9, z: 2 });
    expect(frames.pending()).toBe(0);
  });

  it("stops a glide where it is, and a new glide replaces the one under way", () => {
    const frames = stubFrames();
    const store = new CameraStore({ x: 0, y: 0, z: 1 }, { reduced: () => false });
    store.size = { width: 800, height: 600 };

    store.glide({ x: 0, y: 0, z: 4 }, 700);
    frames.run(1350);
    const midway = store.cam;
    store.glide({ x: 50, y: 50, z: 1 }, 700);
    expect(frames.cancelled).toEqual([2]);
    expect(frames.pending()).toBe(1);

    store.stop();
    expect(frames.cancelled).toEqual([2, 3]);
    expect(store.animating).toBe(false);
    frames.run(1700);
    expect(store.cam).toBe(midway);
  });

  it("glides when there is no window to ask about motion", () => {
    const frames = stubFrames();
    vi.stubGlobal("document", { documentElement: { dataset: { reducedMotion: "true" } } });
    const store = new CameraStore();
    store.glide({ x: 9, y: 9, z: 2 }, 700);
    expect(store.cam).toEqual({ x: 0, y: 0, z: 1 });
    expect(frames.pending()).toBe(1);
  });

  it("does not glide when the app or the system asks for less motion", () => {
    const frames = stubFrames();
    const dataset: { reducedMotion?: string } = { reducedMotion: "true" };
    vi.stubGlobal("document", { documentElement: { dataset } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const store = new CameraStore();
    store.glide({ x: 9, y: 9, z: 2 }, 700);
    expect(store.cam).toEqual({ x: 9, y: 9, z: 2 });
    expect(frames.pending()).toBe(0);

    delete dataset.reducedMotion;
    vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) });
    store.glide({ x: 0, y: 0, z: 1 }, 700);
    expect(store.cam).toEqual({ x: 0, y: 0, z: 1 });
    expect(frames.pending()).toBe(0);

    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    store.glide({ x: 9, y: 9, z: 2 }, 700);
    expect(store.cam).toEqual({ x: 0, y: 0, z: 1 });
    expect(frames.pending()).toBe(1);
  });
});
