// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { onBotMenuRequest, type BotMenuRequest } from "./bot-menu-request";

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
const ledger: Bot = {
  id: "ledger", threadId: "thread-ledger", name: "Ledger", title: "", description: "", notifications: false, color: "green", unread: false,
  modelSelection: { instanceId: "fixture", model: "fixture-model" }, tasks: [], messages: [], section: "Ops",
};
vi.mock("@/state/api", async (original) => ({ ...await original<typeof import("@/state/api")>(), api: async () => ({}) }));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return { ...actual, useStore: () => ({ state: { ...actual.initialState, bots: [ledger] }, dispatch }) };
});
const { TeamCanvas } = await import("./TeamCanvas");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let requests: BotMenuRequest[];
let stopListening: () => void;
beforeEach(async () => {
  requests = [];
  stopListening = onBotMenuRequest((request) => requests.push(request));
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(createElement(TeamCanvas, {
    sections: [{ key: "Ops", name: "Ops", chiefs: [], members: [ledger] }], canManage: false, isEmpty: () => false,
    onMove: async () => {}, onInstructions: () => {}, onEditTeam: () => {}, onDeleteTeam: () => {},
  })));
});
afterEach(() => {
  act(() => root.unmount());
  stopListening();
  document.body.innerHTML = "";
  dispatch.mockReset();
});

const card = () => document.querySelector<HTMLButtonElement>('[data-bot-id="ledger"]')!;
const actions = () => document.querySelector<HTMLButtonElement>('[data-card-actions="ledger"]')!;
const asked = () => requests.map(({ botId, x, y }) => ({ botId, x, y }));
const placeActions = () => vi.spyOn(actions(), "getBoundingClientRect").mockReturnValue({ left: 300, bottom: 140 } as DOMRect);
const press = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
};

it("offers the bot's actions from a ⋯ on its card, shown on hover, keyboard focus and touch as on a sidebar row", () => {
  expect(actions().getAttribute("aria-label")).toBe("Actions for Ledger");
  expect(actions().getAttribute("aria-haspopup")).toBe("menu");
  expect(actions().className.split(" ")).toEqual(expect.arrayContaining([
    "opacity-0", "group-hover/card:opacity-100", "group-focus-within/card:opacity-100", "max-md:opacity-70", "touch:opacity-70",
  ]));
  placeActions();
  act(() => actions().click());
  expect(asked()).toEqual([{ botId: "ledger", x: 300, y: 140 }]);
});

it("asks for the menu at the pointer on a right-click on the card", () => {
  const click = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 80 });
  act(() => { card().dispatchEvent(click); });
  expect(click.defaultPrevented).toBe(true);
  expect(asked()).toEqual([{ botId: "ledger", x: 120, y: 80 }]);
});

it("asks for it below the ⋯ from the ContextMenu key or Shift+F10 on any of the card's controls", () => {
  placeActions();
  expect(press(card(), { key: "ContextMenu" }).defaultPrevented).toBe(true);
  press(actions(), { key: "F10", shiftKey: true });
  expect(press(card(), { key: "F10" }).defaultPrevented).toBe(false);
  expect(asked()).toEqual([{ botId: "ledger", x: 300, y: 140 }, { botId: "ledger", x: 300, y: 140 }]);
});

it("renames from the card's menu in the bot's profile, where its name is edited", () => {
  act(() => actions().click());
  requests[0]!.rename("ledger");
  expect(dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, section: "identity", botId: "ledger" });
});
