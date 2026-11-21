// @vitest-environment happy-dom
import { createElement, Fragment, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { flowParents } from "../../server/team-flow/tree";
import type { TeamFlowsWire } from "../../shared/team-flow";
import type { Action, AppState, BotAnnouncement } from "@/state/store";

vi.mock("@/lib/interface-mode", async (original) => ({ ...await original<typeof import("@/lib/interface-mode")>(), useAdvancedMode: () => false }));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/map-computers", () => ({ useShowComputers: () => ({ show: false, loaded: true, choose: () => {} }), useMapComputers: () => ({ computers: [], frames: {} }) }));
vi.mock("./CanvasComputers", () => ({ CanvasComputers: () => null }));
vi.mock("./MapComposer", () => ({ MapComposer: () => null }));

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

const ENGINE = {
  instanceId: "fake", driverKind: "fake", displayName: "Fake", snapshot: { state: "available" },
  models: { default: "m", options: [{ id: "m", label: "Fake model" }] }, capabilities: { agentsMcp: true },
};
const make = (id: string, name: string, section: string, extra: Partial<BotAnnouncement> = {}): BotAnnouncement => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", notifications: true, unread: false, color: "green", section,
  modelSelection: { instanceId: "fake", model: "m" }, tasks: [{ threadId: `${id}-thread`, title: "Chat", createdAt: 1 }], messages: [], ...extra,
});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const { StoreProvider, useStore } = await import("@/state/store");
const { Sidebar } = await import("./Sidebar");
const { TeamMapPage } = await import("./TeamMapPage");

let seen!: AppState;
let dispatch!: Dispatch<Action>;
function Shell() {
  ({ state: seen, dispatch } = useStore());
  return createElement(Fragment, null,
    createElement(Sidebar, { open: true, onClose: () => {} }),
    seen.activeView === "team-map" ? createElement(TeamMapPage) : null);
}

let saved: Map<string, BotAnnouncement>;
let lines: Record<string, Record<string, string>>;
const teamOf = (section: string) => [...saved.values()].filter((bot) => !bot.hidden && !bot.defaultBot && (bot.section ?? "") === section);
const flows = (): TeamFlowsWire => ({
  readable: true,
  teams: [...new Set([...saved.values()].map((bot) => bot.section ?? ""))].flatMap((section) => {
    const chief = teamOf(section).find((bot) => bot.chiefOfStaff);
    if (!section || !chief) return [];
    const parents = flowParents(teamOf(section).map((bot) => bot.id), chief.id, lines[section] ?? {});
    return [{ section, chiefId: chief.id, parents, placed: Object.keys(parents).filter((id) => parents[id] !== chief.id) }];
  }),
});
const save = (id: string, patch: Partial<BotAnnouncement>) => {
  const bot = { ...saved.get(id)!, ...patch };
  if (patch.chiefOfStaff) for (const other of teamOf(bot.section ?? "")) if (other.chiefOfStaff) saved.set(other.id, { ...other, chiefOfStaff: false });
  saved.set(id, bot);
  return bot;
};

let root: Root;
let host: HTMLElement;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const all = (selector: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLElement>(selector)];
const named = (selector: string, text: string) => all(selector).find((element) => element.textContent?.trim() === text);
const click = async (element: HTMLElement | undefined) => {
  expect(element).toBeDefined();
  flushSync(() => element!.click());
  await settle();
};
const fromCard = async (botId: string, label: string) => {
  await click(all(`[data-card-actions="${botId}"]`)[0]);
  await click(all("[data-bot-menu-more]")[0]);
  await click(named('[data-bot-menu-flyout="more"] [role="menuitem"]', label));
};

/** Each department as the map draws it: its tile, and each card's place and superior in its tree. */
const drawn = () => all("[data-team-key]").map((team) => ({
  key: team.dataset.teamKey,
  tile: team.getAttribute("style"),
  cards: all("[data-bot-id]", team).map((card) => card.dataset.botId),
  places: all("[data-flow-card]", team).map((card) => `${card.dataset.flowCard} ${card.getAttribute("style")}`),
  lines: all("[data-flow-line]", team).map((line) => line.dataset.flowLine).sort(),
}));
const linesOf = (key: string) => drawn().find((team) => team.key === key)?.lines;
const STORYBOARD_LEADS = ["storyboard:director", "storyboard:writer", "writer:editor"];

