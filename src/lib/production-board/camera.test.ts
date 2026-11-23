import { describe, expect, it } from "vitest";
import { fitRect, intersects, visibleRect, wheelZoomFactor, zoomAt, ZOOM_MAX, ZOOM_MIN } from "./camera";

const viewport = { width: 1000, height: 600 };

describe("the board's camera", () => {
  it("fits a rect whole and centred, within the zoom it is allowed", () => {
    const view = fitRect({ x: 0, y: 0, width: 1760, height: 960 }, viewport);
    expect(view.k).toBeCloseTo(0.5);
    expect(view.x + 880 * view.k).toBeCloseTo(500);
    expect(view.y + 480 * view.k).toBeCloseTo(300);
    expect(fitRect({ x: 0, y: 0, width: 10, height: 10 }, viewport).k).toBe(1);
    expect(fitRect({ x: 0, y: 0, width: 10, height: 10 }, viewport, { maxZoom: 0.95 }).k).toBe(0.95);
    expect(fitRect({ x: 0, y: 0, width: 1e7, height: 10 }, viewport).k).toBe(ZOOM_MIN);
    expect(fitRect({ x: 0, y: 0, width: 4000, height: 10 }, viewport, { minZoom: 0.5 }).k).toBe(0.5);
  });

  it("zooms about the point under the pointer and stops at its limits", () => {
    const view = { x: 100, y: 50, k: 1 };
    const world = { x: (400 - view.x) / view.k, y: (300 - view.y) / view.k };
    const zoomed = zoomAt(view, 1.5, { x: 400, y: 300 });
    expect(zoomed.k).toBe(1.5);
    expect(world.x * zoomed.k + zoomed.x).toBeCloseTo(400);
    expect(world.y * zoomed.k + zoomed.y).toBeCloseTo(300);
    expect(zoomAt(view, 100, { x: 0, y: 0 }).k).toBe(ZOOM_MAX);
    expect(zoomAt(view, 0.0001, { x: 0, y: 0 }).k).toBe(ZOOM_MIN);
    expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10, true)).toBeLessThan(wheelZoomFactor(10, false));
  });

  it("knows what part of the world the viewport shows", () => {
    const shown = visibleRect({ x: -200, y: -100, k: 0.5 }, viewport, 50);
    expect(shown).toEqual({ x: 300, y: 100, width: 2200, height: 1400 });
    expect(intersects(shown, { x: 2400, y: 0, width: 200, height: 200 })).toBe(true);
    expect(intersects(shown, { x: 2500, y: 0, width: 200, height: 200 })).toBe(false);
  });
});
