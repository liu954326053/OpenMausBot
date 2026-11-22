import { botIdOfNode, botNodeId, CANVAS_NODE_SIZE, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasPoint } from "../../shared/project-canvas.ts";
import { PIPELINE_STAGES, type FlowStage } from "../../shared/team-pipeline.ts";
import type { CanvasFlow } from "./flow.ts";
import type { CanvasFrame } from "./ops.ts";

/** Between a node and the lane of nodes to its right. */
export const LANE_GAP = 80;
/** Between two nodes stacked in a lane. */
export const NODE_GAP = 40;
/** Between a column of bots and the next: past the bots and past what they made to their right. */
export const COLUMN_GAP = 120;
/** The widest node a lane holds. */
const LANE_WIDTH = CANVAS_NODE_SIZE.video.width;
const ROW_GAP = 60;
const BOT = CANVAS_NODE_SIZE.bot;
const BAND = BOT.height + ROW_GAP;
const MAX_STEPS = 10_000;
/** Around the nodes of a group the server makes, as the app wraps a selection it groups. */
export const GROUP_PADDING = 24;
export const GROUP_TOP_PADDING = 52;

type Lanes = Pick<CanvasDocument, "nodes" | "connections">;

/** Each node's bot, the one whose lane it stands in: the bot that made it, else the bot that made its shot or its group,
 * else the bot the pipeline links it from. */
function laneBots({ nodes, connections }: Lanes): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const linked = new Map<string, string>();
  for (const connection of connections) {
    const botId = connection.pipeline ? botIdOfNode(connection.fromNodeId) : null;
    if (botId !== null) linked.set(connection.toNodeId, botId);
  }
  const botOf = (node: CanvasNode | undefined, depth: number): string | undefined => {
    if (!node || depth > 3) return undefined;
    if (node.createdBy?.kind === "bot") return node.createdBy.botId;
    const shot = node.metadata?.shotId ? byId.get(node.metadata.shotId) : undefined;
    const group = node.groupId ? byId.get(node.groupId) : undefined;
    return (shot !== node ? botOf(shot, depth + 1) : undefined) ?? botOf(group, depth + 1) ?? linked.get(node.id);
  };
  const bots = new Map<string, string>();
  for (const node of nodes) {
    const botId = node.type === "bot" ? undefined : botOf(node, 0);
    if (botId !== undefined) bots.set(node.id, botId);
  }
  return bots;
}

/** Each bot's node where nobody placed it: a column for the lead with the bots outside the pipeline below it, then one
 * for each stage that has a bot, in pipeline order, a bot with several stages in the column of its first. The bots of
 * a column stand one below the other, and the next column starts past them and past what they made, so an empty
 * project's bots stand close together and a column moves right as the one before it makes things. */
export function defaultBotFrames(flow: CanvasFlow, lanes: Lanes = { nodes: [], connections: [] }): Map<string, CanvasFrame> {
  const frames = new Map<string, CanvasFrame>();
  const stored = new Map(lanes.nodes.filter((node) => node.type === "bot").map((node) => [node.id, node]));
  const reach = new Map<string, number>();
  const byId = new Map(lanes.nodes.map((node) => [node.id, node]));
  for (const [nodeId, botId] of laneBots(lanes)) {
    const node = byId.get(nodeId)!;
    reach.set(botId, Math.max(reach.get(botId) ?? Number.NEGATIVE_INFINITY, node.position.x + node.width));
  }
  const first = (botId: string) => flow.stages[botId]?.find((stage) => (PIPELINE_STAGES as readonly FlowStage[]).includes(stage));
  const outside = flow.botIds.filter((botId) => botId !== flow.leadBotId && !first(botId));
  const columns = [
    [...flow.botIds.filter((botId) => botId === flow.leadBotId), ...outside],
    ...PIPELINE_STAGES.map((stage) => flow.botIds.filter((botId) => botId !== flow.leadBotId && first(botId) === stage)),
  ].filter((column) => column.length);
  let x = 0;
  for (const column of columns) {
    let right = x + BOT.width;
    column.forEach((botId, row) => {
      const frame = { position: { x, y: row * BAND }, width: BOT.width, height: BOT.height };
      frames.set(botNodeId(botId), frame);
      const shown = stored.get(botNodeId(botId)) ?? frame;
      right = Math.max(right, shown.position.x + shown.width, reach.get(botId) ?? Number.NEGATIVE_INFINITY);
    });
    x = right + COLUMN_GAP;
  }
  return frames;
}

interface Rect { x: number; y: number; width: number; height: number }

