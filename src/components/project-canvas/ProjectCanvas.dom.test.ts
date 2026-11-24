// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botNodeId, type CanvasSnapshot } from "../../../shared/project-canvas";
import { setLocale } from "@/lib/i18n";
import { buildBoard } from "@/lib/production-board/board";
import { layoutBoard } from "@/lib/production-board/layout";
import type { BoardOverlayProps } from "@/lib/production-board/overlay";
import type { MemoryCanvasBackend } from "@/lib/project-canvas/memory-backend";
import { cardSize } from "@/components/production-board/board/card-view";
import { BOARD_BOTS, productionBoardBackend, productionBoardSample, SAMPLE_FAILED_EPISODE } from "@/testing/production-board-sample";
import { ProjectCanvas, type ProjectCanvasProps } from "./ProjectCanvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let size = { width: 1280, height: 800 };

class SizedObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { ...size } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

let root: Root;
let page: HTMLElement;
let dramas = 0;
let overlay: BoardOverlayProps | null = null;

function RecordOverlay(props: BoardOverlayProps) {
  overlay = props;
  return null;
}

/** The sample drama under a name of its own, so the board remembers no view of it from another test. */
function drama(change: (snapshot: CanvasSnapshot) => void = () => {}): MemoryCanvasBackend {
  const id = `drama-${(dramas += 1)}`;
  const snapshot = productionBoardSample({ episodes: 4 });
  snapshot.projectId = id;
  snapshot.project = { ...snapshot.project, id };
  change(snapshot);
  return productionBoardBackend({ episodes: 1 }, { snapshot });
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const cardElement = (id: string) => page.querySelector<HTMLElement>(`[data-board-card-id="${id}"]`);
const buttonNamed = (scope: ParentNode, name: string) =>
  [...scope.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name);
const node = (backend: MemoryCanvasBackend, id: string) => backend.current().nodes.find((one) => one.id === id)!;

async function mount(backend: MemoryCanvasBackend, props: Partial<ProjectCanvasProps> = {}) {
  await act(async () => root.render(createElement(ProjectCanvas, { projectId: backend.current().projectId, backend, overlay: RecordOverlay, ...props })));
  await settle();
  await settle();
}

/** A viewport the whole board fits in at full size, fitted, so every card is drawn. */
async function mountWhole(backend: MemoryCanvasBackend) {
  const { bounds } = layoutBoard(buildBoard(backend.current()), cardSize);
  size = { width: Math.ceil(bounds.width) + 400, height: Math.ceil(bounds.height) + 400 };
  await mount(backend);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true })); });
  await settle();
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, clientX, clientY })); });
}

async function drag(cardId: string, by: { x: number; y: number }) {
  const board = page.querySelector<HTMLElement>("[data-production-board]")!;
  pointer(cardElement(cardId)!.querySelector("article")!, "pointerdown", 300, 300);
  pointer(board, "pointermove", 300 + by.x / 2, 300 + by.y / 2);
  pointer(board, "pointerup", 300 + by.x, 300 + by.y);
  await settle();
}

const zoom = () => Number(/scale\(([\d.e+-]+)\)/.exec(page.querySelector<HTMLElement>("[data-board-world]")!.style.transform)![1]);

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
});

