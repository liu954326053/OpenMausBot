import { isUnfinishedTurn } from "../project-canvas/task-targets.ts";
import type { Message } from "../store.ts";

/** How a turn ended, read from the line that ends it. */
export type TurnEnd = { ok: true; reply: string } | { ok: false };

/** The end of a turn this line marks: its last reply once it is settled, or the row a failed or stopped turn ends with;
 * null for any other line. */
export function turnEndOf(message: Message): TurnEnd | null {
  if (message.role === "bot" && message.kind === "text" && message.turnTerminal === true && message.turnSucceeded !== undefined) {
    return message.turnSucceeded ? { ok: true, reply: message.text?.trim() ?? "" } : { ok: false };
  }
  return isUnfinishedTurn(message) ? { ok: false } : null;
}

/** The line a teammate's hand-off leaves at the top of the conversation it runs in: who handed it, its request, and the
 * bots it went to when the line names them. */
export function handOffOf(message: Message): { fromBotId: string; requestId: string; botIds: readonly string[] } | null {
  if (message.role !== "bot" || message.kind !== "text" || message.roomRequest?.phase !== "request" || !message.from?.botId) return null;
  return { fromBotId: message.from.botId, requestId: message.roomRequest.id, botIds: message.roomRequest.botIds ?? [] };
}

/** The row a hand-off's end leaves in the conversation that handed it: the bot that did it, the conversation it ran
 * in, and whether it was done. */
export function handBackOf(message: Message): { botId: string; threadId: string; ok: boolean } | null {
  if (message.role !== "bot" || message.kind !== "activity" || message.roomRequest?.phase !== "result" || !message.from?.botId) return null;
  const threadId = message.threadRef?.threadId ?? message.comm?.threadId;
  return threadId ? { botId: message.from.botId, threadId, ok: message.tool?.ok === true } : null;
}

/** The newest reply in a conversation after `since`, the line a hand-off began with left aside. */
export function lastReply(path: readonly Message[], since: number): string {
  const reply = path.findLast((message) => message.at >= since && message.role === "bot" && message.kind === "text" && !message.roomRequest && Boolean(message.text?.trim()));
  return reply?.text?.trim() ?? "";
}
