import type { CanvasDocument, CanvasNode } from "../../shared/project-canvas.ts";
import type { StartGenerationInput } from "../../shared/project-generation.ts";

/** What generation starts for a node, all of it taken from the node and what is connected into it: a shot makes a video,
 * the node's settings are its overrides, its title names the files, and the files of the image and audio nodes connected
 * into it are its references. */
export function generationInput(document: CanvasDocument, node: CanvasNode, prompt: string): StartGenerationInput {
  const byId = new Map(document.nodes.map((one) => [one.id, one]));
  const images = new Set<string>(), audio = new Set<string>();
  for (const connection of document.connections) {
    const from = connection.toNodeId === node.id ? byId.get(connection.fromNodeId) : undefined;
    const path = from?.metadata?.file?.path;
    if (path && from.type === "image") images.add(path);
    else if (path && from.type === "audio") audio.add(path);
  }
  const overrides = node.metadata?.settings;
  const name = node.title.trim();
  return {
    kind: node.type === "image" ? "image" : "video",
    nodeId: node.id,
    prompt,
    references: { images: [...images], audio: [...audio] },
    ...(overrides && Object.keys(overrides).length ? { overrides } : {}),
    ...(name ? { name } : {}),
  };
}
