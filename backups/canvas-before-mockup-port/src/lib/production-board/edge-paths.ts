import type { BoardCard, BoardEdge } from "./types";
import type { BoardRect } from "./layout";

type Side = "left" | "right" | "top" | "bottom";
type Point = [number, number];

const NORMAL: Record<Side, Point> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
/** Room the arrowhead takes before a card's edge. */
const TIP = 7;
const ARROW = { length: 9, half: 4.5 };
const PORT_STEP = 24;
const PORT_MARGIN = 56;

export interface EdgePath {
  d: string;
  arrow: string;
  /** Where its label goes: halfway along it. */
  label: { x: number; y: number };
  bounds: BoardRect;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const centre = (rect: BoardRect): Point => [rect.x + rect.width / 2, rect.y + rect.height / 2];

/** The sides a line leaves and enters by: across when the cards stand side by side, else down or up. */
function sidesOf(from: BoardRect, to: BoardRect): [Side, Side] {
  if (to.x >= from.x + from.width) return ["right", "left"];
  if (to.x + to.width <= from.x) return ["left", "right"];
  return centre(to)[1] >= centre(from)[1] ? ["bottom", "top"] : ["top", "bottom"];
}

function port(rect: BoardRect, side: Side, offset: number): Point {
  switch (side) {
    case "left": return [rect.x, rect.y + rect.height / 2 + offset];
    case "right": return [rect.x + rect.width, rect.y + rect.height / 2 + offset];
    case "top": return [rect.x + rect.width / 2 + offset, rect.y];
    case "bottom": return [rect.x + rect.width / 2 + offset, rect.y + rect.height];
  }
}

const round = (value: number) => Math.round(value * 10) / 10;
const point = ([x, y]: Point) => `${round(x)},${round(y)}`;

/** Each line's curve between the cards it joins. Lines sharing a side of a card spread along it in the order of the
 * cards at their other ends; a reference line leaves its card by one port and enters a shot above the middle for a
 * character and below for a scene, clear of the shot's other lines. */
export function edgePaths(edges: readonly BoardEdge[], rects: ReadonlyMap<string, BoardRect>, cards: ReadonlyMap<string, BoardCard>): Map<string, EdgePath> {
  const drawn = edges.filter((edge) => rects.has(edge.from) && rects.has(edge.to));
  const sides = new Map(drawn.map((edge) => [edge.id, sidesOf(rects.get(edge.from)!, rects.get(edge.to)!)]));
  const offsets = new Map<string, { from: number; to: number }>();
  const offsetOf = (id: string) => offsets.get(id) ?? offsets.set(id, { from: 0, to: 0 }).get(id)!;

  type Item = { edge: BoardEdge; end: "from" | "to"; other: BoardRect };
  const groups = new Map<string, { cardId: string; side: Side; list: Item[] }>();
  const add = (cardId: string, side: Side, item: Item) => {
    const key = `${side} ${cardId}`;
    const group = groups.get(key) ?? groups.set(key, { cardId, side, list: [] }).get(key)!;
    group.list.push(item);
  };
  for (const edge of drawn) {
    if (edge.kind === "ref") continue;
    const [out, into] = sides.get(edge.id)!;
    add(edge.from, out, { edge, end: "from", other: rects.get(edge.to)! });
    add(edge.to, into, { edge, end: "to", other: rects.get(edge.from)! });
  }
  for (const { cardId, side, list } of groups.values()) {
    const rect = rects.get(cardId)!;
    const across = side === "top" || side === "bottom";
    list.sort((a, b) => (across ? centre(a.other)[0] - centre(b.other)[0] : centre(a.other)[1] - centre(b.other)[1]));
    const length = across ? rect.width : rect.height;
    const step = Math.max(0, Math.min(PORT_STEP, (length - PORT_MARGIN) / Math.max(1, list.length)));
    list.forEach((item, at) => { offsetOf(item.edge.id)[item.end] = (at - (list.length - 1) / 2) * step; });
  }

  const refs = drawn.filter((edge) => edge.kind === "ref");
  const bySource = new Map<string, BoardEdge[]>();
  const byTarget = new Map<string, BoardEdge[]>();
  for (const edge of refs) {
    bySource.set(edge.from, [...(bySource.get(edge.from) ?? []), edge]);
    byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), edge]);
  }
  for (const [source, list] of bySource) {
    const rect = rects.get(source)!;
    const below = list.reduce((sum, edge) => sum + centre(rects.get(edge.to)!)[1], 0) / list.length >= centre(rect)[1];
    for (const edge of list) offsetOf(edge.id).from = (below ? 1 : -1) * rect.height * 0.27;
  }
  for (const [target, list] of byTarget) {
    const rect = rects.get(target)!;
    const characters = list.filter((edge) => cards.get(edge.from)?.kind === "character").sort((a, b) => rects.get(a.from)!.y - rects.get(b.from)!.y);
    characters.forEach((edge, at) => { offsetOf(edge.id).to = -rect.height * Math.max(0.06, 0.36 - 0.12 * at); });
    for (const edge of list) if (cards.get(edge.from)?.kind !== "character") offsetOf(edge.id).to = rect.height * 0.3;
  }

  const paths = new Map<string, EdgePath>();
  for (const edge of drawn) {
    const [out, into] = sides.get(edge.id)!;
    const offset = offsetOf(edge.id);
    const start = port(rects.get(edge.from)!, out, offset.from);
    const tip = port(rects.get(edge.to)!, into, offset.to);
    const n1 = NORMAL[out];
    const n2 = NORMAL[into];
    const end: Point = [tip[0] + n2[0] * TIP, tip[1] + n2[1] * TIP];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const d1 = clamp(Math.abs(dx * n1[0] + dy * n1[1]) * 0.5, 40, 300);
    const d2 = clamp(Math.abs(dx * n2[0] + dy * n2[1]) * 0.5, 40, 300);
    const c1: Point = [start[0] + n1[0] * d1, start[1] + n1[1] * d1];
    const c2: Point = [end[0] + n2[0] * d2, end[1] + n2[1] * d2];
    const base: Point = [tip[0] + n2[0] * ARROW.length, tip[1] + n2[1] * ARROW.length];
    const across: Point = [-n2[1] * ARROW.half, n2[0] * ARROW.half];
    const at = (i: 0 | 1) => 0.125 * start[i] + 0.375 * c1[i] + 0.375 * c2[i] + 0.125 * end[i];
    const xs = [start[0], c1[0], c2[0], end[0], tip[0]];
    const ys = [start[1], c1[1], c2[1], end[1], tip[1]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    paths.set(edge.id, {
      d: `M${point(start)} C${point(c1)} ${point(c2)} ${point(end)}`,
      arrow: `M${point(tip)} L${point([base[0] + across[0], base[1] + across[1]])} L${point([base[0] - across[0], base[1] - across[1]])} Z`,
      label: { x: at(0), y: at(1) },
      bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
    });
  }
  return paths;
}
