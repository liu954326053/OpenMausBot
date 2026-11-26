// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { CameraStore } from "../engine/camera";
import { click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { Caption } from "./Caption";
import { StageBar } from "./StageBar";
import { Toast } from "./Toast";
import { Toolbar } from "./Toolbar";

useBoardPage();
const STAGES = { brief: "done", script: "done", library: "active", storyboard: "wait", post: "failed" } as const;

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
});

describe("the stage's note", () => {
  it("says which stage and what happens in it, and is hidden without one", () => {
    const note = render(createElement(Caption, { stage: "script" }));
    expect(note.className).toBe("caption");
    expect(textOf(note.querySelector("b"))).toBe("Stage 2 · Episodes");
    expect(textOf(note)).toContain("adapts the source into episodes");
    expect(render(createElement(Caption, { stage: null })).hidden).toBe(true);
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
});

describe("the toast", () => {
  it("shows while it has something to say", () => {
    expect(render(createElement(Toast, { message: { text: "Reference lines hidden", key: 1 } })).className).toBe("toast is-on");
    expect(render(createElement(Toast, { message: null })).className).toBe("toast");
  });
});
