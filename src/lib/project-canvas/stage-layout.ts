import { botIdOfNode, type CanvasBotState, type CanvasConnection, type CanvasNode, type CanvasPoint, type CanvasSnapshot } from "../../../shared/project-canvas";
import { PIPELINE_STAGES, type FlowStage } from "../../../shared/team-pipeline";

/** Between a column's widest row and the next column. */
export const COLUMN_GAP_X = 120;
/** Between two bots of a column. */
export const BOT_GAP_Y = 64;
/** Between a bot and what it made, and between the nodes it made. */
export const LANE_GAP = 48;

const COLUMN_STAGES: readonly FlowStage[] = ["lead", ...PIPELINE_STAGES];

/** A node in a bot's lane with the nodes that stand in the next cell of its row. A group brings the nodes in it. */
interface Row {
  node: CanvasNode;
  members: CanvasNode[];
  next: Row[];
}

interface Lane {
  rows: Row[];
  /** The widest node of each cell, from the one beside the bot. */
  widths: number[];
}

const rowHeight = (row: Row): number => Math.max(row.node.height, row.next.reduce((sum, next, index) => sum + rowHeight(next) + (index ? LANE_GAP : 0), 0));
const rowsHeight = (rows: readonly Row[]) => rows.reduce((sum, row, index) => sum + rowHeight(row) + (index ? LANE_GAP : 0), 0);
const laneWidth = (lane: Lane) => lane.widths.reduce((sum, width) => sum + LANE_GAP + width, 0);

function cellWidths(rows: readonly Row[], depth = 0, widths: number[] = []): number[] {
  for (const row of rows) {
    widths[depth] = Math.max(widths[depth] ?? 0, row.node.width);
    cellWidths(row.next, depth + 1, widths);
  }
  return widths;
}

const byPlace = (a: CanvasNode, b: CanvasNode) => a.position.y - b.position.y || a.position.x - b.position.x;

/**
 * What each bot made, as the rows that stand to its right: the nodes it created or the server linked from it, each
 * followed by what came of it. A shot is followed by its creation node, and that by the shot's takes in the order they
 * were made; any node by the pictures and clips fed only from the bot's nodes. A group the bot made, or that holds a
 * character's profile it made, is one node of its lane. `loose` are the rows of shots no bot made.
 */
