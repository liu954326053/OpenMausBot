// Adapted from basketikun/infinite-canvas@9cd3deac web/src/lib/canvas/canvas-node-geometry.ts and the viewport, curve
// and resize arithmetic of web/src/components/canvas/{infinite-canvas,canvas-connections,canvas-node}.tsx and
// web/src/lib/canvas/canvas-node-size.ts, MIT License, Copyright (c) 2026 basketikun (full text in
// third_party/infinite-canvas/LICENSE).
import type { CanvasNode, CanvasPoint, CanvasViewport } from "../../../shared/project-canvas";

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 5;
export const GRID_SIZE = 48;
export const NODE_MIN_WIDTH = 220;
export const NODE_MIN_HEIGHT = 160;
export const GROUP_WRAP_PADDING = 24;
export const GROUP_WRAP_TOP_PADDING = 52;
export const GROUP_SNAP_PADDING = 24;
export const CULL_PADDING = 280;
export const CONNECTION_HANDLE_HIT_RADIUS = 40;
export const CONNECTION_NODE_HIT_PADDING = 32;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type HandleType = "source" | "target";
export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const clampZoom = (k: number) => Math.min(Math.max(k, MIN_ZOOM), MAX_ZOOM);

export function screenToWorld(viewport: CanvasViewport, point: CanvasPoint): CanvasPoint {
  return { x: (point.x - viewport.x) / viewport.k, y: (point.y - viewport.y) / viewport.k };
}

/** The wheel zoom: the world point under the pointer stays under it. */
export function zoomAtPoint(viewport: CanvasViewport, point: CanvasPoint, deltaY: number): CanvasViewport {
  const k = clampZoom(viewport.k * Math.pow(1.1, -deltaY / 100));
  const world = screenToWorld(viewport, point);
  return { x: point.x - world.x * k, y: point.y - world.y * k, k };
}

/** A zoom level set from the controls, about the middle of the canvas. */
export function zoomAroundCenter(viewport: CanvasViewport, size: CanvasSize, scale: number): CanvasViewport {
  const k = clampZoom(scale);
  return {
    x: size.width / 2 - ((size.width / 2 - viewport.x) / viewport.k) * k,
    y: size.height / 2 - ((size.height / 2 - viewport.y) / viewport.k) * k,
    k,
  };
}

export function gridBackground(viewport: CanvasViewport) {
  const size = GRID_SIZE * viewport.k;
  return { size, x: viewport.x % size, y: viewport.y % size, dot: viewport.k < 0.12 ? 0.8 : 1.15 };
}

