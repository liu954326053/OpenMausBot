import { CANVAS_NODE_SIZE, generationKindOf, type CanvasConnection, type CanvasNode, type CanvasNodeType, type CanvasPoint } from "../../../shared/project-canvas";
import { generationReferences } from "../../../shared/project-canvas-references";
import type { StartGenerationInput } from "../../../shared/project-generation";
import { nodeOverrides } from "./settings";

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

/** Whether generating `node` puts its first result in the node itself: an empty image or video node takes it in place. */
export const takesResultInPlace = (node: CanvasNode): boolean => (node.type === "image" || node.type === "video") && !node.metadata?.file;

const outputColumn = (source: CanvasNode) => source.position.x + source.width + OUTPUT_OFFSET_X;

/** The results made from `source` before: what it connects to in the column right of it. */
export function previousOutputs(source: CanvasNode, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[]): CanvasNode[] {
  const x = outputColumn(source);
  const targets = new Set(connections.filter((connection) => connection.fromNodeId === source.id).map((connection) => connection.toNodeId));
  return nodes.filter((node) => targets.has(node.id) && node.position.x < x + CANVAS_NODE_SIZE.video.width && node.position.x + node.width > x);
}

type OutputFrame = { position: CanvasPoint; width: number; height: number };

const overlaps = (a: OutputFrame, b: OutputFrame) =>
  a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;

/** Where the next result of `source` lands, as the server puts it: right of it, level with its top or under the results
 * made before, then down past every node and every frame in `taken` of results still to come that is in the way. */
export function nextOutputFrame(source: CanvasNode, type: CanvasNodeType, nodes: readonly CanvasNode[], connections: readonly CanvasConnection[], taken: readonly OutputFrame[] = []): OutputFrame {
  const size = CANVAS_NODE_SIZE[type];
  const frame = {
    position: { x: outputColumn(source), y: previousOutputs(source, nodes, connections).reduce((lowest, node) => Math.max(lowest, node.position.y + node.height + OUTPUT_GAP_Y), source.position.y) },
    width: size.width,
    height: size.height,
  };
  const blocking = [...nodes.filter((node) => node.type !== "group"), ...taken];
  for (;;) {
    const hits = blocking.filter((one) => overlaps(one, frame));
    if (!hits.length) return frame;
    frame.position = { x: frame.position.x, y: Math.max(...hits.map((one) => one.position.y + one.height)) + OUTPUT_GAP_Y };
  }
}

/** The frames the results of the generations running now will take, each with the node it comes from. */
export function comingOutputs(nodes: readonly CanvasNode[], connections: readonly CanvasConnection[], taken: readonly OutputFrame[]): Array<{ sourceId: string; frame: OutputFrame }> {
  return nodes.flatMap((node) => {
    const kind = generationKindOf(node);
    if (!kind || node.metadata?.status !== "loading" || takesResultInPlace(node)) return [];
    return [{ sourceId: node.id, frame: nextOutputFrame(node, kind, nodes, connections, taken) }];
  });
}
