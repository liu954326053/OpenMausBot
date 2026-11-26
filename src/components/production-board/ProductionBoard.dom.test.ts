// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { botNodeId } from "../../../shared/project-canvas";
import type { BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import { BOARD_BOTS, PRODUCTION_BOARD_LOOKS, productionBoardBackend, productionBoardSample } from "@/testing/production-board-sample";
import { ProductionBoard, type BoardHost } from "./ProductionBoard";
import { click, press, render, textOf, useBoardPage } from "./testing/dom-kit";

useBoardPage();

class SizedObserver {
  constructor(private readonly run: (entries: Array<{ target: Element; contentRect: { width: number; height: number } }>) => void) {}
  observe(target: Element) { this.run([{ target, contentRect: { width: 1440, height: 900 } }]); }
  unobserve() {}
  disconnect() {}
}

function mount(patch: { opened?: BoardOpened | null; readOnly?: boolean; overlay?: boolean } = {}) {
  vi.stubGlobal("ResizeObserver", SizedObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1440 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 900 });
  const snapshot = { ...productionBoardSample({ episodes: 4 }), ...(patch.readOnly ? { readOnly: "archived" as const } : {}) };
  const host: BoardHost = { fileUrl: (file) => `/files/${file.path}`, move: vi.fn(), generate: vi.fn(async () => {}), selectTake: vi.fn(async () => {}), retry: vi.fn(async () => {}), openDraft: vi.fn(async () => {}) };
  const onOpenedChange = vi.fn();
  const overlay = vi.fn((_props: BoardOverlayProps) => null);
  const root = render(createElement("div", { style: { height: "900px" } }, createElement(ProductionBoard, {
    projectId: snapshot.project.id, snapshot, backend: productionBoardBackend(), looks: PRODUCTION_BOARD_LOOKS, host,
    opened: patch.opened ?? null, onOpenedChange, ...(patch.overlay === false ? {} : { overlay }),
  })));
  const board = root.querySelector<HTMLElement>(".mj-board")!;
  return { board, stage: board.querySelector<HTMLElement>("main.stage")!, viewport: board.querySelector<HTMLElement>("[data-production-board]")!, host, onOpenedChange, overlay, snapshot };
}
const node = (board: HTMLElement, id: string) => board.querySelector<HTMLElement>(`[data-board-card-id="${id}"]`);
const point = (type: string, x: number, y: number, more: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...more });

