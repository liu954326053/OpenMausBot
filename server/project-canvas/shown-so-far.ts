import { botIdOfNode, type CanvasSnapshot } from "../../shared/project-canvas.ts";

/** The bots the work has reached: the lead, the bots the production's plan gives a job, each episode's own bots, a bot
 * that did or said something in the project, one something on the canvas is its own or is connected to, and one the
 * person placed. */
export function reachedBots(snapshot: Pick<CanvasSnapshot, "project" | "nodes" | "connections" | "bots" | "production">): Set<string> {
  const reached = new Set<string>([snapshot.project.leadBotId]);
  for (const { botId } of snapshot.production?.jobs ?? []) reached.add(botId);
  for (const node of snapshot.nodes) if (node.createdBy?.kind === "bot") reached.add(node.createdBy.botId);
  for (const connection of snapshot.connections) {
    if (connection.kind !== "content") continue;
    for (const end of [connection.fromNodeId, connection.toNodeId]) {
      const botId = botIdOfNode(end);
      if (botId !== null) reached.add(botId);
    }
  }
  for (const [botId, state] of Object.entries(snapshot.bots)) {
    if (state.lead || state.placed || state.episode !== undefined || state.status !== "idle" || state.output || state.waiting) reached.add(botId);
  }
  return reached;
}

/** The canvas as the person sees it: the team is its skeleton, and a bot's node, with the lines that meet it, shows
 * once the work has reached the bot. */
export function shownSoFar(snapshot: CanvasSnapshot): CanvasSnapshot {
  const reached = reachedBots(snapshot);
  const hidden = new Set(snapshot.nodes.flatMap((node) => {
    const botId = node.type === "bot" ? botIdOfNode(node.id) : null;
    return botId !== null && !reached.has(botId) ? [node.id] : [];
  }));
  if (!hidden.size) return snapshot;
  return {
    ...snapshot,
    nodes: snapshot.nodes.filter((node) => !hidden.has(node.id)),
    connections: snapshot.connections.filter((connection) => !hidden.has(connection.fromNodeId) && !hidden.has(connection.toNodeId)),
  };
}
