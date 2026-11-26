import type { BoardCard } from "../../../lib/production-board/types";
import type { Cam, Rect, Size } from "./camera";

export interface MinimapFrame {
  world: Rect;
  scale: number;
  width: number;
  height: number;
}

export function minimapFrame(world: Rect, cssWidth: number): MinimapFrame {
  const scale = cssWidth / world.w;
  return { world, scale, width: cssWidth, height: Math.round(world.h * scale) };
}

export function minimapPoint(frame: MinimapFrame, px: number, py: number): { x: number; y: number } {
  return { x: frame.world.x + px / frame.scale, y: frame.world.y + py / frame.scale };
}

export interface MinimapColors {
  bg: string;
  plain: string;
  working: string;
  done: string;
  idle: string;
  failed: string;
  sheet: string;
  view: string;
  viewFill: string;
}

/** A card's colour on the map: a bot by its state, a sheet of paper, a video by its state, else plain. */
export function minimapColor(kind: BoardCard["kind"], state: "done" | "working" | "waiting" | "failed" | undefined, colors: MinimapColors): string {
  if ((kind === "bot" || kind === "result") && state === "failed") return colors.failed;
  if (kind === "bot") return state === "working" ? colors.working : state === "done" ? colors.done : colors.idle;
  if (kind === "brief" || kind === "plan" || kind === "episode" || kind === "stack" || kind === "shot") return colors.sheet;
  if (kind === "result") return state === "done" ? colors.done : state === "working" ? colors.working : colors.plain;
  return colors.plain;
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  frame: MinimapFrame,
  dpr: number,
  items: ReadonlyArray<{ rect: Rect; color: string }>,
  cam: Cam,
  size: Size,
  colors: MinimapColors,
): void {
  const { world, scale } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, frame.width, frame.height);
  for (const { rect, color } of items) {
    ctx.fillStyle = color;
    ctx.fillRect((rect.x - world.x) * scale, (rect.y - world.y) * scale, Math.max(2, rect.w * scale), Math.max(2, rect.h * scale));
  }
  const x = (-cam.x / cam.z - world.x) * scale;
  const y = (-cam.y / cam.z - world.y) * scale;
  const w = (size.width / cam.z) * scale;
  const h = (size.height / cam.z) * scale;
  ctx.fillStyle = colors.viewFill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = colors.view;
  ctx.lineWidth = 1.25;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
