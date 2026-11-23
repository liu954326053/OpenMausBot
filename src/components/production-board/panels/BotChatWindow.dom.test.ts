// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasSnapshot } from "../../../../shared/project-canvas";
import { setLocale } from "@/lib/i18n";
import { renderOverlay, type OverlayHarness } from "./testing/render-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let harness: OverlayHarness;

afterEach(() => {
  harness.unmount();
  setLocale("en");
});

const card = { width: 320, height: 240 };
const chat = () => harness.host.querySelector<HTMLElement>("[data-board-chat]");
const composer = () => chat()!.querySelector<HTMLTextAreaElement>("textarea")!;
const picker = () => chat()!.querySelector<HTMLElement>("[data-reference-picker]");
const named = (name: string, scope: ParentNode = chat()!) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.getAttribute("aria-label") === name || each.textContent?.trim() === name);
const chipIds = () => [...chat()!.querySelectorAll<HTMLElement>("[data-reference]")].map((chip) => chip.getAttribute("data-reference"));
const click = (element: HTMLElement) => act(async () => {
  element.click();
});
const typeInto = (field: HTMLTextAreaElement | HTMLInputElement, text: string) => act(async () => {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const press = (element: HTMLElement, init: KeyboardEventInit) => act(async () => {
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
});
const sized = (element: HTMLElement, width: number, height: number) => {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
};

async function openChat(botId: string, references?: string[]) {
  await harness.update({ opened: { kind: "bot", botId, ...(references ? { references } : {}) } });
  await harness.settle();
}

function withBot(snapshot: CanvasSnapshot, botId: string, change: Partial<CanvasSnapshot["bots"][string]>): CanvasSnapshot {
  return { ...snapshot, bots: { ...snapshot.bots, [botId]: { ...snapshot.bots[botId]!, ...change } } };
}

describe("a bot's chat window", () => {
  it("sits beside the bot's card, follows it as the board moves, flips to stay on the screen and docks without a card", async () => {
    harness = await renderOverlay();
    harness.anchors.set("bot:board-2", { x: 100, y: 200, ...card });
    await openChat("board-2");
    const window = chat()!;
    expect(window.getAttribute("role")).toBe("dialog");
    expect(window.getAttribute("aria-label")).toBe("Chat with 镜川 EP02");
    sized(window, 384, 500);
    await harness.moveView();
    expect(window.dataset.placement).toBe("beside");
    expect(window.style.transform).toBe("translate(436px, 200px)");
    harness.anchors.set("bot:board-2", { x: 900, y: 240, ...card });
    await harness.moveView();
    expect(window.style.transform).toBe("translate(500px, 240px)");
    harness.anchors.delete("bot:board-2");
    await harness.moveView();
    expect(window.dataset.placement).toBe("docked");
    expect(window.style.transform).toBe("translate(736px, 12px)");
  });

  it("becomes a sheet along the bottom of a narrow board", async () => {
    harness = await renderOverlay({}, { width: 700, height: 800 });
    harness.anchors.set("bot:board-2", { x: 100, y: 200, ...card });
    await openChat("board-2");
    expect(chat()!.dataset.placement).toBe("sheet");
    expect(chat()!.style.transform).toBe("");
  });

  it("puts the cursor in the composer and closes with its button or Escape", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    expect(document.activeElement).toBe(composer());
    await click(named("Close")!);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(chat()).toBeNull();
    await openChat("writer");
    await press(composer(), { key: "Escape" });
    expect(harness.close).toHaveBeenCalledTimes(2);
  });

  it("shows the bot's latest exchange and reads it again when the bot moves on", async () => {
    harness = await renderOverlay();
    await openChat("board-2");
    expect(chat()!.textContent).toContain("追逐那场节奏再快一点。");
    expect(chat()!.textContent).toContain("收到，SH03 拆成两个 3 秒的镜头，正在重新生成。");
    const reads = harness.fake.calls.exchanges.length;
    await harness.update({ snapshot: withBot(harness.current().snapshot, "board-2", { status: "idle" }) });
    await harness.settle();
    expect(harness.fake.calls.exchanges).toHaveLength(reads + 1);
    await harness.update({ snapshot: { ...harness.current().snapshot, revision: 99 } });
    await harness.settle();
    expect(harness.fake.calls.exchanges).toHaveLength(reads + 1);
  });

  it("says what goes here when nothing was said yet, and marks replies read as opening the chat does", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    expect(chat()!.textContent).toContain("Nothing said yet. What should 墨白 do?");
    expect(harness.fake.calls.read).toEqual([]);
    await openChat("board-2");
    expect(harness.fake.calls.read).toEqual([{ botId: "board-2" }]);
  });

  it("sends the task, leaving what is connected to the server, and shows it in the exchange", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    expect(chipIds()).toEqual(["brief"]);
    expect(chat()!.querySelector("[data-reference='brief'] button")).toBeNull();
    await typeInto(composer(), "把第三集写得更紧凑。");
    await click(named("Send")!);
    await harness.settle();
    expect(harness.fake.calls.sent).toEqual([{ botId: "writer", text: "把第三集写得更紧凑。", language: "en" }]);
    expect(composer().value).toBe("");
    expect(chat()!.textContent).toContain("把第三集写得更紧凑。");
  });

  it("offers a storyboard bot every character and scene without lines, and sends the ones the person keeps", async () => {
    harness = await renderOverlay();
    await openChat("board-2");
    expect(chipIds()).toEqual([
      "episode-2",
      "profile-qingwu", "profile-chenzhou", "profile-baixiansheng", "profile-aman",
      "profile-pier", "profile-shop", "profile-lighthouse", "profile-street", "profile-pier-end",
    ]);
    await click(named("Remove 沈青梧")!);
    expect(chipIds()).not.toContain("profile-qingwu");
    await typeInto(composer(), "雾再浓一点");
    await click(named("Send")!);
    await harness.settle();
    const { text } = harness.fake.calls.sent[0]!;
    expect(text.startsWith("雾再浓一点\n\nAlso work from these on the project's canvas")).toBe(true);
    expect(text).toContain("- Character \"陆沉舟\" (node profile-chenzhou)");
    expect(text).toContain("- Scene \"栈桥尽头\" (node profile-pier-end)");
    expect(text).not.toContain("profile-qingwu");
    expect(text).not.toContain("episode-2");
  });

  it("takes the references it opens with, and keeps a bot's draft and references while it is closed", async () => {
    harness = await renderOverlay();
    await openChat("board-1", ["take-1-3-2"]);
    expect(chipIds()).toContain("creation-1-3");
    await typeInto(composer(), "换个角度");
    await harness.update({ opened: null });
    await openChat("writer");
    expect(composer().value).toBe("");
    await openChat("board-1");
    expect(composer().value).toBe("换个角度");
    expect(chipIds()).toContain("creation-1-3");
  });

  it("adds references from the board with the picker", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    await click(named("Add a reference")!);
    expect(picker()!.textContent).toContain("Characters");
    expect(picker()!.querySelector("[data-pick='brief']")).toBeNull();
    await typeInto(picker()!.querySelector("input")!, "灯塔");
    expect([...picker()!.querySelectorAll("[data-pick]")].map((each) => each.getAttribute("data-pick"))).toEqual(["profile-lighthouse"]);
    await click(picker()!.querySelector<HTMLElement>("[data-pick='profile-lighthouse']")!);
    expect(chipIds()).toEqual(["brief", "profile-lighthouse"]);
    expect(picker()!.textContent).toContain("Nothing matches.");
    await click(named("Done")!);
    expect(picker()).toBeNull();
  });

  it("keeps the way to add a reference outside the list, which scrolls when it is long", async () => {
    harness = await renderOverlay();
    await openChat("board-2");
    expect(named("Add a reference")!.closest("ul")).toBeNull();
    await openChat("lead");
    expect(chipIds()).toEqual([]);
    expect(chat()!.querySelector("ul")).toBeNull();
    expect(named("Add a reference")).toBeDefined();
  });

  it("closes the picker before the window with Escape", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    await click(named("Add a reference")!);
    await press(picker()!.querySelector("input")!, { key: "Escape" });
    expect(picker()).toBeNull();
    expect(harness.close).not.toHaveBeenCalled();
    expect(chat()).not.toBeNull();
  });

  it("sends with Enter and keeps Shift+Enter and a composing Enter for the words", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    await typeInto(composer(), "第一行");
    await press(composer(), { key: "Enter", shiftKey: true });
    await press(composer(), { key: "Enter", isComposing: true });
    expect(harness.fake.calls.sent).toEqual([]);
    await press(composer(), { key: "Enter" });
    await harness.settle();
    expect(harness.fake.calls.sent).toHaveLength(1);
  });

  it("keeps the words and says why when the task wasn't sent", async () => {
    harness = await renderOverlay();
    await openChat("writer");
    harness.fake.failNextSend("The bot is busy.");
    await typeInto(composer(), "再写一版");
    await click(named("Send")!);
    await harness.settle();
    expect(chat()!.querySelector("[role=alert]")?.textContent).toBe("The task wasn't sent: The bot is busy.");
    expect(composer().value).toBe("再写一版");
  });

  it("says when the task waits in the bot's queue", async () => {
    harness = await renderOverlay();
    await openChat("board-2");
    harness.fake.queueNextSend();
    await typeInto(composer(), "SH05 改成缓慢推近");
    await click(named("Send")!);
    await harness.settle();
    expect(chat()!.textContent).toContain("Queued: 镜川 EP02 reads it after the current work.");
  });

  it("stops a busy bot and opens its conversation in the chat", async () => {
    harness = await renderOverlay();
    await openChat("board-2");
    await click(named("Stop")!);
    expect(harness.fake.calls.stopped).toEqual(["board-2"]);
    await click(named("Open in the chat")!);
    expect(harness.fake.calls.chats).toEqual([{ botId: "board-2" }]);
    await openChat("writer");
    expect(named("Stop")).toBeUndefined();
  });

  it("shows the question a bot waits on, answered in the chat", async () => {
    harness = await renderOverlay();
    await openChat("board-3");
    expect(chat()!.textContent).toContain("镜川 EP03 has a question");
    await click(named("Answer in the chat")!);
    expect(harness.fake.calls.chats).toEqual([{ botId: "board-3", threadId: "thread-board-3" }]);
  });

  it("takes no task in an archived project", async () => {
    harness = await renderOverlay();
    await harness.update({ snapshot: { ...harness.current().snapshot, readOnly: "archived" } });
    await openChat("writer");
    expect(composer().disabled).toBe(true);
    expect(named("Send")!.disabled).toBe(true);
    expect(chat()!.textContent).toContain("This project is archived, so it takes no new tasks.");
  });

  it("closes when its bot leaves the project", async () => {
    harness = await renderOverlay();
    await openChat("publicist");
    const { publicist: _left, ...bots } = harness.current().snapshot.bots;
    await harness.update({ snapshot: { ...harness.current().snapshot, bots } });
    expect(harness.close).toHaveBeenCalled();
    expect(chat()).toBeNull();
  });
});