describe("the project's canvas", () => {
  it("shows the project's board under a top bar with its name and what the app puts there, once it has loaded", async () => {
    const backend = drama();
    act(() => root.render(createElement(ProjectCanvas, { projectId: backend.current().projectId, backend, topBarSlot: createElement("span", { "data-slotted": "" }) })));
    expect(page.querySelector('[aria-label="Loading…"]')).not.toBeNull();
    await settle();
    await settle();
    expect(page.querySelector("h1")?.textContent).toBe("雨城");
    expect(page.querySelector("[data-project-canvas-slot] [data-slotted]")).not.toBeNull();
    expect(page.querySelector("[data-production-board]")).not.toBeNull();
    expect(cardElement(botNodeId(BOARD_BOTS.lead))).not.toBeNull();
    expect(page.textContent).not.toContain("Archived");
  });

  it("says when the board didn't load, and loads it again when asked", async () => {
    const backend = drama();
    const read = backend.readSnapshot.bind(backend);
    backend.readSnapshot = vi.fn().mockRejectedValueOnce(new Error("The server went away.")).mockImplementation(read);
    await mount(backend);
    expect(page.querySelector('[role="alert"]')?.textContent).toBe("The canvas couldn't load: The server went away.");
    await click(buttonNamed(page, "Try again"));
    await settle();
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(page.querySelector("[data-production-board]")).not.toBeNull();
  });

  it("marks an archived project and a missing folder in the top bar", async () => {
    const backend = drama((snapshot) => {
      snapshot.readOnly = "archived";
      snapshot.project = { ...snapshot.project, archived: true, folderState: "missing" };
    });
    await mount(backend);
    const header = page.querySelector("header")!;
    expect(header.textContent).toContain("Archived");
    expect(header.textContent).toContain("Project folder not found");
  });

  it("opens the project's settings from the top bar and closes them", async () => {
    await mount(drama());
    expect(page.ownerDocument.querySelector("[data-project-canvas-settings]")).toBeNull();
    await click(buttonNamed(page.querySelector("header")!, "Project settings"));
    const dialog = page.ownerDocument.querySelector<HTMLElement>("[data-project-canvas-settings]");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    await click(buttonNamed(dialog!, "Cancel"));
    expect(page.ownerDocument.querySelector("[data-project-canvas-settings]")).toBeNull();
  });

  it("keeps a card where the person dragged it: the project holds the place, and the card is there when the board opens again", async () => {
    const backend = drama();
    await mount(backend);
    const brief = cardElement("brief")!;
    const at = { x: Number.parseFloat(brief.style.left), y: Number.parseFloat(brief.style.top) };
    const k = zoom();
    await drag("brief", { x: 120, y: 60 });
    const placed = { x: Math.round(at.x + 120 / k), y: Math.round(at.y + 60 / k) };
    expect(node(backend, "brief")).toMatchObject({ position: placed, arranged: true });
    expect([cardElement("brief")!.style.left, cardElement("brief")!.style.top]).toEqual([`${placed.x}px`, `${placed.y}px`]);

    await act(async () => root.unmount());
    root = createRoot(page);
    await mount(backend);
    expect([cardElement("brief")!.style.left, cardElement("brief")!.style.top]).toEqual([`${placed.x}px`, `${placed.y}px`]);
  });

  it("says when a change didn't save", async () => {
    const backend = drama();
    backend.applyOps = vi.fn().mockRejectedValue(new Error("The disk is full."));
    await mount(backend);
    await drag("brief", { x: 120, y: 60 });
    expect(page.querySelector('[role="status"]')?.textContent).toBe("A change wasn't saved: The disk is full.");
    await click(buttonNamed(page.querySelector('[role="status"]')!, "Dismiss"));
    expect(page.querySelector('[role="status"]')).toBeNull();
  });

  it("has a failed episode go on, and uses the take the person chose, on the project", async () => {
    const backend = drama();
    await mountWhole(backend);
    await click(buttonNamed(cardElement(`ep${SAMPLE_FAILED_EPISODE}`)!, "Retry"));
    await settle();
    expect(backend.retries).toEqual([{ episode: SAMPLE_FAILED_EPISODE }]);
    expect(backend.current().production!.episodes.find((one) => one.episode === SAMPLE_FAILED_EPISODE)!.status).toBe("storyboard");
    expect(buttonNamed(cardElement(`ep${SAMPLE_FAILED_EPISODE}`)!, "Retry")).toBeUndefined();

    const result = cardElement("result:ep1-shot-3")!;
    await click(result.querySelector("[data-result-take]"));
    await click(buttonNamed(result, "Use this take"));
    await settle();
    expect(node(backend, "ep1-shot-3-take-1").metadata?.selected).toBe(true);
    expect(node(backend, "ep1-shot-3-take-2").metadata?.selected).toBeFalsy();
  });

  it("hands the layer over the board the project, and what a card opens", async () => {
    const backend = drama();
    await mount(backend);
    expect(overlay).toMatchObject({ projectId: backend.current().projectId, backend, opened: null });
    await click(cardElement(botNodeId(BOARD_BOTS.lead))!.querySelector("article"));
    expect(overlay?.opened).toEqual({ kind: "bot", botId: BOARD_BOTS.lead });
  });
});
