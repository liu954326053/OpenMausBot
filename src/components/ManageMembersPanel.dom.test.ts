// @vitest-environment happy-dom
import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects";
import type { AppState, Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots } as AppState, dispatch: fixture.dispatch }) };
});
vi.mock("./Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { ManageMembersPanel } = await import("./ManageMembersPanel");
const { setLocale } = await import("@/lib/i18n");
const { setTeamProjects } = await import("@/state/team-projects");

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" }, ...extra,
});
const room = (id: string, memberIds: string[]): Group => ({
  id, threadId: `${id}-thread`, name: `${id} chat`, memberIds, defaultResponder: { kind: "member", botId: "lead" },
  bulletin: "", unread: false, createdAt: 1, messages: [], section: "The bride",
});
const bride: TeamProjectWire = {
  id: "p-bride", name: "The bride", folder: "/dramas/The bride", section: "The bride", team: { key: "team:urban", name: "Urban" },
  leadBotId: "lead", roomId: "bride-room", createdAt: 1, folderState: "ready", follows: {},
  botIds: ["lead", "writer", "frame-1", "cut-1"],
  episodeBots: { "frame-1": { number: 1, job: "storyboard" }, "cut-1": { number: 1, job: "post" } },
};

let host: HTMLDivElement;
let root: Root;
const draw = (group: Group) => flushSync(() => root.render(createElement(ManageMembersPanel, { group, onClose: () => {}, triggerRef: createRef<HTMLButtonElement>() })));
const candidates = () => [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].map((box) => [box.getAttribute("aria-label"), box.getAttribute("aria-checked")]);
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const button = (text: string) => [...document.querySelectorAll("button")].find((one) => one.textContent === text);

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockReset();
  fixture.bots = [bot("lead"), bot("writer"), bot("frame-1", { section: "The bride" }), bot("cut-1", { section: "The bride" }), bot("helper")];
  setTeamProjects({ root: "/dramas", projects: [bride] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setTeamProjects(null);
  document.body.innerHTML = "";
});

describe("Manage members of a drama's group chat", () => {
  it("leaves the bots made for one episode out of the drama's own group chat, archived or not", () => {
    draw(room("bride-room", ["lead", "writer"]));
    expect(candidates()).toEqual([["lead", "true"], ["writer", "true"], ["helper", "false"]]);
    flushSync(() => setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 5 }] }));
    expect(candidates()).toEqual([["lead", "true"], ["writer", "true"], ["helper", "false"]]);
  });

  it("offers them to any other room as before", () => {
    draw(room("side-room", ["lead"]));
    expect(candidates()).toEqual([["lead", "true"], ["writer", "false"], ["frame-1", "false"], ["cut-1", "false"], ["helper", "false"]]);
  });

  it("keeps one that is in the drama's group chat already listed, so it can be taken out", () => {
    draw(room("bride-room", ["lead", "cut-1", "writer"]));
    expect(candidates()).toEqual([["lead", "true"], ["writer", "true"], ["cut-1", "true"], ["helper", "false"]]);
    click(document.querySelector('[role="checkbox"][aria-label="cut-1"]'));
    click(button("Save · 2 bots"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "patchGroup", groupId: "bride-room", patch: { memberIds: ["lead", "writer"] } }]]);
  });
});
