import type { ResolvedSender } from "../../shared/wire.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import type { Message } from "../store.ts";
import type { UsageTrigger } from "../usage-ledger.ts";

export interface RoomLine {
  trigger: UsageTrigger;
  /** The bots it is for. */
  mentions: string[];
  sender?: ResolvedSender;
}

export interface RoomSendDeps {
  /** A turn runs in that thread of the room now. */
  working(groupId: string, threadId: string): boolean;
  queue(groupId: string, threadId: string, text: string, line: RoomLine & { mode: "chat" }): { id: string };
  start(groupId: string, text: string, line: RoomLine & { threadId: string }): Message;
  /** Throws when the spend cap is reached. */
  withinBudget(): void;
}

export interface RoomMessage {
  groupId: string;
  threadId: string;
  /** In the order the line addresses them, each with what it asks of that bot. */
  to: Array<{ botId: string; name: string; text: string }>;
  trigger: UsageTrigger;
  sender?: ResolvedSender;
}

/** Text in a room line with its mentions made plain: what it quotes never calls in a bot it is not for. */
export const quietMentions = (text: string): string => text.replaceAll("@", "＠");

/** A line into a room that each bot it is for answers in turn, as a person's line to them would go: it waits in the
 * room's queue while a turn runs in that thread. */
export function sendToRoom(deps: RoomSendDeps, message: RoomMessage): DirectSendReceipt {
  deps.withinBudget();
  const text = message.to.map(({ name, text: asked }) => `@${name} ${quietMentions(asked)}`).join("\n\n");
  const line: RoomLine = { trigger: message.trigger, mentions: message.to.map(({ botId }) => botId), ...(message.sender ? { sender: message.sender } : {}) };
  if (deps.working(message.groupId, message.threadId)) {
    const queued = deps.queue(message.groupId, message.threadId, text, { ...line, mode: "chat" });
    return { ok: true, queued: true, queueId: queued.id, threadId: message.threadId };
  }
  return { ok: true, threadId: message.threadId, message: deps.start(message.groupId, text, { ...line, threadId: message.threadId }) };
}
