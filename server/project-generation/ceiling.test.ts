import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BOT_GENERATION_WINDOW_MS, type GenerationRequester } from "../../shared/project-generation.ts";
import { BotCeiling } from "./ceiling.ts";
import { GenerationStore } from "./store.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-generation-ceiling-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bot: GenerationRequester = { kind: "bot", botId: "bot-a" };

describe("a bot's generation ceiling", () => {
  it("counts each picture a bot starts over a rolling day, and forgets them after it", () => {
    let clock = 1_000_000;
    const ceiling = new BotCeiling(new GenerationStore(dir, () => undefined), () => clock);
    ceiling.record(bot, "image", 3);
    clock += 1000;
    ceiling.record(bot, "image", 4);
    expect(ceiling.check(bot, "image", 1)).toBeNull();
    expect(ceiling.check(bot, "image", 2)).toMatchObject({ code: "confirmation_needed", allowance: { used: 7, ceiling: 8, asked: 2 } });
    expect(ceiling.check({ ...bot, confirmed: true }, "image", 2)).toBeNull();
    expect(ceiling.check({ kind: "person" }, "image", 100)).toBeNull();
    expect(ceiling.check({ kind: "bot", botId: "bot-b" }, "image", 8)).toBeNull();
    expect(ceiling.check(bot, "video", 3)).toBeNull();

    clock = 1_000_000 + BOT_GENERATION_WINDOW_MS - 1;
    expect(ceiling.allowance("bot-a").image.used).toBe(7);
    clock += 1;
    expect(ceiling.allowance("bot-a").image.used).toBe(4);
    clock += 1000;
    expect(ceiling.allowance("bot-a").image.used).toBe(0);
  });

  it("doesn't count what the person confirmed or started, and remembers the rest across a restart", () => {
    const store = new GenerationStore(dir, () => undefined);
    const first = new BotCeiling(store);
    first.record({ ...bot, confirmed: true }, "video", 1);
    first.record({ kind: "person" }, "video", 1);
    first.record(bot, "video", 2);
    expect(new BotCeiling(new GenerationStore(dir, () => undefined)).allowance("bot-a").video).toEqual({ used: 2, ceiling: 3 });
  });
});
