// A real server started as the desktop app starts it, on a computer whose locale is US English, with no language in
// config.json: its new bots and its own lines speak Simplified Chinese while the app is told no language.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";

const CHOICES = ["调研和深挖各种主题", "帮我盯着一些事情", "邮件、日历和消息", "预订、购物和跑腿", "数据、表格和报告"];

let fixture: VerificationServer;
const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(fixture.info.url + path, {
    method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
};
const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
const newBot = async (name: string) => {
  const { bot } = await control("new-bot", "--name", name) as { bot: { id: string; activeTaskId: string } };
  const { messages } = (await call("GET", `/api/threads/${bot.activeTaskId}/messages?limit=10`)).body;
  return { bot, greeting: messages[0] };
};

beforeAll(async () => {
  fixture = await launchVerificationServer({ OMB_DEFAULT_LANGUAGE: "zh", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" });
}, 120_000);
afterAll(async () => { await fixture?.close(); });

it("a new bot greets, offers its setup card, keeps its memory and is refused while paused in Simplified Chinese", async () => {
  expect(JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8"))).not.toHaveProperty("language");
  expect((await call("GET", "/api/config")).body.language).toBe("");

  const { bot, greeting } = await newBot("Pepper");
  expect(greeting).toMatchObject({ role: "bot", text: "嗨，我是 Pepper。你想让我帮你做什么？", setupOffer: true, setupChoices: CHOICES });

  await control("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "你好");
  expect((await control("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
  expect(readFileSync(join(fixture.info.dataDir, "workspaces", bot.id, "MEMORY.md"), "utf8")).toMatch(/^# 记忆\n/);

  expect((await call("POST", "/api/paused", { kind: "bot", id: bot.id, paused: true })).status).toBe(200);
  expect(await call("POST", `/api/bots/${bot.id}/messages`, { text: "还在吗？", threadId: bot.activeTaskId, sendId: randomUUID() }))
    .toMatchObject({ status: 409, body: { error: "Pepper 已暂停，不会接收新工作。可在侧边栏的菜单中恢复它。", code: "bot_held" } });
}, 120_000);

it("a language named in config.json still wins, and an empty one names none", async () => {
  expect((await call("PATCH", "/api/config", { language: "en" })).status).toBe(200);
  expect((await call("GET", "/api/config")).body.language).toBe("en");
  expect((await newBot("Iris")).greeting.text).toBe("Hi, I'm Iris. What would you like me to do?");

  expect((await call("PATCH", "/api/config", { language: "" })).status).toBe(200);
  expect((await call("GET", "/api/config")).body.language).toBe("");
  expect((await newBot("Juno")).greeting.text).toBe("嗨，我是 Juno。你想让我帮你做什么？");
}, 60_000);
