/*! Reference numbering adapted from basketikun/infinite-canvas@9cd3deac (web/src/lib/canvas/canvas-resource-references.ts,
 * web/src/lib/image-reference-prompt.ts), MIT; modified.
 *
 * MIT License
 *
 * Copyright (c) 2026 basketikun
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { generationKindOf, type CanvasConnection, type CanvasFileRef, type CanvasNode } from "./project-canvas.ts";
import type { GenerationReferences, ReferenceCounts } from "./project-generation.ts";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

/** A node another node can take as input, numbered within its kind. */
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

/** The keys, in the app's language packs, of the name of each kind. */
export const REFERENCE_KIND_KEYS = {
  image: "server.projectCanvas.reference.image",
  video: "server.projectCanvas.reference.video",
  audio: "server.projectCanvas.reference.audio",
  text: "server.projectCanvas.reference.text",
} as const satisfies Record<CanvasResourceKind, string>;

export type ReferenceKindKey = (typeof REFERENCE_KIND_KEYS)[CanvasResourceKind];

/** "图片 1": how a prompt names a reference, by its kind's name and its number. `word` reads a key of the app's language
 * packs in the person's language (`t` in the app, `serverLine` on the server), so both name a reference alike. */
export function referenceLabel(reference: Pick<CanvasReference, "kind" | "index">, word: (key: ReferenceKindKey) => string): string {
  return `${word(REFERENCE_KIND_KEYS[reference.kind])} ${reference.index}`;
}

export function resourceKind(node: CanvasNode): CanvasResourceKind | null {
  const file = node.metadata?.file;
  if (node.type === "image" && file) return "image";
  if (node.type === "video" && file) return "video";
  if (node.type === "audio" && file) return "audio";
  if (node.type === "text" && (node.metadata?.content || node.metadata?.prompt)) return "text";
  return null;
}

export const groupResourceNodes = (groupId: string, nodes: readonly CanvasNode[]): CanvasNode[] => nodes.filter((node) => node.groupId === groupId && resourceKind(node));

/** A node that can be connected in as a reference: a resource, or a group holding one. */
export const isReferenceNode = (node: CanvasNode, nodes: readonly CanvasNode[]): boolean =>
  Boolean(resourceKind(node)) || (node.type === "group" && groupResourceNodes(node.id, nodes).length > 0);

function inputNodes(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return connections.flatMap((connection) => {
    if (connection.kind !== "content" || connection.toNodeId !== nodeId) return [];
    const node = byId.get(connection.fromNodeId);
    return node && isReferenceNode(node, nodes) ? [node] : [];
  });
}

/** The node whose inputs a node's "@" lists: the config it feeds when that config has other inputs, which it passes
 * back to the node as in infinite-canvas; else the node itself. */
export function mentionHolder(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): string {
  const config = connections.find((connection) => connection.kind === "content" && connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === "config")?.toNodeId;
  return config && inputNodes(config, nodes, connections).some((node) => node.id !== nodeId) ? config : nodeId;
}

const sendsItself = (node: CanvasNode): boolean =>
  (node.type === "image" && Boolean(node.metadata?.file)) || (node.type === "text" && Boolean(node.metadata?.content?.trim()));

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

/** What is connected into the node, groups opened up: the references the app shows on it. */
export function connectedReferences(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasReference[] {
  return label(expand(inputNodes(nodeId, nodes, connections), nodes));
}

/** What a generation takes in: the files of image and audio references, and the words of text ones in its prompt. */
const GENERATION_TAKES: ReadonlySet<CanvasResourceKind> = new Set(["image", "audio", "text"]);

/** What a node's prompt can name with "@", which is exactly what goes with it, numbered as it is sent: the node's own
 * picture or text first when that goes too (generating from an image node edits its picture, and a task written in a
 * text node revises its text); then the inputs of its `mentionHolder`; groups opened up, each node once. A node that
 * generates names only what a generation takes in, while a task written in a text node takes videos too. */
export function mentionReferences(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasReference[] {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return [];
  const inputs = inputNodes(mentionHolder(nodeId, nodes, connections), nodes, connections).filter((input) => input.id !== nodeId);
  const references = label(expand(sendsItself(node) ? [node, ...inputs] : inputs, nodes));
  return generationKindOf(node) ? references.filter((reference) => GENERATION_TAKES.has(reference.kind)) : references;
}

/** The project files of the images and audio among `references`, in their numbering's order. */
export function referenceFiles(references: readonly CanvasReference[]): GenerationReferences {
  const paths = (kind: CanvasResourceKind) => references.flatMap((reference) => (reference.kind === kind && reference.file ? [reference.file.path] : []));
  return { images: paths("image"), audio: paths("audio") };
}

/** The project files a generation for this node hands over as references. */
export function generationReferences(nodeId: string, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): GenerationReferences {
  return referenceFiles(mentionReferences(nodeId, nodes, connections));
}

export const referenceCounts = (references: GenerationReferences): ReferenceCounts => ({ images: references.images.length, audio: references.audio.length });
