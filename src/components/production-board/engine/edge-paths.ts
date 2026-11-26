import type { BoardCard, BoardEdge } from "@/lib/production-board/types";
import type { Rect } from "./camera";

export interface EdgePath {
  d: string;
  arrow: string;
  /** Where the line leaves its card: the small circle. */
  start: { x: number; y: number };
  label: { x: number; y: number };
  bounds: Rect;
}

interface Point {
  x: number;
  y: number;
}

interface Line {
  edge: BoardEdge;
  from: Rect;
  to: Rect;
  /** How far below the middle of its card's right side the line leaves. */
  exit: number;
  /** How far below the middle of its card's left side the line enters. */
  entry: number;
}

const PORT_SPACING = 24;
const SIDE_KEPT_FREE = 56;

const REFERENCE_EXIT = 0.27;
const CHARACTER_ENTRY = 0.36;
const CHARACTER_ENTRY_SPACING = 0.12;
const SCENE_ENTRY = 0.3;

const LINE_STOPS_SHORT = 7;
const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 4.5;
const HANDLE_MIN = 40;
const HANDLE_MAX = 300;

const centerY = (rect: Rect) => rect.y + rect.h / 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 10) / 10 + 0;
const rounded = (point: Point): Point => ({ x: round(point.x), y: round(point.y) });
const pair = (point: Point) => `${round(point.x)},${round(point.y)}`;

function groupedBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return [...groups.values()];
}

function spreadAlongSide(
  lines: readonly Line[],
  card: Rect,
  otherCard: (line: Line) => Rect,
  shift: (line: Line, offset: number) => void,
): void {
  const middle = (lines.length - 1) / 2;
  const step = Math.min(PORT_SPACING, (card.h - SIDE_KEPT_FREE) / lines.length);
  [...lines]
    .sort((p, q) => centerY(otherCard(p)) - centerY(otherCard(q)))
    .forEach((line, i) => shift(line, (i - middle) * step));
}

function spreadPlainLines(lines: readonly Line[]): void {
  for (const leaving of groupedBy(lines, (line) => line.edge.from)) {
    spreadAlongSide(
      leaving,
      leaving[0].from,
      (line) => line.to,
      (line, offset) => {
        line.exit = offset;
      },
    );
  }
  for (const entering of groupedBy(lines, (line) => line.edge.to)) {
    spreadAlongSide(
      entering,
      entering[0].to,
      (line) => line.from,
      (line, offset) => {
        line.entry = offset;
      },
    );
  }
}

function fanReferenceLines(lines: readonly Line[], kinds: ReadonlyMap<string, BoardCard["kind"]>): void {
  const fromCharacter = (line: Line) => kinds.get(line.edge.from) === "character";

  for (const leaving of groupedBy(lines, (line) => line.edge.from)) {
    const meanTarget = leaving.reduce((sum, line) => sum + centerY(line.to), 0) / leaving.length;
    for (const line of leaving) {
      line.exit = (meanTarget < centerY(line.from) ? -1 : 1) * line.from.h * REFERENCE_EXIT;
    }
  }
  for (const entering of groupedBy(lines, (line) => line.edge.to)) {
    entering
      .filter(fromCharacter)
      .sort((p, q) => p.from.y - q.from.y)
      .forEach((line, i) => {
        line.entry = -line.to.h * (CHARACTER_ENTRY - CHARACTER_ENTRY_SPACING * i);
      });
    for (const line of entering) {
      if (!fromCharacter(line)) line.entry = line.to.h * SCENE_ENTRY;
    }
  }
}

function boundsOf(points: readonly Point[]): Rect {
  const xs = points.map((point) => round(point.x));
  const ys = points.map((point) => round(point.y));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y) };
}

function drawn(line: Line): EdgePath {
  const start = { x: line.from.x + line.from.w, y: centerY(line.from) + line.exit };
  const tip = { x: line.to.x, y: centerY(line.to) + line.entry };
  const end = { x: tip.x - LINE_STOPS_SHORT, y: tip.y };
  const handle = clamp(Math.abs(end.x - start.x) * 0.5, HANDLE_MIN, HANDLE_MAX);
  const control1 = { x: start.x + handle, y: start.y };
  const control2 = { x: end.x - handle, y: end.y };
  const halfway = (axis: "x" | "y") => (start[axis] + 3 * control1[axis] + 3 * control2[axis] + end[axis]) / 8;
  const arrowBase = tip.x - ARROW_LENGTH;
  const barbAbove = { x: arrowBase, y: tip.y - ARROW_HALF_WIDTH };
  const barbBelow = { x: arrowBase, y: tip.y + ARROW_HALF_WIDTH };

  return {
    d: `M${pair(start)} C${pair(control1)} ${pair(control2)} ${pair(end)}`,
    arrow: `M${pair(tip)} L${pair(barbAbove)} L${pair(barbBelow)} Z`,
    start: rounded(start),
    label: rounded({ x: halfway("x"), y: halfway("y") }),
    bounds: boundsOf([start, control1, control2, end, tip]),
  };
}

export function edgePaths(
  edges: readonly BoardEdge[],
  rects: ReadonlyMap<string, Rect>,
  kinds: ReadonlyMap<string, BoardCard["kind"]>,
): Map<string, EdgePath> {
  const lines: Line[] = [];
  for (const edge of edges) {
    const from = rects.get(edge.from);
    const to = rects.get(edge.to);
    if (from && to) lines.push({ edge, from, to, exit: 0, entry: 0 });
  }
  spreadPlainLines(lines.filter((line) => line.edge.kind !== "ref"));
  fanReferenceLines(
    lines.filter((line) => line.edge.kind === "ref"),
    kinds,
  );
  return new Map(lines.map((line) => [line.edge.id, drawn(line)]));
}
