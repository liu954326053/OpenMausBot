// @vitest-environment happy-dom
import { createElement, Fragment, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

const make = (id: string, name: string, extra: Partial<BotAnnouncement> = {}): BotAnnouncement => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", notifications: true, unread: false, color: "green",
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
    seen.activeView === "team-map" ? createElement(TeamMapPage) : createElement("main", { "data-chat-of": seen.selectedId }));
}

let root: Root;
let host: HTMLElement;
let saved: Map<string, BotAnnouncement>;
let created: number;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const all = (selector: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLElement>(selector)];
const named = (selector: string, text: string) => all(selector).find((element) => element.textContent?.trim() === text);
const story = () => all('[data-team-key="Story"] [data-bot-id]').map((card) => card.dataset.botId);
const mapShown = () => named("h1", "Team map") !== undefined && all("[data-chat-of]").length === 0;
const click = async (element: HTMLElement | undefined) => {
  expect(element).toBeDefined();
  flushSync(() => element!.click());
  await settle();
};
const choose = (label: string) => click(named('[data-bot-menu] [role="menuitem"]', label));
const confirmArchive = () => click(all('[role="alertdialog"] button').find((button) => button.textContent === "Archive"));
const undo = () => click(named('[role="status"] button', "Undo"));

beforeEach(async () => {
  document.documentElement.dataset.reducedMotion = "true";
  saved = new Map([
    make("magic", "MagicBot", { defaultBot: {} } as never), make("director", "Director", { section: "Story" }),
    make("storyboard", "Storyboard", { section: "Story" }), make("writer", "Writer", { section: "Story" }),
  ].map((bot) => [bot.id, bot]));
  created = 0;
  FixtureEventSource.opened = [];
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const id = /^\/api\/bots\/([^/?]+)$/.exec(path)?.[1];
    if (id && init?.method === "PATCH") {
      const bot = { ...saved.get(id)!, ...body };
      saved.set(id, bot);
      return json({ bot });
    }
    if (path === "/api/bots" && init?.method === "POST") {
      const bot = make(`copy-${++created}`, "Copy");
      saved.set(bot.id, bot);
      return json({ bot }, 201);
    }
    if (path.startsWith("/api/bots?")) return json({ bots: [...saved.values()], groups: [] });
    if (path === "/api/team-map") return json({ collaborations: [], queued: [], running: [] });
    if (path === "/api/team-flows") return json({ teams: [] });
    if (path === "/api/instances") return json({ instances: [] });
    if (path.startsWith("/api/routines")) return json({ routines: [], runs: [] });
    if (path.startsWith("/api/webhooks")) return json({ webhooks: [], attempts: [] });
    return json({});
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Shell))));
  await settle();
  FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
  expect(seen.bots).toHaveLength(4);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
});

const showMap = async (afterChatOf?: string) => {
  if (afterChatOf) flushSync(() => dispatch({ type: "select", id: afterChatOf }));
  flushSync(() => dispatch({ type: "showTeamMap" }));
  await settle();
  expect(mapShown()).toBe(true);
  expect(story()).toEqual(["director", "storyboard", "writer"]);
};

it("archives a bot from its card's ⋯ and, on Undo, puts its card back in its place with the team map still shown", async () => {
  await showMap();
  await click(all('[data-card-actions="storyboard"]')[0]);
  await choose("Archive");
  await confirmArchive();
  expect(story()).toEqual(["director", "writer"]);
  expect(named('[role="status"] span', "Storyboard archived")).toBeDefined();
  await undo();
  expect(mapShown()).toBe(true);
  expect(story()).toEqual(["director", "storyboard", "writer"]);
  expect(named('[role="status"] span', "Storyboard restored")).toBeDefined();
});

it("stays on the team map when the bot archived from a right-click is the one whose chat was open, and on its Undo", async () => {
  await showMap("storyboard");
  const card = all('[data-bot-id="storyboard"]')[0]!;
  flushSync(() => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 80 })));
  await settle();
  await choose("Archive");
  await confirmArchive();
  expect(mapShown()).toBe(true);
  expect(story()).toEqual(["director", "writer"]);
  await undo();
  expect(mapShown()).toBe(true);
  expect(story()).toEqual(["director", "storyboard", "writer"]);
});

it("adds a copy made from a card to the map without opening it", async () => {
  await showMap("writer");
  await click(all('[data-card-actions="storyboard"]')[0]);
  await click(all("[data-bot-menu-more]")[0]);
  await click(named('[data-bot-menu-flyout="more"] [role="menuitem"]', "Duplicate"));
  await vi.waitFor(() => expect(all('[data-bot-id="copy-1"]')).toHaveLength(1));
  expect(mapShown()).toBe(true);
  expect(seen.selectedId).toBe("writer");
});
