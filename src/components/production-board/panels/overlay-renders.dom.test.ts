// @vitest-environment happy-dom
import { commitMark, commitsSince, renderMark, renderedSince } from "@/testing/render-counts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasSnapshot } from "../../../../shared/project-canvas";
import { setLocale } from "@/lib/i18n";
import type { BoardAnchor, BoardOverlayProps } from "@/lib/production-board/overlay";
import { dramaScaleSnapshot, fakeBackend, workspaceLooks } from "./testing/board-sample";
import { renderOverlay, type OverlayHarness } from "./testing/render-overlay";

const drawn = vi.hoisted(() => ({ episodeRows: 0 }));
// An episode's row asks for its progress words once each time it is drawn.
vi.mock("@/lib/production-board/asset-words", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/production-board/asset-words")>();
  return { ...original, episodeProgress: (...args: Parameters<typeof original.episodeProgress>) => { drawn.episodeRows++; return original.episodeProgress(...args); } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let harness: OverlayHarness | undefined;

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  setLocale("en");
});

const live = () => harness!;
const at = (x: number, y: number): BoardAnchor => ({ x, y, width: 320, height: 240 });
const chat = () => live().host.querySelector<HTMLElement>("[data-board-chat]")!;
const panel = () => live().host.querySelector<HTMLElement>("[data-board-side-panel]")!;
const tab = (name: string) => [...live().host.querySelectorAll<HTMLElement>("[role=tab]")].find((each) => each.textContent === name);
const row = (text: string) => [...panel().querySelectorAll<HTMLButtonElement>("[role=tabpanel] button")].find((each) => each.textContent?.includes(text))!;
const click = (element: HTMLElement) => act(async () => {
  element.click();
});
const sized = (element: HTMLElement, width: number, height: number) => {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
};
const namesSince = (mark: number) => renderedSince(mark).map((entry) => entry.component);
const times = (names: readonly string[], name: string) => names.filter((each) => each === name).length;
const DETAILS = new Set(["AssetDetails", "Preview", "Appearances", "Swatches", "ChatMarkdown"]);

async function atScale(overrides: Partial<BoardOverlayProps> = {}): Promise<OverlayHarness> {
  const snapshot = dramaScaleSnapshot();
  harness = await renderOverlay({ snapshot, ...overrides }, { width: 1440, height: 900 }, fakeBackend({ looks: workspaceLooks(snapshot, 301) }));
  return harness;
}

async function openChat(botId: string) {
  await live().update({ opened: { kind: "bot", botId } });
  await live().settle();
}

/** The server's next snapshot, all new objects as a read gives them, with `edit` made; answers what drew again. */
async function nextSnapshot(edit: (next: CanvasSnapshot) => void): Promise<string[]> {
  const next = JSON.parse(JSON.stringify(live().current().snapshot)) as CanvasSnapshot;
  edit(next);
  const mark = renderMark();
  await live().update({ snapshot: next });
  await live().settle();
  return namesSince(mark);
}

