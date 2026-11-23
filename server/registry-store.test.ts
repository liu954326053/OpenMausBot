import { mkdirSync, rmSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnedFile } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { BOTS_FILE, JsonRegistry, persistedBots, saveBotsOnceAfter, type RegistryStore } from "./registry-store.ts";
import { flushLaterSaves } from "./save-batch.ts";
import type { BotRecord } from "./store.ts";

const bot = (id: string) => ({ id, name: id, busy: true, activity: "working", tasks: [
  { threadId: `${id}-t`, busy: true, activity: "working", turnStartedAt: 1, pinned: false },
] }) as unknown as BotRecord;
const owner = { kind: "bot", id: "a" } as const;
const nextIteration = () => new Promise<void>((done) => setImmediate(done));

describe("the JSON registry: today's bots.json and groups.json behind the registry calls", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });
  afterEach(() => {
    flushLaterSaves();
    vi.restoreAllMocks();
  });

  it("never saves live state, and a missing file throws instead of reading as no bots", () => {
    expect(persistedBots([bot("a")])).toEqual([{ id: "a", name: "a", tasks: [{ threadId: "a-t" }] }]);
    const registry = new JsonRegistry();
    expect(() => registry.loadBots()).toThrow();
    expect(() => registry.loadGroups()).toThrow();
  });

  it("writes the whole file owner-only, skips an unchanged one, and reads back what it wrote", () => {
    const registry = new JsonRegistry();
    registry.writeBots([bot("a")], true);
    const first = statSync(BOTS_FILE);
    if (process.platform !== "win32") expect(first.mode & 0o777).toBe(0o600);
    registry.writeBots([bot("a")], true);
    expect(statSync(BOTS_FILE).ino, "the same text is not written again").toBe(first.ino);
    expect(new JsonRegistry().loadBots()).toEqual(persistedBots([bot("a")]));
  });

  it("writes a thread change at once, by the end of the event-loop iteration, or a bounded moment later", async () => {
    const registry = new JsonRegistry();
    const write = vi.fn();
    registry.upsertThread(owner, "a-t", "now", write);
    expect(write).toHaveBeenCalledTimes(1);
    registry.batch(() => {
      registry.upsertThread(owner, "a-t", "pass", write);
      registry.upsertThread(owner, undefined, "pass", write);
    });
    registry.upsertThread(owner, "a-t", "pass", write);
    expect(write).toHaveBeenCalledTimes(1);
    await nextIteration();
    expect(write, "one write for the iteration").toHaveBeenCalledTimes(2);
    registry.upsertThread(owner, "a-t", "later", write);
    expect(write).toHaveBeenCalledTimes(2);
    flushLaterSaves();
    expect(write).toHaveBeenCalledTimes(3);
    registry.deleteOwner(owner, write);
    expect(write).toHaveBeenCalledTimes(4);
  });

  it("a whole save of the live list, a deletion or a fresh read supersedes a write still waiting", async () => {
    const supersede: Array<[string, (registry: JsonRegistry) => void]> = [
      ["a whole save of the live list", (registry) => { registry.writeBots([bot("a")], false); registry.writeBots([bot("b")], true); }],
      ["a deletion", (registry) => registry.deleteOwner({ kind: "bot", id: "b" }, () => registry.writeBots([bot("a")], false))],
      ["a fresh read", () => new JsonRegistry().loadBots()],
    ];
    for (const [what, run] of supersede) {
      const registry = new JsonRegistry();
      registry.writeBots([bot("a"), bot("b")], true);
      const waiting = vi.fn();
      registry.upsertThread(owner, "a-t", "later", waiting);
      registry.upsertThread(owner, "a-t", "pass", waiting);
      run(registry);
      await nextIteration();
      flushLaterSaves();
      expect(waiting, what).not.toHaveBeenCalled();
    }
  });

  it("writes the bots once when a pass of many changes returns, the last list it was asked to save", () => {
    const registry = new JsonRegistry();
    const write = vi.spyOn(OwnedFile.prototype, "write");
    const returned = saveBotsOnceAfter(() => {
      registry.writeBots([bot("a"), bot("b")], true);
      saveBotsOnceAfter(() => registry.writeBots([bot("a"), bot("c")], false));
      registry.writeBots([bot("a"), bot("b"), bot("c")], false);
      expect(write).not.toHaveBeenCalled();
      return 42;
    });
    expect(returned).toBe(42);
    expect(write).toHaveBeenCalledOnce();
    expect(new JsonRegistry().loadBots()).toEqual(persistedBots([bot("a"), bot("b"), bot("c")]));
  });

  it("writes a bot's deletion at once inside such a pass, and the end of the pass never brings the bot back", () => {
    const registry = new JsonRegistry();
    saveBotsOnceAfter(() => {
      registry.writeBots([bot("a"), bot("b")], true);
      registry.deleteOwner({ kind: "bot", id: "b" }, () => registry.writeBots([bot("a")], false));
      expect(new JsonRegistry().loadBots()).toEqual(persistedBots([bot("a")]));
    });
    expect(new JsonRegistry().loadBots()).toEqual(persistedBots([bot("a")]));
  });

  it("logs a write that fails at the end of such a pass instead of throwing, and the next save writes the changes", () => {
    const registry = new JsonRegistry();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(OwnedFile.prototype, "write").mockImplementationOnce(() => { throw new Error("disk full"); });
    expect(() => saveBotsOnceAfter(() => registry.writeBots([bot("a")], true))).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    expect(() => registry.loadBots()).toThrow();
    registry.writeBots([bot("a")], true);
    expect(new JsonRegistry().loadBots()).toEqual(persistedBots([bot("a")]));
  });

  it("has no deferrable save for a room: nothing of a room may wait, and no room save would supersede it", () => {
    const roomLater = (registry: RegistryStore) =>
      // @ts-expect-error "later" is for bots only
      registry.upsertThread({ kind: "group", id: "g" }, undefined, "later", () => {});
    expect(roomLater).toBeTypeOf("function"); // never called: the check is the typecheck's
  });
});
