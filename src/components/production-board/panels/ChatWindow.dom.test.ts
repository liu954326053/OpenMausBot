// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardIndex } from "@/lib/production-board/board-index";
import { BOARD_BOTS, boarderOf, PRODUCTION_BOARD_LOOKS, productionBoardBackend, productionBoardSample } from "@/testing/production-board-sample";
import { buttonNamed, click, press, render, textOf, useBoardPage } from "../testing/dom-kit";
import { ChatWindow, type ChatSession } from "./ChatWindow";

useBoardPage();

async function open(botId: string, patch: { readOnly?: boolean; references?: string[]; stageWidth?: number } = {}) {
  const snapshot = productionBoardSample({ episodes: 4 });
  const backend = productionBoardBackend();
  const sendTask = vi.spyOn(backend, "sendTask");
  const stopBot = vi.spyOn(backend, "stopBot");
  const onClose = vi.fn();
  const sessions = new Map<string, ChatSession>();
  const root = render(createElement("div", { className: "mj-board" }, createElement(ChatWindow, {
    projectId: snapshot.project.id, bot: snapshot.bots[botId]!, look: PRODUCTION_BOARD_LOOKS[botId] ?? { color: "silver" }, index: boardIndex(snapshot), backend,
    readOnly: Boolean(patch.readOnly), references: patch.references, sessions, pictureUrl: (file) => `/files/${file.path}`,
    layer: { width: patch.stageWidth ?? 1200, height: 800 }, reserved: 0, anchorOf: () => ({ x: 100, y: 100, width: 320, height: 400 }), subscribeView: () => () => {}, zoom: () => 1, onClose, locale: "en",
  })));
  await act(async () => { await Promise.resolve(); });
  return { box: root.querySelector<HTMLElement>(".bchat")!, sendTask, stopBot, onClose, snapshot, sessions };
}

describe("a bot's chat on the board", () => {
  it("is the mockup's window: its head, the exchange, the references and the composer", async () => {
    const { box, snapshot } = await open(BOARD_BOTS.lead);
    expect(box.getAttribute("role")).toBe("dialog");
    expect(box.hasAttribute("data-board-chat")).toBe(true);
    expect(textOf(box.querySelector(".bc-head .bc-who b"))).toBe(snapshot.bots[BOARD_BOTS.lead]!.name);
    expect(box.querySelector(".bc-thread .chat-log")?.getAttribute("role")).toBe("log");
    expect(box.querySelectorAll(".chat-log .msg").length).toBeGreaterThan(0);
    expect(box.querySelectorAll(".bc-thread .quick .qbtn")).toHaveLength(2);
    expect(box.querySelector(".bc-compose textarea.bc-input")).not.toBeNull();
    expect(box.querySelector<HTMLButtonElement>(".bc-send")!.disabled).toBe(true);
    expect(box.dataset.side).toBe("r");
  });

  it("sends what is written with the references in the tray, and a quick question as it stands", async () => {
    const { box, sendTask, snapshot } = await open(boarderOf(1));
    const tiles = box.querySelectorAll(".bc-refs .rt").length;
    expect(tiles).toBeGreaterThan(0);
    const input = box.querySelector<HTMLTextAreaElement>(".bc-input")!;
    act(() => { input.value = "Tighten shot 2"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { click(box.querySelector(".bc-send")); await Promise.resolve(); });
    expect(sendTask).toHaveBeenLastCalledWith(snapshot.project.id, expect.objectContaining({ botId: boarderOf(1), text: "Tighten shot 2", references: expect.any(Array) }));
    expect(sendTask.mock.lastCall![1].references).toHaveLength(tiles);
    await act(async () => { click(box.querySelector(".quick .qbtn")); await Promise.resolve(); });
    expect(sendTask).toHaveBeenLastCalledWith(snapshot.project.id, expect.objectContaining({ text: "How far along is this episode?" }));
  });

  it("takes a reference out of the tray and adds one from the picker", async () => {
    const { box } = await open(boarderOf(1));
    const before = box.querySelectorAll(".bc-refs .rt").length;
    click(box.querySelector(".bc-refs .rt .rt-x"));
    expect(box.querySelectorAll(".bc-refs .rt")).toHaveLength(before - 1);
    click(box.querySelector(".bc-refs .rt-add"));
    expect(box.querySelector<HTMLElement>(".bc-picker")!.hidden).toBe(false);
    click(box.querySelector(".bc-picker .pk"));
    expect(box.querySelectorAll(".bc-refs .rt")).toHaveLength(before);
  });

  it("closes its picker on Escape, then itself", async () => {
    const { box, onClose } = await open(BOARD_BOTS.lead);
    click(box.querySelector(".bc-refs .rt-add"));
    press(box, "Escape");
    expect(box.querySelector<HTMLElement>(".bc-picker")!.hidden).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    press(box, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers Stop while the bot works, and only reading in an archived project", async () => {
    const working = await open(boarderOf(2));
    await act(async () => { click(buttonNamed(working.box, "Stop")); await Promise.resolve(); });
    expect(working.stopBot).toHaveBeenCalledWith(working.snapshot.project.id, boarderOf(2));
    const archived = await open(BOARD_BOTS.lead, { readOnly: true });
    expect(archived.box.querySelector<HTMLTextAreaElement>(".bc-input")!.disabled).toBe(true);
    expect(archived.box.querySelector(".quick .qbtn")).toBeNull();
  });

  it("is a sheet on a narrow stage", async () => {
    expect((await open(BOARD_BOTS.lead, { stageWidth: 700 })).box.className).toContain("is-sheet");
  });

  it("takes the references it opens with, and keeps the draft and the tray for the bot's next window", async () => {
    const { box, sessions } = await open(boarderOf(1), { references: ["ep1-shot-3-take-2"] });
    expect(box.querySelector(".bc-refs .rt-result")).not.toBeNull();
    write(box, "Slower push-in");
    expect(sessions.get(boarderOf(1))).toMatchObject({ draft: "Slower push-in", added: ["ep1-shot-3-creation"] });
  });

  it("sends with Enter, keeps Shift+Enter and a composing Enter for the words, and keeps the words when the task wasn't sent", async () => {
    const { box, sendTask } = await open(BOARD_BOTS.writer);
    const input = write(box, "One more draft");
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); });
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); });
    expect(sendTask).not.toHaveBeenCalled();
    sendTask.mockRejectedValueOnce(new Error("The bot is busy."));
    await act(async () => { press(input, "Enter"); await Promise.resolve(); });
    expect(sendTask).toHaveBeenCalledTimes(1);
    expect(textOf(box.querySelector("[role=alert]"))).toBe("The task wasn't sent: The bot is busy.");
    expect(input.value).toBe("One more draft");
  });
});

function write(box: HTMLElement, text: string): HTMLTextAreaElement {
  const input = box.querySelector<HTMLTextAreaElement>(".bc-input")!;
  act(() => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
  return input;
}
