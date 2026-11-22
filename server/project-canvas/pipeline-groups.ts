import { CANVAS_MAX_NODES, type CanvasDocument, type CanvasNode } from "../../shared/project-canvas.ts";
import type { CanvasFrame } from "./ops.ts";
import { isCharacter } from "./pipeline-nodes.ts";
import type { PlaceContext } from "./pipeline-shots.ts";
import { clearBelow, clearSpot, GROUP_PADDING, GROUP_TOP_PADDING, NODE_GAP } from "./placement.ts";

function wrap(members: readonly CanvasNode[]): CanvasFrame {
  const left = Math.min(...members.map((one) => one.position.x));
  const top = Math.min(...members.map((one) => one.position.y));
  const right = Math.max(...members.map((one) => one.position.x + one.width));
  const bottom = Math.max(...members.map((one) => one.position.y + one.height));
  return { position: { x: left - GROUP_PADDING, y: top - GROUP_TOP_PADDING }, width: right - left + 2 * GROUP_PADDING, height: bottom - top + GROUP_TOP_PADDING + GROUP_PADDING };
}

/** The group around a node that newly is a character: its maker's, titled after it, moved down with it until it is
 * clear of what is on the canvas. */
function groupAround(document: CanvasDocument, character: CanvasNode, context: PlaceContext): CanvasNode {
  const stored = new Set(document.nodes.map((one) => one.id));
  const taken: CanvasFrame[] = [
    ...document.nodes.filter((one) => one.id !== character.id),
    ...[...context.bots].filter(([id]) => !stored.has(id)).map(([, frame]) => frame),
    ...context.reserved,
  ];
  const around = wrap([character]);
  const clear = clearBelow(around, taken);
  character.position = { x: character.position.x, y: character.position.y + clear.position.y - around.position.y };
  const group: CanvasNode = { id: context.newId(), type: "group", title: character.title, ...clear, ...(character.createdBy ? { createdBy: character.createdBy } : {}) };
  character.groupId = group.id;
  document.nodes.splice(document.nodes.indexOf(character), 0, group);
  return group;
}

/**
 * Keeps each character with its pictures in one group. A node that newly is a character and sits in no group gets one.
 * A picture in no group joins a character's group when a connection is newly made into it from the character or from
 * a picture of the group, as generating from either makes one: it goes to the right of the group's nodes, and the
 * group grows around them. A group that carries its character's name is renamed with it. Returns the ids of the nodes
 * it added, moved or changed.
 */
export function settleGroups(before: CanvasDocument, after: CanvasDocument, context: PlaceContext): string[] {
  const changed = new Set<string>();
  const was = new Map(before.nodes.map((node) => [node.id, node]));
  const groupOf = (node: CanvasNode) => (node.groupId ? after.nodes.find((one) => one.id === node.groupId && one.type === "group") : undefined);

  for (const character of after.nodes.filter(isCharacter)) {
    const prior = was.get(character.id);
    const group = groupOf(character);
    if (group) {
      if (prior && prior.title !== character.title && group.title === prior.title) {
        group.title = character.title;
        changed.add(group.id);
      }
    } else if (!(prior && isCharacter(prior)) && after.nodes.length < CANVAS_MAX_NODES) {
      changed.add(groupAround(after, character, context).id);
      changed.add(character.id);
    }
  }

  const characterOf = new Map<string, CanvasNode>();
  for (const character of after.nodes.filter(isCharacter)) {
    const group = groupOf(character);
    if (group && !characterOf.has(group.id)) characterOf.set(group.id, character);
  }
  const byId = new Map(after.nodes.map((node) => [node.id, node]));
  const had = new Set(before.connections.map((connection) => connection.id));
  const grown = new Set<string>();
  for (const connection of after.connections) {
    if (had.has(connection.id)) continue;
    const from = byId.get(connection.fromNodeId);
    const picture = byId.get(connection.toNodeId);
    const character = from?.groupId ? characterOf.get(from.groupId) : undefined;
    if (!from?.groupId || !character || picture?.type !== "image" || picture.groupId || (from !== character && from.type !== "image")) continue;
    const members = after.nodes.filter((one) => one.groupId === from.groupId);
    const x = Math.max(...members.map((one) => one.position.x + one.width)) + NODE_GAP;
    picture.position = clearSpot(after, { x, y: character.position.y }, picture, context.bots, context.reserved, new Set([picture.id]));
    picture.groupId = from.groupId;
    changed.add(picture.id);
    grown.add(from.groupId);
  }
  for (const groupId of grown) {
    Object.assign(byId.get(groupId)!, wrap(after.nodes.filter((one) => one.groupId === groupId)));
    changed.add(groupId);
  }
  return [...changed];
}
