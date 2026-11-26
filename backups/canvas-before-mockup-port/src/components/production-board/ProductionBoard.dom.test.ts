// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botNodeId, type CanvasSnapshot } from "../../../shared/project-canvas";
import { setLocale } from "@/lib/i18n";
import { buildBoard } from "@/lib/production-board/board";
import { FAR_ZOOM, fitRect, intersects, toScreen, visibleRect, type BoardView } from "@/lib/production-board/camera";
import { layoutBoard, type BoardRect } from "@/lib/production-board/layout";
import type { BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import {
  BOARD_BOTS,
  boarderOf,
  editorOf,
  PRODUCTION_BOARD_LOOKS,
  productionBoardBackend,
  productionBoardSample,
  SAMPLE_FAILED_EPISODE,
  SAMPLE_GENERATING_SHOT,
} from "@/testing/production-board-sample";
import { cardSize } from "./board/card-view";
import { ProductionBoard, type BoardHost } from "./ProductionBoard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let size = { width: 1280, height: 800 };
const observers = new Set<SizedObserver>();

class SizedObserver {
  private target: Element | null = null;
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.target = target;
    observers.add(this);
    this.report();
  }
  report() {
    const element = this.target as HTMLElement | null;
    const width = element && "clientWidth" in element && element.clientWidth ? element.clientWidth : size.width;
    const height = element && "clientHeight" in element && element.clientHeight ? element.clientHeight : size.height;
    this.callback([{ target: this.target, contentRect: { x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this);
  }
}

async function resizeBoard(width: number) {
  size = { ...size, width };
  await act(async () => { for (const observer of observers) observer.report(); });
  await settle();
}

let root: Root;
let page: HTMLElement;
let mounts = 0;
let overlay: BoardOverlayProps | null = null;
const onOpened = vi.fn<(next: BoardOpened | null) => void>();
const host = {
  fileUrl: vi.fn<BoardHost["fileUrl"]>((file) => `/files/${file.path}`),
  move: vi.fn<BoardHost["move"]>(),
  generate: vi.fn<BoardHost["generate"]>(async () => {}),
  selectTake: vi.fn<BoardHost["selectTake"]>(async () => {}),
  retry: vi.fn<BoardHost["retry"]>(async () => {}),
  openDraft: vi.fn<BoardHost["openDraft"]>(async () => {}),
};

function RecordOverlay(props: BoardOverlayProps) {
  overlay = props;
  return null;
}

interface Mounted {
  snapshot: CanvasSnapshot;
  focusBotId?: string;
}

function Board({ projectId, snapshot, focusBotId }: Mounted & { projectId: string }) {
  const [opened, setOpened] = useState<BoardOpened | null>(null);
  return createElement(ProductionBoard, {
    projectId,
    snapshot,
    backend: productionBoardBackend({ episodes: 1 }),
    looks: PRODUCTION_BOARD_LOOKS,
    host,
    opened,
    onOpenedChange: (next: BoardOpened | null) => {
      onOpened(next);
      setOpened(next);
    },
    overlay: RecordOverlay,
    ...(focusBotId ? { focusBotId } : {}),
  });
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const stage = () => page.querySelector<HTMLElement>("[data-production-board]")!;
const cardElement = (id: string) => page.querySelector<HTMLElement>(`[data-board-card-id="${id}"]`);
const drawnIds = () => [...page.querySelectorAll<HTMLElement>("[data-board-card-id]")].map((one) => one.dataset.boardCardId!);
const edge = (id: string) => page.querySelector<SVGGElement>(`[data-board-edge="${id}"]`);
const buttonNamed = (scope: ParentNode, name: string) =>
  [...scope.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name);
const minimap = () => page.querySelector<HTMLElement>("[data-board-minimap]");
const minimapButton = () => buttonNamed(page, "Minimap")!;
const toolbar = () => page.querySelector<HTMLElement>("[data-board-toolbar]")!;
const hint = () => page.querySelector<HTMLElement>("[data-board-hint]");
const layoutOf = (snapshot: CanvasSnapshot, opened: number[] = []) => layoutBoard(buildBoard(snapshot, { opened: new Set(opened) }), cardSize);

function view(): BoardView {
  const world = page.querySelector<HTMLElement>("[data-board-world]")!;
  const [, x, y, k] = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(world.style.transform)!;
  return { x: Number(x), y: Number(y), k: Number(k) };
}

async function mount(mounted: Mounted) {
  const projectId = `board-${(mounts += 1)}`;
  await act(async () => root.render(createElement(Board, { projectId, ...mounted })));
  await settle();
  return {
    rerender: async (next: Mounted) => {
      await act(async () => root.render(createElement(Board, { projectId, ...next })));
      await settle();
    },
  };
}

function BoardWithOverlay({ projectId, snapshot, overlay }: Mounted & { projectId: string; overlay: ComponentType<BoardOverlayProps> }) {
  const [opened, setOpened] = useState<BoardOpened | null>(null);
  return createElement(ProductionBoard, {
    projectId,
    snapshot,
    backend: productionBoardBackend({ episodes: 1 }),
    looks: PRODUCTION_BOARD_LOOKS,
    host,
    opened,
    onOpenedChange: (next: BoardOpened | null) => {
      onOpened(next);
      setOpened(next);
    },
    overlay,
  });
}

async function mountWithOverlay(snapshot: CanvasSnapshot, overlay: ComponentType<BoardOverlayProps>) {
  const projectId = `board-${(mounts += 1)}`;
  await act(async () => root.render(createElement(BoardWithOverlay, { projectId, snapshot, overlay })));
  await settle();
}

/** A viewport the whole board fits in at full size, so every card and line is drawn once the board is fitted. */
async function mountWhole(snapshot: CanvasSnapshot) {
  const { bounds } = layoutOf(snapshot);
  size = { width: Math.ceil(bounds.width) + 400, height: Math.ceil(bounds.height) + 400 };
  const mounted = await mount({ snapshot });
  await key("0");
  return mounted;
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}

async function key(name: string) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  await settle();
}

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, clientX, clientY })); });
}

