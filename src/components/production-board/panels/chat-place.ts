import type { BoardAnchor } from "@/lib/production-board/overlay";

export const CHAT_GAP = 16;
export const CHAT_SHEET_BELOW = 720;
const EDGE = 12;
const TOP = 60;
const CARD_HEAD = 36;

export type ChatPlace =
  | { sheet: true }
  | { sheet: false; left: number; top: number; arrowY: number; side: "r" | "l" | "none" };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Where a bot's chat stands beside its card: to its right, to its left when there is no room, clamped to the stage. */
export function placeChat(anchor: BoardAnchor | null, size: { width: number; height: number }, stage: { width: number; height: number }, reserved: number, zoom: number): ChatPlace {
  if (stage.width < CHAT_SHEET_BELOW) return { sheet: true };
  const room = stage.width - reserved;
  const right = Math.max(EDGE, room - size.width - EDGE);
  if (!anchor) return { sheet: false, left: Math.round(right), top: TOP, arrowY: 0, side: "none" };
  let want = anchor.x + anchor.width + CHAT_GAP;
  let side: "r" | "l" = "r";
  if (want + size.width > room - EDGE && anchor.x - CHAT_GAP - size.width >= EDGE) {
    want = anchor.x - CHAT_GAP - size.width;
    side = "l";
  }
  const left = clamp(want, EDGE, right);
  const top = clamp(anchor.y, TOP, Math.max(TOP, stage.height - size.height - EDGE));
  const arrowY = anchor.y + CARD_HEAD * zoom - top;
  const beside = Math.abs(left - want) < 1 && arrowY > 14 && arrowY < size.height - 26;
  return { sheet: false, left: Math.round(left), top: Math.round(top), arrowY: Math.round(arrowY), side: beside ? side : "none" };
}
