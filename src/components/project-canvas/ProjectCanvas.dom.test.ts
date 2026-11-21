// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botNodeId } from "../../../shared/project-canvas";
import type { MemoryCanvasBackend } from "@/lib/project-canvas/memory-backend";
import { SAMPLE_PROJECT_ID, sampleCanvasBackend } from "@/testing/project-canvas-sample";
import { ProjectCanvas } from "./ProjectCanvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class WideObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 4000, height: 3000 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

let root: Root;
let host: HTMLElement;
let backend: MemoryCanvasBackend;

const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const nodeElement = (id: string) => host.querySelector<HTMLElement>(`[data-canvas-node="${CSS.escape(id)}"]`);
const stage = () => host.querySelector<HTMLElement>("[data-project-canvas-stage]")!;
const panel = () => host.querySelector<HTMLElement>("[data-node-panel]");
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
const shown = (id: string) => backend.current().nodes.find((node) => node.id === id);

function pointer(target: Element, type: string, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init }));
}

async function clickNode(id: string) {
  await act(async () => {
    pointer(nodeElement(id)!, "pointerdown");
    pointer(stage(), "pointerup");
  });
}

async function key(init: KeyboardEventInit) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function mount(options: Parameters<typeof sampleCanvasBackend>[0] = {}) {
  backend = sampleCanvasBackend({ delayMs: 5, ...options });
  await act(async () => root.render(createElement(ProjectCanvas, { projectId: SAMPLE_PROJECT_ID, backend })));
  await settle();
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", WideObserver);
  host = document.createElement("div");
  host.style.height = "900px";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the project canvas", () => {
  it("draws the team with its dispatch lines apart from the content lines a person can edit", async () => {
    await mount();
    expect(host.querySelector("h1")?.textContent).toBe("Rain City");
    for (const id of ["mira", "kai", "lena", "otto"]) expect(nodeElement(botNodeId(id))).not.toBeNull();
    for (const id of ["logline", "shot-1", "shot-1-take-1", "city-night"]) expect(nodeElement(id)).not.toBeNull();

    const dispatch = host.querySelectorAll('[data-kind="dispatch"]');
    expect(dispatch).toHaveLength(3);
    for (const line of dispatch) expect(line.tagName.toLowerCase()).toBe("path");
    expect(host.querySelectorAll('[data-kind="content"]')).toHaveLength(4);

    const bot = nodeElement(botNodeId("kai"))!;
    expect(bot.querySelector('[data-handle="target"]')).not.toBeNull();
    expect(bot.querySelector('[data-handle="source"]')).toBeNull();
    expect(bot.textContent).toContain("Writing the rooftop scene");
  });

  it("opens a node's panel on a click and keeps one panel open at a time", async () => {
    await mount();
    await clickNode("shot-1");
    expect(panel()?.textContent).toContain("Generate video");
    expect(nodeElement("shot-1")!.querySelectorAll("[data-resize-corner]")).toHaveLength(4);

    await clickNode(botNodeId("mira"));
    expect(host.querySelectorAll("[data-node-panel]")).toHaveLength(1);
    expect(buttonByText(panel()!, "Send")).toBeDefined();
    expect(nodeElement("shot-1")!.querySelectorAll("[data-resize-corner]")).toHaveLength(0);
  });

  it("shows a bot's waiting question, sends the answer to the conversation and unfolds the latest exchange", async () => {
    await mount();
    await clickNode(botNodeId("lena"));
    const open = panel()!;
    expect(open.textContent).toContain("Generate shot 1 again at 1080p?");
    await act(async () => buttonByText(open, "Answer in the conversation")!.click());
    expect(backend.openedChats).toEqual([{ botId: "lena", threadId: "thread-lena" }]);

    await act(async () => buttonByText(open, "Conversation")!.click());
    await settle();
    expect(panel()!.textContent).toContain("Board shot 1 and generate a first take.");
    expect(buttonByText(panel()!, "Open the full chat")).toBeDefined();
  });

  it("never deletes a bot, deletes a content line and node, and undoes both", async () => {
    await mount();
    await clickNode(botNodeId("otto"));
    await key({ key: "Delete" });
    await settle();
    expect(shown(botNodeId("otto"))).toBeDefined();

    await clickNode("logline");
    await key({ key: "Escape" });
    await key({ key: "Backspace" });
    await settle();
    expect(shown("logline")).toBeUndefined();
    expect(backend.current().connections.some((connection) => connection.toNodeId === "logline")).toBe(false);

    await key({ key: "z", metaKey: true });
    await settle();
    expect(shown("logline")).toBeDefined();
    expect(backend.current().connections.some((connection) => connection.id === "c-kai-logline")).toBe(true);
  });

  it("lets a shot override a setting, restore the project default, then follow the project when its default changes", async () => {
    await mount();
    const chips = () => nodeElement("shot-1")!.textContent ?? "";
    expect(chips()).toContain("10s");

    await clickNode("shot-1");
    const summary = [...panel()!.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')][0]!;
    await act(async () => summary.click());
    await act(async () => buttonByText(panel()!, "Restore default")!.click());
    await settle();
    expect(shown("shot-1")!.metadata?.settings).toBeUndefined();
    expect(chips()).toContain("5s");

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Project settings"]')!.click());
    await settle();
    const dialog = document.body.querySelector<HTMLElement>("[data-project-canvas-settings]")!;
    await choose(dialog.querySelector<HTMLSelectElement>('select[aria-label="Duration"]')!, "10");
    await act(async () => buttonByText(dialog, "Save")!.click());
    await settle();
    expect(document.body.querySelector("[data-project-canvas-settings]")).toBeNull();
    expect(chips()).toContain("10s");
    expect(shown("shot-1")!.metadata?.settings).toBeUndefined();
  });

  it("asks a bot to write into a text node and shows the text once it arrives", async () => {
    await mount({ delayMs: 150 });
    await clickNode("logline");
    const open = panel()!;
    const request = open.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(request, "A tighter logline, one sentence");
      request.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const ask = [...open.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Ask "))!;
    await act(async () => ask.click());
    await settle();
    expect(nodeElement("logline")!.textContent).toContain("is writing");
    await settle(250);
    expect(nodeElement("logline")!.textContent).not.toContain("is writing");
    expect(String(shown("logline")!.metadata?.content)).toContain("A tighter logline, one sentence");
  });

  it("pastes what was copied on the canvas from the keyboard, and undo takes the paste back", async () => {
    await mount();
    const before = backend.current().nodes.length;
    await clickNode("city-night");
    await key({ key: "c", metaKey: true });
    await key({ key: "v", metaKey: true });
    await settle();
    const copies = backend.current().nodes.filter((node) => node.id !== "city-night" && node.metadata?.file?.path === shown("city-night")!.metadata?.file?.path);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.title).toBe(`${shown("city-night")!.title} copy`);

    await key({ key: "z", metaKey: true });
    await settle();
    expect(backend.current().nodes).toHaveLength(before);
  });

  it("renames a content node from its title and leaves a bot's name alone", async () => {
    await mount();
    await clickNode("city-night");
    const title = nodeElement("city-night")!.querySelector<HTMLElement>('[title="Double-click to rename"]')!;
    await act(async () => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = nodeElement("city-night")!.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      input.value = "Night street";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(shown("city-night")!.title).toBe("Night street");
    expect(nodeElement(botNodeId("mira"))!.querySelector('[title="Double-click to rename"]')).toBeNull();
  });

  it("disables editing on an archived project", async () => {
    await mount({ snapshot: { ...sampleCanvasBackend().current(), readOnly: "archived" } });
    expect(host.textContent).toContain("Archived");
    await clickNode("logline");
    expect(nodeElement("logline")!.querySelectorAll("[data-resize-corner]")).toHaveLength(0);
    await key({ key: "Delete" });
    await settle();
    expect(shown("logline")).toBeDefined();
  });
});