describe("the overlay over the owner's drama", () => {
  it("is measured against pb-bench's drama: 60 episodes, 126 bots in the project, 283 shots, 301 bots in the workspace", () => {
    const snapshot = dramaScaleSnapshot();
    expect(snapshot.production!.episodes).toHaveLength(60);
    expect(Object.keys(snapshot.bots)).toHaveLength(126);
    expect(snapshot.nodes.filter((node) => node.type === "shot")).toHaveLength(283);
    expect(snapshot.nodes).toHaveLength(1124);
    expect(Object.keys(workspaceLooks(snapshot, 301))).toHaveLength(301);
  });

  it("moves the chat window with the camera without drawing anything again", async () => {
    await atScale();
    live().anchors.set("bot:board-30", at(100, 200));
    await openChat("board-30");
    sized(chat(), 384, 520);
    await live().moveView();
    const mark = renderMark();
    const commits = commitMark();
    for (let step = 1; step <= 100; step += 1) {
      live().anchors.set("bot:board-30", at(100 + step, 200 + step));
      await live().moveView();
    }
    expect(namesSince(mark)).toEqual([]);
    expect(commitsSince(commits)).toBe(0);
    expect(chat().style.transform).toBe("translate(536px, 300px)");
  });

  it("lays the chat window out once for all the moves the board makes at once", async () => {
    const anchors = new Map<string, BoardAnchor>([["bot:board-30", at(100, 200)]]);
    const anchorOf = vi.fn((nodeId: string) => anchors.get(nodeId) ?? null);
    await atScale({ anchorOf });
    await openChat("board-30");
    sized(chat(), 384, 520);
    await live().nextFrame();
    anchorOf.mockClear();
    for (let step = 1; step <= 100; step += 1) {
      anchors.set("bot:board-30", at(100 + step, 200));
      live().tick();
    }
    expect(anchorOf).not.toHaveBeenCalled();
    await live().nextFrame();
    expect(anchorOf).toHaveBeenCalledTimes(1);
    expect(chat().style.transform).toBe("translate(536px, 200px)");
    await live().nextFrame();
    expect(anchorOf).toHaveBeenCalledTimes(1);
  });

  it("lays the chat window out in the frame the board moved in when the board glides in animation frames", async () => {
    await atScale();
    live().anchors.set("bot:board-30", at(100, 200));
    await openChat("board-30");
    sized(chat(), 384, 520);
    await live().moveView();
    let drawnInThatFrame = "";
    await act(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        live().anchors.set("bot:board-30", at(140, 200));
        live().tick();
        queueMicrotask(() => {
          drawnInThatFrame = chat().style.transform;
          resolve();
        });
      });
    }));
    expect(drawnInThatFrame).toBe("translate(476px, 200px)");
  });

  it("stops following the view when the chat window closes and when the overlay goes", async () => {
    const anchorOf = vi.fn(() => at(100, 200));
    await atScale({ anchorOf });
    expect(live().viewListeners()).toBe(0);
    await openChat("board-30");
    expect(live().viewListeners()).toBe(1);
    live().tick();
    await live().update({ opened: null });
    expect(live().viewListeners()).toBe(0);
    anchorOf.mockClear();
    await live().nextFrame();
    expect(anchorOf).not.toHaveBeenCalled();
    await openChat("board-31");
    expect(live().viewListeners()).toBe(1);
    const gone = live();
    gone.unmount();
    harness = undefined;
    expect(gone.viewListeners()).toBe(0);
  });

  it("draws nothing under it again when the board draws it again with new callbacks", async () => {
    await atScale();
    live().anchors.set("bot:board-30", at(100, 200));
    await openChat("board-30");
    sized(chat(), 384, 520);
    const { open, close, focusNode, focusEpisode, focusStage, anchorOf, subscribeView } = live().current();
    const mark = renderMark();
    await live().update({
      open: (what) => open(what),
      close: () => close(),
      focusNode: (nodeId) => focusNode(nodeId),
      focusEpisode: (episode) => focusEpisode(episode),
      focusStage: (stage) => focusStage(stage),
      anchorOf: (nodeId) => anchorOf(nodeId),
      subscribeView: (listener) => subscribeView(listener),
    });
    expect(namesSince(mark).filter((name) => name !== "ProductionBoardOverlay")).toEqual([]);
    expect(live().viewListeners()).toBe(1);
    live().anchors.set("bot:board-30", at(140, 220));
    await live().moveView();
    expect(chat().style.transform).toBe("translate(476px, 220px)");
  });

  it("draws only the row of the bot whose status changed, on whichever tab is shown", async () => {
    await atScale();
    let names = await nextSnapshot((next) => {
      next.bots["board-30"]!.status = "working";
    });
    expect(times(names, "TeamRow")).toBe(1);
    expect(row("镜川 EP30").textContent).toContain("Working");

    await click(tab("Assets")!);
    names = await nextSnapshot((next) => {
      next.bots["board-31"]!.status = "working";
    });
    expect(names.filter((name) => name === "AssetRow" || name === "EpisodeShots")).toEqual([]);

    await click(tab("Episodes")!);
    const before = drawn.episodeRows;
    names = await nextSnapshot((next) => {
      next.bots["board-32"]!.status = "working";
    });
    expect(drawn.episodeRows - before).toBe(0);
    expect(names.filter((name) => name === "EpisodesTab")).toEqual([]);
  });

  it("draws only the rows of the episode whose shot changed", async () => {
    await atScale();
    await click(tab("Episodes")!);
    const before = drawn.episodeRows;
    await nextSnapshot((next) => {
      next.production!.episodes[29]!.ready = 4;
    });
    expect(drawn.episodeRows - before).toBe(1);
    expect(row("EP30").textContent).toContain("4/5 selected");

    await click(tab("Assets")!);
    await click(row("EP30"));
    const names = await nextSnapshot((next) => {
      next.nodes.find((node) => node.id === "shot-31-2")!.title = "新的船影";
    });
    expect(names.filter((name) => name === "AssetRow")).toEqual([]);
    expect(times(names, "EpisodeShots")).toBe(0);
  });

  it("draws no shot row for a folded episode", async () => {
    await atScale();
    await click(tab("Assets")!);
    expect(panel().querySelectorAll("[role=tabpanel] button[aria-expanded]")).toHaveLength(60);
    expect(panel().querySelectorAll("[role=tabpanel] ul[hidden] li")).toHaveLength(0);
    await click(row("EP07"));
    expect(row("EP07").nextElementSibling!.querySelectorAll("li")).toHaveLength(5);
  });

  it("keeps the open details as they are when the snapshot changes elsewhere, and shows a change to them", async () => {
    await atScale();
    await live().update({ opened: { kind: "asset", nodeId: "group-qingwu" } });
    await live().settle();
    let names = await nextSnapshot((next) => {
      next.bots["board-30"]!.status = "working";
      next.nodes.find((node) => node.id === "shot-31-2")!.title = "新的船影";
    });
    expect(names.filter((name) => DETAILS.has(name))).toEqual([]);
    names = await nextSnapshot((next) => {
      next.nodes.find((node) => node.id === "profile-qingwu")!.metadata!.card!.subtitle = "18 岁 · 灯铺传人";
    });
    expect(times(names, "AssetDetails")).toBe(1);
    expect(document.querySelector("[data-board-asset]")!.textContent).toContain("18 岁 · 灯铺传人");
  });

  it("draws nothing under it again for a snapshot that changes nothing it shows, nor for a look of a bot outside the project", async () => {
    const snapshot = dramaScaleSnapshot();
    const looks = workspaceLooks(snapshot, 301);
    harness = await renderOverlay({ snapshot }, { width: 1440, height: 900 }, fakeBackend({ looks }));
    looks["elsewhere-5"] = { color: "green", unread: true };
    const names = await nextSnapshot(() => undefined);
    expect(names.filter((name) => name !== "ProductionBoardOverlay")).toEqual([]);
  });

  it("draws its rows again in a new language", async () => {
    await atScale();
    setLocale("zh");
    await live().update({});
    expect(tab("团队")).toBeDefined();
    expect(row("镜川 EP30").textContent).toContain("空闲");
  });
});
