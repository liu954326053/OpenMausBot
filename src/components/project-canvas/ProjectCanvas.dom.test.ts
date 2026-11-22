// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));

import { botNodeId, CANVAS_NODE_SIZE, type CanvasBotState } from "../../../shared/project-canvas";
import { loadLocale, setLocale } from "@/lib/i18n";
import { VIEWPORT_SAVE_DELAY_MS } from "@/lib/project-canvas/controller";
import { fitNodeSize, nodeBounds } from "@/lib/project-canvas/geometry";
import type { MemoryCanvasBackend, MemoryWork } from "@/lib/project-canvas/memory-backend";
import { PLACEMENT_GAP } from "@/lib/project-canvas/placement";
import { initialState, StoreContext, type AppState, type Bot } from "@/state/store";
import { SAMPLE_EXCHANGES, SAMPLE_LOOKS, SAMPLE_PROJECT_ID, sampleCanvasBackend, sampleCanvasSnapshot } from "@/testing/project-canvas-sample";
import { ProjectCanvas } from "./ProjectCanvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sizedObserver(width: number, height: number) {
  return class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width, height } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
}

let root: Root;
let host: HTMLElement;
let backend: MemoryCanvasBackend;

const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const nodeElement = (id: string) => host.querySelector<HTMLElement>(`[data-canvas-node="${CSS.escape(id)}"]`);
const stage = () => host.querySelector<HTMLElement>("[data-project-canvas-stage]")!;
const view = () => {
  const [, x, y, k] = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(stage().querySelector<HTMLElement>(".origin-top-left")!.style.transform)!;
  return { x: Number(x), y: Number(y), k: Number(k) };
};
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

async function mount(options: Parameters<typeof sampleCanvasBackend>[0] = {}, store?: { bots: Bot[]; dispatch: () => void }) {
  backend = sampleCanvasBackend({ delayMs: 5, ...options });
  const canvas = createElement(ProjectCanvas, { projectId: SAMPLE_PROJECT_ID, backend });
  const value = store && { state: { ...initialState, bots: store.bots } as AppState, dispatch: store.dispatch, flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() };
  await act(async () => root.render(value ? createElement(StoreContext.Provider, { value: value as never }, canvas) : canvas));
  await settle();
  await settle();
}

function heldWork() {
  const held: Array<{ work: MemoryWork; finish: () => void }> = [];
  return {
    schedule: (finish: () => void, _ms: number, work: MemoryWork) => {
      const entry = { work, finish };
      held.push(entry);
      return () => { if (held.includes(entry)) held.splice(held.indexOf(entry), 1); };
    },
    pending: () => held.map((entry) => entry.work.kind),
    async finish(kind: MemoryWork["kind"]) {
      const at = held.findIndex((entry) => entry.work.kind === kind);
      expect(at, `no ${kind} is being worked on`).toBeGreaterThanOrEqual(0);
      const [entry] = held.splice(at, 1);
      await act(async () => entry!.finish());
      await settle();
    },
  };
}

const unreadDot = (botId: string) => nodeElement(botNodeId(botId))!.querySelector<HTMLElement>("[data-bot-unread]");
const approvalCard = () => panel()!.querySelector<HTMLElement>('[data-ask-card="approval"]');

async function waitOn(card: NonNullable<CanvasBotState["waiting"]>["card"]) {
  await act(async () => backend.updateBots((snapshot) => {
    snapshot.bots.lena!.waiting = { threadId: "thread-lena", messageId: "l-9", card };
  }));
  await settle();
}

