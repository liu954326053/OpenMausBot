import {
  botIdOfNode,
  botNodeId,
  CANVAS_OUTPUT_MAX_CHARS,
  dispatchConnectionId,
  type CanvasBotState,
  type CanvasBotStatus,
  type CanvasConnection,
  type CanvasDocument,
  type CanvasNode,
  type CanvasSnapshot,
} from "../../shared/project-canvas.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { redactSecrets, redactSecretsInText } from "../redact.ts";
import type { CanvasFrame } from "./ops.ts";
import { defaultBotFrames, treeParents, type BotTree } from "./placement.ts";

/** One conversation of a bot, as its node needs it. */
export interface ThreadFacts {
  threadId: string;
  busy: boolean;
  /** A turn there waits on the person. */
  waitingOnPerson: boolean;
  /** A message waits there for the bot to be free. */
  queued: boolean;
  /** Its newest turn failed. */
  failed: boolean;
  /** When something last happened there, epoch ms. */
  lastAt: number;
  /** While busy: the words of its newest activity row. */
  doing?: string;
  /** Its newest reply. */
  reply?: { messageId: string; text: string; at: number };
  /** Its newest question or approval card nobody answered. */
  card?: { messageId: string; at: number; card: OptionCardData };
}

export interface BotFacts {
  id: string;
  name: string;
  title: string;
  threads: ThreadFacts[];
}

export interface SnapshotInput {
  document: CanvasDocument;
  project: CanvasSnapshot["project"];
  /** In the order the project lists them. */
  bots: BotFacts[];
  /** A bot's superior in the flow. */
  parentOf(botId: string): string | undefined;
  /** Whether the viewer may open this conversation. */
  sees(threadId: string): boolean;
}

export type PlacedFrame = CanvasFrame & { placed: boolean };

/** Each bot node's frame by node id: where it is stored, or where the default layout puts it. */
export function botFrames(document: CanvasDocument, tree: BotTree): Map<string, PlacedFrame> {
  const defaults = defaultBotFrames(tree);
  const stored = new Map(document.nodes.filter((node) => node.type === "bot").map((node) => [node.id, node]));
  return new Map(tree.botIds.map((botId) => {
    const id = botNodeId(botId);
    const own = stored.get(id);
    const frame = own ? { position: own.position, width: own.width, height: own.height } : defaults.get(id)!;
    return [id, { ...frame, placed: own !== undefined }];
  }));
}

function statusOf(threads: readonly ThreadFacts[]): CanvasBotStatus {
  if (threads.some((one) => one.card || one.waitingOnPerson)) return "waiting";
  if (threads.some((one) => one.busy)) return "working";
  if (threads.some((one) => one.queued)) return "queued";
  const latest = threads.reduce<ThreadFacts | undefined>((best, one) => (!best || one.lastAt > best.lastAt ? one : best), undefined);
  return latest?.failed ? "error" : "idle";
}

function newest<T>(items: readonly T[], at: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, item) => (!best || at(item) > at(best) ? item : best), undefined);
}

/** Security: redacted before it is cut, so a cut never leaves part of a key unrecognised. */
function boundedOutput(text: string): { text: string; truncated?: true } {
  const points = [...redactSecretsInText(text)];
  return points.length > CANVAS_OUTPUT_MAX_CHARS ? { text: points.slice(0, CANVAS_OUTPUT_MAX_CHARS).join(""), truncated: true } : { text: points.join("") };
}

function botState(bot: BotFacts, lead: boolean, placed: boolean, sees: (threadId: string) => boolean): CanvasBotState {
  const visible = bot.threads.filter((one) => sees(one.threadId));
  const reply = newest(visible.filter((one) => one.reply), (one) => one.reply!.at);
  const card = newest(visible.filter((one) => one.card), (one) => one.card!.at);
  const doing = newest(visible.filter((one) => one.busy && one.doing), (one) => one.lastAt);
  return {
    botId: bot.id,
    name: bot.name,
    title: bot.title,
    lead,
    status: statusOf(bot.threads),
    ...(doing ? { doing: redactSecretsInText(doing.doing!) } : {}),
    ...(reply ? { output: { ...boundedOutput(reply.reply!.text), threadId: reply.threadId, messageId: reply.reply!.messageId, at: reply.reply!.at } } : {}),
    ...(card ? { waiting: { threadId: card.threadId, messageId: card.card!.messageId, card: redactSecrets(card.card!.card) as OptionCardData } } : {}),
    placed,
  };
}

/** The stored canvas joined with what the server derives: a node for every bot of the project, the dispatch
 * connections of the flow, and what each bot shows, from the conversations the viewer may open. */
export function buildSnapshot(input: SnapshotInput): CanvasSnapshot {
  const { document, project } = input;
  const tree: BotTree = { botIds: input.bots.map((one) => one.id), leadBotId: project.leadBotId, parentOf: input.parentOf };
  const frames = botFrames(document, tree);
  const botNodes: CanvasNode[] = input.bots.map((one) => {
    const frame = frames.get(botNodeId(one.id))!;
    return { id: botNodeId(one.id), type: "bot", title: one.name, position: frame.position, width: frame.width, height: frame.height };
  });
  const content = document.nodes.filter((node) => botIdOfNode(node.id) === null);
  const nodes = [...botNodes, ...content];
  const present = new Set(nodes.map((node) => node.id));
  const { parents } = treeParents(tree);
  const dispatch: CanvasConnection[] = tree.botIds.flatMap((child) => {
    const parent = parents.get(child);
    return parent === undefined ? [] : [{ id: dispatchConnectionId(parent, child), fromNodeId: botNodeId(parent), toNodeId: botNodeId(child), kind: "dispatch" as const }];
  });
  const connections = [...dispatch, ...document.connections.filter((one) => present.has(one.fromNodeId) && present.has(one.toNodeId))];
  return {
    ...document,
    nodes,
    connections,
    project,
    ...(project.archived ? { readOnly: "archived" as const } : {}),
    bots: Object.fromEntries(input.bots.map((one) => [one.id, botState(one, one.id === project.leadBotId, frames.get(botNodeId(one.id))!.placed, input.sees)])),
  };
}