const stageBar = () => page.querySelector<HTMLElement>("[data-board-stage-form]")!;
const stageSurface = () => page.querySelector<HTMLElement>("[data-stage-surface]")!;
const stageForm = () => stageBar().dataset.boardStageForm!;
const activeStages = () => [...page.querySelectorAll<HTMLElement>(`[data-stage-list="${stageForm()}"] [data-board-stage]`)];
const stageNames = () => activeStages().map((one) => one.dataset.boardStage!);
/** How a browser lays the bar out: the board's width the bar spans, and how wide the full bar asks to be. */
const layOutBar = (board: number, full: number) => {
  Object.defineProperty(stageBar(), "clientWidth", { configurable: true, get: () => board });
  Object.defineProperty(stageBar(), "clientHeight", { configurable: true, get: () => 36 });
  Object.defineProperty(page.querySelector('[data-stage-list="full"]')!, "scrollWidth", { configurable: true, get: () => full });
};

/** The side panel as the overlay marks it: the visible room reports its width, the hidden one nothing. */
function RoomPanel() {
  const [open, setOpen] = useState(true);
  const place = (element: HTMLElement | null, width: number) => {
    if (!element) return;
    element.getBoundingClientRect = () => ({ x: 600 - width, y: 16, left: 600 - width, top: 16, width, height: width ? 300 : 0, right: 600, bottom: 316, toJSON: () => ({}) });
  };
  return createElement(
    "div",
    null,
    createElement(
      "aside",
      { "data-board-room": "", hidden: !open, ref: (element: HTMLElement | null) => place(element, open ? 304 : 0) },
      open ? createElement("button", { type: "button", "aria-label": "Hide side panel", onClick: () => setOpen(false) }) : null,
    ),
    createElement("button", {
      type: "button",
      "data-board-room": "",
      hidden: open,
      "aria-label": "Show side panel",
      ref: (element: HTMLElement | null) => place(element, open ? 0 : 68),
      onClick: () => setOpen(true),
    }),
  );
}

const onScreen = (rect: BoardRect) => {
  const screen = toScreen(rect, view());
  return screen.x >= 0 && screen.y >= 0 && screen.x + screen.width <= size.width && screen.y + screen.height <= size.height;
};

