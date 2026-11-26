// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { botNodeId } from "../../../shared/project-canvas";
import type { TeamProjectWire } from "../../../shared/team-projects";
import type { MemoryCanvasBackend } from "@/lib/project-canvas/memory-backend";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { bots: [] as unknown[], groups: [] as unknown[], pendingQueued: {} },
  backend: null as MemoryCanvasBackend | null,
}));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
vi.mock("@/components/project-canvas/ServerProjectCanvas", async () => {
  const { createElement: element } = await import("react");
  const { ProjectCanvas } = await import("@/components/project-canvas/ProjectCanvas");
  return {
    ServerProjectCanvas: (props: Omit<import("@/components/project-canvas/ProjectCanvas").ProjectCanvasProps, "backend">) => element(ProjectCanvas, { ...props, backend: fixture.backend! }),
  };
});

import { setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { BOARD_BOTS, BOARD_PROJECT_ID, productionBoardBackend } from "@/testing/production-board-sample";
import { ProjectView } from "./ProjectView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { width: 1280, height: 800 };

class SizedObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { ...VIEWPORT } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

const project: TeamProjectWire = {
  id: BOARD_PROJECT_ID, name: "雨城", folder: "/Users/demo/短剧/雨城", section: "雨城", team: { key: "team:drama", name: "Drama" }, follows: {}, episodeBots: {},
  leadBotId: BOARD_BOTS.lead, createdAt: 1, folderState: "ready", botIds: Object.values(BOARD_BOTS),
};

let page: HTMLElement;
let root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const cardElement = (id: string) => page.querySelector<HTMLElement>(`[data-board-card-id="${id}"]`);

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}

/** A press on a card: the pointer down on it, the pointer up on the board, as a person's click arrives. */
async function press(card: Element | null | undefined) {
  if (!card) throw new Error("nothing to press");
  const viewport = card.closest<HTMLElement>("[data-production-board]")!;
  await act(async () => {
    card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
  });
  await settle();
}

/** Where a card is on the screen: its place on the board, moved and scaled as the board's world is. */
function onScreen(card: HTMLElement) {
  const [, x, y, k] = /translate\(([\d.e+-]+)px, ([\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(page.querySelector<HTMLElement>("[data-board-world]")!.style.transform)!.map(Number);
  const box = (name: "left" | "top" | "width" | "height") => Number.parseFloat(card.style[name]);
  return { x: box("left") * k! + x!, y: box("top") * k! + y!, width: box("width") * k!, height: box("height") * k! };
}

beforeEach(async () => {
  setLocale("en");
  vi.stubGlobal("ResizeObserver", SizedObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener() {}, removeEventListener() {} }));
  fixture.backend = productionBoardBackend({ episodes: 4 });
  setTeamProjects({ root: "/Users/demo/短剧", projects: [project] });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  await act(async () => root.render(createElement(ProjectView, { projectId: BOARD_PROJECT_ID })));
  await settle();
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  page.remove();
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("a project's board in the app", () => {
  it("draws the team and assets panel in a layer over the board, and keeps the board's stage bar clear of it", () => {
    const stage = q("main.stage")!;
    const layer = stage.querySelector<HTMLElement>(":scope > [data-board-overlay]")!;
    expect([...layer.classList]).toEqual(expect.arrayContaining(["absolute", "inset-0"]));
    expect(layer.querySelector("aside[data-board-side-panel]")?.getAttribute("aria-label")).toBe("Team and assets");
    const rooms = layer.querySelectorAll<HTMLElement>("[data-board-room]");
    expect([...rooms].map((room) => room.style.width)).toEqual(["304px"]);
    const stages = stage.querySelector<HTMLElement>("nav[aria-label='Stages']")!;
    expect(stages.style.maxWidth).toBe("calc(100% - 24px - 320px)");
  });

  it("opens a bot's chat window beside its card when the card is clicked", async () => {
    const card = cardElement(botNodeId(BOARD_BOTS.lead))!;
    await press(card);
    const chat = q("[data-board-chat]")!;
    expect(chat.getAttribute("aria-label")).toBe("Chat with 云舟");
    expect(chat.dataset.side).toBe("r");
    const box = onScreen(card);
    expect(chat.style.transform).toBe(`translate(${Math.round(box.x + box.width + 16)}px, ${Math.round(Math.max(12, box.y))}px)`);
  });

  it("opens an asset's details when its card is clicked, in place of a chat", async () => {
    await press(cardElement(botNodeId(BOARD_BOTS.lead))!);
    await press(cardElement("brief")!);
    const details = q("[role='dialog'][aria-modal='true']")!;
    expect(details.dataset.boardAsset).toBe("brief");
    expect(details.querySelector("h2")?.textContent).toBe(fixture.backend!.current().nodes.find((node) => node.id === "brief")!.title);
    expect(q("[data-board-chat]")).toBeNull();
    await click([...details.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Close"));
    expect(q("[role='dialog'][aria-modal='true']")).toBeNull();
  });
});
