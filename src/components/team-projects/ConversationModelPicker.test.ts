import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { teamProjectSide } from "@/lib/team-projects";
import type { Bot } from "@/state/store";

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `thread-${id}`, name, title: "", description: "", notifications: false, color: "green", unread: false,
  modelSelection: { instanceId: "fixture", model: "fixture-model" }, tasks: [], messages: [], ...extra,
});
const source = bot("pepper", "Pepper", { section: "Ops" });
const copy = bot("copy", "Pepper", { section: "Launch" });
const launch = { id: "p1", name: "Launch", section: "Launch", folder: "/work/launch", leadBotId: "copy", botIds: ["copy"], follows: { copy: "pepper" }, createdAt: 1 } as unknown as TeamProjectWire;
const side = teamProjectSide({ root: "/work", projects: [launch] });

vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return { ...actual, useStore: () => ({ state: { ...actual.initialState, bots: [source, copy] }, dispatch: vi.fn() }) };
});
vi.mock("@/state/team-projects", async (original) => ({ ...await original<object>(), useTeamProjectSide: () => side }));
vi.mock("../ModelPicker", () => ({ ModelPicker: () => createElement("span", { "data-model-picker-stub": "" }) }));
const { ConversationModelPicker } = await import("./ConversationModelPicker");

describe("ConversationModelPicker", () => {
  it("locks a copy's conversation model and says it comes from the source", () => {
    const html = renderToStaticMarkup(createElement(ConversationModelPicker, { bot: copy, threadId: copy.threadId }));
    expect(html).not.toContain("data-model-picker-stub");
    expect(html).toContain('data-copy-conversation-model="pepper"');
    expect(html).toMatch(/<button[^>]* disabled=""/);
    expect(html).toContain("Its name, job, instructions, look and model come from Pepper.");
  });

  it("says why in place of a label that asks for a change", () => {
    const html = renderToStaticMarkup(createElement(ConversationModelPicker, { bot: copy, threadId: copy.threadId, contained: true, label: createElement("span", null, "Switch model") }));
    expect(html).not.toContain("Switch model");
    expect(html).toContain(">Its name, job, instructions, look and model come from Pepper.<");
  });

  it("offers the picker on a bot that follows nobody", () => {
    expect(renderToStaticMarkup(createElement(ConversationModelPicker, { bot: source, threadId: source.threadId }))).toContain("data-model-picker-stub");
  });
});
