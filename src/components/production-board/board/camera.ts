import type { BoardView, ViewportSize } from "@/lib/production-board/camera";

const GLIDE_MS = 240;

const prefersLessMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The board's camera outside React, so panning moves the board every frame without drawing its cards again. */
export class BoardCamera {
  private current: BoardView;
  private frame = 0;
  private readonly listeners = new Set<() => void>();
  size: ViewportSize = { width: 0, height: 0 };

  constructor(view: BoardView) {
    this.current = view;
  }

  get view(): BoardView {
    return this.current;
  }

  set(view: BoardView): void {
    this.stop();
    this.move(view);
  }

  /** Eases to `target`, or goes there at once for a person who asked for less motion. */
  glide(target: BoardView): void {
    this.stop();
    if (prefersLessMotion() || typeof requestAnimationFrame !== "function") {
      this.move(target);
      return;
    }
    const from = this.current;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / GLIDE_MS);
      const eased = 1 - (1 - progress) ** 3;
      this.move({ x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased, k: from.k + (target.k - from.k) * eased });
      this.frame = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Tells the listeners the board moved under the camera. */
  notify(): void {
    for (const listener of this.listeners) listener();
  }

  private move(view: BoardView): void {
    this.current = view;
    this.notify();
  }
}
