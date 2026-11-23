import { describe, expect, it } from "vitest";

import { failedTurnTool } from "../../shared/failed-turn.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import type { BotRecord, Message, TaskRecord } from "../store.ts";
import { BotFactsReader, readThread, type BotFactsDeps } from "./bot-facts.ts";

let at = 0;
const line = (patch: Partial<Message>): Message => ({ id: `m${++at}`, at, role: "bot", kind: "text", ...patch });
const reply = (text: string) => line({ text, turnId: `t${at}`, turnTerminal: true });
const step = (name: string, label?: string) => line({ kind: "activity", tool: { name, ok: true, ...(label ? { label } : {}) } });
const failure = () => line({ kind: "activity", tool: failedTurnTool("The engine stopped answering.") });

describe("what one conversation shows on its bot's node", () => {
  it("is its newest settled reply, and the words of its newest step", () => {
    const read = readThread([reply("First"), line({ role: "user", text: "More" }), step("Read", "Read brief.md"), line({ text: "half a thought", turnId: "t9" })]);
    expect(read.reply).toMatchObject({ text: "First" });
    expect(read.doing).toBe("Read brief.md");
    expect(read.failed).toBe(false);
  });

  it("keeps its newest turn's last steps, oldest first, without a failed turn's line", () => {
    const read = readThread([step("Old"), line({ role: "user", text: "Go" }), step("Read", "Read a.md"), step("Write", "Write b.md"), failure(), step("Grep"), step("Edit"), step("Bash", "Ran tests")]);
    expect(read.steps?.map((one) => one.text)).toEqual(["Write b.md", "Grep", "Edit", "Ran tests"]);
    expect(read.steps?.at(-1)?.at).toBe(at);
    expect(readThread([step("Old"), line({ role: "user", text: "Go" }), reply("Hi")])).not.toHaveProperty("steps");
  });

  it("failed when a failed turn came after its last reply, and not once a reply came after it", () => {
    expect(readThread([reply("Done"), failure()]).failed).toBe(true);
    expect(readThread([failure(), reply("Recovered")]).failed).toBe(false);
    expect(readThread([reply("Done"), line({ kind: "activity", tool: { ...failedTurnTool("one step failed"), partial: true } })]).failed).toBe(false);
  });
});

function deps(patch: Partial<BotFactsDeps> = {}): BotFactsDeps & { reads: string[] } {
  const reads: string[] = [];
  const bots: Record<string, Partial<BotRecord>> = { lead: { id: "lead", name: "Lead", title: "Chief" } };
  const tasks: Record<string, Partial<TaskRecord>[]> = {
    lead: [
      { threadId: "a", createdAt: 1, updatedAt: 5, activity: "working" },
      { threadId: "b", createdAt: 1, updatedAt: 9, activity: "waiting-on-you" },
    ],
  };
  const threads: Record<string, Message[]> = { a: [reply("From a")], b: [reply("From b")] };
  return {
    reads,
    store: {
      bot: (id) => (bots[id] ?? null) as BotRecord | null,
      tasks: (id) => (tasks[id] ?? []) as TaskRecord[],
      messagesTail: (threadId) => { reads.push(threadId); return { messages: threads[threadId] ?? [], hasMore: false, activeLeafId: null }; },
    },
    threadBusy: (_botId, threadId) => threadId === "a",
    openCards: () => [],
    queuedThreads: () => new Set(["b"]),
    roomSpeaker: () => undefined,
    ...patch,
  };
}

const card: OptionCardData = { title: "Allow?", subtitle: "Write to the shared folder", options: ["Allow", "Deny"] };

describe("a bot's facts", () => {
  it("hold each conversation's state, reading its messages once until it changes", () => {
    const source = deps();
    const reader = new BotFactsReader(source);
    const [lead] = reader.facts(["lead", "gone"]);
    expect(lead).toMatchObject({ id: "lead", name: "Lead", title: "Chief" });
    expect(lead!.threads.map((one) => [one.threadId, one.busy, one.queued, one.waitingOnPerson, one.reply?.text])).toEqual([
      ["b", false, true, true, "From b"],
      ["a", true, false, false, "From a"],
    ]);
    reader.facts(["lead"]);
    expect(source.reads).toEqual(["b", "a"]);
    reader.forget("a");
    reader.facts(["lead"]);
    expect(source.reads).toEqual(["b", "a", "a"]);
  });

  it("carry the newest open card the bot asked, in its own conversation or a room", () => {
    const reader = new BotFactsReader(deps({ openCards: () => [
      { threadId: "a", id: "c1", at: 3, card: JSON.stringify(card), fromBotId: null },
      { threadId: "a", id: "c2", at: 4, card: JSON.stringify({ ...card, title: "Newer" }), fromBotId: null },
      { threadId: "room", id: "c3", at: 5, card: JSON.stringify(card), fromBotId: "lead" },
      { threadId: "room", id: "c4", at: 6, card: JSON.stringify(card), fromBotId: "someone-else" },
      { threadId: "a", id: "c5", at: 7, card: "not json", fromBotId: null },
    ] }));
    const threads = reader.facts(["lead"])[0]!.threads;
    expect(threads.find((one) => one.threadId === "a")!.card).toMatchObject({ messageId: "c2", card: { title: "Newer" } });
    expect(threads.find((one) => one.threadId === "room")).toMatchObject({ lastAt: 0, card: { messageId: "c3" } });
    expect(threads).toHaveLength(3);
  });
});