export function nodeBounds(nodes: readonly Pick<CanvasNode, "position" | "width" | "height">[]): CanvasBounds {
  return nodes.reduce(
    (acc, node) => ({
      left: Math.min(acc.left, node.position.x),
      top: Math.min(acc.top, node.position.y),
      right: Math.max(acc.right, node.position.x + node.width),
      bottom: Math.max(acc.bottom, node.position.y + node.height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

/** The world rectangle on screen, widened by `padding` so nodes just outside still draw. */
export function visibleBounds(viewport: CanvasViewport, size: CanvasSize, padding = CULL_PADDING): CanvasBounds {
  const left = -viewport.x / viewport.k - padding;
  const top = -viewport.y / viewport.k - padding;
  return { left, top, right: left + size.width / viewport.k + padding * 2, bottom: top + size.height / viewport.k + padding * 2 };
}

export function intersects(node: Pick<CanvasNode, "position" | "width" | "height">, bounds: CanvasBounds): boolean {
  return node.position.x + node.width > bounds.left && node.position.x < bounds.right && node.position.y + node.height > bounds.top && node.position.y < bounds.bottom;
}

export interface ConnectionCurve {
  path: string;
  start: CanvasPoint;
  end: CanvasPoint;
  curvature: number;
}

/** From the right middle of `from` to the left middle of `to`. */
export function connectionCurve(from: Pick<CanvasNode, "position" | "width" | "height">, to: Pick<CanvasNode, "position" | "height">): ConnectionCurve {
  const start = { x: from.position.x + from.width, y: from.position.y + from.height / 2 };
  const end = { x: to.position.x, y: to.position.y + to.height / 2 };
  const curvature = Math.max(Math.abs(end.x - start.x) * 0.5, 50);
  return { path: `M ${start.x} ${start.y} C ${start.x + curvature} ${start.y}, ${end.x - curvature} ${end.y}, ${end.x} ${end.y}`, start, end, curvature };
}

/** A cubic curve stays inside its control points' hull, so the ends widened by the curvature bound it. */
export function curveInView(curve: ConnectionCurve, bounds: CanvasBounds): boolean {
  const { start, end, curvature } = curve;
  return Math.max(start.x + curvature, end.x) > bounds.left && Math.min(start.x, end.x - curvature) < bounds.right && Math.max(start.y, end.y) > bounds.top && Math.min(start.y, end.y) < bounds.bottom;
}

/** The dashed line while a connection is being drawn, snapped to the node it would land on. */
export function draftCurve(node: CanvasNode, handle: HandleType, pointer: CanvasPoint, target?: CanvasNode): string {
  const start = handle === "source" ? { x: node.position.x + node.width, y: node.position.y + node.height / 2 } : target ? { x: target.position.x + target.width, y: target.position.y + target.height / 2 } : pointer;
  const end = handle === "target" ? { x: node.position.x, y: node.position.y + node.height / 2 } : target ? { x: target.position.x, y: target.position.y + target.height / 2 } : pointer;
  const distance = Math.abs(end.x - start.x);
  return `M ${start.x} ${start.y} C ${start.x + distance * 0.5} ${start.y}, ${end.x - distance * 0.5} ${end.y}, ${end.x} ${end.y}`;
}

export function connectionAnchor(node: CanvasNode, handle: HandleType): CanvasPoint {
  return { x: handle === "source" ? node.position.x : node.position.x + node.width, y: node.position.y + node.height / 2 };
}

/**
 * Which way a connection drawn from `first`'s handle to `second` runs, or null when it may not exist: never into a
 * group, never out of a bot (the server draws what a bot made), never between two configs; a config always receives.
 */
export function normalizeConnection(first: CanvasNode | undefined, second: CanvasNode | undefined, handle: HandleType): { fromNodeId: string; toNodeId: string } | null {
  if (!first || !second || first.id === second.id) return null;
  if (first.type === "config" && second.type === "config") return null;
  const reversed = second.type !== "config" && handle === "target";
  const [from, to] = reversed ? [second, first] : [first, second];
  if (to.type === "group" || from.type === "bot") return null;
  return { fromNodeId: from.id, toNodeId: to.id };
}

/** The node a connection being drawn would land on: inside a node beats its handle, which beats its margin. */
export function connectionDropTarget(nodes: readonly CanvasNode[], from: CanvasNode, handle: HandleType, world: CanvasPoint, k: number): { nodeId: string | null; nearNode: boolean } {
  const scale = Math.max(k, MIN_ZOOM);
  const padding = CONNECTION_NODE_HIT_PADDING / scale;
  const radius = CONNECTION_HANDLE_HIT_RADIUS / scale;
  let nearNode = false;
  let best: string | null = null;
  let bestPriority = Infinity;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    const anchor = connectionAnchor(node, handle);
    const hitsHandle = (world.x - anchor.x) ** 2 + (world.y - anchor.y) ** 2 <= radius * radius;
    const { x, y } = node.position;
    const hitsInside = world.x >= x && world.x <= x + node.width && world.y >= y && world.y <= y + node.height;
    const hitsMargin = world.x >= x - padding && world.x <= x + node.width + padding && world.y >= y - padding && world.y <= y + node.height + padding;
    if (!hitsHandle && !hitsInside && !hitsMargin) continue;
    nearNode = true;
    if (node.id === from.id || !normalizeConnection(from, node, handle)) continue;
    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
    if (priority < bestPriority) {
      best = node.id;
      bestPriority = priority;
    }
  }
  return { nodeId: best, nearNode };
}

function containsCenter(group: CanvasNode, node: CanvasNode) {
  const x = node.position.x + node.width / 2;
  const y = node.position.y + node.height / 2;
  return x >= group.position.x && x <= group.position.x + group.width && y >= group.position.y && y <= group.position.y + group.height;
}

/** Bot nodes never join a group. */
const groupable = (node: CanvasNode) => node.type !== "group" && node.type !== "bot";

export function findGroupDropTarget(movedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]): CanvasNode | null {
  if (nodes.some((node) => movedIds.has(node.id) && node.type === "group")) return null;
  const moving = nodes.filter((node) => movedIds.has(node.id) && groupable(node));
  if (!moving.length) return null;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const group = nodes[index]!;
    if (group.type !== "group" || movedIds.has(group.id)) continue;
    if (moving.some((node) => containsCenter(group, node))) return group;
  }
  return null;
}

export function snapNodesIntoGroup(movedIds: ReadonlySet<string>, nodes: readonly CanvasNode[], group: CanvasNode): CanvasNode[] {
  const moving = nodes.filter((node) => movedIds.has(node.id) && groupable(node));
  if (!moving.length) return [...nodes];
  const bounds = nodeBounds(moving);
  const left = group.position.x + GROUP_SNAP_PADDING;
  const top = group.position.y + GROUP_SNAP_PADDING;
  const right = group.position.x + group.width - GROUP_SNAP_PADDING;
  const bottom = group.position.y + group.height - GROUP_SNAP_PADDING;
  const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
  const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
  return nodes.map((node) => (movedIds.has(node.id) && groupable(node) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, groupId: group.id } : node));
}

export function findContainingGroupId(node: CanvasNode, nodes: readonly CanvasNode[]): string | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const group = nodes[index]!;
    if (group.type === "group" && group.id !== node.id && containsCenter(group, node)) return group.id;
  }
  return undefined;
}

