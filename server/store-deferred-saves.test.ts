import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnedFile } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { RESTART_EXIT_CODE } from "./restart.ts";
import { flushAtCleanExit, flushLaterSaves, SAVE_LATER_MAX_MS, waitingSaves } from "./save-batch.ts";
import { Store, type BotRecord } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const file = join(DATA_DIR, "bots.json");
const onDisk = (botId: string) => (JSON.parse(readFileSync(file, "utf8")) as BotRecord[]).find((bot) => bot.id === botId)!;
const taskOf = (saved: BotRecord, threadId: string) => saved.tasks!.find((candidate) => candidate.threadId === threadId)!;
const written = () => statSync(file).ino;
const endOfIteration = () => vi.advanceTimersByTimeAsync(0);

describe("what bots.json holds, and when", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    vi.useFakeTimers();
  });
  afterEach(() => {
    flushLaterSaves();
    vi.useRealTimers();
  });

  /** What a turn's end writes that may wait: its usage, the context reading's model, and the turn's own unread mark. */
  function turnEnd(store: Store, botId: string, threadId: string): void {
    store.addTaskUsage(botId, threadId, { input: 100, output: 10, costUsd: null });
    store.patchTask(botId, threadId, { lastContextModel: "claude:claude-sonnet-5" });
    store.patchTask(botId, threadId, { unread: true }, { turnEnd: true });
  }

  it("writes the harmless end-of-turn changes once, a bounded moment later, however many turns end together", async () => {
    const store = new Store(selection);
    const bots = Array.from({ length: 6 }, (_, i) => store.createBot({ name: `Bot ${i}` }, { seedMessages: false }));
    const before = written();
    for (let n = 0; n < 3; n++) {
      for (const bot of bots) turnEnd(store, bot.id, bot.threadId);
      await vi.advanceTimersByTimeAsync(5);
      expect(written(), "nothing is written while the changes are still arriving").toBe(before);
    }
    expect(waitingSaves()).toBe(1);
    await vi.advanceTimersByTimeAsync(SAVE_LATER_MAX_MS);
    expect(waitingSaves()).toBe(0);
    expect(written()).not.toBe(before);
    for (const bot of bots) {
      const task = onDisk(bot.id).tasks!.find((candidate) => candidate.threadId === bot.threadId)!;
      expect(task).toMatchObject({ usage: { turns: 3 }, unread: true, lastContextModel: "claude:claude-sonnet-5" });
    }
    const once = written();
    await vi.advanceTimersByTimeAsync(10 * SAVE_LATER_MAX_MS);
    expect(written(), "one write for the lot").toBe(once);
  });

  it("holds everything else before the call returns, with the end-of-turn changes that were waiting", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Maus" }, { seedMessages: false }), threadId = bot.threadId;
    const task = (saved: BotRecord) => taskOf(saved, threadId);
    const durable: Array<[string, () => void, (saved: BotRecord) => void]> = [
      ["a result posted into the chat (context changed elsewhere)", () => store.patchTask(bot.id, threadId, { resumeCursors: {}, lastInstanceId: "external:1" }),
        (saved) => expect(task(saved)).toMatchObject({ resumeCursors: {}, lastInstanceId: "external:1" })],
      ["a context reset", () => store.patchTask(bot.id, threadId, { resumeCursors: {} }), (saved) => expect(task(saved).resumeCursors).toEqual({})],
      ["a read mark", () => store.patchTask(bot.id, threadId, { unread: false, lastReadMessageId: "m-9" }),
        (saved) => expect(task(saved)).toMatchObject({ unread: false, lastReadMessageId: "m-9" })],
      ["a person's own unread mark", () => store.patchTask(bot.id, threadId, { unread: true }), (saved) => expect(task(saved).unread).toBe(true)],
      ["a thread's title", () => store.patchTask(bot.id, threadId, { title: "Quarterly numbers" }), (saved) => expect(task(saved).title).toBe("Quarterly numbers")],
      ["an always-allow grant", () => store.patchTask(bot.id, threadId, { alwaysAllow: ["Bash(git status)"] }),
        (saved) => expect(task(saved).alwaysAllow).toEqual(["Bash(git status)"])],
      ["a new thread", () => store.createTask(bot.id, "Second thread", false), (saved) => expect(saved.tasks!.map((candidate) => candidate.title)).toContain("Second thread")],
      ["the bot's own settings", () => store.patchBot(bot.id, { name: "Renamed" }), (saved) => expect(saved.name).toBe("Renamed")],
    ];
    durable.forEach(([what, change, check], n) => {
      turnEnd(store, bot.id, threadId);
      expect(waitingSaves(), what).toBe(1);
      change();
      const saved = onDisk(bot.id);
      check(saved);
      expect(task(saved).usage, `${what}: the waiting changes ride along`).toMatchObject({ turns: n + 1 });
      expect(waitingSaves(), `${what}: nothing is left waiting`).toBe(0);
    });
  });

  it("holds an engine's bookkeeping by the end of the event-loop iteration, with the end-of-turn changes that were waiting", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Maus" }, { seedMessages: false }), threadId = bot.threadId;
    const task = (saved: BotRecord) => taskOf(saved, threadId);
    const bookkeeping: Array<[string, () => void, (saved: BotRecord) => void]> = [
      ["an engine session", () => store.setResumeCursor(bot.id, "claude", { sessionId: "s-1" }, threadId),
        (saved) => expect(task(saved).resumeCursors).toEqual({ claude: { sessionId: "s-1" } })],
      ["which engine has the thread", () => store.markTaskDispatched(bot.id, threadId, "claude"), (saved) => expect(task(saved).lastInstanceId).toBe("claude")],
      ["what was handed to the engine", () => store.setHandedMessages(bot.id, threadId, "claude", { session: { sessionId: "s-1" }, lastMessageId: "m-1" } as never),
        (saved) => expect(task(saved).handedMessages).toMatchObject({ claude: { lastMessageId: "m-1" } })],
      ["when the person last wrote", () => store.setTaskAskedAt(bot.id, threadId, 5_000), (saved) => expect(task(saved).askedAt).toBe(5_000)],
    ];
    for (const [n, [what, change, check]] of bookkeeping.entries()) {
      turnEnd(store, bot.id, threadId);
      const before = written();
      change();
      expect(written(), `${what}: not before the iteration ends`).toBe(before);
      await endOfIteration();
      const saved = onDisk(bot.id);
      check(saved);
      expect(task(saved).usage, `${what}: the waiting changes ride along`).toMatchObject({ turns: n + 1 });
      expect(waitingSaves(), `${what}: nothing is left waiting`).toBe(0);
    }
  });

  it("writes waiting bookkeeping with a change that must be on disk before its call returns, or a deletion, and nothing older after it", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Maus" }, { seedMessages: false });
    const other = store.createBot({ name: "Other" }, { seedMessages: false });
    const mine = () => taskOf(onDisk(bot.id), bot.threadId);
    const steps: Array<[string, () => void, () => void, () => void]> = [
      ["a thread's folder", () => store.markTaskDispatched(bot.id, bot.threadId, "claude"), () => store.pinTaskCwd(other.id, other.threadId, "/tmp/other"),
        () => expect(mine().lastInstanceId).toBe("claude")],
      ["a change put back if its write fails", () => store.setResumeCursor(bot.id, "claude", { sessionId: "s-1" }, bot.threadId),
        () => store.patchTask(other.id, other.threadId, { title: "Renamed" }), () => expect(mine().resumeCursors).toEqual({ claude: { sessionId: "s-1" } })],
      ["a deletion", () => store.setHandedMessages(bot.id, bot.threadId, "claude", { session: { sessionId: "s-1" }, lastMessageId: "m-1" } as never),
        () => store.deleteBot(other.id), () => expect(mine().handedMessages).toMatchObject({ claude: { lastMessageId: "m-1" } })],
    ];
    for (const [what, waiting, atOnce, check] of steps) {
      waiting();
      atOnce();
      check();
      const last = written();
      await endOfIteration();
      expect(written(), `${what}: nothing is left to write after it`).toBe(last);
    }
    expect((JSON.parse(readFileSync(file, "utf8")) as BotRecord[]).map((saved) => saved.id)).toEqual([bot.id]);
  });

  it("writes the engine bookkeeping of many conversations starting together once", async () => {
    const store = new Store(selection);
    const bots = Array.from({ length: 34 }, (_, i) => store.createBot({ name: `Episode ${i}` }, { seedMessages: false }));
    const write = vi.spyOn(OwnedFile.prototype, "write");
    for (const bot of bots) {
      store.markTaskDispatched(bot.id, bot.threadId, "claude");
      store.setHandedMessages(bot.id, bot.threadId, "claude", { session: { sessionId: `s-${bot.id}` }, lastMessageId: "m-1" } as never);
      store.setResumeCursor(bot.id, "claude", { sessionId: `s-${bot.id}` }, bot.threadId);
    }
    expect(write).not.toHaveBeenCalled();
    await endOfIteration();
    expect(write.mock.results.filter((result) => result.value === true)).toHaveLength(1);
    write.mockRestore();
    for (const bot of bots) expect(taskOf(onDisk(bot.id), bot.threadId)).toMatchObject({ lastInstanceId: "claude", resumeCursors: { claude: { sessionId: `s-${bot.id}` } } });
  });

  it("does not hold back the unread mark that wakes a snoozed thread", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Maus" }, { seedMessages: false });
    store.patchTask(bot.id, bot.threadId, { snoozedUntil: 0 });
    store.patchTask(bot.id, bot.threadId, { unread: true });
    expect(waitingSaves()).toBe(0);
    const task = onDisk(bot.id).tasks!.find((candidate) => candidate.threadId === bot.threadId)!;
    expect(task.unread).toBe(true);
    expect(task.snoozedUntil).toBeUndefined();
  });

  it("writes what is waiting when flushed, as shutdown and a backup do, and at a clean exit but not after a fatal one", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Maus" }, { seedMessages: false });
    turnEnd(store, bot.id, bot.threadId);
    store.markTaskDispatched(bot.id, bot.threadId, "claude");
    expect(onDisk(bot.id).tasks![0]!.usage).toBeUndefined();
    // 1: an uncaught exception; 70: the crash guard's fatal exit (server/crash-guard.ts).
    for (const fatal of [1, 70]) flushAtCleanExit(fatal);
    expect(onDisk(bot.id).tasks![0]!.usage, "a fatal exit leaves the last whole file").toBeUndefined();
    expect(onDisk(bot.id).tasks![0]!.lastInstanceId).toBeUndefined();
    flushAtCleanExit(RESTART_EXIT_CODE);
    expect(onDisk(bot.id).tasks![0]).toMatchObject({ usage: { turns: 1 }, lastInstanceId: "claude" });
    turnEnd(store, bot.id, bot.threadId);
    store.setTaskAskedAt(bot.id, bot.threadId, 7_000);
    flushLaterSaves();
    expect(new Store(selection).taskByThread(bot.id, bot.threadId)).toMatchObject({ usage: { turns: 2 }, askedAt: 7_000 });
  });

  it("names the changed thread on each bookkeeping event, so its frame can carry that thread alone", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Maus" }, { seedMessages: false });
    const second = store.createTask(bot.id, "Second thread")!;
    const events: unknown[] = [];
    store.onChange((change) => { if (change.type === "bot") events.push(change); });
    turnEnd(store, bot.id, second.threadId);
    store.setResumeCursor(bot.id, "claude", { sessionId: "s-1" }, second.threadId);
    store.setTaskAskedAt(bot.id, second.threadId, 1_000);
    store.setTaskActivity(bot.id, second.threadId, "working");
    expect(events.length).toBeGreaterThanOrEqual(6);
    for (const event of events) expect(event).toEqual({ type: "bot", botId: bot.id, threadId: second.threadId });
  });
});
