// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Group } from "@/state/store";

const copied = vi.hoisted(() => vi.fn(async (_text: string) => true));
vi.mock("@/lib/copy-text", () => ({ copyText: copied }));

const { TeamMapRooms } = await import("./TeamMapRooms");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");

const room = (id: string, name: string, extra: Partial<Group> = {}): Group => ({
  id, threadId: `${id}-thread`, name, memberIds: ["pen", "ink"], messages: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
  ...extra,
});
const state: AppState = {
  ...initialState,
  connected: true,
  activeView: "team-map",
  groups: [room("launch", "Launch room", { description: "Plans" }), room("desk", "Pen ⇄ Ink", { dm: true })],
};

const dispatch = vi.fn();
let root: Root, host: HTMLDivElement;
const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const menu = () => q("[data-room-menu]");
const items = () => [...document.querySelectorAll<HTMLElement>("[data-room-menu] [role=menuitem]")].map((one) => one.textContent);
const itemNamed = (name: string) => [...document.querySelectorAll<HTMLElement>("[data-room-menu] [role=menuitem]")].find((one) => one.textContent === name)!;
const rowOf = (id: string) => q(`[data-team-map-room="${id}"]`)!;
const actionsOf = (id: string) => q(`[data-team-map-room-actions="${id}"]`)!;
const dialog = () => q("[role=alertdialog]");
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  flushSync(() => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const click = (target: HTMLElement) => flushSync(() => target.click());
const deletes = () => dispatch.mock.calls.filter(([action]) => action.type === "deleteGroup");
const patches = () => dispatch.mock.calls.filter(([action]) => action.type === "patchGroup").map(([action]) => action);

function type(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
}
function openFromButton(id: string) {
  const button = actionsOf(id);
  button.focus();
  click(button);
}

beforeEach(() => {
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  dispatch.mockClear();
  copied.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(TeamMapRooms) })));
  q("details")!.setAttribute("open", "");
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  delete (window as { ogb?: unknown }).ogb;
});