/** After a drag: into the group the moved nodes were dropped on, or each into the group around its centre. */
export function settleDraggedNodes(movedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]): CanvasNode[] {
  const target = findGroupDropTarget(movedIds, nodes);
  if (target) return snapNodesIntoGroup(movedIds, nodes, target);
  return nodes.map((node) => {
    if (!movedIds.has(node.id) || !groupable(node)) return node;
    const groupId = findContainingGroupId(node, nodes);
    if (node.groupId === groupId) return node;
    if (groupId) return { ...node, groupId };
    const { groupId: _left, ...rest } = node;
    return rest;
  });
}

function selectedGroupIds(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]) {
  return new Set(nodes.filter((node) => selectedIds.has(node.id) && node.type === "group").map((node) => node.id));
}

export function collectGroupMemberNodes(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]): CanvasNode[] {
  const groups = selectedGroupIds(selectedIds, nodes);
  return nodes.filter((node) => groupable(node) && (selectedIds.has(node.id) || (node.groupId != null && groups.has(node.groupId))));
}

export function groupWrapRect(members: readonly CanvasNode[]) {
  const bounds = nodeBounds(members);
  return {
    x: bounds.left - GROUP_WRAP_PADDING,
    y: bounds.top - GROUP_WRAP_TOP_PADDING,
    width: bounds.right - bounds.left + GROUP_WRAP_PADDING * 2,
    height: bounds.bottom - bounds.top + GROUP_WRAP_TOP_PADDING + GROUP_WRAP_PADDING,
  };
}

export function canGroupSelection(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]): boolean {
  const members = collectGroupMemberNodes(selectedIds, nodes);
  if (members.length < 2) return false;
  const groupId = members[0]!.groupId;
  return !groupId || members.some((node) => node.groupId !== groupId);
}

export function canUngroupSelection(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]): boolean {
  return nodes.some((node) => selectedIds.has(node.id) && (node.type === "group" || Boolean(node.groupId)));
}

function emptyGroupIds(nodes: readonly CanvasNode[], keepId?: string) {
  const used = new Set(nodes.flatMap((node) => (node.type !== "group" && node.groupId ? [node.groupId] : [])));
  return new Set(nodes.filter((node) => node.type === "group" && node.id !== keepId && !used.has(node.id)).map((node) => node.id));
}

const withoutGroupId = (node: CanvasNode): CanvasNode => {
  const { groupId: _groupId, ...rest } = node;
  return rest;
};

/** The selection wrapped in `group`; groups it held are flattened and groups left empty go. */
export function applyGroupSelection(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNode[], group: CanvasNode): { nodes: CanvasNode[]; selectedIds: string[] } | null {
  const members = collectGroupMemberNodes(selectedIds, nodes);
  if (members.length < 2) return null;
  const memberIds = new Set(members.map((node) => node.id));
  const flattened = selectedGroupIds(selectedIds, nodes);
  const updated = nodes.filter((node) => !flattened.has(node.id)).map((node) => (memberIds.has(node.id) ? { ...node, groupId: group.id } : node));
  const insertAt = updated.findIndex((node) => memberIds.has(node.id));
  const withGroup = insertAt < 0 ? [...updated, group] : [...updated.slice(0, insertAt), group, ...updated.slice(insertAt)];
  const removed = emptyGroupIds(withGroup, group.id);
  return { nodes: withGroup.filter((node) => !removed.has(node.id)), selectedIds: [group.id] };
}

export function applyUngroupSelection(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNode[]): { nodes: CanvasNode[]; selectedIds: string[] } | null {
  const flattened = selectedGroupIds(selectedIds, nodes);
  if (!flattened.size && !nodes.some((node) => selectedIds.has(node.id) && node.groupId)) return null;
  const released = new Set<string>();
  const updated = nodes.filter((node) => !flattened.has(node.id)).map((node) => {
    if (!node.groupId) return node;
    if (!flattened.has(node.groupId) && !selectedIds.has(node.id)) return node;
    released.add(node.id);
    return withoutGroupId(node);
  });
  const removed = emptyGroupIds(updated);
  const next = updated.filter((node) => !removed.has(node.id));
  return { nodes: next, selectedIds: next.filter((node) => selectedIds.has(node.id) || released.has(node.id)).map((node) => node.id) };
}

