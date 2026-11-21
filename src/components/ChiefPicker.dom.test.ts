// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppState, Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), refreshInbox: vi.fn(async () => {}), state: { bots: [], instances: [] } as unknown as AppState }));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: <T,>(select: (state: AppState) => T) => select(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
  sameItems: (left: readonly unknown[], right: readonly unknown[]) => left.length === right.length && left.every((item, index) => item === right[index]),
}));
vi.mock("@/state/inbox", () => ({ refreshInbox: fixture.refreshInbox }));

import { setLocale } from "@/lib/i18n";
import { ChiefPicker } from "./ChiefPicker";

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `thread-${id}`, name, title: "", description: "", notifications: false, color: "green", unread: false,
  modelSelection: { instanceId: "codex", model: "fixture-model" }, tasks: [], messages: [], ...extra,
});
const instances = [
  { instanceId: "codex", capabilities: { agentsMcp: true } },
  { instanceId: "plain", capabilities: {} },
] as unknown as InstanceInfo[];
const team = (...members: Bot[]) => [
  bot("main", "MagicBot", { defaultBot: {}, chiefOfStaff: true }),
  ...members,
  bot("gone", "Gone", { section: "Night shift", hidden: true }),
  bot("zed", "Zed", { section: "Day shift" }),
];

interface Call { path: string; method: string; body: unknown }
let calls: Call[] = [];
let answer: () => [number, unknown] = () => [200, {}];
let container: HTMLDivElement, root: Root, anchor: HTMLButtonElement;
const onClose = vi.fn(), onChosen = vi.fn();
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const choices = () => [...document.body.querySelectorAll<HTMLButtonElement>("[data-chief-choice]")];
const choice = (id: string) => q(`[data-chief-choice="${id}"]`) as HTMLButtonElement;
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const press = (key: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

async function open(bots: Bot[]): Promise<void> {
  fixture.state = { bots, instances } as unknown as AppState;
  await act(async () => root.render(createElement(ChiefPicker, { department: "Night shift", anchor, onClose, onChosen })));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  calls = [];
  answer = () => [200, {}];
  fixture.dispatch.mockClear();
  fixture.refreshInbox.mockClear();
  onClose.mockClear();
  onChosen.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const [status, body] = answer();
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  anchor = document.createElement("button");
  anchor.textContent = "No Chief of Staff";
  container = document.createElement("div");
  document.body.append(anchor, container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchor.remove();
  vi.unstubAllGlobals();
});

describe("choosing a department's Chief of Staff", () => {
  it("lists the department's own bots and starts on the first, with a bot whose engine can't coordinate unavailable and saying why", async () => {
    await open(team(bot("nia", "Nia", { section: "Night shift", title: "Writes the scripts" }), bot("ode", "Ode", { section: " Night shift ", modelSelection: { instanceId: "plain", model: "m" } })));
    expect(q('[role="menu"]')!.getAttribute("aria-label")).toBe("Choose the Chief of Staff of Night shift");
    expect(choices().map((row) => [row.dataset.chiefChoice, row.disabled, row.getAttribute("aria-checked"), row.textContent])).toEqual([
      ["nia", false, "false", "NiaWrites the scripts"],
      ["ode", true, "false", "OdeChoose a provider that supports bot coordination."],
    ]);
    expect(document.activeElement).toBe(choice("nia"));
  });

  it("makes the chosen bot the Chief of Staff the way the switch in its settings does, then closes and gives the keyboard back", async () => {
    const saved = bot("nia", "Nia", { section: "Night shift", chiefOfStaff: true });
    answer = () => [200, { bot: saved }];
    await open(team(bot("nia", "Nia", { section: "Night shift" })));
    await act(async () => choice("nia").click());
    await settle();
    expect(calls).toEqual([{ path: "/api/bots/nia", method: "PATCH", body: { chiefOfStaff: true } }]);
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "botPatched", bot: saved }]]);
    expect(fixture.refreshInbox).toHaveBeenCalledTimes(1);
    expect(onChosen.mock.calls).toEqual([["nia"]]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it("stays open and says what the server says when it refuses, and can be tried again", async () => {
    answer = () => [409, { error: "Night shift already has a Chief of Staff." }];
    await open(team(bot("nia", "Nia", { section: "Night shift" }), bot("pia", "Pia", { section: "Night shift" })));
    await act(async () => choice("nia").click());
    await settle();
    expect(q('[role="alert"]')!.textContent).toBe("Night shift already has a Chief of Staff.");
    expect(onClose).not.toHaveBeenCalled();
    expect(onChosen).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(choices().map((row) => row.disabled)).toEqual([false, false]);
  });

  it("marks the Chief the department has, starts there, and changes nothing when it is chosen again", async () => {
    await open(team(bot("nia", "Nia", { section: "Night shift" }), bot("pia", "Pia", { section: "Night shift", chiefOfStaff: true })));
    expect(choice("pia").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(choice("pia"));
    await act(async () => choice("pia").click());
    expect(calls).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves with the arrow keys past a bot that can't be chosen, and closes on Escape back to what opened it", async () => {
    await open(team(bot("nia", "Nia", { section: "Night shift" }), bot("ode", "Ode", { section: "Night shift", modelSelection: { instanceId: "plain", model: "m" } }), bot("pia", "Pia", { section: "Night shift" })));
    await press("ArrowDown");
    expect(document.activeElement).toBe(choice("pia"));
    await press("ArrowDown");
    expect(document.activeElement).toBe(choice("nia"));
    await press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it("says when the department has no bots to choose from", async () => {
    await open(team());
    expect(choices()).toEqual([]);
    expect(q('[role="menu"]')!.textContent).toContain("This department has no bots to choose from yet.");
  });
});
