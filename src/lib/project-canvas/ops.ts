// Adapted from basketikun/infinite-canvas@9cd3deac web/src/lib/canvas/canvas-agent-ops.ts, MIT License, Copyright (c)
// 2026 basketikun (full text in third_party/infinite-canvas/LICENSE); modified: the operations of
// shared/project-canvas.ts, applied as the server applies a person's, with their inverse and a diff between documents.
import {
  allowedNodeHeight,
  CANVAS_NODE_SIZE,
  type CanvasConnection,
  type CanvasContentNodeType,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeMetadata,
  type CanvasNodeMetadataPatch,
  type CanvasNodePatch,
  type CanvasOp,
} from "../../../shared/project-canvas";

const idsOf = (op: { id?: string; ids?: string[] }): string[] => op.ids ?? (op.id ? [op.id] : []);

const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

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
  if (patch.position) next.position = { x: patch.position.x, y: patch.position.y };
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

/** The op that adds `node` back as it is. */
export function addNodeOp(node: CanvasNode): CanvasOp {
  return {
    type: "add_node",
    id: node.id,
    nodeType: node.type as CanvasContentNodeType,
    title: node.title,
    position: { ...node.position },
    width: node.width,
    height: node.height,
    ...(node.metadata ? { metadata: node.metadata } : {}),
    ...(node.groupId ? { groupId: node.groupId } : {}),
  };
}

const connectOp = (connection: CanvasConnection): CanvasOp => ({ type: "connect_nodes", id: connection.id, fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId });

const groupsFirst = (a: CanvasNode, b: CanvasNode) => Number(b.type === "group") - Number(a.type === "group");

/** The update that turns `from` into `to`, the same node; none when they do not differ. */
export function updateBetween(from: CanvasNode, to: CanvasNode): CanvasOp[] {
  const patch: CanvasNodePatch = {};
  if (from.title !== to.title) patch.title = to.title;
  if (from.position.x !== to.position.x || from.position.y !== to.position.y) patch.position = { ...to.position };
  if (from.width !== to.width) patch.width = to.width;
  if (from.height !== to.height) patch.height = to.height;
  if (from.groupId !== to.groupId) patch.groupId = to.groupId ?? null;
  const metadata: Record<string, unknown> = {};
  const before = (from.metadata ?? {}) as Record<string, unknown>;
  const after = (to.metadata ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameValue(before[key], after[key])) metadata[key] = after[key] === undefined ? null : after[key];
  }
  const hasPatch = Object.keys(patch).length > 0;
  const hasMetadata = Object.keys(metadata).length > 0;
  if (!hasPatch && !hasMetadata) return [];
  return [{ type: "update_node", id: to.id, ...(hasPatch ? { patch } : {}), ...(hasMetadata ? { metadata: metadata as CanvasNodeMetadataPatch } : {}) }];
}

function inverseOf(document: CanvasDocument, op: CanvasOp): CanvasOp[] {
  switch (op.type) {
    case "add_node":
      return op.id && !document.nodes.some((node) => node.id === op.id) ? [{ type: "delete_node", ids: [op.id] }] : [];
    case "update_node": {
      const node = document.nodes.find((item) => item.id === op.id);
      return node ? updateBetween(patchNode(node, op.patch, op.metadata), node) : [];
    }
    case "delete_node": {
      const ids = new Set(idsOf(op).filter((id) => document.nodes.some((node) => node.id === id && node.type !== "bot")));
      if (!ids.size) return [];
      const removed = document.nodes.filter((node) => ids.has(node.id)).sort(groupsFirst);
      const regrouped = document.nodes.filter((node) => !ids.has(node.id) && node.groupId && ids.has(node.groupId))
        .map((node): CanvasOp => ({ type: "update_node", id: node.id, patch: { groupId: node.groupId } }));
      const relinked = document.connections.filter((connection) => connection.kind === "content" && (ids.has(connection.fromNodeId) || ids.has(connection.toNodeId)));
      return [...removed.map(addNodeOp), ...regrouped, ...relinked.map(connectOp)];
    }
    case "connect_nodes":
      return applyCanvasOps(document, [op]).connections.length > document.connections.length ? [{ type: "delete_connections", ids: [op.id!] }] : [];
    case "delete_connections": {
      const ids = new Set(idsOf(op));
      return document.connections.filter((connection) => connection.kind === "content" && ids.has(connection.id)).map(connectOp);
    }
    case "set_viewport":
      return [{ type: "set_viewport", viewport: document.viewport }];
    case "set_background":
      return document.backgroundMode === op.backgroundMode ? [] : [{ type: "set_background", backgroundMode: document.backgroundMode }];
  }
}

/** The ops that undo `ops` once they have been applied to `document`. */
export function invertCanvasOps(document: CanvasDocument, ops: readonly CanvasOp[]): CanvasOp[] {
  const steps: CanvasOp[][] = [];
  let current = document;
  for (const op of ops) {
    steps.push(inverseOf(current, op));
    current = applyCanvasOps(current, [op]);
  }
  return steps.reverse().flat();
}

/** The ops that turn `before` into `after`, viewport aside. Bot nodes are never added or deleted. */
export function diffCanvasOps(before: CanvasDocument, after: CanvasDocument): CanvasOp[] {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterIds = new Set(after.nodes.map((node) => node.id));
  const removed = new Set(before.nodes.filter((node) => !afterIds.has(node.id) && node.type !== "bot").map((node) => node.id));
  const afterConnections = new Set(after.connections.map((connection) => connection.id));
  const beforeConnections = new Set(before.connections.map((connection) => connection.id));
  const unlinked = before.connections
    .filter((connection) => connection.kind === "content" && !afterConnections.has(connection.id) && !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId))
    .map((connection) => connection.id);
  const ops: CanvasOp[] = [];
  if (unlinked.length) ops.push({ type: "delete_connections", ids: unlinked });
  if (removed.size) ops.push({ type: "delete_node", ids: [...removed] });
  ops.push(...after.nodes.filter((node) => !beforeNodes.has(node.id) && node.type !== "bot").sort(groupsFirst).map(addNodeOp));
  for (const node of after.nodes) {
    const old = beforeNodes.get(node.id);
    if (old) ops.push(...updateBetween(old.groupId && removed.has(old.groupId) ? withoutGroup(old) : old, node));
  }
  ops.push(...after.connections.filter((connection) => connection.kind === "content" && !beforeConnections.has(connection.id)).map(connectOp));
  if (before.backgroundMode !== after.backgroundMode) ops.push({ type: "set_background", backgroundMode: after.backgroundMode });
  return ops;
}
