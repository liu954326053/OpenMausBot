export interface Cam {
  x: number;
  y: number;
  z: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZMIN = 0.07;
export const ZMAX = 2;
export const FAR = 0.32;
export const GRID = 28;

const STAGE_BAR_INSET = 60;
const TOOLBAR_INSET = 56;
const FIT_PAD = 48;
const FIT_MIN_AREA = 120;
const WHEEL_LINE_PX = 16;
const WHEEL_RATE = 0.0016;
const PINCH_RATE = 0.012;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const clampZoom = (z: number): number => clamp(z, ZMIN, ZMAX);

export function zoomAt(cam: Cam, sx: number, sy: number, nz: number): Cam {
  const z = clampZoom(nz);
  const wx = (sx - cam.x) / cam.z;
  const wy = (sy - cam.y) / cam.z;
  return { x: sx - wx * z, y: sy - wy * z, z };
}

/** The camera after zooming by `k` about the viewport's centre. */
export function zoomAbout(cam: Cam, size: Size, k: number): Cam {
  return zoomAt(cam, size.width / 2, size.height / 2, cam.z * k);
}

export interface FitOptions {
  pad?: number;
  top?: number;
  minZ?: number;
  maxZ?: number;
  anchorLeft?: boolean;
}

export function fitRect(r: Rect, size: Size, o: FitOptions = {}): Cam {
  const pad = o.pad ?? FIT_PAD;
  const insetTop = o.top ?? STAGE_BAR_INSET;
  const between = size.height - insetTop - TOOLBAR_INSET;
  const aw = Math.max(FIT_MIN_AREA, size.width - pad * 2);
  const ah = Math.max(FIT_MIN_AREA, between - pad);
  const z = clamp(Math.min(aw / r.w, ah / r.h), o.minZ || ZMIN, o.maxZ || 1);
  const overflows = o.anchorLeft === true && r.w * z > aw;
  return {
    x: overflows ? pad - r.x * z : size.width / 2 - (r.x + r.w / 2) * z,
    y: insetTop + between / 2 - (r.y + r.h / 2) * z,
    z,
  };
}

export function centreOn(r: Rect, size: Size, z: number): Cam {
  return { x: size.width / 2 - (r.x + r.w / 2) * z, y: size.height / 2 - (r.y + r.h / 2) * z, z };
}

const easeInOutCubic = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** The camera `k` of the way from `from` to `to`, `k` from 0 to 1 before easing. */
export function tween(from: Cam, to: Cam, size: Size, k: number): Cam {
  if (k <= 0) return from;
  if (k >= 1) return to;
  const eased = easeInOutCubic(k);
  const cx = size.width / 2;
  const cy = size.height / 2;
  const fromCentre = { x: (cx - from.x) / from.z, y: (cy - from.y) / from.z };
  const toCentre = { x: (cx - to.x) / to.z, y: (cy - to.y) / to.z };
  const z = from.z * Math.pow(to.z / from.z, eased);
  return {
    x: cx - (fromCentre.x + (toCentre.x - fromCentre.x) * eased) * z,
    y: cy - (fromCentre.y + (toCentre.y - fromCentre.y) * eased) * z,
    z,
  };
}

export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const unit = deltaMode === 1 ? WHEEL_LINE_PX : 1;
  return Math.exp(-deltaY * unit * (pinch ? PINCH_RATE : WHEEL_RATE));
}

export function gridStep(z: number): number {
  return GRID * z * (z < 0.22 ? 8 : z < 0.45 ? 4 : z < 0.9 ? 2 : 1);
}

export function lineScale(z: number): { ew: number; ls: number } {
  return { ew: clamp(0.75 / z, 1, 10), ls: clamp(1 / z, 1, 13) };
}

export function visibleWorld(cam: Cam, size: Size, screenMargin = 0): Rect {
  return {
    x: (-cam.x - screenMargin) / cam.z,
    y: (-cam.y - screenMargin) / cam.z,
    w: (size.width + screenMargin * 2) / cam.z,
    h: (size.height + screenMargin * 2) / cam.z,
  };
}

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const toScreen = (r: Rect, cam: Cam): Rect => ({ x: r.x * cam.z + cam.x, y: r.y * cam.z + cam.y, w: r.w * cam.z, h: r.h * cam.z });

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "true";
}

export class CameraStore {
  cam: Cam;
  size: Size = { width: 0, height: 0 };
  readonly #reduced: () => boolean;
  readonly #listeners = new Set<() => void>();
  #frame = 0;

  constructor(cam: Cam = { x: 0, y: 0, z: 1 }, options: { reduced?: () => boolean } = {}) {
    this.cam = cam;
    this.#reduced = options.reduced ?? prefersReducedMotion;
  }

  get animating(): boolean {
    return this.#frame !== 0;
  }

  set(cam: Cam): void {
    this.cam = cam;
    for (const listener of this.#listeners) listener();
  }

  glide(to: Cam, ms: number): void {
    this.stop();
    if (!ms || this.#reduced() || typeof requestAnimationFrame !== "function") {
      this.set(to);
      return;
    }
    const from = this.cam;
    const size = this.size;
    const started = performance.now();
    const step = (now: number): void => {
      const k = clamp((now - started) / ms, 0, 1);
      this.#frame = k < 1 ? requestAnimationFrame(step) : 0;
      this.set(tween(from, to, size, k));
    };
    this.#frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.#frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}
