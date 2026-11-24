import type { BoardAnchor } from "@/lib/production-board/overlay";

export const CHAT_MARGIN = 12;
export const CHAT_GAP = 16;
/** Narrower than this, the board has no room beside a card for the window, which becomes a sheet along its bottom. */
export const CHAT_SHEET_BELOW = 720;
/** How far below the card's top the window's pointer sits, and how much room it needs to show. */
const ARROW_DROP = 28;
const ARROW_INSET = 22;

interface Size {
  width: number;
  height: number;
}

export interface PlacementInput {
  /** The bot's card, or null when it has none on the screen. */
  anchor: BoardAnchor | null;
  size: Size;
  layer: Size;
  /** How far from the layer's right edge the window keeps: the side panel's room, with its gaps. */
  reserved: number;
}

export type ChatPlacement =
  | { mode: "beside"; side: "right" | "left"; x: number; y: number; arrow: number | null }
  | { mode: "docked"; x: number; y: number }
  | { mode: "sheet" };

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

export function placeChat({ anchor, size, layer, reserved }: PlacementInput): ChatPlacement {
  if (layer.width < CHAT_SHEET_BELOW) return { mode: "sheet" };
  const left = CHAT_MARGIN;
  const besidePanel = layer.width - Math.max(CHAT_MARGIN, reserved);
  const right = besidePanel - left >= size.width ? besidePanel : layer.width - CHAT_MARGIN;
  const top = CHAT_MARGIN;
  const lowest = Math.max(top, layer.height - CHAT_MARGIN - size.height);
  if (!anchor) return { mode: "docked", x: right - size.width, y: top };
  const wanted = clamp(anchor.y, top, lowest);
  const pointer = anchor.y + ARROW_DROP - wanted;
  const arrow = pointer >= ARROW_INSET && pointer <= size.height - ARROW_INSET ? pointer : null;
  const onRight = anchor.x + anchor.width + CHAT_GAP;
  if (onRight + size.width <= right) return { mode: "beside", side: "right", x: onRight, y: wanted, arrow };
  const onLeft = anchor.x - CHAT_GAP - size.width;
  if (onLeft >= left) return { mode: "beside", side: "left", x: onLeft, y: wanted, arrow };
  return { mode: "beside", side: "right", x: clamp(onRight, left, right - size.width), y: wanted, arrow };
}
