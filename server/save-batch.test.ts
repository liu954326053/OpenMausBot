import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFile, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CRASH_EXIT_CODE, RESTART_EXIT_CODE } from "./restart.ts";
import {
  batchSaves, flushAtCleanExit, flushLaterSaves, SAVE_LATER_MAX_MS, saveBeforeReturning, saveByIterationEnd, saveLater, saveLaterDelayMs, saveSoon,
  supersedeWaitingSaves, waitingSaves,
} from "./save-batch.ts";

const nextIteration = () => new Promise<void>((done) => setImmediate(done));

describe("a save asked for with saveByIterationEnd", () => {
  afterEach(() => flushLaterSaves());

  it("is written once per file, the last write asked for, after the callbacks of the event-loop iteration that asked and before the next iteration's timers and I/O", async () => {
    const writes: string[] = [];
    const seen: Record<string, string[]> = {};
    await new Promise<void>((done) => {
      readFile(import.meta.filename, () => {
        saveByIterationEnd("a", () => writes.push("a1"));
        saveByIterationEnd("a", () => writes.push("a2"));
        batchSaves(() => saveByIterationEnd("a", () => writes.push("a3")));
        saveByIterationEnd("b", () => writes.push("b1"));
        seen.asked = [...writes];
        let probes = 2;
        const probe = (key: string) => () => {
          seen[key] = [...writes];
          if (--probes === 0) done();
        };
        // Node 24: inside an I/O callback every setImmediate callback runs before any timer, and an I/O callback started
        // here runs in a later iteration.
        setTimeout(probe("timer"), 0);
        readFile(import.meta.filename, probe("io"));
      });
    });
    expect(seen).toEqual({ asked: [], timer: ["a3", "b1"], io: ["a3", "b1"] });
  });

  it("is written before the call returns when its change is put back on a failed write, outside a batch, and then nothing waits for the file", async () => {
    const writes: string[] = [];
    saveByIterationEnd("a", () => writes.push("waiting"));
    saveBeforeReturning(() => saveByIterationEnd("a", () => writes.push("now")));
    expect(writes).toEqual(["now"]);
    batchSaves(() => saveBeforeReturning(() => saveByIterationEnd("a", () => writes.push("batched"))));
    expect(writes).toEqual(["now"]);
    await nextIteration();
    expect(writes).toEqual(["now", "batched"]);
    expect(() => saveBeforeReturning(() => saveByIterationEnd("a", () => { throw new Error("disk full"); }))).toThrow("disk full");
  });

  it("is dropped, with a later write for the file, once the file was written whole another way", async () => {
    const writes: string[] = [];
    saveByIterationEnd("a", () => writes.push("a"));
    saveLater("a", () => writes.push("later"));
    supersedeWaitingSaves("a");
    await nextIteration();
    flushLaterSaves();
    expect(writes).toEqual([]);
  });

  it("that fails is logged and waits: the next save of any file writes it, and so does a flush", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const writes: string[] = [];
    saveByIterationEnd("a", () => { if (fail) throw new Error("disk full"); writes.push("a"); });
    batchSaves(() => saveByIterationEnd("b", () => writes.push("b")));
    await nextIteration();
    expect(writes).toEqual(["b"]);
    expect(error).toHaveBeenCalledOnce();
    await nextIteration();
    expect(writes, "nothing tries it again by itself").toEqual(["b"]);
    fail = false;
    saveByIterationEnd("c", () => writes.push("c"));
    await nextIteration();
    expect(writes).toEqual(["b", "a", "c"]);
    fail = true;
    saveByIterationEnd("a", () => { if (fail) throw new Error("disk full"); writes.push("a2"); });
    await nextIteration();
    fail = false;
    flushLaterSaves();
    expect(writes).toEqual(["b", "a", "c", "a2"]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("is written by a flush, as a graceful stop and a backup do, and at a clean exit, but not after a fatal one", () => {
    const writes: string[] = [];
    saveByIterationEnd("a", () => writes.push("a"));
    for (const fatal of [1, CRASH_EXIT_CODE]) flushAtCleanExit(fatal);
    expect(writes).toEqual([]);
    flushAtCleanExit(0);
    expect(writes).toEqual(["a"]);
    saveByIterationEnd("a", () => writes.push("a2"));
    flushAtCleanExit(RESTART_EXIT_CODE);
    saveByIterationEnd("b", () => writes.push("b"));
    flushLaterSaves();
    expect(writes).toEqual(["a", "a2", "b"]);
  });

  it("reaches the disk when its process runs out of work or exits cleanly right after asking, and not when it exits on a fatal error", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-iteration-save-"));
    const module = pathToFileURL(join(import.meta.dirname, "save-batch.ts")).href;
    try {
      for (const [exit, saved] of [["drain", true], ["0", true], [String(RESTART_EXIT_CODE), true], ["1", false], [String(CRASH_EXIT_CODE), false]] as const) {
        const script = [
          `import { writeFileSync } from "node:fs";`,
          `import { saveByIterationEnd } from ${JSON.stringify(module)};`,
          `saveByIterationEnd("file", () => writeFileSync(${JSON.stringify(join(dir, exit))}, "saved"));`,
          exit === "drain" ? "" : `process.exit(${exit});`,
        ].join("\n");
        const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
        expect(existsSync(join(dir, exit)), `${exit}: ${run.stderr}`).toBe(saved);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("batchSaves", () => {
  it("writes at once outside a batch, and once per file when the outermost batch returns", () => {
    const writes: string[] = [];
    const a = {}, b = {};
    saveSoon(a, () => writes.push("a0"));
    expect(writes).toEqual(["a0"]);
    batchSaves(() => {
      saveSoon(a, () => writes.push("a1"));
      batchSaves(() => saveSoon(b, () => writes.push("b1")));
      saveSoon(a, () => writes.push("a2"));
      expect(writes).toEqual(["a0"]);
    });
    expect(writes).toEqual(["a0", "a2", "b1"]);
  });

  it("writes what was asked for when the batch throws, and a failed write never stops the others", () => {
    const writes: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => batchSaves(() => {
      saveSoon({}, () => { throw new Error("disk full"); });
      saveSoon({}, () => writes.push("b"));
      throw new Error("listener");
    })).toThrow("listener");
    expect(writes).toEqual(["b"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("hands back what the batch returned", () => {
    expect(batchSaves(() => 42)).toBe(42);
  });
});

describe("saveLater", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { flushLaterSaves(); vi.useRealTimers(); });

  it("writes once for every change asked for within the delay, across passes of the event loop", async () => {
    const writes: string[] = [];
    saveLater("a", () => writes.push("a1"));
    await vi.advanceTimersByTimeAsync(10);
    saveLater("a", () => writes.push("a2"));
    batchSaves(() => saveLater("a", () => writes.push("a3")));
    saveLater("b", () => writes.push("b1"));
    expect(writes).toEqual([]);
    expect(waitingSaves()).toBe(2);
    await vi.advanceTimersByTimeAsync(saveLaterDelayMs());
    expect(writes).toEqual(["a3", "b1"]);
    expect(waitingSaves()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes).toEqual(["a3", "b1"]);
  });

  it("counts the delay from the first change still waiting, so a steady stream of changes cannot put the write off", async () => {
    const writes: number[] = [];
    const delay = saveLaterDelayMs();
    for (let i = 0; i < 10; i++) {
      saveLater("a", () => writes.push(i));
      await vi.advanceTimersByTimeAsync(delay / 5);
    }
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(delay).toBeLessThanOrEqual(SAVE_LATER_MAX_MS);
  });

  it("writes everything waiting at once when flushed, and nothing twice", async () => {
    const writes: string[] = [];
    saveLater("a", () => writes.push("a"));
    saveLater("b", () => writes.push("b"));
    flushLaterSaves();
    expect(writes).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes).toEqual(["a", "b"]);
  });

  it("drops a waiting write once the file was written whole another way", async () => {
    const writes: string[] = [];
    saveLater("a", () => writes.push("a"));
    supersedeWaitingSaves("a");
    await vi.advanceTimersByTimeAsync(5_000);
    flushLaterSaves();
    expect(writes).toEqual([]);
  });

  it("keeps a failed write waiting and tries it again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const writes: string[] = [];
    saveLater("a", () => { if (fail) throw new Error("disk full"); writes.push("a"); });
    saveLater("b", () => writes.push("b"));
    await vi.advanceTimersByTimeAsync(saveLaterDelayMs());
    expect(writes).toEqual(["b"]);
    expect(waitingSaves()).toBe(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(SAVE_LATER_MAX_MS);
    expect(writes).toEqual(["b", "a"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
