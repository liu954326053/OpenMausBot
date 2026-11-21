import { CANVAS_NODE_SIZE, type CanvasConnection, type CanvasNode, type CanvasPoint } from "../../../shared/project-canvas";
import type { GenerationKind, StartGenerationInput } from "../../../shared/project-generation";
import { generationReferences } from "./references";
import { generationKindOf, nodeOverrides } from "./settings";

/** How far right of its source a new result lands, as in infinite-canvas. */
export const OUTPUT_OFFSET_X = 96;
/** The space between results stacked under each other. */
export const OUTPUT_GAP_Y = 32;

/** What the panel hands to `startGeneration`: the prompt, the node's own overrides and the files connected in. */
export function generationInput(node: CanvasNode, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[], prompt: string): StartGenerationInput | null {
  const kind = generationKindOf(node);
  if (!kind) return null;
  const overrides = nodeOverrides(kind, node);
  return {
    kind,
    nodeId: node.id,
    prompt,
    references: generationReferences(node.id, nodes, connections),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(node.title.trim() ? { name: node.title.trim() } : {}),
  };
}

/** An empty image or video node shows its first result itself; every other result becomes a new node. */
export const showsResultInPlace = (node: CanvasNode) => (node.type === "image" || node.type === "video") && !node.metadata?.file;

/** The results made from `source` before: what it connects to that lies to its right. */
export function previousOutputs(source: CanvasNode, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasNode[] {
  const targets = new Set(connections.filter((connection) => connection.kind === "content" && connection.fromNodeId === source.id).map((connection) => connection.toNodeId));
  return nodes.filter((node) => targets.has(node.id) && (node.type === "image" || node.type === "video") && node.position.x >= source.position.x + source.width);
}

/** Where the next result of `source` lands: right of it, an image centred on it and a video level with its top; once there are results, under the lowest. */
export function nextOutputFrame(source: CanvasNode, kind: GenerationKind, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): { position: CanvasPoint; width: number; height: number } {
  const size = CANVAS_NODE_SIZE[kind];
  const lowest = previousOutputs(source, nodes, connections).reduce<CanvasNode | null>((low, node) => (!low || node.position.y + node.height > low.position.y + low.height ? node : low), null);
  const position = lowest
    ? { x: lowest.position.x, y: lowest.position.y + lowest.height + OUTPUT_GAP_Y }
    : { x: source.position.x + source.width + OUTPUT_OFFSET_X, y: kind === "image" ? source.position.y + source.height / 2 - size.height / 2 : source.position.y };
  return { position, width: size.width, height: size.height };
}
