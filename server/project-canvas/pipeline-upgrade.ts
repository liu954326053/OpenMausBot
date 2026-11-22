import type { CanvasConnection, CanvasDocument, CanvasNode } from "../../shared/project-canvas.ts";
import { creationOf, isShot } from "./pipeline-nodes.ts";
import { addCreation, type PlaceContext } from "./pipeline-shots.ts";
import { placeAfter } from "./placement.ts";

/**
 * Brings a canvas stored before the pipeline forward. Every shot gets its creation node. The videos generated from a
 * shot, the ones connected from it that hold a file, become its takes: they move to the right of the creation node in
 * the order they were made, are connected from it instead of from the shot, and the newest is selected. What else was
 * connected into the shot besides images, which the pipeline's own links carry over, is connected into the creation
 * node too, so the shot generates from what it did. Returns the ids of what it added, changed and took away.
 */
export function upgradeCanvas(document: CanvasDocument, context: PlaceContext): { nodes: string[]; connections: string[] } {
  const nodes: string[] = [];
  const connections: string[] = [];
  for (const shot of document.nodes.filter(isShot)) {
    if (creationOf(document, shot.id)) continue;
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    const results = document.connections.filter((one) => one.fromNodeId === shot.id);
    const takes = results.flatMap((one) => {
      const video = byId.get(one.toNodeId);
      return video?.type === "video" && video.metadata?.file && !video.metadata.role ? [video] : [];
    });
    const pending = new Set(takes.map((take) => take.id));
    const creation = addCreation(document, shot, context, pending);
    nodes.push(creation.id);

    const moved = results.filter((one) => pending.has(one.toNodeId)).map((one) => one.id);
    connections.push(...moved);
    document.connections = document.connections.filter((one) => !moved.includes(one.id));
    for (const take of takes) {
      pending.delete(take.id);
      const others: CanvasDocument = { ...document, nodes: document.nodes.filter((one) => one.id !== take.id && !pending.has(one.id)) };
      take.position = placeAfter(others, creation, take, context.bots, context.reserved);
      take.metadata = { ...take.metadata, role: "take", shotId: shot.id, ...(take === takes.at(-1) ? { selected: true } : {}) };
      connections.push(connect(document, creation, take, context, true).id);
      nodes.push(take.id);
    }

    for (const input of document.connections.filter((one) => one.toNodeId === shot.id)) {
      const source = byId.get(input.fromNodeId);
      if (!source || source.type === "bot" || source.type === "image") continue;
      if (document.connections.some((one) => one.fromNodeId === source.id && one.toNodeId === creation.id)) continue;
      connections.push(connect(document, source, creation, context, false).id);
    }
  }
  return { nodes, connections };
}

function connect(document: CanvasDocument, from: CanvasNode, to: CanvasNode, context: PlaceContext, pipeline: boolean): CanvasConnection {
  const connection: CanvasConnection = { id: context.newId(), fromNodeId: from.id, toNodeId: to.id, kind: "content", ...(pipeline ? { pipeline: true as const } : {}) };
  document.connections.push(connection);
  return connection;
}
