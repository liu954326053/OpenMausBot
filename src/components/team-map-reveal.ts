import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { View } from "@/lib/team-canvas";
import { teamMapTargetShown, useTeamMapTarget, type TeamMapTarget } from "@/state/team-map-focus";

const MARK_MS = 2_400;

export interface WorldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The view, at the same zoom, that puts the box in the middle of an area that size. */
export function centredOn(box: WorldBox, size: { width: number; height: number }, view: View): View {
  return { ...view, x: size.width / 2 - (box.x + box.width / 2) * view.scale, y: size.height / 2 - (box.y + box.height / 2) * view.scale };
}

/** Where the element sits in the world before the world is moved and zoomed: layout offsets ignore CSS transforms. */
function worldBox(element: HTMLElement, world: Element): WorldBox {
  let x = 0, y = 0;
  for (let node: Element | null = element; node instanceof HTMLElement && node !== world; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

export const targetMark = (target: TeamMapTarget): string => "department" in target ? target.department : target.botId;

/** `gap` and `height` are in world units; `top`, `bottom` and `inset` are on screen. */
export function menuOpensAbove({ top, gap, height, scale, bottom, inset }: { top: number; gap: number; height: number; scale: number; bottom: number; inset: number }): boolean {
  return top + (gap + height) * scale > bottom - inset;
}

function targetElement(viewport: HTMLElement, target: TeamMapTarget): HTMLElement | undefined {
  if ("department" in target) return [...viewport.querySelectorAll<HTMLElement>("[data-team-key]")].find((node) => node.dataset.teamKey === target.department);
  return [...viewport.querySelectorAll<HTMLElement>("[data-bot-id]")].find((node) => node.dataset.botId === target.botId)?.closest("article") ?? undefined;
}

/** Brings what the person just made into the middle of the map once it is drawn there, and marks it for a moment:
 * the bot's id or the department's name while marked. */
export function useTeamMapReveal(viewport: RefObject<HTMLElement | null>, ready: boolean, layout: string, bottomInset: number, setView: Dispatch<SetStateAction<View>>): string | null {
  const target = useTeamMapTarget();
  const [marked, setMarked] = useState<string | null>(null);
  useEffect(() => {
    const element = viewport.current;
    const world = element?.querySelector("[data-canvas-world]");
    const node = element && target ? targetElement(element, target) : undefined;
    if (!ready || !target || !element || !world || !node) return;
    const bounds = element.getBoundingClientRect();
    const box = worldBox(node, world);
    setView((view) => centredOn(box, { width: bounds.width, height: Math.max(200, bounds.height - bottomInset) }, view));
    setMarked(targetMark(target));
    teamMapTargetShown(target);
  }, [target, ready, layout, bottomInset, viewport, setView]);
  useEffect(() => {
    if (marked === null) return;
    const timer = window.setTimeout(() => setMarked(null), MARK_MS);
    return () => window.clearTimeout(timer);
  }, [marked]);
  return marked;
}
