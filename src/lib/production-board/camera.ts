import type { BoardRect } from "./layout";

/** Screen = world × k + (x, y). */
export interface BoardView {
  x: number;
  y: number;
  k: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const ZOOM_MIN = 0.07;
export const ZOOM_MAX = 2;
/** At or below this zoom cards are drawn as labels. */
export const FAR_ZOOM = 0.32;
export const FIT_PADDING = 60;

export const clampZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** The view that shows `rect` whole and centred, its zoom kept within `minZoom` and `maxZoom`. */
export function fitRect(rect: BoardRect, viewport: ViewportSize, { padding = FIT_PADDING, minZoom = ZOOM_MIN, maxZoom = 1 } = {}): BoardView {
  const room = { width: Math.max(1, viewport.width - padding * 2), height: Math.max(1, viewport.height - padding * 2) };
  const fit = Math.min(room.width / Math.max(1, rect.width), room.height / Math.max(1, rect.height));
  const k = clampZoom(Math.min(maxZoom, Math.max(minZoom, fit)));
  return { k, x: viewport.width / 2 - (rect.x + rect.width / 2) * k, y: viewport.height / 2 - (rect.y + rect.height / 2) * k };
}

/** Zooms by `factor` keeping the world point under the screen point `at` where it is. */
export function zoomAt(view: BoardView, factor: number, at: { x: number; y: number }): BoardView {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/** A wheel's zoom factor: a pinch on a trackpad comes as a wheel event with the control key. */
export const wheelZoomFactor = (deltaY: number, pinch: boolean) => Math.exp(-deltaY * (pinch ? 0.012 : 0.0016));

/** The part of the world the viewport shows, grown by `margin` screen pixels on each side. */
export function visibleRect(view: BoardView, viewport: ViewportSize, margin = 0): BoardRect {
  return { x: (-view.x - margin) / view.k, y: (-view.y - margin) / view.k, width: (viewport.width + margin * 2) / view.k, height: (viewport.height + margin * 2) / view.k };
}

export const intersects = (a: BoardRect, b: BoardRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const toScreen = (rect: BoardRect, view: BoardView): BoardRect =>
  ({ x: rect.x * view.k + view.x, y: rect.y * view.k + view.y, width: rect.width * view.k, height: rect.height * view.k });

/** Moves the view so `rect` is centred, at zoom `k`. */
export const centreOn = (rect: BoardRect, viewport: ViewportSize, k: number): BoardView =>
  ({ k, x: viewport.width / 2 - (rect.x + rect.width / 2) * k, y: viewport.height / 2 - (rect.y + rect.height / 2) * k });