export interface FocusFrame {
  above?: number;
  below?: number;
  bottomInset?: number;
}

/**
 * Centres the node with what is open above and below it in the usable area, zoomed so all of it fits (the node at
 * most 60% of the view); with a panel below, the spare height splits 3:1 so the panel sits nearer the bottom dock.
 */
export function focusViewportForNode(node: Pick<CanvasNode, "position" | "width" | "height">, size: CanvasSize, frame: FocusFrame = {}): CanvasViewport {
  const above = frame.above ?? 0;
  const below = frame.below ?? 0;
  const usableBottom = Math.max(0, size.height - (frame.bottomInset ?? 0));
  const centerX = node.position.x + node.width / 2;
  const centerY = node.position.y + node.height / 2;
  const verticalRoom = usableBottom * 0.92 - above - below;
  const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height, verticalRoom / node.height), MIN_ZOOM), 1);
  const groupHeight = above + node.height * k + below;
  const slack = usableBottom - groupHeight;
  const groupTop = slack * (below > 0 && slack > 0 ? 0.75 : 0.5);
  return { x: size.width / 2 - centerX * k, y: groupTop + groupHeight / 2 - centerY * k - (below - above) / 2, k };
}

const PANEL_WIDTH = 600;
const PANEL_GAP = 16;
const PANEL_INSET = 16;
const NODE_TITLE_ROOM = 28;

export interface PanelPlace {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** Where a node's panel `height` tall shows on a canvas of `size`: 600px wide at every zoom, 16px under its node and
 * centred on it, then moved only as far as keeps it wholly on the canvas, 16px clear of every edge. With no room under
 * the node it goes above it, or to the side with more room. The node and the view stay where they are. */
export function panelPlacement(node: Pick<CanvasNode, "position" | "width" | "height">, viewport: CanvasViewport, height: number, size: CanvasSize): PanelPlace {
  const x = node.position.x * viewport.k + viewport.x;
  const y = node.position.y * viewport.k + viewport.y;
  const bottom = y + node.height * viewport.k;
  const width = Math.max(0, Math.min(PANEL_WIDTH, size.width - PANEL_INSET * 2));
  const maxHeight = Math.max(0, size.height - PANEL_INSET * 2);
  const shown = Math.min(height, maxHeight);
  const roomBelow = size.height - PANEL_INSET - bottom - PANEL_GAP;
  const roomAbove = y - NODE_TITLE_ROOM - PANEL_GAP - PANEL_INSET;
  const top = roomBelow >= shown || roomBelow >= roomAbove ? bottom + PANEL_GAP : y - NODE_TITLE_ROOM - PANEL_GAP - shown;
  const within = (value: number, extent: number, limit: number) => Math.min(Math.max(value, PANEL_INSET), Math.max(PANEL_INSET, limit - PANEL_INSET - extent));
  return {
    left: within(x + (node.width * viewport.k) / 2 - width / 2, width, size.width),
    top: within(top, shown, size.height),
    width,
    maxHeight,
  };
}

export interface ResizeStart {
  corner: ResizeCorner;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Width over height to keep, or null to resize freely. */
  ratio: number | null;
}

/** The frame a corner drag of (dx, dy) world units gives, never under the minimum size. */
export function resizeFrame(start: ResizeStart, dx: number, dy: number) {
  const fromLeft = start.corner.includes("left");
  const fromTop = start.corner.includes("top");
  let width = Math.max(NODE_MIN_WIDTH, start.width + (fromLeft ? -dx : dx));
  let height = Math.max(NODE_MIN_HEIGHT, start.height + (fromTop ? -dy : dy));
  if (start.ratio) {
    const ratio = start.ratio;
    if (Math.abs(dx) >= Math.abs(dy)) height = width / ratio;
    else width = height * ratio;
    if (height < NODE_MIN_HEIGHT) {
      height = NODE_MIN_HEIGHT;
      width = height * ratio;
    }
    if (width < NODE_MIN_WIDTH) {
      width = NODE_MIN_WIDTH;
      height = width / ratio;
    }
  }
  return {
    width,
    height,
    position: { x: fromLeft ? start.left + start.width - width : start.left, y: fromTop ? start.top + start.height - height : start.top },
  };
}

/** The frame that shows a picture of `width` by `height` whole: its shape, no larger than the maximum, and no smaller
 * than a node can be resized to unless the maximum forbids it. */
export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640): CanvasSize {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(maxWidth / w, maxHeight / h, Math.max(1, NODE_MIN_WIDTH / w, NODE_MIN_HEIGHT / h));
  return { width: w * scale, height: h * scale };
}
