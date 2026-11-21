import { CANVAS_NODE_SIZE, type CanvasConnection, type CanvasNode, type CanvasPoint } from "../../../shared/project-canvas";
import type { GenerationKind, StartGenerationInput } from "../../../shared/project-generation";
import { generationReferences } from "./references";
import { generationKindOf, nodeOverrides } from "./settings";

/** How far right of its source the server puts a result. */
export const OUTPUT_OFFSET_X = 80;
/** The space the server leaves under each result before the next. */
export const OUTPUT_GAP_Y = 40;

/** What generation starts for a node: its prompt, its own overrides, its title and the files connected into it. */
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

const outputColumn = (source: CanvasNode) => source.position.x + source.width + OUTPUT_OFFSET_X;

/** The results made from `source` before: what it connects to in the column right of it. */
export function previousOutputs(source: CanvasNode, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasNode[] {
  const x = outputColumn(source);
  const targets = new Set(connections.filter((connection) => connection.fromNodeId === source.id).map((connection) => connection.toNodeId));
  return nodes.filter((node) => targets.has(node.id) && node.position.x < x + CANVAS_NODE_SIZE.video.width && node.position.x + node.width > x);
}

/** Where the next result of `source` lands: right of it, level with its top, under the results made before. */
export function nextOutputFrame(source: CanvasNode, kind: GenerationKind, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): { position: CanvasPoint; width: number; height: number } {
  const size = CANVAS_NODE_SIZE[kind];
  const y = previousOutputs(source, nodes, connections).reduce((lowest, node) => Math.max(lowest, node.position.y + node.height + OUTPUT_GAP_Y), source.position.y);
  return { position: { x: outputColumn(source), y }, width: size.width, height: size.height };
}
