// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botNodeId } from "../../../shared/project-canvas";
import { loadLocale, setLocale } from "@/lib/i18n";
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

async function paste(clipboardData: { files: File[]; getData: (type: string) => string }) {
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    window.dispatchEvent(event);
  });
}

async function type(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(20);
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

  it("gives a bot's card to generate past its ceiling the reason in the person's language, as the chat does", async () => {
    await mount();
    const asked = { requestId: "r1", projectId: SAMPLE_PROJECT_ID, nodeId: "shot-1", title: "Shot 1", botId: "lena", threadId: "thread-lena", reasonKey: "serverError.projectGeneration.confirmVideos", reasonParams: { ceiling: 3, used: 3, asked: 1 }, createdAt: 1 };
    await act(async () => backend.updateBots((snapshot) => {
      snapshot.bots.lena!.waiting = { threadId: "thread-lena", messageId: "l-9", card: { title: "Generate “Shot 1”?", subtitle: "Words generation wrote", options: ["Confirm", "Cancel"], canvasGeneration: asked } };
    }));
    await settle();
    await clickNode(botNodeId("lena"));
    expect(panel()!.textContent).toContain("Generate “Shot 1”?");
    expect(panel()!.textContent).toContain("A bot may start 3 videos a day without you, and this one has started 3. Confirm to let it make 1 more.");
    expect(panel()!.textContent).not.toContain("Words generation wrote");
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

  it("asks a bot to revise a text node's text, draws the node its reply becomes beside it while the bot writes, and the reply takes exactly that place", async () => {
    await mount({ delayMs: 150 });
    const text = shown("logline")!.metadata?.content;
    await clickNode("logline");
    const open = panel()!;
    const request = open.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(request.placeholder).toContain("how to revise this text");
    await type(request, "A tighter logline, one sentence");
    const ask = [...open.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Ask "))!;
    await act(async () => ask.click());
    await settle();
    const writer = Object.values(backend.current().bots).find((bot) => bot.writingBeside?.length)!;
    const [placeholder] = writer.writingBeside!;
    const ghost = host.querySelector<HTMLElement>(`[data-reply-placeholder="${placeholder!.id}"]`)!;
    const frame = (element: HTMLElement) => [element.style.left, element.style.top, element.style.width, element.style.height];
    expect(ghost.getAttribute("role")).toBe("status");
    expect(ghost.textContent).toBe(`${writer.name} is writing…`);
    expect(frame(ghost)).toEqual([placeholder!.position.x, placeholder!.position.y, placeholder!.width, placeholder!.height].map((value) => `${value}px`));
    expect(host.querySelector(`[data-ghost-connection="${placeholder!.id}"]`)).not.toBeNull();
    expect(nodeElement(placeholder!.id)).toBeNull();
    expect(nodeElement("logline")!.textContent).not.toContain("is writing");
    await settle(250);
    expect(host.querySelector("[data-reply-placeholder]")).toBeNull();
    expect(host.querySelector("[data-ghost-connection]")).toBeNull();
    expect(shown("logline")!.metadata?.content).toBe(text);
    const replies = backend.current().connections.filter((connection) => connection.fromNodeId === "logline" && connection.kind === "content").map((connection) => shown(connection.toNodeId)!);
    expect(replies).toEqual([expect.objectContaining({ id: placeholder!.id, type: "text", createdBy: { kind: "bot", botId: writer.botId }, metadata: { content: expect.stringContaining("A tighter logline, one sentence") } })]);
    expect(frame(nodeElement(placeholder!.id)!)).toEqual(frame(ghost));
  });

  it("names a text node's own text first in its references and its @, with the videos a task attaches, and no video in a generation's", async () => {
    await mount();
    await act(async () => {
      await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [
        { type: "connect_nodes", fromNodeId: "city-night", toNodeId: "logline" },
        { type: "connect_nodes", fromNodeId: "shot-1-take-1", toNodeId: "logline" },
        { type: "connect_nodes", fromNodeId: "shot-1-take-1", toNodeId: "city-night" },
      ] });
    });
    await settle();
    const shelf = () => [...panel()!.querySelectorAll("[data-reference]")].map((thumb) => thumb.textContent);
    const choices = () => [...host.querySelectorAll('[role="option"]')].map((option) => option.querySelector("span")?.textContent);

    await clickNode("logline");
    expect(shelf()).toEqual(["Text 1", "Image 1", "Video 1"]);
    expect(panel()!.querySelector('button[aria-label="Remove Text 1"]')).toBeNull();
    expect(panel()!.querySelector('button[aria-label="Remove Video 1"]')).not.toBeNull();
    await type(panel()!.querySelector<HTMLTextAreaElement>("textarea")!, "Shorter, after @");
    expect(choices()).toEqual(["Text 1", "Image 1", "Video 1"]);

    await clickNode("city-night");
    expect(shelf()).toEqual(["Image 1"]);
    await type(panel()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')!, "Night rain on @");
    expect(choices()).toEqual(["Image 1"]);
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

  it("makes pasted text a text node and uploads a pasted file", async () => {
    await mount();
    const before = backend.current().nodes.length;
    await paste({ files: [], getData: () => "Rain on the rooftop" });
    await settle(20);
    expect(backend.current().nodes.find((node) => node.type === "text" && node.metadata?.content === "Rain on the rooftop")).toBeDefined();

    await paste({ files: [new File(["png"], "board.png", { type: "image/png" })], getData: () => "" });
    await settle(20);
    expect(backend.current().nodes.find((node) => node.metadata?.file?.name === "board.png")?.type).toBe("image");
    expect(backend.current().nodes).toHaveLength(before + 2);
  });

  it("stops picking references on Escape pressed inside the panel, and keeps the panel open", async () => {
    await mount();
    await clickNode("shot-1");
    const add = panel()!.querySelector<HTMLButtonElement>('button[aria-label="Add references from the canvas"]')!;
    await act(async () => add.click());
    expect(host.textContent).toContain("Click nodes to add them as references");

    await act(async () => { add.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(host.textContent).not.toContain("Click nodes to add them as references");
    expect(panel()).not.toBeNull();
  });

  it("names an image node's own picture first in its references and its @ list, leaves out a clip no generation takes, and takes off only what is connected in", async () => {
    await mount();
    await act(async () => {
      await backend.applyOps(SAMPLE_PROJECT_ID, {
        ops: [
          { type: "add_node", id: "clip", nodeType: "video", position: { x: 2400, y: 0 }, metadata: { file: { path: "素材/rain.mp4", name: "rain.mp4", mime: "video/mp4", bytes: 1 } } },
          { type: "connect_nodes", fromNodeId: "clip", toNodeId: "city-night" },
          { type: "connect_nodes", fromNodeId: "logline", toNodeId: "city-night" },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await clickNode("city-night");
    const open = panel()!;
    expect([...open.querySelectorAll("[data-reference]")].map((thumb) => thumb.textContent)).toEqual(["Image 1", "Text 1"]);
    expect(open.querySelector('button[aria-label="Remove Image 1"]')).toBeNull();
    expect(open.querySelector('button[aria-label="Remove Text 1"]')).not.toBeNull();

    const prompt = open.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "@");
      prompt.setSelectionRange(1, 1);
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect([...open.querySelectorAll('[role="listbox"] [role="option"]')].map((option) => option.querySelector("span")?.textContent)).toEqual(["Image 1", "Text 1"]);
  });

  it("generates an empty image node into itself with no placeholder beside it, and draws the next picture's placeholder to its right", async () => {
    await mount({ delayMs: 40 });
    await act(async () => {
      await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "blank", nodeType: "image", position: { x: 2400, y: 600 }, metadata: { prompt: "A bride at dawn" } }] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const madeFromBlank = () => backend.current().connections.filter((connection) => connection.fromNodeId === "blank");
    await clickNode("blank");
    await act(async () => buttonByText(panel()!, "Generate")!.click());
    await settle();
    expect(nodeElement("blank")!.textContent).toContain("Generating…");
    expect(host.querySelector('[data-generation-ghost="blank"]')).toBeNull();
    await settle(120);
    expect(shown("blank")!.metadata).toMatchObject({ status: "success", file: { mime: "image/png" } });
    expect(nodeElement("blank")!.querySelector("img")).not.toBeNull();
    expect(madeFromBlank()).toEqual([]);

    await act(async () => buttonByText(panel()!, "Generate")!.click());
    await settle();
    expect(host.querySelector('[data-generation-ghost="blank"]')).not.toBeNull();
    await settle(120);
    expect(host.querySelector('[data-generation-ghost="blank"]')).toBeNull();
    expect(madeFromBlank()).toHaveLength(1);
  });

  it("draws a reply's placeholder and its connection as it draws the next picture's, and takes them away when the bot is stopped, leaving the node as it was", async () => {
    await mount({ delayMs: 150 });
    await act(async () => {
      await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "poster", nodeType: "image", position: { x: 2400, y: 600 }, metadata: { prompt: "A bride at dawn", file: { path: "素材/poster.png", name: "poster.png", mime: "image/png", bytes: 1 } } }] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const before = { nodes: backend.current().nodes, connections: backend.current().connections };
    await clickNode("poster");
    await act(async () => buttonByText(panel()!, "Generate")!.click());
    await settle();
    await clickNode("logline");
    await type(panel()!.querySelector<HTMLTextAreaElement>("textarea")!, "A tighter logline");
    await act(async () => [...panel()!.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Ask "))!.click());
    await settle();
    const picture = host.querySelector<HTMLElement>('[data-generation-ghost="poster"]')!;
    const reply = host.querySelector<HTMLElement>("[data-reply-placeholder]")!;
    expect(reply.className).toBe(picture.className);
    expect(reply.querySelector("svg")!.getAttribute("class")).toBe(picture.querySelector("svg")!.getAttribute("class"));
    const look = (path: Element) => ["fill", "stroke", "stroke-width", "stroke-dasharray"].map((name) => path.getAttribute(name));
    const replyLink = host.querySelector(`[data-ghost-connection="${reply.dataset.replyPlaceholder}"]`)!;
    expect(look(replyLink)).toEqual(look(host.querySelector('[data-ghost-connection="poster"]')!));
    expect(look(replyLink)).toEqual(["none", "var(--color-ink-tertiary)", "2", "5 5"]);

    await act(async () => buttonByText(panel()!, "Stop")!.click());
    await settle();
    expect(host.querySelector("[data-reply-placeholder]")).toBeNull();
    expect(host.querySelector(`[data-ghost-connection="${reply.dataset.replyPlaceholder}"]`)).toBeNull();
    await settle(400);
    expect(shown("logline")).toEqual(before.nodes.find((node) => node.id === "logline"));
    expect(backend.current().connections.filter((connection) => connection.fromNodeId === "logline")).toEqual(before.connections.filter((connection) => connection.fromNodeId === "logline"));
    expect(backend.current().nodes.filter((node) => node.type === "text")).toEqual(before.nodes.filter((node) => node.type === "text"));
  });

  it("takes the pointer on a node only once it drags, so a double-click on the node reaches it", async () => {
    await mount();
    const capture = vi.fn();
    stage().setPointerCapture = capture;
    const before = shown("logline")!.position;
    await act(async () => {
      pointer(nodeElement("logline")!, "pointerdown", { clientX: 100, clientY: 100 });
      pointer(stage(), "pointerup", { clientX: 100, clientY: 100 });
    });
    expect(capture).not.toHaveBeenCalled();
    await act(async () => {
      pointer(nodeElement("logline")!, "pointerdown", { clientX: 100, clientY: 100 });
      pointer(stage(), "pointermove", { clientX: 180, clientY: 100 });
      pointer(stage(), "pointerup", { clientX: 180, clientY: 100 });
    });
    await settle();
    expect(capture).toHaveBeenCalledOnce();
    expect(shown("logline")!.position.x).toBeGreaterThan(before.x);
  });

  it("hides an open panel while the canvas pans and brings it back as it was", async () => {
    await mount();
    await clickNode(botNodeId("mira"));
    await act(async () => buttonByText(panel()!, "Conversation")!.click());
    await settle();
    expect(buttonByText(panel()!, "Open the full chat")).toBeDefined();
    await act(async () => {
      pointer(stage(), "pointerdown", { clientX: 3000, clientY: 2500 });
      pointer(stage(), "pointermove", { clientX: 3100, clientY: 2550 });
    });
    expect(panel()!.parentElement!.classList.contains("invisible")).toBe(true);
    await act(async () => pointer(stage(), "pointerup", { clientX: 3100, clientY: 2550 }));
    expect(panel()!.parentElement!.classList.contains("invisible")).toBe(false);
    expect(buttonByText(panel()!, "Open the full chat")).toBeDefined();
  });

  it("leaves a left press on the canvas to move the focus, so the text being written in a node is saved", async () => {
    await mount();
    const press = (button: number) => {
      const event = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button, pointerId: 2 });
      stage().dispatchEvent(event);
      pointer(stage(), "pointerup", { button, pointerId: 2 });
      return event.defaultPrevented;
    };
    const kept: Record<string, boolean> = {};
    await act(async () => {
      kept.left = press(0);
      kept.middle = press(1);
    });
    expect(kept).toEqual({ left: false, middle: true });
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

  it("says why a generation failed in the person's language from its key, and in the server's words for any other key", async () => {
    await loadLocale("zh");
    try {
      await mount();
      const fail = (metadata: Record<string, unknown>) => act(async () => {
        await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "city-night", metadata: { status: "error", errorDetails: "gen couldn't make it: no faces", ...metadata } }] });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await fail({ errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "没有人脸" } });
      expect(nodeElement("city-night")!.querySelector('[role="alert"]')!.textContent).toContain("gen 没能生成：没有人脸");
      await fail({ errorKey: "approval.held.outbound", errorParams: null });
      expect(nodeElement("city-night")!.querySelector('[role="alert"]')!.textContent).toContain("gen couldn't make it: no faces");
    } finally {
      setLocale("en");
    }
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
