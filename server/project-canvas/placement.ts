import { botNodeId, CANVAS_NODE_SIZE, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasPoint } from "../../shared/project-canvas.ts";
import type { CanvasFrame } from "./ops.ts";

/** Between a node and the lane of nodes to its right. */
export const LANE_GAP = 80;
/** Between two nodes stacked in a lane. */
export const NODE_GAP = 40;
/** The widest node a lane holds, so a bot's subordinates sit clear of its lane. */
const LANE_WIDTH = CANVAS_NODE_SIZE.video.width;
const ROW_GAP = 60;
const BOT = CANVAS_NODE_SIZE.bot;
const COLUMN = BOT.width + LANE_GAP + LANE_WIDTH + LANE_GAP;
const BAND = BOT.height + ROW_GAP;
const MAX_STEPS = 10_000;

export interface BotTree {
  /** In the order the project lists them. */
  botIds: readonly string[];
  leadBotId: string;
  parentOf(botId: string): string | undefined;
}

/** Each bot's node where nobody placed it: the flow's tree from left to right, the lead at the left, each bot at the
 * top of the band its subtree takes, with room for its lane before its subordinates' column. A bot whose superior is
 * not in the project, or that the tree does not reach from the lead, sits under the lead. */
export function defaultBotFrames(tree: BotTree): Map<string, CanvasFrame> {
  const frames = new Map<string, CanvasFrame>();
  const root = tree.botIds.includes(tree.leadBotId) ? tree.leadBotId : tree.botIds[0];
  if (root === undefined) return frames;
  const members = new Set(tree.botIds);
  const parents = new Map<string, string>();
  for (const id of tree.botIds) {
    if (id === root) continue;
    const parent = tree.parentOf(id);
    parents.set(id, parent !== undefined && parent !== id && members.has(parent) ? parent : root);
  }
  const childrenOf = (id: string) => tree.botIds.filter((one) => parents.get(one) === id);
  const reached = new Set([root]);
  for (const queue = [root]; queue.length;) {
    for (const child of childrenOf(queue.shift()!)) {
      if (reached.has(child)) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  for (const id of tree.botIds) if (!reached.has(id)) parents.set(id, root);

  const place = (id: string, depth: number, top: number): number => {
    frames.set(botNodeId(id), { position: { x: depth * COLUMN, y: top }, width: BOT.width, height: BOT.height });
    let next = top;
    for (const child of childrenOf(id)) next += place(child, depth + 1, next);
    return Math.max(BAND, next - top);
  };
  place(root, 0, 0);
  return frames;
}

interface Rect { x: number; y: number; width: number; height: number }

const rectOf = (frame: CanvasFrame): Rect => ({ x: frame.position.x, y: frame.position.y, width: frame.width, height: frame.height });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function obstacles(document: CanvasDocument, bots: ReadonlyMap<string, CanvasFrame>): Rect[] {
  const stored = new Set(document.nodes.map((one) => one.id));
  return [
    ...document.nodes.filter((one) => one.type !== "group").map(rectOf),
    ...[...bots].filter(([id]) => !stored.has(id)).map(([, frame]) => rectOf(frame)),
  ];
}

/** The first free spot at `x` from `y` down. */
function freeBelow(x: number, y: number, node: CanvasNode, blocking: readonly Rect[]): CanvasPoint {
  let top = y;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const candidate = { x, y: top, width: node.width, height: node.height };
    const hit = blocking.filter((rect) => overlaps(rect, candidate)).sort((a, b) => b.y + b.height - (a.y + a.height))[0];
    if (!hit) break;
    top = hit.y + hit.height + NODE_GAP;
  }
  return { x, y: top };
}

/** To the right of `anchor`, below the lane members already there, clear of every other node. */
function placeInLane(document: CanvasDocument, anchor: CanvasFrame, member: (node: CanvasNode) => boolean, node: CanvasNode, bots: ReadonlyMap<string, CanvasFrame>): CanvasPoint {
  const x = anchor.position.x + anchor.width + LANE_GAP;
  const inLane = document.nodes.filter((one) => member(one) && one.position.x < x + LANE_WIDTH && one.position.x + one.width > x);
  const y = inLane.reduce((lowest, one) => Math.max(lowest, one.position.y + one.height + NODE_GAP), anchor.position.y);
  return freeBelow(x, y, node, obstacles(document, bots));
}

/** Where a node added without a position goes: a bot's in its lane, below what it made there; the person's at the
 * right of everything. */
export function placeForActor(document: CanvasDocument, node: CanvasNode, actor: CanvasNodeCreator, bots: ReadonlyMap<string, CanvasFrame>): CanvasPoint {
  if (actor.kind === "bot") {
    const own = bots.get(botNodeId(actor.botId));
    if (own) return placeInLane(document, own, (one) => one.createdBy?.kind === "bot" && one.createdBy.botId === actor.botId, node, bots);
  }
  const all = obstacles(document, bots);
  if (!all.length) return { x: 0, y: 0 };
  return { x: Math.max(...all.map((rect) => rect.x + rect.width)) + LANE_GAP, y: Math.min(...all.map((rect) => rect.y)) };
}

/** A result of `source`: to its right, below the results already connected from it. */
export function placeAfter(document: CanvasDocument, source: CanvasNode, node: CanvasNode, bots: ReadonlyMap<string, CanvasFrame>): CanvasPoint {
  const fromSource = new Set(document.connections.filter((one) => one.fromNodeId === source.id).map((one) => one.toNodeId));
  return placeInLane(document, source, (one) => fromSource.has(one.id), node, bots);
}
