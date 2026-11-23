import { botNodeId, CANVAS_MAX_CONNECTIONS, type CanvasDocument } from "../../shared/project-canvas.ts";
import { botsWith, isEpisode, isFinal, isProfile, isShot, isTake, makerOf, shotParts, type BotStages } from "./pipeline-nodes.ts";

/** A connection the pipeline wants, by the ids of the nodes it joins. */
export interface PipelineLink {
  from: string;
  to: string;
}

/** The bots the production made for one episode each → that episode's number. */
export type BotEpisodes = Readonly<Record<string, number>>;

const keyOf = (from: string, to: string) => `${from}\u0000${to}`;

/**
 * The connections the production wants on a canvas, by who made each node and what it is:
 * - the brief and the plan: from the bot that made them, and the brief on to every script bot;
 * - an episode's script: from the bot that made it, and on to the episode's own storyboard bot;
 * - a script written before dramas had episodes: from every script bot, and on to every storyboard bot that is no
 *   episode's own;
 * - a character or a scene: from the bot that made it;
 * - a shot: from the bot that made it, on to its creation node, and every image connected into the shot into that
 *   node too;
 * - a take: from its shot's creation node, and the selected one of a shot that is there on to its episode's post bot;
 * - a finished film: from its episode's post bot.
 */
export function wantedLinks(document: Pick<CanvasDocument, "nodes" | "connections">, stages: BotStages, botEpisodes: BotEpisodes = {}): PipelineLink[] {
  const links: PipelineLink[] = [];
  const seen = new Set<string>();
  const want = (from: string, to: string) => {
    const key = keyOf(from, to);
    if (from === to || seen.has(key)) return;
    seen.add(key);
    links.push({ from, to });
  };
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const { creationOf } = shotParts(document);
  const imagesInto = new Map<string, string[]>();
  for (const connection of document.connections) {
    if (byId.get(connection.fromNodeId)?.type !== "image") continue;
    const images = imagesInto.get(connection.toNodeId);
    if (images) images.push(connection.fromNodeId);
    else imagesInto.set(connection.toNodeId, [connection.fromNodeId]);
  }
  const fromMaker = (node: { id: string }, maker: string | undefined) => {
    if (maker !== undefined && Object.hasOwn(stages, maker)) want(botNodeId(maker), node.id);
  };
  /** The bots that do `job` for `episode`: that episode's own, or without an episode the ones that are no episode's. */
  const at = (job: "storyboard" | "post", episode: number | undefined) => botsWith(stages, job).filter((botId) => botEpisodes[botId] === episode);
  for (const node of document.nodes) {
    const role = node.metadata?.role;
    const maker = makerOf(node);
    if (node.type === "text" && (role === "brief" || role === "plan")) {
      fromMaker(node, maker);
      if (role === "brief") for (const botId of botsWith(stages, "script")) if (botId !== maker) want(node.id, botNodeId(botId));
    } else if (isEpisode(node)) {
      fromMaker(node, maker);
      for (const botId of at("storyboard", node.metadata!.episode)) want(node.id, botNodeId(botId));
    } else if (node.type === "text" && role === "script") {
      const writers = botsWith(stages, "script");
      for (const botId of writers) want(botNodeId(botId), node.id);
      for (const botId of at("storyboard", undefined)) if (!writers.includes(botId)) want(node.id, botNodeId(botId));
    } else if (isProfile(node)) {
      fromMaker(node, maker);
    } else if (isShot(node)) {
      fromMaker(node, maker);
      const creation = creationOf(node.id);
      if (!creation) continue;
      want(node.id, creation.id);
      for (const image of imagesInto.get(node.id) ?? []) want(image, creation.id);
    } else if (isTake(node)) {
      const shotId = node.metadata?.shotId;
      const creation = shotId ? creationOf(shotId) : undefined;
      if (creation) want(creation.id, node.id);
      if (node.metadata?.selected && shotId && byId.get(shotId)?.type === "shot") for (const botId of at("post", node.metadata.episode)) want(node.id, botNodeId(botId));
    } else if (isFinal(node)) {
      for (const botId of at("post", node.metadata?.episode)) want(botNodeId(botId), node.id);
    }
  }
  return links;
}

/**
 * Brings a canvas's connections from the links wanted `before` a change to the ones `wanted` after it: a link newly
 * wanted is added as the pipeline's, or the connection already there becomes the pipeline's; a link no longer wanted
 * goes when it is the pipeline's. A link wanted before and after is left as it is, so one the person deleted stays
 * away. Returns the ids of the connections it added, marked or took away.
 */
export function settleLinks(document: Pick<CanvasDocument, "connections">, before: readonly PipelineLink[], wanted: readonly PipelineLink[], newId: () => string): string[] {
  const had = new Set(before.map((link) => keyOf(link.from, link.to)));
  const want = new Set(wanted.map((link) => keyOf(link.from, link.to)));
  const changed: string[] = [];
  const gone = new Set<string>();
  for (const connection of document.connections) {
    const key = keyOf(connection.fromNodeId, connection.toNodeId);
    if (connection.pipeline && had.has(key) && !want.has(key)) gone.add(connection.id);
  }
  if (gone.size) {
    changed.push(...gone);
    document.connections = document.connections.filter((connection) => !gone.has(connection.id));
  }
  const present = new Map(document.connections.map((connection) => [keyOf(connection.fromNodeId, connection.toNodeId), connection]));
  for (const link of wanted) {
    const key = keyOf(link.from, link.to);
    if (had.has(key)) continue;
    const existing = present.get(key);
    if (existing?.pipeline) continue;
    if (existing) {
      existing.pipeline = true;
      changed.push(existing.id);
    } else if (document.connections.length < CANVAS_MAX_CONNECTIONS) {
      const connection = { id: newId(), fromNodeId: link.from, toNodeId: link.to, kind: "content" as const, pipeline: true as const };
      document.connections.push(connection);
      present.set(key, connection);
      changed.push(connection.id);
    }
  }
  return changed;
}