beforeEach(() => {
  setLocale("en");
  size = { width: 1280, height: 800 };
  overlay = null;
  vi.stubGlobal("ResizeObserver", SizedObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} }));
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(async () => {
  await act(async () => root.unmount());
  page.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the production board", () => {
  it("opens on the brief and the writer, says how far each stage got, and draws only the cards near the screen", async () => {
    const snapshot = productionBoardSample();
    await mount({ snapshot });
    const layout = layoutOf(snapshot);
    expect(onScreen(layout.rects.get("brief")!)).toBe(true);
    expect(onScreen(layout.rects.get(botNodeId(BOARD_BOTS.writer))!)).toBe(true);
    const stages = [...page.querySelectorAll<HTMLElement>("[data-board-stage]")].map((one) => [one.dataset.boardStage, one.dataset.stageState]);
    expect(stages).toEqual([["brief", "done"], ["script", "done"], ["library", "done"], ["storyboard", "failed"], ["post", "active"]]);

    const near = visibleRect(view(), size, 480);
    const drawn = drawnIds().sort();
    expect(drawn.length).toBeLessThan(layout.rects.size);
    expect(drawn).toEqual([...layout.rects].filter(([, rect]) => intersects(rect, near)).map(([id]) => id).sort());
  });

  it("goes to a stage chosen in the stage bar or by its number, and fits the whole board on 0", async () => {
    const snapshot = productionBoardSample({ episodes: 12 });
    await mount({ snapshot });
    const layout = layoutOf(snapshot);
    await click(page.querySelector('[data-board-stage="storyboard"]'));
    expect(view()).toEqual(fitRect(layout.stages.storyboard!, size, { minZoom: 0.12, maxZoom: 1 }));
    await key("1");
    expect(view()).toEqual(fitRect(layout.stages.brief!, size, { minZoom: 0.12, maxZoom: 1 }));
    await key("0");
    expect(view()).toEqual(fitRect(layout.bounds, size, { maxZoom: 1 }));
  });

  it("folds the episodes that wait into one stack, unfolds one chosen from its menu, and folds it back", async () => {
    const snapshot = productionBoardSample({ episodes: 12 });
    await mountWhole(snapshot);
    expect(drawnIds()).toEqual(expect.arrayContaining(["ep1", "ep2", "ep3", "stack"]));
    expect(cardElement("ep7")).toBeNull();

    await click(cardElement("stack")!.querySelector("article"));
    const items = [...page.querySelectorAll<HTMLElement>("[data-board-stack-menu] [data-board-stack-episode]")];
    expect(items.map((item) => [item.dataset.boardStackEpisode, item.getAttribute("aria-checked")])).toEqual(
      [4, 5, 6, 7, 8, 9, 10, 11, 12].map((episode) => [String(episode), "false"]),
    );
    await click(items[3]);
    expect(page.querySelector("[data-board-stack-menu]")).toBeNull();
    expect(cardElement("ep7")).not.toBeNull();
    expect(onScreen(layoutOf(snapshot, [7]).rects.get("ep7")!)).toBe(true);

    await key("0");
    await click(cardElement("stack")!.querySelector("article"));
    const seventh = page.querySelector<HTMLElement>('[data-board-stack-episode="7"]')!;
    expect(seventh.getAttribute("aria-checked")).toBe("true");
    await click(seventh);
    expect(cardElement("ep7")).toBeNull();
  });

  it("draws each line in the state of the work it carries, with its label, and reference lines only when asked", async () => {
    await mountWhole(productionBoardSample({ episodes: 4 }));
    expect(edge(`gen:${SAMPLE_GENERATING_SHOT}>result:${SAMPLE_GENERATING_SHOT}`)?.dataset.edgeState).toBe("active");
    expect(edge(`output:${botNodeId(editorOf(1))}>film-1`)?.dataset.edgeState).toBe("active");
    expect(edge(`dispatch:ep${SAMPLE_FAILED_EPISODE}>${botNodeId(boarderOf(SAMPLE_FAILED_EPISODE))}`)?.dataset.edgeState).toBe("wait");
    expect(edge(`output:${botNodeId(BOARD_BOTS.lead)}>brief`)?.dataset.edgeState).toBe("done");
    expect(page.querySelector(`[data-board-edge-label="dispatch:plan>${botNodeId(BOARD_BOTS.writer)}"]`)?.textContent).toBe("Dispatch · episodes");
    expect(page.querySelector(`[data-board-edge-label="output:${botNodeId(editorOf(1))}>film-1"]`)?.textContent).toBe("Edit EP01");
    expect(page.querySelectorAll('[data-edge-kind="ref"]')).toHaveLength(0);

    const references = buttonNamed(page, "Show reference lines")!;
    await click(references);
    expect(references.getAttribute("aria-pressed")).toBe("true");
    expect(page.querySelectorAll('[data-edge-kind="ref"]').length).toBeGreaterThan(0);
    await click(references);
    expect(page.querySelectorAll('[data-edge-kind="ref"]')).toHaveLength(0);
  });

  it("colours each line by the work it carries: teal when done, dashed amber while it runs, grey while it waits", async () => {
    await mountWhole(productionBoardSample({ episodes: 4 }));
    const style = (id: string) => edge(id)!.querySelector("path")!.getAttribute("style") ?? "";

    const done = `output:${botNodeId(BOARD_BOTS.lead)}>brief`;
    expect(edge(done)!.getAttribute("class")).toContain("text-success");
    expect(style(done)).toContain("calc(1.5px");
    expect(style(done)).not.toContain("stroke-dasharray");
    expect(edge(done)!.querySelector("[data-edge-flow]")).toBeNull();

    const active = `gen:${SAMPLE_GENERATING_SHOT}>result:${SAMPLE_GENERATING_SHOT}`;
    expect(edge(active)!.getAttribute("class")).toContain("text-warning");
    expect(style(active)).toContain("calc(10px");
    expect(style(active)).toContain("calc(14px");
    expect(edge(active)!.querySelector("[data-edge-flow]")).not.toBeNull();

    const waiting = `dispatch:ep${SAMPLE_FAILED_EPISODE}>${botNodeId(boarderOf(SAMPLE_FAILED_EPISODE))}`;
    expect(edge(waiting)!.getAttribute("class")).toContain("text-ink-tertiary");
    expect(style(waiting)).toContain("calc(5px");
    expect(style(waiting)).toContain("calc(6px");
    expect(edge(waiting)!.querySelector("[data-edge-flow]")).toBeNull();

    expect(page.querySelector('[data-edge-kind="derive"] path')!.getAttribute("style")).toContain("calc(2px");
    const references = buttonNamed(page, "Show reference lines")!;
    await click(references);
    expect(page.querySelector('[data-edge-kind="ref"] path')!.getAttribute("style")).toContain("calc(3px");
    expect(page.querySelector('[data-edge-kind="ref"] path')!.getAttribute("style")).toContain("calc(7px");
  });

  it("fills a dispatch label with teal and its ink, dashes a waiting one, and leaves the rest on the panel", async () => {
    await mountWhole(productionBoardSample({ episodes: 4 }));
    const dispatch = page.querySelector<HTMLElement>(`[data-board-edge-label="dispatch:plan>${botNodeId(BOARD_BOTS.writer)}"]`)!;
    expect(dispatch.textContent).toBe("Dispatch · episodes");
    expect(dispatch.className).toContain("bg-success");
    expect(dispatch.className).toContain("text-[color:var(--color-success-ink)]");
    expect(dispatch.className).toContain("font-semibold");

    const waiting = page.querySelector<HTMLElement>(`[data-board-edge-label="dispatch:ep${SAMPLE_FAILED_EPISODE}>${botNodeId(boarderOf(SAMPLE_FAILED_EPISODE))}"]`)!;
    expect(waiting.className).toContain("border-dashed");
    expect(waiting.className).toContain("bg-panel");

    const cut = page.querySelector<HTMLElement>(`[data-board-edge-label="output:${botNodeId(editorOf(1))}>film-1"]`)!;
    expect(cut.className).toContain("bg-panel");
    expect(cut.className).toContain("border-hairline");
    expect(cut.className).not.toContain("bg-success");
  });

  it("shows each card as a label, and its lines without labels, once zoomed far out", async () => {
    await mount({ snapshot: productionBoardSample({ episodes: 12 }) });
    expect(page.querySelector("[data-board-far]")).toBeNull();
    for (let tries = 0; view().k > FAR_ZOOM && tries < 20; tries += 1) await click(buttonNamed(page, "Zoom out"));
    expect(view().k).toBeLessThanOrEqual(FAR_ZOOM);
    expect(page.querySelector("[data-board-zoom]")?.textContent).toBe(`${Math.round(view().k * 100)}%`);
    expect(page.querySelectorAll("[data-board-far]").length).toBe(drawnIds().length);
    expect(page.querySelector("[data-board-card]")).toBeNull();
    expect(page.querySelector("[data-board-edge]")).not.toBeNull();
    expect(page.querySelector("[data-board-edge-label]")).toBeNull();
  });

  it("starts with its minimap folded on a board narrower than 720 and follows the board's width, until the person opens it", async () => {
    size = { width: 719, height: 620 };
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    expect(minimap()).toBeNull();
    expect(minimapButton().getAttribute("aria-pressed")).toBe("false");
    await resizeBoard(720);
    expect(minimap()).not.toBeNull();
    await resizeBoard(580);
    expect(minimap()).toBeNull();

    await click(minimapButton());
    expect(minimap()).not.toBeNull();
    expect(minimapButton().getAttribute("aria-pressed")).toBe("true");
    await resizeBoard(1280);
    await resizeBoard(580);
    expect(minimap()).not.toBeNull();
  });

  it("starts with its minimap open on a board 720 wide, and keeps it as the person leaves it whatever the width", async () => {
    size = { width: 720, height: 620 };
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    expect(minimap()).not.toBeNull();
    expect(minimapButton().getAttribute("aria-pressed")).toBe("true");

    await click(minimapButton());
    expect(minimap()).toBeNull();
    expect(minimapButton().getAttribute("aria-pressed")).toBe("false");
    await resizeBoard(580);
    await resizeBoard(1440);
    expect(minimap()).toBeNull();
    await click(minimapButton());
    expect(minimap()).not.toBeNull();
    await resizeBoard(580);
    expect(minimap()).not.toBeNull();
  });

  it("keeps five stage controls in reading order in the compact bar, and the one in view keeps its name", async () => {
    size = { width: 800, height: 620 };
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    layOutBar(800, 700);
    await resizeBoard(800);
    const bar = stageBar();
    expect({ available: bar.dataset.stageAvailable, full: bar.dataset.stageFull, form: bar.dataset.boardStageForm, reserve: bar.dataset.boardStageReserve })
      .toEqual({ available: "456", full: "700", form: "compact", reserve: "320" });
    expect(stageNames()).toEqual(["brief", "script", "library", "storyboard", "post"]);
    const names: Record<string, string> = { brief: "Brief", script: "Episodes", library: "Characters · scenes", storyboard: "Storyboards · videos", post: "Post" };
    const states: Record<string, string> = { brief: "Done", script: "Done", library: "Done", storyboard: "Failed", post: "In progress" };
    const numbers: Record<string, string> = { short: "bg-control", Done: "bg-success", Failed: "bg-danger", "In progress": "bg-warning" };
    for (const button of activeStages()) {
      const stage = button.dataset.boardStage!;
      expect(button.getAttribute("title")).toBe(`${names[stage]} · ${states[stage]}`);
      expect(button.getAttribute("aria-label")).toBe(button.getAttribute("title"));
      expect(button.querySelector("[data-stage-number]")?.className).toContain(numbers[states[stage]!]!);
    }
    expect(page.querySelectorAll("[data-board-stage] [data-stage-name]")).toHaveLength(1);
    expect(stageSurface().className).toContain("overflow-hidden");

    await key("4");
    expect(stageForm()).toBe("compact");
    expect(page.querySelector('[data-stage-list="compact"] [data-board-stage="storyboard"] [data-stage-name]')?.textContent).toBe("Storyboards · videos");
    expect(page.querySelectorAll("[data-board-stage] [data-stage-name]")).toHaveLength(1);
    await key("1");
    expect(page.querySelector('[data-stage-list="compact"] [data-board-stage="brief"] [data-stage-name]')?.textContent).toBe("Brief");
  });

  it("numbers the five stages, tints each number by its state, sets them apart with a hairline and marks the one in view", async () => {
    await mountWhole(productionBoardSample({ episodes: 4 }));
    const number = (stage: string) => page.querySelector<HTMLElement>(`[data-board-stage="${stage}"] [data-stage-number]`)!;
    expect(["brief", "script", "library", "storyboard", "post"].map((stage) => number(stage).textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(number("brief").className).toContain("bg-success");
    expect(number("brief").className).toContain("text-[color:var(--color-success-ink)]");
    expect(number("post").className).toContain("bg-warning");
    expect(number("storyboard").className).toContain("bg-danger");
    expect(number("brief").className).toContain("size-5");
    expect(number("brief").className).toContain("text-[11px]");
    expect(page.querySelector('[data-board-stage="brief"] [data-stage-name]')!.className).toContain("text-[13px]");
    expect(page.querySelectorAll("[data-stage-sep]")).toHaveLength(4);
    expect(page.querySelector("[data-stage-sep]")!.className).toContain("h-px");
    expect(page.querySelector("[data-stage-sep]")!.className).toContain("w-2.5");
    expect(page.querySelector("[data-board-stage] [aria-hidden=true] svg")).toBeNull();

    await key("1");
    const current = [...page.querySelectorAll<HTMLElement>("[data-board-stage]")].filter((one) => one.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]!.dataset.boardStage).toBe("brief");
    expect(current[0]!.className).toContain("bg-control");
    expect(stageSurface().className).toContain("bg-panel/94");
    expect(stageSurface().className).toContain("rounded-xl");
  });

  it("wears the control tone on the numbers of the stages that have not started", async () => {
    await mount({ snapshot: productionBoardSample({ empty: true }) });
    const numbers = [...page.querySelectorAll<HTMLElement>("[data-board-stage] [data-stage-number]")];
    expect(numbers.map((one) => one.className.includes("bg-control"))).toEqual([false, true, true, true, true]);
  });

  it("puts the tools in the mockup's order, naming fit and reference lines in words, and lights a pressed tool amber", async () => {
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    expect([...toolbar().querySelectorAll("button")].map((one) => one.getAttribute("aria-label"))).toEqual([
      "Zoom out", "Zoom in", "Fit to view", "Show reference lines", "Minimap",
    ]);
    expect(page.querySelector("[data-board-zoom]")?.textContent).toBe(`${Math.round(view().k * 100)}%`);
    expect(buttonNamed(toolbar(), "Fit to view")!.textContent).toBe("Fit");
    expect(buttonNamed(toolbar(), "Show reference lines")!.textContent).toBe("Reference lines");
    expect(page.querySelectorAll("[data-board-toolbar-sep]")).toHaveLength(1);

    expect(toolbar().className).toContain("bg-panel/94");
    expect(toolbar().className).toContain("rounded-xl");
    expect(toolbar().className).toContain("border-hairline");
    expect(toolbar().className).toContain("board-type");
    expect(toolbar().parentElement!.className).toContain("bottom-3");
    expect(toolbar().parentElement!.className).toContain("start-3");

    const references = buttonNamed(toolbar(), "Show reference lines")!;
    expect(references.className).not.toContain("text-warning");
    await click(references);
    expect(references.className).toContain("text-warning");
  });

  it("keeps its minimap at the bottom right, 220 wide, and clear of the room the side panel marks", async () => {
    size = { width: 1280, height: 800 };
    await mountWithOverlay(productionBoardSample({ episodes: 4 }), RoomPanel);
    const panel = minimap()!;
    expect(panel.style.width).toBe("220px");
    expect(panel.style.insetInlineEnd).toBe("316px");
    expect(panel.className).toContain("bottom-3");
    expect(panel.className).toContain("bg-panel/94");
    expect(panel.className).toContain("rounded-xl");
    expect(panel.className).toContain("p-1.5");
    expect(panel.querySelector("svg")!.getAttribute("width")).toBe("208");
    expect(page.querySelector('[data-board-chrome-button="minimap"]')!.getAttribute("aria-pressed")).toBe("true");

    await click(buttonNamed(page, "Hide side panel"));
    expect(minimap()!.style.insetInlineEnd).toBe("80px");
  });

  it("tells the person how the board works until they first touch it, and mentions nothing at a narrow width", async () => {
    size = { width: 1280, height: 800 };
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    expect(hint()!.textContent).toBe("Click a bot to talk · click an asset for its details · drag empty space to pan · scroll to zoom");
    expect(hint()!.className).toContain("text-ink-tertiary");
    expect(hint()!.hasAttribute("data-board-hint-gone")).toBe(false);

    await resizeBoard(580);
    expect(hint()).toBeNull();
    await resizeBoard(1280);

    pointer(stage(), "pointerdown", 20, 20);
    pointer(stage(), "pointerup", 20, 20);
    expect(hint()!.hasAttribute("data-board-hint-gone")).toBe(true);
    expect(hint()!.className).toContain("opacity-0");
  });

  it("gives the stage bar only the room the side panel marks, and the whole bar back once the panel folds into its button", async () => {
    size = { width: 760, height: 520 };
    await mountWithOverlay(productionBoardSample({ episodes: 4 }), RoomPanel);
    layOutBar(760, 620);
    await resizeBoard(760);
    expect(stageForm()).toBe("compact");
    expect(stageBar().dataset.boardStageReserve).toBe("304");
    expect(stageBar().style.paddingInlineEnd).toBe("316px");
    expect(activeStages()).toHaveLength(5);

    await click(buttonNamed(page, "Hide side panel"));
    expect(stageForm()).toBe("full");
    expect(stageBar().dataset.boardStageReserve).toBe("68");
    expect(stageBar().style.paddingInlineEnd).toBe("80px");
    expect(stageNames()).toEqual(["brief", "script", "library", "storyboard", "post"]);
    for (const button of activeStages()) expect(button.textContent).toBeTruthy();

    await click(buttonNamed(page, "Show side panel"));
    expect(stageForm()).toBe("compact");
    expect(stageBar().dataset.boardStageReserve).toBe("304");
  });

  it("takes a compact stage control to its stage as the whole bar does", async () => {
    size = { width: 800, height: 620 };
    await mount({ snapshot: productionBoardSample({ episodes: 12 }) });
    layOutBar(800, 700);
    await resizeBoard(800);
    expect(stageForm()).toBe("compact");
    await click(page.querySelector('[data-stage-list="compact"] [data-board-stage="post"]'));
    expect(view()).toEqual(fitRect(layoutOf(productionBoardSample({ episodes: 12 })).stages.post!, size, { minZoom: 0.12, maxZoom: 1 }));
  });

  it("moves a card the person drags, by its name too, to where they let go, takes a press that hardly moves as a click, and pans from anywhere else", async () => {
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    const before = view();
    const brief = cardElement("brief")!;
    const article = brief.querySelector("article")!;
    const left = Number.parseFloat(brief.style.left);
    const top = Number.parseFloat(brief.style.top);
    pointer(article, "pointerdown", 400, 300);
    pointer(stage(), "pointermove", 460, 330);
    expect(Number.parseFloat(brief.style.left)).toBeCloseTo(left + 60 / before.k);
    pointer(stage(), "pointerup", 500, 350);
    await click(article);
    expect(host.move.mock.calls).toEqual([["brief", { x: Math.round(left + 100 / before.k), y: Math.round(top + 50 / before.k) }]]);
    expect(onOpened).not.toHaveBeenCalled();
    expect(view()).toEqual(before);

    const name = brief.querySelector("[data-card-name]")!;
    pointer(name, "pointerdown", 400, 300);
    pointer(stage(), "pointermove", 400, 340);
    pointer(stage(), "pointerup", 400, 340);
    await click(name);
    expect(host.move.mock.calls[1]).toEqual(["brief", { x: Math.round(left), y: Math.round(top + 40 / before.k) }]);
    expect(onOpened).not.toHaveBeenCalled();

    pointer(article, "pointerdown", 400, 300);
    pointer(stage(), "pointermove", 402, 301);
    pointer(stage(), "pointerup", 402, 301);
    await click(article);
    expect(host.move).toHaveBeenCalledTimes(2);
    expect(onOpened.mock.calls).toEqual([[{ kind: "asset", nodeId: "brief" }]]);

    pointer(stage(), "pointerdown", 20, 20);
    pointer(stage(), "pointermove", 120, 70);
    pointer(stage(), "pointerup", 120, 70);
    expect(view()).toEqual({ ...before, x: before.x + 100, y: before.y + 50 });
  });

  it("has a failed episode go on and uses the take the person chose, and shows a refusal until it is dismissed", async () => {
    await mountWhole(productionBoardSample({ episodes: 4 }));
    await click(buttonNamed(cardElement(`ep${SAMPLE_FAILED_EPISODE}`)!, "Retry"));
    expect(host.retry.mock.calls).toEqual([[{ episode: SAMPLE_FAILED_EPISODE }]]);

    const result = cardElement("result:ep1-shot-3")!;
    expect(buttonNamed(result, "Use this take")).toBeUndefined();
    await click(result.querySelector("[data-result-take]"));
    await click(buttonNamed(result, "Use this take"));
    expect(host.selectTake.mock.calls).toEqual([["ep1-shot-3-take-1"]]);

    host.retry.mockRejectedValueOnce(new Error("Nothing stopped there."));
    await click(buttonNamed(cardElement(botNodeId(boarderOf(SAMPLE_FAILED_EPISODE)))!, "Retry"));
    const notice = page.querySelector('[role="status"]');
    expect(notice?.textContent).toBe("That didn't go through: Nothing stopped there.");
    await click(buttonNamed(notice!, "Dismiss"));
    expect(page.querySelector('[role="status"]')).toBeNull();
  });

  it("offers no action on an archived project's cards, and pans the board where a card would be dragged", async () => {
    await mountWhole({ ...productionBoardSample({ episodes: 4 }), readOnly: "archived" });
    expect(buttonNamed(cardElement(`ep${SAMPLE_FAILED_EPISODE}`)!, "Retry")).toBeUndefined();
    expect(buttonNamed(cardElement(botNodeId(boarderOf(SAMPLE_FAILED_EPISODE)))!, "Retry")).toBeUndefined();
    await click(cardElement("result:ep1-shot-3")!.querySelector("[data-result-take]"));
    expect(buttonNamed(cardElement("result:ep1-shot-3")!, "Use this take")).toBeUndefined();

    const before = view();
    pointer(cardElement("brief")!.querySelector("article")!, "pointerdown", 400, 300);
    pointer(stage(), "pointermove", 500, 350);
    pointer(stage(), "pointerup", 500, 350);
    expect(host.move).not.toHaveBeenCalled();
    expect(view()).toEqual({ ...before, x: before.x + 100, y: before.y + 50 });
  });

  it("opens what a card shows in the layer over the board, a bot's chat from its card, and closes it on Escape", async () => {
    await mount({ snapshot: productionBoardSample({ episodes: 4 }) });
    await click(cardElement("brief")!.querySelector("article"));
    expect(onOpened).toHaveBeenLastCalledWith({ kind: "asset", nodeId: "brief" });
    expect(overlay?.opened).toEqual({ kind: "asset", nodeId: "brief" });
    expect(cardElement("brief")!.hasAttribute("data-opened")).toBe(true);

    const lead = botNodeId(BOARD_BOTS.lead);
    await click(cardElement(lead)!.querySelector("article"));
    expect(overlay?.opened).toEqual({ kind: "bot", botId: BOARD_BOTS.lead });
    expect(cardElement(lead)!.hasAttribute("data-opened")).toBe(true);
    expect(cardElement("brief")!.hasAttribute("data-opened")).toBe(false);

    await key("Escape");
    expect(onOpened).toHaveBeenLastCalledWith(null);
    expect(overlay?.opened).toBeNull();
  });

  it("tells the layer where a card is on the screen and when the board moves, and unfolds an episode it asks for", async () => {
    const snapshot = productionBoardSample({ episodes: 12 });
    await mount({ snapshot });
    expect(overlay!.anchorOf("brief")).toEqual(toScreen(layoutOf(snapshot).rects.get("brief")!, view()));
    expect(overlay!.anchorOf("ep9")).toBeNull();
    const moved = vi.fn();
    const stop = overlay!.subscribeView(moved);

    await act(async () => overlay!.focusEpisode(9));
    await settle();
    const unfolded = layoutOf(snapshot, [9]);
    expect(cardElement("ep9")).not.toBeNull();
    const ninth = overlay!.anchorOf("ep9")!;
    expect(ninth).toEqual(toScreen(unfolded.rects.get("ep9")!, view()));
    expect(moved).toHaveBeenCalled();
    expect(intersects(toScreen(unfolded.rects.get("brief")!, view()), { x: 0, y: 0, ...size })).toBe(false);
    expect(overlay!.anchorOf("brief")).toBeNull();

    stop();
    moved.mockClear();
    await key("ArrowLeft");
    expect(moved).not.toHaveBeenCalled();
    expect(overlay!.anchorOf("ep9")).toEqual({ ...ninth, x: ninth.x + 80 });
  });

  it("brings the member chosen in the sidebar to the middle when it opens and when the choice changes", async () => {
    const snapshot = productionBoardSample({ episodes: 4 });
    const layout = layoutOf(snapshot);
    const middleOf = (botId: string) => {
      const screen = toScreen(layout.rects.get(botNodeId(botId))!, view());
      return { x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 };
    };
    const { rerender } = await mount({ snapshot, focusBotId: boarderOf(2) });
    expect(middleOf(boarderOf(2)).x).toBeCloseTo(size.width / 2);
    expect(middleOf(boarderOf(2)).y).toBeCloseTo(size.height / 2);
    await rerender({ snapshot, focusBotId: editorOf(1) });
    expect(middleOf(editorOf(1)).x).toBeCloseTo(size.width / 2);
    expect(middleOf(editorOf(1)).y).toBeCloseTo(size.height / 2);
  });

  it("shows only the lead, and how to begin, before the lead has written anything", async () => {
    await mount({ snapshot: productionBoardSample({ empty: true }) });
    expect(drawnIds()).toEqual([botNodeId(BOARD_BOTS.lead)]);
    expect(page.querySelector("[data-board-empty-hint]")?.textContent).toBe("Confirm the brief with the lead in the group chat first");
    expect([...page.querySelectorAll<HTMLElement>("[data-board-stage]")].map((one) => one.dataset.stageState)).toEqual(["active", "wait", "wait", "wait", "wait"]);
  });
});