function lanesOf(nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): { lanes: Map<string, Lane>; loose: Row[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const content = connections.filter((connection) => connection.kind === "content");
  const shotOf = (node: CanvasNode) => {
    const shot = node.metadata?.shotId ? byId.get(node.metadata.shotId) : undefined;
    return shot?.type === "shot" ? shot : undefined;
  };
  const ofShot = (role: "creation" | "take") => {
    const found = new Map<string, CanvasNode[]>();
    for (const node of nodes) {
      const shot = node.metadata?.role === role ? shotOf(node) : undefined;
      if (shot) found.set(shot.id, [...(found.get(shot.id) ?? []), node]);
    }
    return found;
  };
  const creations = ofShot("creation");
  const takes = ofShot("take");
  const inShotRow = (node: CanvasNode) => (node.metadata?.role === "creation" || node.metadata?.role === "take") && Boolean(shotOf(node));
  const claimed = new Set<string>();
  const free = (node: CanvasNode | undefined): node is CanvasNode => Boolean(node && node.type !== "bot" && !node.groupId && !claimed.has(node.id));

  const rowsFrom = (roots: readonly CanvasNode[], madeBy: (node: CanvasNode) => boolean): Row[] => {
    const mine = new Set(roots.map((node) => node.id));
    const fed = (node: CanvasNode) => content.flatMap((connection) => {
      const target = connection.fromNodeId === node.id ? byId.get(connection.toNodeId) : undefined;
      if (!free(target) || inShotRow(target) || (target.type !== "image" && target.type !== "video")) return [];
      const onlyMine = content.every((other) => other.toNodeId !== target.id || mine.has(other.fromNodeId));
      return onlyMine && (target.createdBy?.kind !== "bot" || madeBy(target)) ? [target] : [];
    });
    const row = (node: CanvasNode): Row => {
      claimed.add(node.id);
      mine.add(node.id);
      const shotId = node.type === "shot" ? node.id : node.metadata?.role === "creation" ? shotOf(node)?.id : undefined;
      const ofRow = !shotId ? [] : node.type === "shot" && creations.get(shotId)?.some(free) ? creations.get(shotId)! : takes.get(shotId) ?? [];
      const next = [...ofRow, ...fed(node)].filter((one, index, all) => free(one) && all.indexOf(one) === index);
      for (const one of next) claimed.add(one.id);
      return { node, members: node.type === "group" ? nodes.filter((member) => member.groupId === node.id) : [], next: next.map(row) };
    };
    for (const root of roots) claimed.add(root.id);
    return roots.map(row);
  };

  const lanes = new Map<string, Lane>();
  for (const bot of nodes) {
    const botId = botIdOfNode(bot.id);
    if (bot.type !== "bot" || botId === null) continue;
    const madeBy = (node: CanvasNode) => node.createdBy?.kind === "bot" && node.createdBy.botId === botId;
    const linked = new Set(content.filter((connection) => connection.pipeline && connection.fromNodeId === bot.id).map((connection) => connection.toNodeId));
    const own = (node: CanvasNode) => madeBy(node) || linked.has(node.id);
    const holdsCharacter = (group: CanvasNode) => nodes.some((member) => member.groupId === group.id && member.metadata?.role === "character" && own(member));
    const roots = nodes.filter((node) => free(node) && !inShotRow(node) && (own(node) || (node.type === "group" && holdsCharacter(node)))).sort(byPlace);
    const rows = rowsFrom(roots, madeBy);
    lanes.set(bot.id, { rows, widths: cellWidths(rows) });
  }
  const looseShots = nodes.filter((node) => node.type === "shot" && free(node));
  return { lanes, loose: rowsFrom(looseShots, () => false) };
}

/** The column a bot stands in: the lead's, or that of the first of its stages; the lead's too for a bot outside the
 * pipeline, which stands below the lead. */
function columnOf(state: CanvasBotState | undefined): number {
  if (!state || state.lead) return 0;
  const first = COLUMN_STAGES.findIndex((stage) => state.stages.includes(stage));
  return Math.max(first, 0);
}

/**
 * Where "Tidy" puts things. Bots stand in columns by stage, left to right, the bots of one stage top to bottom; the
 * bots outside the pipeline stand below the lead. What a bot made stands to its right, before the next column, and a
 * shot's row holds the shot, its creation node and its takes. The first bot of the first column keeps its place, and a
 * shot no bot made keeps its own, its row to its right. Returns the new positions by node id.
 */
export function layoutPipeline(snapshot: Pick<CanvasSnapshot, "nodes" | "connections" | "bots">): Map<string, CanvasPoint> {
  const { nodes, connections, bots } = snapshot;
  const positions = new Map<string, CanvasPoint>();
  const { lanes, loose } = lanesOf(nodes, connections);

  const place = (row: Row, x: number, y: number, widths: readonly number[], depth: number) => {
    const dx = x - row.node.position.x;
    const dy = y - row.node.position.y;
    positions.set(row.node.id, { x, y });
    for (const member of row.members) positions.set(member.id, { x: member.position.x + dx, y: member.position.y + dy });
    let top = y;
    for (const next of row.next) {
      place(next, x + widths[depth]! + LANE_GAP, top, widths, depth + 1);
      top += rowHeight(next) + LANE_GAP;
    }
  };

  const stateOf = (node: CanvasNode) => bots[botIdOfNode(node.id) ?? ""];
  const inPipeline = (node: CanvasNode) => {
    const state = stateOf(node);
    return Boolean(state && (state.lead || columnOf(state) > 0));
  };
  const columns = new Map<number, CanvasNode[]>();
  const botNodes = nodes.filter((node) => node.type === "bot");
  const standing = [
    ...botNodes.filter((node) => stateOf(node)?.lead),
    ...botNodes.filter((node) => inPipeline(node) && !stateOf(node)!.lead),
    ...botNodes.filter((node) => !inPipeline(node)),
  ];
  for (const node of standing) {
    const column = columnOf(stateOf(node));
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }
  const ordered = [...columns.entries()].sort(([a], [b]) => a - b).map(([, column]) => column);
  const origin = ordered[0]?.[0]?.position;
  if (origin) {
    let x = origin.x;
    for (const column of ordered) {
      let y = origin.y;
      for (const bot of column) {
        const lane = lanes.get(bot.id)!;
        positions.set(bot.id, { x, y });
        let top = y;
        for (const row of lane.rows) {
          place(row, x + bot.width + LANE_GAP, top, lane.widths, 0);
          top += rowHeight(row) + LANE_GAP;
        }
        y += Math.max(bot.height, rowsHeight(lane.rows)) + BOT_GAP_Y;
      }
      x += Math.max(...column.map((bot) => bot.width + laneWidth(lanes.get(bot.id)!))) + COLUMN_GAP_X;
    }
  }

  for (const row of loose) {
    place(row, row.node.position.x, row.node.position.y, cellWidths([row]), 0);
    positions.delete(row.node.id);
  }
  return positions;
}