describe("a group chat on the team map", () => {
  it("has an actions button beside it, shown on hover, on keyboard focus and always on touch", () => {
    const actions = actionsOf("launch");
    expect(actions).not.toBe(rowOf("launch"));
    expect(actions.getAttribute("aria-label")).toBe("Actions for Launch room");
    expect(actions.getAttribute("aria-haspopup")).toBe("menu");
    expect(actions.getAttribute("aria-expanded")).toBe("false");
    for (const reveal of ["opacity-0", "group-hover/room:opacity-100", "group-focus-within/room:opacity-100", "focus-visible:opacity-100", "touch:opacity-100"]) {
      expect(actions.className.split(" ")).toContain(reveal);
    }
  });

  it("opens its menu from the button, without moving to a department, and keeps the list open", () => {
    openFromButton("launch");
    expect(menu()?.getAttribute("role")).toBe("menu");
    expect(menu()?.getAttribute("aria-label")).toBe("Actions for Launch room");
    expect(items()).toEqual(["Rename group chat", "Set description", "Copy conversation ID", "Delete group chat"]);
    expect(document.activeElement).toBe(itemNamed("Rename group chat"));
    expect(actionsOf("launch").getAttribute("aria-expanded")).toBe("true");
    expect(actionsOf("launch").className.split(" ")).toContain("opacity-100");
    expect(q("details")!.hasAttribute("open")).toBe(true);
  });

  it("opens the same menu where it is right-clicked", () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
    flushSync(() => rowOf("launch").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(items()).toEqual(["Rename group chat", "Set description", "Copy conversation ID", "Delete group chat"]);
    expect(menu()!.style.left).toBe("120px");
    expect(menu()!.style.top).toBe("90px");
  });

  it("opens it from the ContextMenu key and Shift+F10, and Escape gives focus back to the row", () => {
    const row = rowOf("launch");
    row.focus();
    press(row, "ContextMenu");
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(itemNamed("Rename group chat"));
    press(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(row);

    press(row, "F10");
    expect(menu()).toBeNull();
    press(row, "F10", { shiftKey: true });
    expect(menu()).not.toBeNull();
    press(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(row);
  });

  it("moves through its items with the arrow keys, Home and End", () => {
    openFromButton("launch");
    press(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(itemNamed("Set description"));
    press(document.activeElement!, "End");
    expect(document.activeElement).toBe(itemNamed("Delete group chat"));
    press(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(itemNamed("Rename group chat"));
    press(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(itemNamed("Delete group chat"));
    press(document.activeElement!, "Home");
    expect(document.activeElement).toBe(itemNamed("Rename group chat"));
  });

  it("renames in the menu: Enter saves a new name and gives focus back, Escape and an unchanged name save nothing", () => {
    openFromButton("launch");
    click(itemNamed("Rename group chat"));
    const input = q('input[aria-label="Rename Launch room"]') as HTMLInputElement;
    expect(input.value).toBe("Launch room");
    expect(q('button[aria-label="Save group chat name"]')).not.toBeNull();
    expect(q('button[aria-label="Cancel group chat rename"]')).not.toBeNull();
    type(input, "  Launch plan ");
    press(input, "Enter", { isComposing: true });
    expect(patches()).toEqual([]);
    press(input, "Enter");
    expect(patches()).toEqual([{ type: "patchGroup", groupId: "launch", patch: { name: "Launch plan" } }]);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(actionsOf("launch"));

    dispatch.mockClear();
    openFromButton("launch");
    click(itemNamed("Rename group chat"));
    type(q('input[aria-label="Rename Launch room"]') as HTMLInputElement, "Something else");
    press(q('input[aria-label="Rename Launch room"]')!, "Escape");
    expect(menu()).toBeNull();
    openFromButton("launch");
    click(itemNamed("Rename group chat"));
    press(q('input[aria-label="Rename Launch room"]')!, "Enter");
    expect(patches()).toEqual([]);
  });

  it("sets a group chat's description in the menu", () => {
    openFromButton("launch");
    click(itemNamed("Set description"));
    const input = q('input[aria-label="Set description for Launch room"]') as HTMLInputElement;
    expect(input.value).toBe("Plans");
    expect(input.placeholder).toBe("Short description (optional)");
    type(input, "  Launch week plans ");
    click(q('button[aria-label="Save description"]')!);
    expect(patches()).toEqual([{ type: "patchGroup", groupId: "launch", patch: { description: "Launch week plans" } }]);
    expect(menu()).toBeNull();
  });

  it("copies its conversation ID", () => {
    openFromButton("launch");
    click(itemNamed("Copy conversation ID"));
    expect(copied).toHaveBeenCalledWith("launch-thread");
    expect(menu()).toBeNull();
  });

  it("asks before deleting it: Cancel and Escape keep it, and the delete button deletes it", () => {
    openFromButton("launch");
    click(itemNamed("Delete group chat"));
    expect(menu()).toBeNull();
    expect(dialog()?.textContent).toContain("Delete Launch room?");
    expect(dialog()?.textContent).toContain("This permanently deletes the Launch room group chat, its messages, and every thread in it");
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(q("details")!.hasAttribute("open")).toBe(true);
    click(document.activeElement as HTMLElement);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(actionsOf("launch"));

    openFromButton("launch");
    click(itemNamed("Delete group chat"));
    press(document.activeElement!, "Escape");
    expect(dialog()).toBeNull();
    expect(deletes()).toEqual([]);

    openFromButton("launch");
    click(itemNamed("Delete group chat"));
    const confirm = [...dialog()!.querySelectorAll("button")].find((one) => one.textContent === "Delete group chat")!;
    expect(confirm.className).toContain("bg-danger");
    click(confirm);
    expect(dialog()).toBeNull();
    expect(deletes()).toEqual([[{ type: "deleteGroup", groupId: "launch" }]]);
  });
});

describe("a bot chat on the team map", () => {
  it("uses the thread wording and has no description", () => {
    openFromButton("desk");
    expect(items()).toEqual(["Rename thread", "Copy conversation ID", "Delete thread"]);
    click(itemNamed("Rename thread"));
    expect(q('button[aria-label="Save thread name"]')).not.toBeNull();
    press(q('input[aria-label="Rename Pen ⇄ Ink"]')!, "Escape");

    openFromButton("desk");
    click(itemNamed("Delete thread"));
    expect(dialog()?.textContent).toContain("Delete Pen ⇄ Ink?");
    expect(dialog()?.textContent).toContain("Pen ⇄ Ink thread");
    expect(dialog()?.textContent).not.toMatch(/group chat/);
  });
});

describe("a remote client", () => {
  it("can only copy a room's conversation ID", () => {
    (window as { ogb?: unknown }).ogb = { remoteClient: { active: true } };
    openFromButton("launch");
    expect(items()).toEqual(["Copy conversation ID"]);
  });
});

describe("the list in a narrow window", () => {
  const details = () => q("details") as HTMLDetailsElement;
  const list = () => details().querySelector<HTMLElement>("summary + div")!;
  const layOut = (button: { left: number; right: number }, windowWidth: number) => {
    const box = { ...button, top: 40, bottom: 76, width: button.right - button.left, height: 36, x: button.left, y: 40, toJSON: () => ({}) };
    vi.spyOn(details(), "getBoundingClientRect").mockReturnValue(box);
    vi.spyOn(q("summary")!, "getBoundingClientRect").mockReturnValue(box);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(windowWidth);
  };
  const setOpen = (open: boolean) => {
    details().open = open;
    flushSync(() => details().dispatchEvent(new Event("toggle")));
  };
  const shown = () => {
    const left = details().getBoundingClientRect().left + parseFloat(list().style.left);
    return { left, right: left + parseFloat(list().style.width) };
  };
  const openAt = (button: { left: number; right: number }, windowWidth: number) => {
    setOpen(false);
    layOut(button, windowWidth);
    setOpen(true);
    return shown();
  };
  const expectInside = ({ left, right }: { left: number; right: number }, windowWidth: number) => {
    expect(left).toBeGreaterThanOrEqual(8);
    expect(right).toBeLessThanOrEqual(windowWidth - 8);
  };
  afterEach(() => vi.restoreAllMocks());

  it("stays at least 8px inside the window on both sides, and ends at its button's right edge at desktop width", () => {
    expectInside(openAt({ left: 48, right: 156 }, 640), 640);
    expectInside(openAt({ left: 69, right: 177 }, 320), 320);
    expectInside(openAt({ left: 20, right: 128 }, 260), 260);
    expectInside(openAt({ left: 10, right: 118 }, 260), 260);
    expect(openAt({ left: 653, right: 761 }, 1024)).toEqual({ left: 505, right: 761 });
  });

  it("moves back inside when the window narrows while it is open, and not once it is closed", () => {
    expect(openAt({ left: 653, right: 761 }, 1024)).toEqual({ left: 505, right: 761 });
    layOut({ left: 48, right: 156 }, 390);
    window.dispatchEvent(new Event("resize"));
    expectInside(shown(), 390);
    const { left, width } = list().style;

    setOpen(false);
    layOut({ left: 69, right: 177 }, 320);
    window.dispatchEvent(new Event("resize"));
    expect([list().style.left, list().style.width]).toEqual([left, width]);
  });
});
