// @vitest-environment happy-dom
import { createElement, Fragment, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  stageLines, type FlowLineWire, type FlowStage, type TeamPipelineLineInput, type TeamPipelineRejudgeResult, type TeamPipelineRestoreInput, type TeamPipelinesWire,
} from "../../shared/team-pipeline";
import { t } from "@/lib/i18n";
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
/** What the server holds of the pipelines: each member's judged stages, who is still to be judged, and what the person set by hand. */
let stages: Record<string, FlowStage[]>;
let pending: Set<string>;
let hand: { manual: string[]; added: FlowLineWire[]; removed: FlowLineWire[] };
let refusal: { status: number; body: Record<string, unknown> } | null;
let asked: Array<{ path: string; method: string; body: unknown }>;
const teamOf = (section: string) => [...saved.values()].filter((bot) => !bot.hidden && !bot.defaultBot && (bot.section ?? "") === section);
const sameLine = (a: FlowLineWire) => (b: FlowLineWire) => a.from === b.from && a.to === b.to;
const pipelines = (): TeamPipelinesWire => ({
  readable: true,
  teams: [...new Set([...saved.values()].map((bot) => bot.section ?? ""))].flatMap((section) => {
    const chief = teamOf(section).find((bot) => bot.chiefOfStaff);
    if (!section || !chief) return [];
    const members = teamOf(section).map((bot) => bot.id);
    const own = Object.fromEntries(members.map((id): [string, FlowStage[]] => [id, id === chief.id ? ["lead"] : pending.has(id) ? ["other"] : stages[id] ?? ["other"]]));
    const within = (line: FlowLineWire) => members.includes(line.from) && members.includes(line.to);
    return [{
      section, chiefId: chief.id, stages: own, pending: members.filter((id) => pending.has(id)), manual: members.filter((id) => hand.manual.includes(id)),
      lines: [...stageLines(chief.id, members, own).filter((line) => !hand.removed.some(sameLine(line))), ...hand.added.filter(within)],
    }];
  }),
});
const setLine = ({ from, to, present }: TeamPipelineLineInput) => {
  const line = { from, to };
  hand = {
    manual: [...new Set([...hand.manual, from, to])],
    added: present ? [...hand.added, line] : hand.added.filter((one) => !sameLine(line)(one)),
    removed: present ? hand.removed.filter((one) => !sameLine(line)(one)) : [...hand.removed, line],
  };
};
const rejudge = (section: string): TeamPipelineRejudgeResult => {
  const undo: TeamPipelineRestoreInput = { section, state: hand };
  hand = { manual: [], added: [], removed: [] };
  for (const bot of teamOf(section)) if (!bot.chiefOfStaff) pending.add(bot.id);
  return { pipelines: pipelines(), undo };
};
const restore = (undo: TeamPipelineRestoreInput) => {
  hand = undo.state as typeof hand;
  for (const bot of teamOf(undo.section)) pending.delete(bot.id);
};
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
const labelled = (label: string) => all("[aria-label]").find((element) => element.getAttribute("aria-label") === label);
const click = async (element: Element | undefined) => {
  expect(element).toBeDefined();
  flushSync(() => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
};
const fromCard = async (botId: string, label: string) => {
  await click(all(`[data-card-actions="${botId}"]`)[0]);
  await click(all("[data-bot-menu-more]")[0]);
  await click(named('[data-bot-menu-flyout="more"] [role="menuitem"]', label));
};

/** Each department as the map draws it: its tile, and each card's place and column in its pipeline. */
const drawn = () => all("[data-team-key]").map((team) => ({
  key: team.dataset.teamKey,
  tile: team.getAttribute("style"),
  cards: all("[data-bot-id]", team).map((card) => card.dataset.botId),
  places: all("[data-pipeline-card]", team).map((card) => `${card.dataset.pipelineCard} ${card.dataset.column} ${card.getAttribute("style")}`),
  lines: all("[data-pipeline-line]", team).map((line) => line.dataset.pipelineLine).sort(),
}));
const linesOf = (key: string) => drawn().find((team) => team.key === key)?.lines;
const placeOf = (botId: string) => {
  const card = all(`[data-pipeline-card="${botId}"]`)[0]!;
  return { column: card.dataset.column, left: parseFloat(card.style.left), top: parseFloat(card.style.top) };
};
const noteOf = (botId: string) => all(`[data-bot-id="${botId}"] [data-pipeline-note] > *`).map((part) => part.textContent?.trim());
const sentTo = (path: string) => asked.filter((request) => request.path === path).map((request) => request.body);
const STORYBOARD_LEADS = ["storyboard:director", "storyboard:writer", "writer:editor"];
const DRAMA = ["mobai:qinghe", "yanqing:mobai", "yunzhou:yanqing"];

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
    make("yunzhou", "云舟", "Drama", { chiefOfStaff: true }), make("yanqing", "砚青", "Drama"), make("mobai", "墨白", "Drama"), make("qinghe", "青禾", "Drama"),
  ].map((bot) => [bot.id, bot]));
  stages = { writer: ["script"], editor: ["post"], yanqing: ["script"], mobai: ["character", "storyboard"], qinghe: ["post"] };
  pending = new Set();
  hand = { manual: [], added: [], removed: [] };
  refusal = null;
  asked = [];
  FixtureEventSource.opened = [];
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", sent = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ path, method, body: sent });
    const id = /^\/api\/bots\/([^/?]+)$/.exec(path)?.[1];
    if (id && method === "PATCH") return json({ bot: save(id, sent) });
    if (path.startsWith("/api/bots?")) return json({ bots: [...saved.values()], groups: [] });
    if (path === "/api/team-pipelines" && method === "GET") return json(pipelines());
    if (path === "/api/team-pipelines/line" && method === "PUT") {
      if (refusal) return json(refusal.body, refusal.status);
      setLine(sent);
      return json(pipelines());
    }
    if (path === "/api/team-pipelines/rejudge" && method === "POST") return json(rejudge(sent.section));
    if (path === "/api/team-pipelines/restore" && method === "PUT") { restore(sent); return json(pipelines()); }
    if (path === "/.well-known/openmausbot/environment") return json({ environmentId: "pipeline-test" });
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
  localStorage.clear();
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
});