const open = async () => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Shell))));
  await settle();
  FixtureEventSource.opened.at(-1)!.send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
  flushSync(() => dispatch({ type: "showTeamMap" }));
  await vi.waitFor(() => expect(linesOf("Promo")).toEqual(["lead:promoter"]));
};
const close = () => {
  flushSync(() => root.unmount());
  host.remove();
};
/** The same server data on a map opened afresh, as after a reload. */
const reloaded = async () => {
  close();
  await open();
  return drawn();
};

beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  saved = new Map([
    make("magic", "MagicBot", "", { defaultBot: {} } as never),
    make("lead", "Lead", "Promo", { chiefOfStaff: true }), make("promoter", "Promoter", "Promo"),
    make("director", "Director", "Story", { chiefOfStaff: true }), make("storyboard", "Storyboard", "Story"),
    make("writer", "Writer", "Story"), make("editor", "Editor", "Story"),
  ].map((bot) => [bot.id, bot]));
  lines = { Story: { editor: "writer" } };
  FixtureEventSource.opened = [];
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    const id = /^\/api\/bots\/([^/?]+)$/.exec(path)?.[1];
    if (id && init?.method === "PATCH") return json({ bot: save(id, JSON.parse(String(init.body))) });
    if (path.startsWith("/api/bots?")) return json({ bots: [...saved.values()], groups: [] });
    if (path === "/api/team-flows") return json(flows());
    if (path === "/api/team-map") return json({ collaborations: [], queued: [], running: [] });
    if (path === "/api/team-projects") return json({ root: null, projects: [] });
    if (path.startsWith("/api/instances")) return json({ instances: [ENGINE] });
    if (path.startsWith("/api/routines")) return json({ routines: [], runs: [] });
    if (path.startsWith("/api/webhooks")) return json({ webhooks: [], attempts: [] });
    return json({});
  });
});
afterEach(() => {
  close();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
});

it("roots a department's tree at the bot made Chief from its card, as a reload draws it, and moves no other department", async () => {
  await open();
  const before = drawn();
  expect(linesOf("Story")).toEqual(["director:storyboard", "director:writer", "writer:editor"]);
  await fromCard("storyboard", "Make Chief of Staff");
  await vi.waitFor(() => expect(saved.get("storyboard")?.chiefOfStaff).toBe(true));
  await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
  const live = drawn();
  expect(live.filter((team) => team.key !== "Story")).toEqual(before.filter((team) => team.key !== "Story"));
  expect(live).toEqual(await reloaded());
});

it("draws a department whose Chief was unset on its card as a reload draws a team without one", async () => {
  await open();
  await fromCard("director", "Remove Chief of Staff");
  await vi.waitFor(() => expect(saved.get("director")?.chiefOfStaff).toBe(false));
  await vi.waitFor(() => expect(all('[data-team-flow="Story"]')).toHaveLength(0));
  expect(drawn()).toEqual(await reloaded());
});

it("roots the tree at the Chief chosen from the department's ⋯ menu", async () => {
  await open();
  await click(named('[data-team-key="Story"] [data-team-menu] button', "Choose Chief of Staff"));
  await click(all('[data-chief-picker="Story"] [data-chief-choice="storyboard"]')[0]);
  await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
  expect(drawn()).toEqual(await reloaded());
});

it("roots the tree at the Chief chosen from a department's No Chief of Staff label", async () => {
  save("director", { chiefOfStaff: false });
  await open();
  expect(all('[data-team-flow="Story"]')).toHaveLength(0);
  await click(all('[data-team-key="Story"] [data-team-note="no_chief"]')[0]);
  await click(all('[data-chief-picker="Story"] [data-chief-choice="storyboard"]')[0]);
  await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
  expect(drawn()).toEqual(await reloaded());
});

it("roots the tree at a Chief chosen in another window, once the server says so", async () => {
  await open();
  const chief = save("storyboard", { chiefOfStaff: true });
  for (const bot of [chief, saved.get("director")!]) FixtureEventSource.opened.at(-1)!.send({ kind: "bot", bot });
  await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
  expect(drawn()).toEqual(await reloaded());
});
