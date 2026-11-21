// Adapted from basketikun/infinite-canvas@9cd3deac web/src/pages/canvas/project.tsx (click and marquee selection,
// dragging a group with its members, copy, paste and duplicate), MIT License, Copyright (c) 2026 basketikun (full text
// in third_party/infinite-canvas/LICENSE).
import type { CanvasConnection, CanvasNode, CanvasNodeMetadata, CanvasPoint } from "../../../shared/project-canvas";
import { nodeBounds } from "./geometry";

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectFromPoints(a: CanvasPoint, b: CanvasPoint): CanvasRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** The nodes a marquee touches. */
export function nodesInRect(nodes: readonly CanvasNode[], rect: CanvasRect): string[] {
  return nodes
    .filter((node) => rect.x < node.position.x + node.width && rect.x + rect.width > node.position.x && rect.y < node.position.y + node.height && rect.y + rect.height > node.position.y)
    .map((node) => node.id);
}

/** A click: with a modifier it toggles the node; without one it selects only the node, unless it is already selected. */
export function clickSelection(selected: ReadonlySet<string>, nodeId: string, toggle: boolean): Set<string> {
  const next = new Set(selected);
  if (toggle) {
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
  } else if (!next.has(nodeId)) {
    next.clear();
    next.add(nodeId);
  }
  return next;
}

/** What moves when the selection is dragged: a selected group takes its members along. */
export function dragNodeIds(selected: ReadonlySet<string>, nodes: readonly CanvasNode[]): Set<string> {
  const ids = new Set(selected);
  for (const node of nodes) if (node.groupId && selected.has(node.groupId)) ids.add(node.id);
  return ids;
}

/** Bot nodes cannot be deleted, copied or grouped. */
export const isContentNode = (node: CanvasNode) => node.type !== "bot";

export interface CanvasClipboard {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

/** The selected content nodes, with the connections that lead into them. */
export function copySelection(selected: ReadonlySet<string>, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasClipboard | null {
  const copied = nodes.filter((node) => selected.has(node.id) && isContentNode(node)).map((node) => structuredClone(node));
  if (!copied.length) return null;
  const ids = new Set(copied.map((node) => node.id));
  return { nodes: copied, connections: connections.filter((connection) => connection.kind === "content" && ids.has(connection.toNodeId)).map((connection) => ({ ...connection })) };
}

/** A copy shows its own result, never a generation still running for the original. */
function copiedMetadata(metadata: CanvasNodeMetadata | undefined): CanvasNodeMetadata | undefined {
  if (!metadata) return undefined;
  const { jobId: _jobId, ...rest } = metadata;
  if (rest.status === "loading") delete rest.status;
  return Object.keys(rest).length ? rest : undefined;
}

export interface PasteOptions {
  center: CanvasPoint;
  newId: () => string;
  copyTitle: (title: string) => string;
}

/**
 * The clipboard's nodes centred on `center`, with new ids and copy titles. A member keeps its group only when the group
 * was copied too; a connection from a node that was not copied still comes from that node.
 */
export function pasteClipboard(clipboard: CanvasClipboard, { center, newId, copyTitle }: PasteOptions): CanvasClipboard {
  const bounds = nodeBounds(clipboard.nodes);
  const dx = center.x - (bounds.left + bounds.right) / 2;
  const dy = center.y - (bounds.top + bounds.bottom) / 2;
  const ids = new Map(clipboard.nodes.map((node) => [node.id, newId()]));
  const nodes = clipboard.nodes.map((node): CanvasNode => {
    const { groupId, metadata, createdBy: _createdBy, ...rest } = node;
    const pasted: CanvasNode = { ...rest, id: ids.get(node.id)!, title: copyTitle(node.title), position: { x: node.position.x + dx, y: node.position.y + dy } };
    const copied = copiedMetadata(metadata);
    if (copied) pasted.metadata = copied;
    const group = groupId ? ids.get(groupId) : undefined;
    if (group) pasted.groupId = group;
    return pasted;
  });
  const connections = clipboard.connections.flatMap((connection): CanvasConnection[] => {
    const toNodeId = ids.get(connection.toNodeId);
    return toNodeId ? [{ id: newId(), fromNodeId: ids.get(connection.fromNodeId) ?? connection.fromNodeId, toNodeId, kind: "content" }] : [];
  });
  return { nodes, connections };
}

/** One node copied beside itself, keeping what leads into it. */
export function duplicateNode(node: CanvasNode, connections: readonly CanvasConnection[], options: Omit<PasteOptions, "center">): CanvasClipboard {
  const center = { x: node.position.x + 36 + node.width / 2, y: node.position.y + 36 + node.height / 2 };
  return pasteClipboard({ nodes: [node], connections: connections.filter((connection) => connection.kind === "content" && connection.toNodeId === node.id) }, { ...options, center });
}