describe("who leads a department's pipeline", () => {
  it("is the bot made Chief from its card, as a reload draws it, and no other department moves", async () => {
    await open();
    const before = drawn();
    expect(linesOf("Story")).toEqual(["director:storyboard", "director:writer", "writer:editor"]);
    await fromCard("storyboard", "Make Chief of Staff");
    await vi.waitFor(() => expect(saved.get("storyboard")?.chiefOfStaff).toBe(true));
    await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
    expect(placeOf("storyboard").column).toBe("lead");
    expect(placeOf("director").column).toBe("other");
    const live = drawn();
    expect(live.filter((team) => team.key !== "Story")).toEqual(before.filter((team) => team.key !== "Story"));
    expect(live).toEqual(await reloaded());
  });

  it("is nobody once the Chief is unset on its card: the department is drawn as a reload draws a team without one", async () => {
    await open();
    await fromCard("director", "Remove Chief of Staff");
    await vi.waitFor(() => expect(saved.get("director")?.chiefOfStaff).toBe(false));
    await vi.waitFor(() => expect(all('[data-team-pipeline="Story"]')).toHaveLength(0));
    expect(all('[data-team-key="Story"] [data-pipeline-rejudge]')).toHaveLength(0);
    expect(drawn()).toEqual(await reloaded());
  });

  it("is the Chief chosen from the department's ⋯ menu", async () => {
    await open();
    await click(named('[data-team-key="Story"] [data-team-menu] button', "Choose Chief of Staff"));
    await click(all('[data-chief-picker="Story"] [data-chief-choice="storyboard"]')[0]);
    await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
    expect(drawn()).toEqual(await reloaded());
  });

  it("is the Chief chosen from a department's No Chief of Staff label", async () => {
    save("director", { chiefOfStaff: false });
    await open();
    expect(all('[data-team-pipeline="Story"]')).toHaveLength(0);
    await click(all('[data-team-key="Story"] [data-team-note="no_chief"]')[0]);
    await click(all('[data-chief-picker="Story"] [data-chief-choice="storyboard"]')[0]);
    await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
    expect(drawn()).toEqual(await reloaded());
  });

  it("is a Chief chosen in another window, once the server says so", async () => {
    await open();
    const chief = save("storyboard", { chiefOfStaff: true });
    for (const bot of [chief, saved.get("director")!]) FixtureEventSource.opened.at(-1)!.send({ kind: "bot", bot });
    await vi.waitFor(() => expect(linesOf("Story")).toEqual(STORYBOARD_LEADS));
    expect(drawn()).toEqual(await reloaded());
  });
});

