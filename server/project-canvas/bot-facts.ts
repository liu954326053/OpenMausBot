import { failedTurnCause } from "../../shared/failed-turn.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import type { Message, Store } from "../store.ts";
import type { BotFacts, ThreadFacts } from "./snapshot.ts";

/** A card nobody answered, as `openCardRows` reads it. */
export interface OpenCardRow {
  threadId: string;
  id: string;
  at: number;
  card: string | null;
  fromBotId: string | null;
}

export interface BotFactsDeps {
  store: Pick<Store, "bot" | "tasks" | "messagesTail">;
  threadBusy(botId: string, threadId: string): boolean;
  openCards(): OpenCardRow[];
  /** The conversations a message waits in for its bot to be free. */
  queuedThreads(): ReadonlySet<string>;
}

/** The newest conversations of a bot whose messages are read; the others give only their state. */
const READ_THREADS = 8;
const TAIL_MESSAGES = 80;
const DOING_MAX_CHARS = 200;

export interface ThreadRead {
  reply?: NonNullable<ThreadFacts["reply"]>;
  doing?: string;
  failed: boolean;
}

const isReply = (message: Message) => message.role === "bot" && message.kind === "text" && message.turnTerminal === true && Boolean(message.text?.trim());
const isFailedTurn = (message: Message) => message.kind === "activity" && message.tool !== undefined && message.tool.partial !== true && failedTurnCause(message.tool.name) !== null;

export function readThread(messages: readonly Message[]): ThreadRead {
  const replyAt = messages.findLastIndex(isReply);
  const reply = messages[replyAt];
  const step = messages.findLast((message) => message.kind === "activity" && message.tool !== undefined && failedTurnCause(message.tool.name) === null);
  const words = step?.tool?.label ?? step?.tool?.name;
  return {
    ...(reply ? { reply: { messageId: reply.id, text: reply.text!, at: reply.at } } : {}),
    ...(words ? { doing: [...words].slice(0, DOING_MAX_CHARS).join("") } : {}),
    failed: messages.findLastIndex(isFailedTurn) > replyAt,
  };
}

function parsedCard(raw: string | null): OptionCardData | null {
  if (!raw) return null;
  try {
    const card: unknown = JSON.parse(raw);
    return card && typeof card === "object" && !Array.isArray(card) ? card as OptionCardData : null;
  } catch {
    return null;
  }
}

/** What each bot's node is derived from. A conversation's messages are read once and again only after `forget`. */
export class BotFactsReader {
  private readonly reads = new Map<string, ThreadRead>();
  private readonly deps: BotFactsDeps;

  constructor(deps: BotFactsDeps) {
    this.deps = deps;
  }

  forget(threadId: string): void {
    this.reads.delete(threadId);
  }

  private read(threadId: string): ThreadRead {
    let read = this.reads.get(threadId);
    if (!read) {
      read = readThread(this.deps.store.messagesTail(threadId, TAIL_MESSAGES).messages);
      this.reads.set(threadId, read);
    }
    return read;
  }

  facts(botIds: readonly string[]): BotFacts[] {
    const cards = this.deps.openCards();
    const queued = this.deps.queuedThreads();
    return botIds.flatMap((botId) => {
      const bot = this.deps.store.bot(botId);
      if (!bot) return [];
      const lastAt = (task: { createdAt: number; updatedAt?: number }) => task.updatedAt ?? task.createdAt;
      const tasks = [...this.deps.store.tasks(botId)].sort((a, b) => lastAt(b) - lastAt(a));
      const threads: ThreadFacts[] = tasks.map((task, index) => {
        const busy = this.deps.threadBusy(botId, task.threadId);
        const read: ThreadRead = index < READ_THREADS || busy ? this.read(task.threadId) : { failed: false };
        return {
          threadId: task.threadId,
          busy,
          waitingOnPerson: task.activity === "waiting-on-you",
          queued: queued.has(task.threadId),
          failed: read.failed,
          lastAt: lastAt(task),
          ...(read.doing ? { doing: read.doing } : {}),
          ...(read.reply ? { reply: read.reply } : {}),
        };
      });
      const own = new Set(tasks.map((task) => task.threadId));
      for (const row of cards) {
        if (row.fromBotId ? row.fromBotId !== botId : !own.has(row.threadId)) continue;
        const card = parsedCard(row.card);
        if (!card) continue;
        const asked = { messageId: row.id, at: row.at, card };
        const thread = threads.find((one) => one.threadId === row.threadId);
        if (!thread) threads.push({ threadId: row.threadId, busy: false, waitingOnPerson: false, queued: false, failed: false, lastAt: 0, card: asked });
        else if (!thread.card || thread.card.at < row.at) thread.card = asked;
      }
      return [{ id: botId, name: bot.name, title: bot.title ?? "", threads }];
    });
  }
}
