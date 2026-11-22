import { isStoppedTurnName } from "../../shared/client-cancel.ts";
import { failedTurnCause } from "../../shared/failed-turn.ts";
import { CANVAS_CONTENT_MAX_CHARS, type CanvasReplyPlaceholder } from "../../shared/project-canvas.ts";
import { redactSecretsInText } from "../redact.ts";
import type { Message } from "../store.ts";

/** A text node waiting for a bot's reply to a task. The task's message is `requestId` once the conversation has it,
 * and is known by `queueId` while it waits in the bot's queue. */
export interface TaskTarget {
  projectId: string;
  botId: string;
  threadId: string;
  nodeId: string;
  /** The title of the node the reply becomes beside a node with text. */
  title: string;
  /** The node the reply becomes, given when the node had text as the task was sent. */
  beside?: CanvasReplyPlaceholder;
  requestId?: string;
  /** When the task's message joined the conversation. */
  requestAt?: number;
  queueId?: string;
  /** The task went into the project's group chat, where every member speaks: only this bot's own turns there end it. */
  inRoom?: true;
}

export interface SettledTask {
  target: TaskTarget;
  /** The bot's reply, when its turn for the task ended well. */
  reply?: string;
}

const MAX_TARGETS = 200;

const isTurnEnd = (message: Message) =>
  message.role === "bot" && message.kind === "text" && message.turnTerminal === true && message.turnSucceeded !== undefined;

/** The row a turn that failed or was stopped ends with, whether or not it wrote a line before. */
export const isUnfinishedTurn = (message: Message) => message.kind === "activity" && message.tool !== undefined && message.tool.partial !== true
  && (failedTurnCause(message.tool.name) !== null || isStoppedTurnName(message.tool.name));

/** A reply as a text node's text. Security: redacted before it is cut, so a cut never leaves part of a key
 * unrecognised. */
export function replyText(reply: string): string {
  let text = "";
  for (const point of redactSecretsInText(reply)) {
    if (text.length + point.length > CANVAS_CONTENT_MAX_CHARS) break;
    text += point;
  }
  return text;
}

/** The text nodes the replies to tasks go into, until the turns for them end. */
export class TaskTargets {
  private targets: TaskTarget[] = [];

  add(target: TaskTarget): void {
    this.targets = [...this.targets, target].slice(-MAX_TARGETS);
  }

  of(projectId: string): readonly TaskTarget[] {
    return this.targets.filter((one) => one.projectId === projectId);
  }

  /** Hears a new or changed line of a conversation, and answers the task whose turn it ends. A conversation runs one
   * turn at a time, so a turn ending there, however it ends, ends every task whose message came before it. So does a
   * queued message joining it: the queue lets messages in only once the bot is free, and they start the next turn
   * together. Those tasks get no reply. In a group chat the same holds for each member, from the lines it says. */
  heard(threadId: string, message: Message): SettledTask | null {
    if (message.role === "user" && message.queueId) {
      for (const one of this.targets) {
        if (one.threadId === threadId && one.queueId === message.queueId) Object.assign(one, { requestId: message.id, requestAt: message.at });
      }
      this.endBefore(threadId, message.at, { kept: message.id });
      return null;
    }
    const speaker = message.from?.botId;
    if (isUnfinishedTurn(message)) {
      this.endBefore(threadId, message.at, { speaker });
      return null;
    }
    if (!isTurnEnd(message) || (!speaker && message.requestMessageId === undefined)) return null;
    const target = speaker
      ? this.targets.filter((one) => one.inRoom && one.threadId === threadId && one.botId === speaker && one.requestAt !== undefined && one.requestAt <= message.at).at(-1)
      : this.targets.find((one) => !one.inRoom && one.threadId === threadId && one.requestId === message.requestMessageId);
    this.targets = this.targets.filter((one) => one !== target);
    this.endBefore(threadId, message.at, { speaker });
    if (!target) return null;
    const reply = message.turnSucceeded ? message.text?.trim() : undefined;
    return reply ? { target, reply } : { target };
  }

  /** Ends the tasks of a conversation whose messages joined it by `at`, but the task of the message `kept`, and in a group
   * chat only those of the bot that spoke. */
  private endBefore(threadId: string, at: number, { kept, speaker }: { kept?: string; speaker?: string }): void {
    this.targets = this.targets.filter((one) => one.threadId !== threadId || one.requestAt === undefined || one.requestAt > at || one.requestId === kept
      || (one.inRoom === true && one.botId !== speaker));
  }
}