describe("a team's pipeline on the team map", () => {
  it("stands a drama team's cards in stage columns from the lead to post, each card saying its stages under its role", async () => {
    await open();
    expect(linesOf("Drama")).toEqual(DRAMA);
    expect(["yunzhou", "yanqing", "mobai", "qinghe"].map((id) => placeOf(id).column)).toEqual(["lead", "script", "character", "post"]);
    const lefts = ["yunzhou", "yanqing", "mobai", "qinghe"].map((id) => placeOf(id).left);
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    expect(new Set(lefts).size).toBe(4);
    expect(new Set(["yunzhou", "yanqing", "mobai", "qinghe"].map((id) => placeOf(id).top)).size).toBe(1);
    expect(noteOf("yunzhou")).toEqual(["Lead"]);
    expect(noteOf("mobai")).toEqual(["Characters · Storyboard"]);
    expect(noteOf("promoter")).toEqual([]);
    const tile = all('[data-team-key="Drama"]')[0]!;
    expect(parseFloat(tile.style.width)).toBe(placeOf("qinghe").left + 236 + 20);
  });

  it("adds a line from a card's dot and marks both of its ends as set by hand", async () => {
    await open();
    await click(labelled("Draw a line from 云舟"));
    await click(named('[role="menu"] [role="menuitemcheckbox"]', "青禾"));
    expect(sentTo("/api/team-pipelines/line")).toEqual([{ from: "yunzhou", to: "qinghe", present: true }]);
    expect(linesOf("Drama")).toEqual([...DRAMA, "yunzhou:qinghe"].sort());
    expect(all('[data-pipeline-line$=":qinghe"]')).toHaveLength(2);
    expect(noteOf("yunzhou")).toEqual(["Lead", "By hand"]);
    expect(noteOf("qinghe")).toEqual(["Post", "By hand"]);
    expect(noteOf("yanqing")).toEqual(["Script"]);
  });

  it("removes the line the person selected", async () => {
    await open();
    await click(labelled("Line from 砚青 to 墨白"));
    await click(labelled("Remove the line from 砚青 to 墨白"));
    expect(sentTo("/api/team-pipelines/line")).toEqual([{ from: "yanqing", to: "mobai", present: false }]);
    expect(linesOf("Drama")).toEqual(DRAMA.filter((line) => line !== "yanqing:mobai"));
    expect(noteOf("mobai")).toEqual(["Characters · Storyboard", "By hand"]);
  });

  it("says why the server refused a line, in the server's words, and leaves the lines as they were", async () => {
    refusal = { status: 409, body: { error: "A loop.", errorKey: "serverError.teamFlow.loop", errorParams: { bot: "砚青", superior: "墨白" } } };
    await open();
    await click(labelled("Draw a line from 墨白"));
    await click(named('[role="menu"] [role="menuitemcheckbox"]', "砚青"));
    const alert = all('[data-team-key="Drama"] [role="alert"]')[0]!;
    expect(alert.textContent).toBe(t("serverError.teamFlow.loop", { bot: "砚青", superior: "墨白" }));
    expect(alert.style.left).toBe(all('[data-pipeline-card="mobai"]')[0]!.style.left);
    expect(linesOf("Drama")).toEqual(DRAMA);
    expect(noteOf("mobai")).toEqual(["Characters · Storyboard"]);
  });

  it("judges a team again from its menu without asking, and Undo puts back what the person had set by hand", async () => {
    await open();
    await click(labelled("Draw a line from 云舟"));
    await click(named('[role="menu"] [role="menuitemcheckbox"]', "青禾"));
    const byHand = drawn();

    await click(named('[data-team-key="Drama"] [data-team-menu] button', "Judge again"));
    expect(sentTo("/api/team-pipelines/rejudge")).toEqual([{ section: "Drama" }]);
    expect(all('[role="alertdialog"], [role="dialog"]')).toHaveLength(0);
    expect(["yanqing", "mobai", "qinghe"].map(noteOf)).toEqual([["Being placed…"], ["Being placed…"], ["Being placed…"]]);
    expect(["yanqing", "mobai", "qinghe"].map((id) => placeOf(id).column)).toEqual(["other", "other", "other"]);
    expect(noteOf("yunzhou")).toEqual(["Lead"]);
    const toast = all("[data-access-toast]")[0]!;
    expect(toast.textContent).toBe("Judging Drama again. Lines you changed by hand were cleared.Undo");

    await click(named("[data-access-toast] button", "Undo"));
    expect(sentTo("/api/team-pipelines/restore")).toEqual([{ section: "Drama", state: { manual: ["yunzhou", "qinghe"], added: [{ from: "yunzhou", to: "qinghe" }], removed: [] } }]);
    await vi.waitFor(() => expect(drawn()).toEqual(byHand));
    expect(all("[data-access-toast]")).toHaveLength(0);
  });

  it("says in the map's status line why a team could not be judged again", async () => {
    await open();
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => path === "/api/team-pipelines/rejudge"
      ? json({ error: "The pipelines couldn't be read, so nothing was changed." }, 503) : real(path, init));
    await click(named('[data-team-key="Drama"] [data-team-menu] button', "Judge again"));
    expect(all("[data-canvas-status]")[0]!.textContent).toBe("The pipelines couldn't be read, so nothing was changed.");
    expect(all("[data-access-toast]")).toHaveLength(0);
    expect(linesOf("Drama")).toEqual(DRAMA);
  });

  describe("a card the person moved", () => {
    const pointer = (type: string, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 30, clientY: y }), { pointerId: 1, isPrimary: true });

    it("stays where they put it in its column from the keyboard, moves no other card, and is there after a reload", async () => {
      stages = { ...stages, storyboard: ["script"], editor: ["script"], writer: ["post"] };
      await open();
      expect([placeOf("storyboard"), placeOf("editor")].map((place) => place.column)).toEqual(["script", "script"]);
      expect(placeOf("storyboard").top).toBeLessThan(placeOf("editor").top);
      const writer = placeOf("writer");
      flushSync(() => { all('[data-bot-id="editor"]')[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true })); });
      await settle();
      expect(placeOf("editor").top).toBeLessThan(placeOf("storyboard").top);
      expect(placeOf("editor").left).toBe(placeOf("storyboard").left);
      expect(placeOf("writer")).toEqual(writer);
      expect(JSON.parse(localStorage.getItem("omb-team-canvas:pipeline-test:bot-order")!).Story).toEqual(["editor", "storyboard", "writer", "director"]);
      const moved = drawn();
      expect(await reloaded()).toEqual(moved);
    });

    it("goes where they drop it among the cards of its column, whatever stands at that height in another column", async () => {
      saved.set("extra", make("extra", "Extra", "Story"));
      stages = { ...stages, writer: ["script"], editor: ["script"], extra: ["script"] };
      await open();
      expect(["storyboard", "writer", "editor", "extra"].map((id) => [placeOf(id).column, (placeOf(id).top - 64) / 142]))
        .toEqual([["other", 1], ["script", 0], ["script", 1], ["script", 2]]);
      for (const card of all('[data-team-key="Story"] [data-pipeline-card]')) {
        const top = parseFloat(card.style.top);
        card.querySelector("article")!.getBoundingClientRect = () => ({ top, height: 126, left: 0, width: 236, bottom: top + 126, right: 236, x: 0, y: top }) as DOMRect;
      }
      const map = all("[data-team-canvas]")[0]!;
      Object.assign(map, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
      Object.assign(document, { elementFromPoint: () => all('[data-team-key="Story"]')[0] });
      const between = placeOf("editor").top + 10;
      flushSync(() => { all('[data-bot-id="extra"]')[0]!.dispatchEvent(pointer("pointerdown", placeOf("extra").top + 60)); });
      flushSync(() => { map.dispatchEvent(pointer("pointermove", between)); });
      flushSync(() => { map.dispatchEvent(pointer("pointerup", between)); });
      await settle();
      expect(["writer", "extra", "editor"].map((id) => (placeOf(id).top - 64) / 142)).toEqual([0, 1, 2]);
      expect(placeOf("storyboard")).toMatchObject({ column: "other", top: 64 + 142 });
      expect(all("[data-canvas-status]")[0]!.textContent).toBe("Extra arranged in Story. Department membership is unchanged.");
    });
  });
});
