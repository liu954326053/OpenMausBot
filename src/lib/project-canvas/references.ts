// Adapted from basketikun/infinite-canvas@9cd3deac web/src/lib/canvas/canvas-resource-references.ts, MIT License,
// Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE).
import type { CanvasConnection, CanvasFileRef, CanvasNode } from "../../../shared/project-canvas";
import type { GenerationReferences, ReferenceCounts } from "../../../shared/project-generation";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

/** A node another node can take as input, labelled by kind and order ("Image 1"). */
export interface CanvasReference {
  nodeId: string;
  /** The node connected in: the reference itself, or the group that holds it. */
  sourceNodeId: string;
  kind: CanvasResourceKind;
  /** Counts from 1 within its kind. */
  index: number;
  title: string;
  file?: CanvasFileRef;
  text?: string;
}

export function resourceKind(node: CanvasNode): CanvasResourceKind | null {
  const file = node.metadata?.file;
  if (node.type === "image" && file) return "image";
  if (node.type === "video" && file) return "video";
  if (node.type === "audio" && file) return "audio";
  if (node.type === "text" && (node.metadata?.content || node.metadata?.prompt)) return "text";
  return null;
}

export const groupResourceNodes = (groupId: string, nodes: readonly CanvasNode[]) => nodes.filter((node) => node.groupId === groupId && resourceKind(node));

/** A node that can be connected in as a reference: a resource, or a group holding one. */
export const isReferenceNode = (node: CanvasNode, nodes: readonly CanvasNode[]) => Boolean(resourceKind(node)) || (node.type === "group" && groupResourceNodes(node.id, nodes).length > 0);

function inputNodes(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return connections.flatMap((connection) => {
    if (connection.kind !== "content" || connection.toNodeId !== nodeId) return [];
    const node = byId.get(connection.fromNodeId);
    return node && isReferenceNode(node, nodes) ? [node] : [];
  });
}

/** The configs a node feeds pass their other inputs back to it, as in infinite-canvas. */
function configInputNodes(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]) {
  const config = connections.find((connection) => connection.kind === "content" && connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === "config");
  return config ? inputNodes(config.toNodeId, nodes, connections).filter((node) => node.id !== nodeId) : [];
}

function expand(inputs: readonly CanvasNode[], nodes: readonly CanvasNode[]): Array<{ node: CanvasNode; sourceNodeId: string }> {
  const seen = new Set<string>();
  return inputs.flatMap((source) => (source.type === "group" ? groupResourceNodes(source.id, nodes) : [source]).flatMap((node) => {
    if (seen.has(node.id)) return [];
    seen.add(node.id);
    return [{ node, sourceNodeId: source.id }];
  }));
}

function label(entries: Array<{ node: CanvasNode; sourceNodeId: string }>): CanvasReference[] {
  const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
  return entries.flatMap(({ node, sourceNodeId }) => {
    const kind = resourceKind(node);
    if (!kind) return [];
    counts[kind] += 1;
    const text = node.type === "text" ? node.metadata?.content || node.metadata?.prompt : undefined;
    return [{ nodeId: node.id, sourceNodeId, kind, index: counts[kind], title: node.title, ...(node.metadata?.file ? { file: node.metadata.file } : {}), ...(text ? { text } : {}) }];
  });
}

/** What is connected into the node, groups opened up: the reference bar's items. */
export function connectedReferences(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasReference[] {
  return label(expand(inputNodes(nodeId, nodes, connections), nodes));
}

/** What a node's prompt can name with "@": the inputs of a config it feeds, else its own inputs, else itself. */
export function mentionReferences(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasReference[] {
  const config = expand(configInputNodes(nodeId, nodes, connections), nodes);
  if (config.length) return label(config);
  const own = expand(inputNodes(nodeId, nodes, connections), nodes);
  if (own.length) return label(own);
  const node = nodes.find((item) => item.id === nodeId);
  return node && resourceKind(node) ? label([{ node, sourceNodeId: node.id }]) : [];
}

/** The project files a generation for this node hands over as references. */
export function generationReferences(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): GenerationReferences {
  const config = configInputNodes(nodeId, nodes, connections);
  const references = label(expand(config.length ? config : inputNodes(nodeId, nodes, connections), nodes));
  const paths = (kind: CanvasResourceKind) => references.flatMap((reference) => (reference.kind === kind && reference.file ? [reference.file.path] : []));
  return { images: paths("image"), audio: paths("audio") };
}

export const referenceCounts = (references: GenerationReferences): ReferenceCounts => ({ images: references.images.length, audio: references.audio.length });
