// Adapted from basketikun/infinite-canvas@9cd3deac web/src/lib/canvas/canvas-agent-ops.ts, MIT License, Copyright (c)
// 2026 basketikun (full text in third_party/infinite-canvas/LICENSE); modified: the operations of
// shared/project-canvas.ts, applied as the server applies a person's.
import {
  allowedNodeHeight,
  CANVAS_NODE_SIZE,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeMetadata,
  type CanvasNodeMetadataPatch,
  type CanvasNodePatch,
  type CanvasOp,
} from "../../../shared/project-canvas";

const idsOf = (op: { id?: string; ids?: string[] }): string[] => op.ids ?? (op.id ? [op.id] : []);

function withoutGroup(node: CanvasNode): CanvasNode {
  const { groupId: _groupId, ...rest } = node;
  return rest;
}

function patchMetadata(metadata: CanvasNodeMetadata | undefined, patch: CanvasNodeMetadataPatch): CanvasNodeMetadata | undefined {
  const next: Record<string, unknown> = { ...metadata };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return Object.keys(next).length ? next as CanvasNodeMetadata : undefined;
}

/** A bot node takes only a new frame. */
export function patchNode(node: CanvasNode, patch: CanvasNodePatch = {}, metadata?: CanvasNodeMetadataPatch): CanvasNode {
  const content = node.type !== "bot";
  let next: CanvasNode = { ...node };
  if (content && patch.title !== undefined) next.title = patch.title;
  if (patch.position) next = { ...next, position: { x: patch.position.x, y: patch.position.y }, arranged: true };
  if (patch.width !== undefined) next.width = patch.width;
  if (patch.height !== undefined) next.height = allowedNodeHeight(node.type, patch.height);
  if (content && patch.groupId !== undefined) next = patch.groupId === null ? withoutGroup(next) : { ...next, groupId: patch.groupId };
  if (content && metadata) {
    const merged = patchMetadata(node.metadata, metadata);
    if (merged) next.metadata = merged;
    else delete next.metadata;
  }
  return next;
}

function addedNode(op: Extract<CanvasOp, { type: "add_node" }>): CanvasNode {
  const size = CANVAS_NODE_SIZE[op.nodeType];
  const node: CanvasNode = {
    id: op.id!,
    type: op.nodeType,
    title: op.title ?? "",
    position: op.position ?? { x: 0, y: 0 },
    width: op.width ?? size.width,
    height: allowedNodeHeight(op.nodeType, op.height ?? size.height),
    createdBy: { kind: "person" },
  };
  if (op.metadata) node.metadata = op.metadata;
  if (op.groupId) node.groupId = op.groupId;
  return node;
}

/** The ops applied as the server applies a person's: what is not there, or not theirs to change, is left alone. */
export function applyCanvasOps<T extends CanvasDocument>(document: T, ops: readonly CanvasOp[]): T {
  let { nodes, connections, viewport, backgroundMode } = document;
  for (const op of ops) {
    switch (op.type) {
      case "add_node":
        if (op.id && !nodes.some((node) => node.id === op.id)) nodes = [...nodes, addedNode(op)];
        break;
      case "update_node":
        nodes = nodes.map((node) => (node.id === op.id ? patchNode(node, op.patch, op.metadata) : node));
        break;
      case "delete_node": {
        const ids = new Set(idsOf(op).filter((id) => nodes.some((node) => node.id === id && node.type !== "bot")));
        if (!ids.size) break;
        nodes = nodes.filter((node) => !ids.has(node.id)).map((node) => (node.groupId && ids.has(node.groupId) ? withoutGroup(node) : node));
        connections = connections.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId));
        break;
      }
      case "connect_nodes": {
        const { id, fromNodeId, toNodeId } = op;
        if (!id || fromNodeId === toNodeId) break;
        if (connections.some((connection) => connection.id === id || (connection.kind === "content" && connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId))) break;
        if (!nodes.some((node) => node.id === fromNodeId) || !nodes.some((node) => node.id === toNodeId)) break;
        connections = [...connections, { id, fromNodeId, toNodeId, kind: "content" }];
        break;
      }
      case "delete_connections": {
        const ids = new Set(idsOf(op));
        connections = connections.filter((connection) => connection.kind === "dispatch" || !ids.has(connection.id));
        break;
      }
      case "set_viewport":
        viewport = op.viewport;
        break;
      case "set_background":
        backgroundMode = op.backgroundMode;
        break;
    }
  }
  return { ...document, nodes, connections, viewport, backgroundMode };
}
