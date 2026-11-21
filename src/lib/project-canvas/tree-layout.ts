import { botIdOfNode, type CanvasConnection, type CanvasNode, type CanvasPoint, type CanvasSnapshot } from "../../../shared/project-canvas";

export const TREE_GAP_X = 120;
export const TREE_GAP_Y = 64;
export const LANE_GAP = 48;

/**
 * What each bot made, for laying it out beside the bot: the content nodes it created, then each image or video fed only
 * from what it made, such as a video generated from its shot. Nodes in a group stay where the person put them.
 */
export function botMadeNodes(nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): Map<string, CanvasNode[][]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const content = connections.filter((connection) => connection.kind === "content");
  const claimed = new Set<string>();
  const lanes = new Map<string, CanvasNode[][]>();
  const claimable = (node: CanvasNode | undefined): node is CanvasNode => Boolean(node && node.type !== "bot" && node.type !== "group" && !node.groupId && !claimed.has(node.id));
  for (const bot of nodes) {
    if (bot.type !== "bot") continue;
    const botId = botIdOfNode(bot.id);
    const mine = new Set<string>([bot.id]);
    const columns: CanvasNode[][] = [];
    let frontier = nodes.filter((node) => claimable(node) && node.createdBy?.kind === "bot" && node.createdBy.botId === botId);
    while (frontier.length) {
      for (const node of frontier) {
        claimed.add(node.id);
        mine.add(node.id);
      }
      columns.push(frontier);
      const next: CanvasNode[] = [];
      for (const connection of content) {
        const target = byId.get(connection.toNodeId);
        if (connection.fromNodeId === bot.id || !mine.has(connection.fromNodeId) || !claimable(target) || next.includes(target)) continue;
        if (target.type !== "image" && target.type !== "video") continue;
        const fedOnlyByMine = content.every((other) => other.toNodeId !== target.id || mine.has(other.fromNodeId));
        if (fedOnlyByMine && (target.createdBy?.kind !== "bot" || target.createdBy.botId === botId)) next.push(target);
      }
      frontier = next;
    }
    lanes.set(bot.id, columns.map((column) => [...column].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)));
  }
  return lanes;
}

const laneWidth = (columns: readonly CanvasNode[][]) => columns.reduce((sum, column) => sum + LANE_GAP + Math.max(...column.map((node) => node.width)), 0);
const columnHeight = (column: readonly CanvasNode[]) => column.reduce((sum, node, index) => sum + node.height + (index ? LANE_GAP : 0), 0);

/**
 * Bots as a tree from the lead at the left, each subordinate in the next column and each subtree in its own band, what
 * every bot made in columns to its right. The first root keeps its place. Returns the new positions by node id.
 */
export function layoutBotTree(snapshot: Pick<CanvasSnapshot, "nodes" | "connections" | "bots">): Map<string, CanvasPoint> {
  const { nodes, connections, bots } = snapshot;
  const botNodes = nodes.filter((node) => node.type === "bot");
  if (!botNodes.length) return new Map();
  const byId = new Map(botNodes.map((node) => [node.id, node]));
  const children = new Map<string, CanvasNode[]>();
  const hasParent = new Set<string>();
  for (const connection of connections) {
    if (connection.kind !== "dispatch" || !byId.has(connection.fromNodeId) || !byId.has(connection.toNodeId) || hasParent.has(connection.toNodeId)) continue;
    hasParent.add(connection.toNodeId);
    children.set(connection.fromNodeId, [...(children.get(connection.fromNodeId) ?? []), byId.get(connection.toNodeId)!]);
  }
  const isLead = (node: CanvasNode) => bots[botIdOfNode(node.id) ?? ""]?.lead === true;
  const roots = botNodes.filter((node) => !hasParent.has(node.id)).sort((a, b) => Number(isLead(b)) - Number(isLead(a)) || a.position.y - b.position.y);
  const lanes = botMadeNodes(nodes, connections);

  const depthWidth: number[] = [];
  const visited = new Set<string>();
  const measure = (node: CanvasNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    depthWidth[depth] = Math.max(depthWidth[depth] ?? 0, node.width + laneWidth(lanes.get(node.id) ?? []));
    for (const child of children.get(node.id) ?? []) measure(child, depth + 1);
  };
  for (const root of roots) measure(root, 0);

  const bandHeights = new Map<string, number>();
  const band = (node: CanvasNode): number => {
    const known = bandHeights.get(node.id);
    if (known !== undefined) return known;
    bandHeights.set(node.id, 0);
    const own = Math.max(node.height, ...(lanes.get(node.id) ?? []).map(columnHeight));
    const kids = (children.get(node.id) ?? []).reduce((sum, child, index) => sum + band(child) + (index ? TREE_GAP_Y : 0), 0);
    const height = Math.max(own, kids);
    bandHeights.set(node.id, height);
    return height;
  };

  const positions = new Map<string, CanvasPoint>();
  const origin = roots[0]!.position;
  const columnX = (depth: number) => origin.x + depthWidth.slice(0, depth).reduce((sum, width) => sum + width + TREE_GAP_X, 0);
  const place = (node: CanvasNode, depth: number, top: number) => {
    if (positions.has(node.id)) return;
    const x = columnX(depth);
    positions.set(node.id, { x, y: top });
    let laneX = x + node.width + LANE_GAP;
    for (const column of lanes.get(node.id) ?? []) {
      let y = top;
      for (const made of column) {
        positions.set(made.id, { x: laneX, y });
        y += made.height + LANE_GAP;
      }
      laneX += Math.max(...column.map((made) => made.width)) + LANE_GAP;
    }
    let childTop = top;
    for (const child of children.get(node.id) ?? []) {
      place(child, depth + 1, childTop);
      childTop += band(child) + TREE_GAP_Y;
    }
  };
  let top = origin.y;
  for (const root of roots) {
    place(root, 0, top);
    top += band(root) + TREE_GAP_Y;
  }
  return positions;
}
