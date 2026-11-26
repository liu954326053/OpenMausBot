import type { CSSProperties } from "react";

/** For a piece the stylesheet centres with `left: 50%; translateX(-50%)` and keeps `margin` px narrower than the
 * board (`widest` px at most): the same, in the board's width less the `insetEnd` px the side panel takes. */
export function centredInRoom(insetEnd: number, margin: number, widest?: number): CSSProperties | undefined {
  if (insetEnd <= 0) return undefined;
  const room = `calc(100% - ${margin}px - ${insetEnd}px)`;
  return { left: `calc((100% - ${insetEnd}px) / 2)`, maxWidth: widest ? `min(${widest}px, ${room})` : room };
}
