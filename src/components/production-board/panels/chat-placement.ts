import type { BoardAnchor } from "@/lib/production-board/overlay";

export const CHAT_MARGIN = 12;
export const CHAT_GAP = 16;
/** Narrower than this, the chat window is a sheet along the board's bottom. */
export const CHAT_SHEET_BELOW = 720;

interface Size {
  width: number;
  height: number;
}

export interface PlacementInput {
  /** The bot's card, or null when it has none on the screen. */
  anchor: BoardAnchor | null;
  size: Size;
  layer: Size;
  /** The room the side panel takes along the layer's right edge, 0 when it is folded. */
  panelWidth: number;
}

export type ChatPlacement =
  | { mode: "beside"; side: "right" | "left"; x: number; y: number }
  | { mode: "docked"; x: number; y: number }
  | { mode: "sheet" };

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

export function placeChat({ anchor, size, layer, panelWidth }: PlacementInput): ChatPlacement {
  if (layer.width < CHAT_SHEET_BELOW) return { mode: "sheet" };
  const left = CHAT_MARGIN;
  const besidePanel = layer.width - CHAT_MARGIN - (panelWidth ? panelWidth + CHAT_GAP : 0);
  const right = besidePanel - left >= size.width ? besidePanel : layer.width - CHAT_MARGIN;
  const top = CHAT_MARGIN;
  const lowest = Math.max(top, layer.height - CHAT_MARGIN - size.height);
  if (!anchor) return { mode: "docked", x: right - size.width, y: top };
  const y = clamp(anchor.y, top, lowest);
  const onRight = anchor.x + anchor.width + CHAT_GAP;
  if (onRight + size.width <= right) return { mode: "beside", side: "right", x: onRight, y };
  const onLeft = anchor.x - CHAT_GAP - size.width;
  if (onLeft >= left) return { mode: "beside", side: "left", x: onLeft, y };
  return { mode: "beside", side: "right", x: clamp(onRight, left, right - size.width), y };
}
