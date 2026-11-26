// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { CameraStore } from "../engine/camera";
import { click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { Caption } from "./Caption";
import { Minimap, type MinimapItem } from "./Minimap";
import { StageBar } from "./StageBar";
import { Toast } from "./Toast";
import { Toolbar } from "./Toolbar";

useBoardPage();
afterEach(() => {
  vi.restoreAllMocks();
});
const STAGES = { brief: "done", script: "done", library: "active", storyboard: "wait", post: "failed" } as const;
const ROOM_LEFT = "calc((100% - 300px) / 2)";

function renderToolbar() {
  const camera = new CameraStore({ x: 0, y: 0, z: 1 });
  return render(createElement(Toolbar, { camera, showRefs: false, minimap: true, onZoom() {}, onZoomReset() {}, onFit() {}, onRefs() {}, onMinimap() {} }));
}

/** A 2D context that counts its paintings, and resize observers the test can fire. */
function fakeCanvasPage() {
  const paint = { count: 0 };
  const context = { setTransform() {}, clearRect() { paint.count += 1; }, fillRect() {}, strokeRect() {}, fillStyle: "", strokeStyle: "", lineWidth: 1 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  const observers: Array<{ fire: () => void; targets: Element[] }> = [];
  vi.stubGlobal("ResizeObserver", class {
    readonly targets: Element[] = [];
    constructor(callback: () => void) {
      observers.push({ fire: callback, targets: this.targets });
    }
    observe(target: Element) {
      this.targets.push(target);
    }
    unobserve() {}
    disconnect() {}
  });
  return { paint, observers };
}

describe("the stage bar", () => {
  it("is the mockup's five chips, each with its number, name and state, the one in view marked", () => {
    const onStage = vi.fn();
    const bar = render(createElement(StageBar, { stages: STAGES, current: "library", insetEnd: 0, onStage }));
    expect(bar.tagName).toBe("NAV");
    expect(bar.className).toBe("stagebar");
    const chips = [...bar.querySelectorAll("button.schip")];
    expect(chips.map((chip) => textOf(chip.querySelector(".fno")))).toEqual(["1", "2", "3", "4", "5"]);
    expect(chips.map((chip) => chip.getAttribute("data-state"))).toEqual(["done", "done", "active", null, "failed"]);
    expect(chips.map((chip) => chip.getAttribute("aria-current"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(bar.querySelectorAll(".schip-sep")).toHaveLength(4);
    click(chips[3]);
    expect(onStage).toHaveBeenCalledWith("storyboard");
  });

  it("names each chip's state, which its colour alone shows", () => {
    const bar = render(createElement(StageBar, { stages: STAGES, insetEnd: 0, onStage() {} }));
    expect(bar.querySelector("button.schip")?.getAttribute("aria-label")).toBe("Brief · Done");
  });

  it("centres in the room left of the side panel", () => {
    const bar = render(createElement(StageBar, { stages: STAGES, insetEnd: 300, onStage() {} }));
    expect(bar.style.left).toBe(ROOM_LEFT);
  });
});

describe("the stage's note", () => {
  it("says which stage and what happens in it, and is hidden without one", () => {
    const note = render(createElement(Caption, { stage: "script" }));
    expect(note.className).toBe("caption");
    expect(textOf(note.querySelector("b"))).toBe("Stage 2 · Episodes");
    expect(textOf(note)).toContain("adapts the source into episodes");
    expect(render(createElement(Caption, { stage: null })).hidden).toBe(true);
  });

  it("centres under the stage bar in the room left of the side panel", () => {
    expect(render(createElement(Caption, { stage: "script", insetEnd: 300 })).style.left).toBe(ROOM_LEFT);
    expect(render(createElement(Caption, { stage: "script" })).style.left).toBe("");
  });
});

describe("the toolbar", () => {
  it("is the mockup's: out, the zoom that resets, in, the whole board, the reference lines and the minimap", () => {
    const camera = new CameraStore({ x: 0, y: 0, z: 0.55 });
    const calls = { onZoom: vi.fn(), onZoomReset: vi.fn(), onFit: vi.fn(), onRefs: vi.fn(), onMinimap: vi.fn() };
    const bar = render(createElement(Toolbar, { camera, showRefs: false, minimap: true, ...calls }));
    expect(bar.getAttribute("role")).toBe("toolbar");
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((button) => button.className)).toEqual(["tbtn", "tzoom", "tbtn", "tbtn wide", "tbtn wide keep", "tbtn"]);
    expect(textOf(buttons[1])).toBe("55%");
    expect(buttons.slice(4).map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    buttons.forEach((button) => click(button));
    expect(calls.onZoom.mock.calls).toEqual([[0.8], [1.25]]);
    expect(calls.onZoomReset).toHaveBeenCalledTimes(1);
    expect(calls.onFit).toHaveBeenCalledTimes(1);
    expect(calls.onRefs).toHaveBeenCalledTimes(1);
    expect(calls.onMinimap).toHaveBeenCalledTimes(1);
  });

  it("names the reference lines in full, the scope in the part a narrow board hides", () => {
    const keep = renderToolbar().querySelector(".tbtn.keep .tkeep");
    expect(textOf(keep?.querySelector(".tlong"))).toBe("Character and scene");
    expect(keep?.textContent).toBe("Character and scene Reference lines");
  });

  it("puts the scope after the short name in a language that says it after", () => {
    setLocale("pt-br");
    const keep = renderToolbar().querySelector(".tbtn.keep .tkeep");
    expect(keep?.lastElementChild?.className).toBe("tlong");
    expect(keep?.textContent).toBe("Linhas de referência de personagens e cenários");
  });
});

describe("the minimap", () => {
  const WORLD = { x: 0, y: 0, w: 2000, h: 1000 };
  const ITEMS: MinimapItem[] = [{ id: "bot", rect: { x: 10, y: 10, w: 100, h: 80 }, kind: "bot", state: "working" }];

  function renderMinimap(camera: CameraStore, world = WORLD, items = ITEMS) {
    return render(createElement("section", { className: "mj-board" }, createElement(Minimap, { world, items, camera, insetEnd: 0, onJump() {} })));
  }

  it("repaints when the board changes size, which moves the view's frame", () => {
    const { paint, observers } = fakeCanvasPage();
    const board = renderMinimap(new CameraStore());
    const painted = paint.count;
    observers.find((observer) => observer.targets.includes(board))?.fire();
    expect(paint.count).toBe(painted + 1);
  });

  it("repaints a new list of cards, and sets up again only for a different world", () => {
    const { paint } = fakeCanvasPage();
    const camera = new CameraStore();
    const subscribe = vi.spyOn(camera, "subscribe");
    renderMinimap(camera);
    const painted = paint.count;
    renderMinimap(camera, { ...WORLD }, [...ITEMS]);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(paint.count).toBe(painted + 1);
    renderMinimap(camera, { ...WORLD, w: 3000 }, [...ITEMS]);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});

describe("the toast", () => {
  it("shows while it has something to say", () => {
    expect(render(createElement(Toast, { message: { text: "Reference lines hidden", key: 1 } })).className).toBe("toast is-on");
    expect(render(createElement(Toast, { message: null })).className).toBe("toast");
  });

  it("keeps its words while it fades out", () => {
    render(createElement(Toast, { message: { text: "Reference lines hidden", key: 1 } }));
    expect(textOf(render(createElement(Toast, { message: null })))).toBe("Reference lines hidden");
  });

  it("centres in the room left of the side panel", () => {
    expect(render(createElement(Toast, { message: null, insetEnd: 300 })).style.left).toBe(ROOM_LEFT);
  });
});