const rectOf = (frame: CanvasFrame): Rect => ({ x: frame.position.x, y: frame.position.y, width: frame.width, height: frame.height });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** What a node placed with its left edge at `fromX` must stay clear of. A bot nobody placed that reaches past `fromX`
 * stands in a later column, which moves right past the node, so it is not in the way. */
function obstacles(document: CanvasDocument, bots: ReadonlyMap<string, CanvasFrame>, reserved: readonly CanvasFrame[], fromX = Number.POSITIVE_INFINITY): Rect[] {
  const stored = new Set(document.nodes.map((one) => one.id));
  return [
    ...document.nodes.filter((one) => one.type !== "group").map(rectOf),
    ...[...bots].filter(([id, frame]) => !stored.has(id) && frame.position.x + frame.width <= fromX).map(([, frame]) => rectOf(frame)),
    ...reserved.map(rectOf),
  ];
}

/** The first free spot at `x` from `y` down. */
function freeBelow(x: number, y: number, node: Pick<CanvasFrame, "width" | "height">, blocking: readonly Rect[]): CanvasPoint {
  let top = y;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const candidate = { x, y: top, width: node.width, height: node.height };
    const hit = blocking.filter((rect) => overlaps(rect, candidate)).sort((a, b) => b.y + b.height - (a.y + a.height))[0];
    if (!hit) break;
    top = hit.y + hit.height + NODE_GAP;
  }
  return { x, y: top };
}

/** The first spot at `at.x` from `at.y` down that is clear of every node but the groups and `ignore`, of the bots and
 * of `reserved`. */
export function clearSpot(document: CanvasDocument, at: CanvasPoint, size: Pick<CanvasFrame, "width" | "height">, bots: ReadonlyMap<string, CanvasFrame>, reserved: readonly CanvasFrame[] = [], ignore: ReadonlySet<string> = new Set()): CanvasPoint {
  const others = ignore.size ? { ...document, nodes: document.nodes.filter((one) => !ignore.has(one.id)) } : document;
  return freeBelow(at.x, at.y, size, obstacles(others, bots, reserved, at.x));
}

/** `frame` moved down until it overlaps none of `taken`. */
export function clearBelow(frame: CanvasFrame, taken: readonly CanvasFrame[]): CanvasFrame {
  return { ...frame, position: freeBelow(frame.position.x, frame.position.y, frame, taken.map(rectOf)) };
}

/** To the right of `anchor`, below the lane members already there, clear of every other node and of `reserved`. */
function placeInLane(document: CanvasDocument, anchor: CanvasFrame, member: (node: CanvasNode) => boolean, size: Pick<CanvasFrame, "width" | "height">, bots: ReadonlyMap<string, CanvasFrame>, reserved: readonly CanvasFrame[]): CanvasPoint {
  const x = anchor.position.x + anchor.width + LANE_GAP;
  const inLane = document.nodes.filter((one) => member(one) && one.position.x < x + LANE_WIDTH && one.position.x + one.width > x);
  const y = inLane.reduce((lowest, one) => Math.max(lowest, one.position.y + one.height + NODE_GAP), anchor.position.y);
  return freeBelow(x, y, size, obstacles(document, bots, reserved, x));
}

/** Where a node added without a position goes: a bot's in its lane, below what it made there; the person's at the
 * right of everything. Clear of `reserved`, the frames of nodes still to come. */
export function placeForActor(document: CanvasDocument, node: CanvasNode, actor: CanvasNodeCreator, bots: ReadonlyMap<string, CanvasFrame>, reserved: readonly CanvasFrame[] = []): CanvasPoint {
  if (actor.kind === "bot") {
    const own = bots.get(botNodeId(actor.botId));
    if (own) return placeInLane(document, own, (one) => one.createdBy?.kind === "bot" && one.createdBy.botId === actor.botId, node, bots, reserved);
  }
  const all = obstacles(document, bots, reserved);
  if (!all.length) return { x: 0, y: 0 };
  return { x: Math.max(...all.map((rect) => rect.x + rect.width)) + LANE_GAP, y: Math.min(...all.map((rect) => rect.y)) };
}

/** A result of `source`: to its right, below the results already connected from it, clear of `reserved`, the frames of
 * nodes still to come. */
export function placeAfter(document: CanvasDocument, source: CanvasNode, size: Pick<CanvasFrame, "width" | "height">, bots: ReadonlyMap<string, CanvasFrame>, reserved: readonly CanvasFrame[] = []): CanvasPoint {
  const fromSource = new Set(document.connections.filter((one) => one.fromNodeId === source.id).map((one) => one.toNodeId));
  return placeInLane(document, source, (one) => fromSource.has(one.id), size, bots, reserved);
}
