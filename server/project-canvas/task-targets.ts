import { CANVAS_CONTENT_MAX_CHARS } from "../../shared/project-canvas.ts";
import { redactSecretsInText } from "../redact.ts";
import type { Message } from "../store.ts";

/** A text node waiting for a bot's reply to a task. The task's message is `requestId` once the conversation has it,
 * and is known by `queueId` while it waits in the bot's queue. */
export interface TaskTarget {
  projectId: string;
  botId: string;
  threadId: string;
  nodeId: string;
  requestId?: string;
  /** When the task's message joined the conversation. */
  requestAt?: number;
  queueId?: string;
}

export interface SettledTask {
  target: TaskTarget;
  /** The bot's reply, when its turn for the task ended well. */
  reply?: string;
}

const MAX_TARGETS = 200;

type SettledLine = Message & { requestMessageId: string; turnSucceeded: boolean };

const isSettledLine = (message: Message): message is SettledLine =>
  message.role === "bot" && message.kind === "text" && message.turnTerminal === true && message.turnSucceeded !== undefined && message.requestMessageId !== undefined;

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

  /** A newer task for the same node takes the place of the older. */
  add(target: TaskTarget): void {
    this.targets = [...this.targets.filter((one) => one.projectId !== target.projectId || one.nodeId !== target.nodeId), target].slice(-MAX_TARGETS);
  }

  of(projectId: string): readonly TaskTarget[] {
    return this.targets.filter((one) => one.projectId === projectId);
  }

  /** Hears a new or changed line of a conversation, and answers the task whose turn it ends. A conversation runs one
   * turn at a time, so a turn ending there also ends every task whose message came before it: those get no reply. */
  heard(threadId: string, message: Message): SettledTask | null {
    if (message.role === "user" && message.queueId) {
      for (const one of this.targets) {
        if (one.threadId === threadId && one.queueId === message.queueId) Object.assign(one, { requestId: message.id, requestAt: message.at });
      }
      return null;
    }
    if (!isSettledLine(message)) return null;
    const target = this.targets.find((one) => one.threadId === threadId && one.requestId === message.requestMessageId);
    this.targets = this.targets.filter((one) => one !== target && (one.threadId !== threadId || one.requestAt === undefined || one.requestAt > message.at));
    if (!target) return null;
    const reply = message.turnSucceeded ? message.text?.trim() : undefined;
    return reply ? { target, reply } : { target };
  }
}
