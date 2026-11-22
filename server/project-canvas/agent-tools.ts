import { botNodeId, type CanvasNode, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import { statusOf } from "../routes/project-generation.ts";
import { PASS } from "../routes/table.ts";
import type { CanvasGenerationCards } from "./generation-card.ts";
import { CanvasRefusal, canvasRefusalOf, type ProjectCanvasService } from "./service.ts";
import type { ProjectCanvasToolRoute } from "./tool-route.ts";

export const PROJECT_CANVAS_TOOL_PATHS = {
  read: "/api/internal/project-canvas/read",
  apply: "/api/internal/project-canvas/apply",
  generate: "/api/internal/project-canvas/generate",
} as const;

const TOOL_OF_PATH = new Map<string, keyof typeof PROJECT_CANVAS_TOOL_PATHS>(Object.entries(PROJECT_CANVAS_TOOL_PATHS).map(([tool, path]) => [path, tool as keyof typeof PROJECT_CANVAS_TOOL_PATHS]));
/** The newest content nodes the whole canvas lists; one node at a time reads the rest. */
const LISTED_NODES = 300;
const SHORT_CHARS = 240;
const CARD_TITLE_CHARS = 60;
const ASKED = "A card now asks the person to confirm it, and nothing is generated until they press Confirm. Say so in one short line and end your turn: their answer reaches you once they give it.";
const ALREADY_ASKED = "A card already asks the person to confirm generating this node. End your turn: their answer reaches you once they give it.";

const record = (body: unknown): Record<string, unknown> => (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {});
const shortened = (text: string) => (text.length > SHORT_CHARS ? `${text.slice(0, SHORT_CHARS / 2)}...` : text);

function shown(node: CanvasNode, me: string, full: boolean) {
  const metadata = { ...node.metadata };
  if (!full && metadata.content !== undefined) metadata.content = shortened(metadata.content);
  if (!full && metadata.prompt !== undefined) metadata.prompt = shortened(metadata.prompt);
  const by = node.createdBy?.kind === "bot" ? (node.createdBy.botId === me ? "you" : botNodeId(node.createdBy.botId)) : node.createdBy?.kind;
  return {
    id: node.id, type: node.type, title: node.title, position: node.position, width: node.width, height: node.height,
    ...(by ? { createdBy: by } : {}), ...(node.groupId ? { groupId: node.groupId } : {}), ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

/** What `canvas_get_state` answers: the whole canvas in brief, one node in full (`node_id`), or in full what is
 * connected to the bot's own node (`connected`). Nothing in it comes from a conversation. */
export function canvasStateText(snapshot: CanvasSnapshot, me: string, ask: Record<string, unknown>): string {
  const own = botNodeId(me);
  const head = {
    project: { id: snapshot.project.id, name: snapshot.project.name, revision: snapshot.revision },
    you: own,
    ...(snapshot.readOnly ? { readOnly: "The project is archived: the canvas can be read, not changed." } : {}),
  };
  const bots = Object.values(snapshot.bots).map((bot) => ({ id: botNodeId(bot.botId), name: bot.name, title: bot.title, ...(bot.lead ? { lead: true } : {}), stages: bot.stages, status: bot.status }));
  const content = snapshot.nodes.filter((node) => node.type !== "bot");
  const link = (one: CanvasSnapshot["connections"][number]) => ({ id: one.id, from: one.fromNodeId, to: one.toNodeId, kind: one.kind, ...(one.pipeline ? { pipeline: true } : {}) });
  if (typeof ask.node_id === "string") {
    const node = snapshot.nodes.find((one) => one.id === ask.node_id);
    if (!node) throw new CanvasRefusal(404, { error: `no node ${ask.node_id} on this canvas` });
    const bot = node.type === "bot" ? bots.find((one) => one.id === node.id) : undefined;
    const links = snapshot.connections.filter((one) => one.fromNodeId === node.id || one.toNodeId === node.id).map(link);
    return JSON.stringify({ ...head, node: bot ? { ...bot, position: node.position, width: node.width, height: node.height } : shown(node, me, true), connections: links });
  }
  if (ask.connected === true) {
    const links = snapshot.connections.filter((one) => one.kind === "content" && (one.fromNodeId === own || one.toNodeId === own));
    const ends = new Set(links.map((one) => (one.fromNodeId === own ? one.toNodeId : one.fromNodeId)));
    return JSON.stringify({ ...head, nodes: content.filter((node) => ends.has(node.id)).map((node) => shown(node, me, true)), connections: links.map(link) });
  }
  const listed = content.slice(-LISTED_NODES);
  const ids = new Set([...listed.map((node) => node.id), ...bots.map((bot) => bot.id)]);
  return JSON.stringify({
    ...head,
    bots,
    nodes: listed.map((node) => shown(node, me, false)),
    ...(content.length > listed.length ? { olderNodesNotListed: content.length - listed.length } : {}),
    connections: snapshot.connections.filter((one) => ids.has(one.fromNodeId) && ids.has(one.toNodeId)).map(link),
  });
}

/** Security: every call is checked against the bot the capability names: only a project's bots reach its canvas. */
export function createProjectCanvasToolRoutes(service: ProjectCanvasService, cards: Pick<CanvasGenerationCards, "ask">): ProjectCanvasToolRoute {
  return async (ctx) => {
    const tool = ctx.method === "POST" ? TOOL_OF_PATH.get(ctx.path) : undefined;
    if (!tool) return PASS;
    try {
      const body = record(await ctx.readBody());
      const project = service.projectOfBot(ctx.botId);
      const actor = { kind: "bot", botId: ctx.botId } as const;
      if (tool === "read") return void ctx.json(ctx.res, 200, { text: canvasStateText(service.botView(project), ctx.botId, body) });
      if (tool === "apply") {
        const outcome = service.applyRequest(project, actor, { ops: body.ops });
        return void ctx.json(ctx.res, 200, { text: JSON.stringify(outcome) });
      }
      const nodeId = String(body.node_id);
      const outcome = await service.generate(project, actor, body.node_id);
      if ("job" in outcome) {
        const { id, nodeId: creation } = outcome.job;
        const text = creation === nodeId
          ? `Generation of ${nodeId} started (job ${id}). Its node shows how it goes; what it makes lands to its right, connected from it.`
          : `Generation of ${nodeId} started through its creation node ${creation} (job ${id}). That node shows how it goes; the video lands to its right as the shot's newest take, which becomes its selected take.`;
        return void ctx.json(ctx.res, 202, { text });
      }
      const failure = outcome.refused;
      if (failure.code !== "confirmation_needed") return void ctx.json(ctx.res, statusOf(failure), { error: failure.error });
      const node = service.nodeOf(project.id, nodeId);
      const title = node?.title.trim() || node?.metadata?.prompt?.trim().slice(0, CARD_TITLE_CHARS) || nodeId;
      const asked = cards.ask({ projectId: project.id, botId: ctx.botId, threadId: ctx.threadId, nodeId, title, failure });
      return void ctx.json(ctx.res, 200, { text: asked.already ? ALREADY_ASKED : `${failure.error} ${ASKED}` });
    } catch (error) {
      const refused = canvasRefusalOf(error);
      if (!refused) throw error;
      return void ctx.json(ctx.res, refused.status, { error: refused.body.error });
    }
  };
}