const RM_DRAFTS = { title: "Approval needed", subtitle: "rm -rf drafts", options: ["Allow", "Deny"], requestId: "req-rm", tool: "Bash", requestType: "permission" as const };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", sizedObserver(4000, 3000));
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
    for (const id of ["logline", "shot-1", "shot-1-creation", "shot-1-take-1", "city-night"]) expect(nodeElement(id)).not.toBeNull();

    const dispatch = host.querySelectorAll('[data-kind="dispatch"]');
    expect(dispatch).toHaveLength(3);
    for (const line of dispatch) expect(line.tagName.toLowerCase()).toBe("path");
    expect(host.querySelectorAll('[data-kind="content"]')).toHaveLength(6);

    const bot = nodeElement(botNodeId("kai"))!;
    expect(bot.querySelector('[data-handle="target"]')).not.toBeNull();
    expect(bot.querySelector('[data-handle="source"]')).toBeNull();
    expect(bot.textContent).toContain("Writing the rooftop scene");
  });

  it("opens a node's panel on a click and keeps one panel open at a time", async () => {
    await mount();
    await clickNode("shot-1");
    expect(panel()!.querySelector('textarea[aria-label="Shot prompt"]')).not.toBeNull();
    expect(nodeElement("shot-1")!.querySelectorAll("[data-resize-corner]")).toHaveLength(4);

    await clickNode(botNodeId("mira"));
    expect(host.querySelectorAll("[data-node-panel]")).toHaveLength(1);
    expect(buttonByText(panel()!, "Send")).toBeDefined();
    expect(nodeElement("shot-1")!.querySelectorAll("[data-resize-corner]")).toHaveLength(0);
  });

  it("opens with the node of the bot it is opened for chosen", async () => {
    backend = sampleCanvasBackend({ delayMs: 5 });
    await act(async () => root.render(createElement(ProjectCanvas, { projectId: SAMPLE_PROJECT_ID, backend, selectedBotId: "kai" })));
    await settle();
    await settle();
    expect(["mira", "kai", "lena"].map((id) => nodeElement(botNodeId(id))!.querySelectorAll("[data-resize-corner]").length)).toEqual([0, 4, 0]);
    expect(panel()).toBeNull();
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

  it("words a bot's approval as the chat does in the person's language, answered in the conversation where the page has no app store", async () => {
    await loadLocale("zh");
    try {
      await mount();
      await waitOn(RM_DRAFTS);
      await clickNode(botNodeId("lena"));
      const card = approvalCard()!;
      expect(card.textContent).toContain("Lena 想执行命令");
      expect(card.textContent).toContain("rm -rf drafts");
      expect(panel()!.textContent).not.toContain("Approval needed");
      expect(card.querySelector("[data-canvas-action]")).toBeNull();
      await act(async () => buttonByText(card, "到对话里回答")!.click());
      expect(backend.openedChats).toEqual([{ botId: "lena", threadId: "thread-lena" }]);
    } finally {
      setLocale("en");
    }
  });

  it("puts the chat's own approve and deny on a bot's approval card in the app", async () => {
    const dispatch = vi.fn();
    await mount({}, { bots: [{ id: "lena", name: "Lena", color: "coral", threadId: "thread-lena", tasks: [] } as unknown as Bot], dispatch });
    await waitOn(RM_DRAFTS);
    await clickNode(botNodeId("lena"));
    const card = approvalCard()!;
    expect(buttonByText(card, "Answer in the conversation")).toBeUndefined();
    expect(card.querySelector("[data-canvas-action=allow]")!.textContent).toBe("Allow once");
    await act(async () => card.querySelector<HTMLElement>("[data-canvas-action=allow]")!.click());
    await act(async () => card.querySelector<HTMLElement>("[data-canvas-action=deny]")!.click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "decideRequest", threadId: "thread-lena", requestId: "req-rm", behavior: "allow" },
      { type: "decideRequest", threadId: "thread-lena", requestId: "req-rm", behavior: "deny", message: "Denied by the user." },
    ]);
  });

  it("names a bot's question as the chat does, not by the server's title", async () => {
    await mount();
    await waitOn({ title: "Your bot has a question", subtitle: "Which page first?", options: ["Home", "Pricing"], requestId: "req-q", requestType: "question" });
    await clickNode(botNodeId("lena"));
    expect(panel()!.textContent).toContain("Lena has a question");
    expect(panel()!.textContent).toContain("Which page first?");
    expect(panel()!.textContent).not.toContain("Your bot has a question");
  });

  it("marks a bot with an unread reply with the app's unread dot, and reads its conversation when its panel opens", async () => {
    await mount({ looks: { ...SAMPLE_LOOKS, mira: { ...SAMPLE_LOOKS.mira!, unread: true } } });
    expect(unreadDot("mira")!.getAttribute("aria-label")).toBe("Unread");
    expect(["kai", "lena", "otto"].map(unreadDot)).toEqual([null, null, null]);
    await clickNode(botNodeId("mira"));
    await settle();
    expect(backend.readConversations).toEqual([{ botId: "mira", threadId: "thread-mira" }]);
    expect(unreadDot("mira")).toBeNull();
  });

  it("reads a reply that comes while the bot's panel is open, and leaves one that comes after it closed unread", async () => {
    await mount({ delayMs: 40 });
    await clickNode(botNodeId("otto"));
    await type(panel()!.querySelector("textarea")!, "Cut the teaser");
    await act(async () => buttonByText(panel()!, "Send")!.click());
    await settle(80);
    expect(nodeElement(botNodeId("otto"))!.textContent).toContain("Done: Cut the teaser");
    expect(unreadDot("otto")).toBeNull();
    expect(backend.readConversations).toEqual([{ botId: "otto", threadId: "thread-otto" }]);

    await key({ key: "Escape" });
    expect(panel()).toBeNull();
    await act(async () => { await backend.sendTask(backend.current().project.id, { botId: "otto", text: "Make it shorter" }); });
    await settle(80);
    expect(nodeElement(botNodeId("otto"))!.textContent).toContain("Done: Make it shorter");
    expect(unreadDot("otto")).not.toBeNull();
    expect(backend.readConversations).toHaveLength(1);
  });

  it("reads a bot's conversation on opening its panel with the window in the background, and leaves what comes in while the person is away unread", async () => {
    const away = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      await mount({ delayMs: 40, looks: { ...SAMPLE_LOOKS, otto: { ...SAMPLE_LOOKS.otto!, unread: true } } });
      await clickNode(botNodeId("otto"));
      await settle();
      expect(unreadDot("otto")).toBeNull();
      await type(panel()!.querySelector("textarea")!, "Cut the teaser");
      await act(async () => buttonByText(panel()!, "Send")!.click());
      await settle(80);
      expect(nodeElement(botNodeId("otto"))!.textContent).toContain("Done: Cut the teaser");
      expect(unreadDot("otto")).not.toBeNull();
      expect(backend.readConversations).toEqual([{ botId: "otto" }]);
    } finally {
      away.mockRestore();
    }
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

  it("lets a shot's creation node override a setting, restore the project default, then follow the project when its default changes", async () => {
    await mount();
    const chips = () => nodeElement("shot-1-creation")!.textContent ?? "";
    expect(chips()).toContain("10s");

    await clickNode("shot-1-creation");
    const summary = [...panel()!.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')][0]!;
    await act(async () => summary.click());
    await act(async () => buttonByText(panel()!, "Restore default")!.click());
    await settle();
    expect(shown("shot-1-creation")!.metadata?.settings).toBeUndefined();
    expect(chips()).toContain("5s");

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Project settings"]')!.click());
    await settle();
    const dialog = document.body.querySelector<HTMLElement>("[data-project-canvas-settings]")!;
    await choose(dialog.querySelector<HTMLSelectElement>('select[aria-label="Duration"]')!, "10");
    await act(async () => buttonByText(dialog, "Save")!.click());
    await settle();
    expect(document.body.querySelector("[data-project-canvas-settings]")).toBeNull();
    expect(chips()).toContain("10s");
    expect(shown("shot-1-creation")!.metadata?.settings).toBeUndefined();
  });

  it("asks a bot to revise a text node's text, draws the node its reply becomes beside it while the bot writes, and the reply takes exactly that place", async () => {
    const work = heldWork();
    await mount({ schedule: work.schedule });
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
    await work.finish("task");
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
    const work = heldWork();
    await mount({ schedule: work.schedule });
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
    await work.finish("generation");
    expect(shown("blank")!.metadata).toMatchObject({ status: "success", file: { mime: "image/png" } });
    expect(nodeElement("blank")!.querySelector("img")).not.toBeNull();
    expect(madeFromBlank()).toEqual([]);

    await act(async () => buttonByText(panel()!, "Generate")!.click());
    await settle();
    expect(host.querySelector('[data-generation-ghost="blank"]')).not.toBeNull();
    await work.finish("generation");
    expect(host.querySelector('[data-generation-ghost="blank"]')).toBeNull();
    expect(madeFromBlank()).toHaveLength(1);
  });

  it("draws a reply's placeholder and its connection as it draws the next picture's, and takes them away when the bot is stopped, leaving the node as it was", async () => {
    const work = heldWork();
    await mount({ schedule: work.schedule });
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
    expect(work.pending(), "the stopped task will never finish").toEqual(["generation"]);
    await work.finish("generation");
    expect(shown("logline")).toEqual(before.nodes.find((node) => node.id === "logline"));
    expect(backend.current().connections.filter((connection) => connection.fromNodeId === "logline")).toEqual(before.connections.filter((connection) => connection.fromNodeId === "logline"));
    expect(backend.current().nodes.filter((node) => node.type === "text")).toEqual(before.nodes.filter((node) => node.type === "text"));
  });

  it("scrolls a text node's text that is longer than the node on a wheel and from its scrollbar, and zooms on a pinch or over text that fits", async () => {
    await mount();
    const text = () => nodeElement("logline")!.querySelector<HTMLElement>("[data-canvas-scroll]")!;
    const view = () => (stage().firstElementChild as HTMLElement).style.transform;
    const wheel = async ({ ctrlKey = false }: { ctrlKey?: boolean } = {}) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
      Object.defineProperties(event, { clientX: { value: 100 }, clientY: { value: 100 }, ctrlKey: { value: ctrlKey } });
      await act(async () => { text().dispatchEvent(event); });
      return event.defaultPrevented;
    };
    const longer = (element: HTMLElement) => Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 448 }, clientWidth: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 308 }, getBoundingClientRect: { configurable: true, value: () => new DOMRect(50, 40, 308 * 0.5, 448 * 0.5) },
    });
    const fits = view();
    expect(await wheel()).toBe(true);
    expect(view()).not.toBe(fits);
    longer(text());
    const scrolled = view();
    expect(await wheel()).toBe(false);
    expect(view()).toBe(scrolled);
    expect(await wheel({ ctrlKey: true })).toBe(true);
    expect(view()).not.toBe(scrolled);

    const pressAndDrag = async (clientX: number) => {
      await act(async () => {
        pointer(text(), "pointerdown", { clientX, clientY: 100 });
        pointer(stage(), "pointermove", { clientX: clientX + 80, clientY: 100 });
        pointer(stage(), "pointerup", { clientX: clientX + 80, clientY: 100 });
      });
      await settle();
      return shown("logline")!.position;
    };
    const before = shown("logline")!.position;
    expect(await pressAndDrag(202)).toEqual(before);
    Object.defineProperty(text(), "clientLeft", { configurable: true, value: 8 });
    expect(await pressAndDrag(52)).toEqual(before);
    expect((await pressAndDrag(120)).x).toBeGreaterThan(before.x);
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
    expect(panel()!.classList.contains("invisible")).toBe(true);
    await act(async () => pointer(stage(), "pointerup", { clientX: 3100, clientY: 2550 }));
    expect(panel()!.classList.contains("invisible")).toBe(false);
    expect(buttonByText(panel()!, "Open the full chat")).toBeDefined();
  });

  it("keeps a bot's panel wholly on the canvas at its left, right and bottom edges, the node and the view where they were", async () => {
    const start = sampleCanvasSnapshot();
    const otto = start.nodes.find((one) => one.id === botNodeId("otto"))!;
    const panelWithNodeAt = async (screen: { x: number; y: number }) => {
      act(() => root.unmount());
      root = createRoot(host);
      await mount({ snapshot: { ...start, viewport: { x: screen.x - otto.position.x, y: screen.y - otto.position.y, k: 1 } } });
      const world = stage().firstElementChild as HTMLElement;
      const drawn = () => ({ node: nodeElement(otto.id)!.getAttribute("style"), view: world.style.transform });
      const before = drawn();
      await clickNode(otto.id);
      expect(drawn()).toEqual(before);
      const { left, top, width } = panel()!.style;
      return { left, top, width };
    };
    expect(await panelWithNodeAt({ x: 20, y: 200 })).toEqual({ left: "16px", top: "396px", width: "600px" });
    expect(await panelWithNodeAt({ x: 4000 - 20 - 300, y: 200 })).toEqual({ left: `${4000 - 16 - 600}px`, top: "396px", width: "600px" });
    expect(await panelWithNodeAt({ x: 1800, y: 3000 - 20 - 180 })).toEqual({ left: `${1800 + 150 - 300}px`, top: `${3000 - 20 - 180 - 28 - 16}px`, width: "600px" });
  });

  it("draws an open panel on the screen above the minimap, outside the zoomed canvas and its node", async () => {
    await mount();
    await clickNode(botNodeId("mira"));
    const shown = panel()!;
    const minimap = host.querySelector('[role="img"][aria-label="Minimap"]')!;
    expect((stage().firstElementChild as HTMLElement).style.transform).toContain("scale(");
    expect(stage().firstElementChild!.contains(shown)).toBe(false);
    const canvasArea = minimap.closest(".isolate")!;
    const zIndex = (element: Element) => Number(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(element.className)?.[1]);
    const layersUpTo = (element: Element) => {
      const layers: Element[] = [];
      for (let at: Element = element; at !== canvasArea; at = at.parentElement!) {
        if (!Number.isNaN(zIndex(at)) || (at as HTMLElement).style.transform || at.classList.contains("isolate")) layers.push(at);
      }
      return layers;
    };
    const [panelLayer, ...underPanel] = layersUpTo(shown);
    const [minimapLayer, ...underMinimap] = layersUpTo(minimap);
    expect([panelLayer, underPanel, underMinimap]).toEqual([shown, [], []]);
    expect(zIndex(panelLayer!)).toBeGreaterThan(zIndex(minimapLayer!));
  });

  it("shows a picture a person sent in the panel's conversation as the chat does, folded, never its tag or its path", async () => {
    const picture = "/tmp/omb-data/attachments/278b7337-3b67-4e33-afe3-0a444e40c67a.png";
    const asked = ["Add a twist", "", "Connected to your node on the project's canvas:", "", "Text 1:", "", "> The bride is swapped at the altar.", "", 'Image 1 "chapel.png":', "", `<attached-image path="${picture}" name="chapel.png"/>`].join("\n");
    await mount({ exchanges: { ...SAMPLE_EXCHANGES, otto: [{ id: "o-1", role: "person", text: asked, at: 1 }, { id: "o-2", role: "bot", text: "The stand-in is the bride's lost sister.", at: 2 }] } });
    await clickNode(botNodeId("otto"));
    await act(async () => buttonByText(panel()!, "Conversation")!.click());
    await settle();
    const shown = panel()!;
    expect(shown.textContent).toContain("The stand-in is the bride's lost sister.");
    expect([...shown.querySelectorAll("img")].map((image) => [image.getAttribute("src"), image.getAttribute("alt")])).toEqual([["/api/attachments/278b7337-3b67-4e33-afe3-0a444e40c67a.png", "chapel.png"]]);
    const words = [...shown.querySelectorAll(".whitespace-pre-wrap")].find((one) => one.textContent?.startsWith("Add a twist"))!;
    expect(words.textContent).toBe(asked.slice(0, asked.indexOf("\n\n<attached-image")));
    expect(words.classList.contains("max-h-40")).toBe(true);
    const leaks = () => ["attached-image", "/tmp/omb-data"].filter((raw) => shown.innerHTML.includes(raw));
    expect(leaks()).toEqual([]);
    await act(async () => buttonByText(shown, "Show full message")!.click());
    expect(words.classList.contains("max-h-40")).toBe(false);
    expect(buttonByText(shown, "Show less")).toBeDefined();
    expect(leaks()).toEqual([]);
  });

  it("opens the panel's conversation at its latest message and follows what comes in while the reader stays at the end, as the chat does", async () => {
    const resized = new Map<Element, () => void>();
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const report = () => this.callback([{ target, contentRect: { width: 4000, height: 3000 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
        resized.set(target, report);
        report();
      }
      unobserve() {}
      disconnect() {}
    });
    let tall = 1000;
    const inConversation = (element: Element) => element.hasAttribute("data-panel-conversation");
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!.get!;
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")!.get!;
    const spies = [
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) { return inConversation(this) ? tall : scrollHeight.call(this); }),
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return inConversation(this) ? 288 : clientHeight.call(this); }),
    ];
    try {
      await mount();
      await clickNode(botNodeId("otto"));
      await act(async () => buttonByText(panel()!, "Conversation")!.click());
      await settle();
      const scroller = panel()!.querySelector<HTMLElement>("[data-panel-conversation]")!;
      expect(scroller.scrollTop).toBe(1000);
      const grow = (height: number) => act(() => { tall = height; resized.get(scroller.firstElementChild!)!(); });
      const scrollTo = (top: number) => act(() => { scroller.scrollTop = top; scroller.dispatchEvent(new Event("scroll")); });
      await grow(1400);
      expect(scroller.scrollTop).toBe(1400);
      await scrollTo(200);
      await grow(1800);
      expect(scroller.scrollTop).toBe(200);
      await scrollTo(1800 - 288);
      await grow(2000);
      expect(scroller.scrollTop).toBe(2000);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
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

  it("opens a canvas nobody set a view on at 100%, from the top left of its nodes when they do not fit, without storing that view, and a stored view as it was", async () => {
    vi.stubGlobal("ResizeObserver", sizedObserver(1200, 800));
    await mount();
    const opened = view();
    const bounds = nodeBounds(backend.current().nodes);
    expect(bounds.right - bounds.left).toBeGreaterThan(1200);
    expect(opened).toEqual({ x: 80 - bounds.left, y: 80 - bounds.top, k: 1 });
    await settle(VIEWPORT_SAVE_DELAY_MS + 50);
    expect(backend.current().viewport).toEqual({ x: 0, y: 0, k: 1 });

    act(() => root.unmount());
    root = createRoot(host);
    await mount({ snapshot: { ...sampleCanvasBackend().current(), viewport: { x: 40, y: 30, k: 0.5 } } });
    expect(view()).toEqual({ x: 40, y: 30, k: 0.5 });
  });

  it("puts nodes added from the toolbar and an upload into free space, and never moves a bot", async () => {
    await mount();
    const bots = () => backend.current().nodes.filter((node) => node.type === "bot").map((node) => ({ id: node.id, position: node.position }));
    const before = new Set(backend.current().nodes.map((node) => node.id));
    const botsBefore = bots();
    const addText = host.querySelector<HTMLButtonElement>('button[aria-label="Add text"]')!;
    for (let count = 0; count < 3; count += 1) await act(async () => addText.click());
    await settle(20);
    await paste({ files: [new File(["png"], "board.png", { type: "image/png" })], getData: () => "" });
    await settle(20);
    const added = backend.current().nodes.filter((node) => !before.has(node.id));
    expect(added.map((node) => node.type)).toEqual(["text", "text", "text", "image"]);
    for (const node of added) {
      const crowding = backend.current().nodes.filter((other) => other.id !== node.id && !(
        node.position.x >= other.position.x + other.width + PLACEMENT_GAP || other.position.x >= node.position.x + node.width + PLACEMENT_GAP
        || node.position.y >= other.position.y + other.height + PLACEMENT_GAP || other.position.y >= node.position.y + node.height + PLACEMENT_GAP));
      expect(crowding.map((other) => other.id)).toEqual([]);
    }
    expect(bots()).toEqual(botsBefore);
    expect(Object.values(backend.current().bots).every((bot) => bot.placed)).toBe(true);
  });

  it("moves a picture that grows as it loads off the node below it into free space, and never moves a bot", async () => {
    await mount();
    const bots = () => backend.current().nodes.filter((node) => node.type === "bot").map((node) => ({ id: node.id, position: node.position }));
    const botsBefore = bots();
    const below = { x: 2400, y: 600 + CANVAS_NODE_SIZE.image.height + PLACEMENT_GAP };
    await act(async () => {
      await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [
        { type: "add_node", id: "tall", nodeType: "image", position: { x: 2400, y: 600 }, metadata: { file: { path: "outputs/tall.png", mime: "image/png", bytes: 900, name: "tall.png" } } },
        { type: "add_node", id: "under", nodeType: "text", position: below, metadata: { content: "Scene two" } },
      ] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle(20);
    const picture = nodeElement("tall")!.querySelector("img")!;
    Object.defineProperty(picture, "naturalWidth", { value: 27 });
    Object.defineProperty(picture, "naturalHeight", { value: 48 });
    await act(async () => { picture.dispatchEvent(new Event("load")); });
    await settle(20);
    const tall = shown("tall")!;
    expect(tall).toMatchObject({ ...fitNodeSize(27, 48), metadata: { naturalWidth: 27, naturalHeight: 48 } });
    expect(shown("under")!.position).toEqual(below);
    const crowding = backend.current().nodes.filter((other) => other.id !== tall.id && !(
      tall.position.x >= other.position.x + other.width + PLACEMENT_GAP || other.position.x >= tall.position.x + tall.width + PLACEMENT_GAP
      || tall.position.y >= other.position.y + other.height + PLACEMENT_GAP || other.position.y >= tall.position.y + tall.height + PLACEMENT_GAP));
    expect(crowding.map((other) => other.id)).toEqual([]);
    expect(bots()).toEqual(botsBefore);
  });

  it("says a project's folder is missing in the sidebar's words", async () => {
    await loadLocale("zh");
    try {
      const snapshot = sampleCanvasBackend().current();
      await mount({ snapshot: { ...snapshot, project: { ...snapshot.project, folderState: "missing" } } });
      expect(host.querySelector("header")!.textContent).toContain("找不到项目文件夹");
      expect(host.querySelector("header")!.textContent).not.toContain("文件夹不见了");
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