describe("the board", () => {
  it("is the mockup's stage: a viewport with the grid and the world, the lines under the labels under the nodes", () => {
    const { board, viewport } = mount();
    expect(viewport.className).toContain("viewport");
    expect(viewport.getAttribute("role")).toBe("application");
    const world = board.querySelector("[data-board-world]")!;
    expect([...world.children].map((child) => child.getAttribute("class"))).toEqual(["edges", "edges", "labels", "nodes"]);
    expect(node(board, botNodeId(BOARD_BOTS.lead))?.className).toContain("node k-bot");
    expect(board.querySelector(".stagebar")).not.toBeNull();
    expect(board.querySelector(".toolbar")).not.toBeNull();
    expect(board.querySelector(".minimap")).not.toBeNull();
  });

  it("draws only what is in view, and real cards at every zoom: far out the bots wear a pin", () => {
    const { board, stage, viewport } = mount();
    const drawn = board.querySelectorAll(".node").length;
    expect(drawn).toBeGreaterThan(0);
    press(viewport, "0");
    expect(stage.className).toContain("lod-far");
    expect(board.querySelectorAll(".node").length).toBeGreaterThan(drawn);
    expect(board.querySelector(".node.k-shot .sh-head")).not.toBeNull();
    expect(board.querySelector("[data-far-pill]")).toBeNull();
  });

  it("opens a bot's chat or a card's details on a click, and closes them on a click of the empty board", () => {
    const { board, viewport, onOpenedChange } = mount();
    const lead = node(board, botNodeId(BOARD_BOTS.lead))!;
    act(() => { lead.dispatchEvent(point("pointerdown", 10, 10)); viewport.dispatchEvent(point("pointerup", 10, 10)); });
    expect(onOpenedChange).toHaveBeenLastCalledWith({ kind: "bot", botId: BOARD_BOTS.lead });
    const brief = node(board, "brief")!;
    act(() => { brief.dispatchEvent(point("pointerdown", 10, 10)); viewport.dispatchEvent(point("pointerup", 10, 10)); });
    expect(onOpenedChange).toHaveBeenLastCalledWith({ kind: "asset", nodeId: "brief" });
    act(() => { viewport.dispatchEvent(point("pointerdown", 5, 5)); viewport.dispatchEvent(point("pointerup", 5, 5)); });
    expect(onOpenedChange).toHaveBeenLastCalledWith(null);
  });

  it("dims the rest about the card that is open, and brings out its lines and what they lead to", () => {
    const { board, stage } = mount({ opened: { kind: "bot", botId: BOARD_BOTS.lead } });
    expect(stage.className).toContain("has-sel");
    expect(node(board, botNodeId(BOARD_BOTS.lead))!.className).toContain("is-sel");
    expect(node(board, "brief")!.className).toContain("is-rel");
    expect(board.querySelectorAll(".edge.is-on").length).toBeGreaterThan(0);
  });

  it("moves a card with the pointer and stores where it was left, without opening it", () => {
    const { board, viewport, host, onOpenedChange } = mount();
    const brief = node(board, "brief")!;
    const before = { x: Number.parseFloat(brief.style.left), y: Number.parseFloat(brief.style.top) };
    const zoom = Number(/scale\(([\d.]+)\)/.exec(board.querySelector<HTMLElement>("[data-board-world]")!.style.transform)![1]);
    act(() => { brief.dispatchEvent(point("pointerdown", 100, 100)); viewport.dispatchEvent(point("pointermove", 160, 130)); viewport.dispatchEvent(point("pointerup", 160, 130)); });
    expect(host.move).toHaveBeenCalledWith("brief", { x: Math.round(before.x + 60 / zoom), y: Math.round(before.y + 30 / zoom) });
    expect(onOpenedChange).not.toHaveBeenCalled();
  });

  it("shows the lines from characters and scenes to their shots when asked, and says so", () => {
    const { board, stage } = mount();
    click(board.querySelector('.toolbar button[aria-pressed="false"]'));
    expect(stage.className).toContain("show-refs");
    expect(textOf(board.querySelector(".toast.is-on"))).toContain("Showing the lines");
    expect(board.querySelectorAll(".edge.t-ref").length).toBeGreaterThan(0);
  });

  it("goes to a stage on its number key and notes what the stage is, until the person moves the board", () => {
    const { board, viewport } = mount();
    press(viewport, "2");
    expect(board.querySelector<HTMLElement>(".caption")!.hidden).toBe(false);
    act(() => { viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -40, clientX: 700, clientY: 400 })); });
    expect(board.querySelector<HTMLElement>(".caption")!.hidden).toBe(true);
  });

  it("keeps the stage's note and the toast clear of the side panel, and centres them on the whole board without one", () => {
    const { board, viewport } = mount();
    press(viewport, "2");
    const caption = board.querySelector<HTMLElement>(".caption")!;
    const toast = board.querySelector<HTMLElement>(".toast")!;
    expect(caption.hidden).toBe(false);
    expect(caption.style.left).toBe("calc((100% - 320px) / 2)");
    expect(caption.style.maxWidth).toBe("min(560px, calc(100% - 32px - 320px))");
    expect(toast.style.left).toBe("calc((100% - 320px) / 2)");
    expect(toast.style.maxWidth).toBe("calc(100% - 32px - 320px)");
    const bare = mount({ overlay: false });
    expect(bare.board.querySelector<HTMLElement>(".caption")!.style.left).toBe("");
    expect(bare.board.querySelector<HTMLElement>(".toast")!.style.left).toBe("");
  });

  it("offers nothing that changes an archived project", () => {
    const { board } = mount({ readOnly: true });
    expect(board.querySelector(".btn-gen")).toBeNull();
    expect([...board.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Retry")).toBe(false);
  });

  it("hands the layer over it the board it built", () => {
    const { overlay } = mount();
    expect(overlay.mock.calls.at(-1)![0]).toMatchObject({ board: { cards: expect.any(Array), edges: expect.any(Array) } });
  });
});
