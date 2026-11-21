// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Group } from "@/state/store";

const { TeamMapRooms } = await import("./TeamMapRooms");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");

const room = (id: string, name: string): Group => ({
  id, threadId: `${id}-thread`, name, memberIds: ["pen", "ink"], messages: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
});
const state: AppState = { ...initialState, connected: true, activeView: "team-map", groups: [room("launch", "Launch room")] };

type Frame = { left: number; top: number; width: number; height: number };
const DESKTOP_BUTTON: Frame = { left: 1100, top: 20, width: 110, height: 33 };
const PHONE_BUTTON: Frame = { left: 111, top: 70, width: 95, height: 33 };
const MENU = { width: 228, height: 160 };
const POP_IN_START_SCALE = 0.96;
const { innerWidth, innerHeight } = window;
let root: Root, host: HTMLDivElement;
const q = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const details = () => q("details");
const toggle = () => q("[data-team-map-rooms]");
const rect = ({ left, top, width, height }: Frame) => DOMRect.fromRect({ x: left, y: top, width, height });

function resize(width: number, height: number) {
  Object.assign(window, { innerWidth: width, innerHeight: height });
  window.dispatchEvent(new Event("resize"));
}
function buttonAt(frame: Frame) {
  toggle().getBoundingClientRect = () => rect(frame);
  details().getBoundingClientRect = () => rect(frame);
}
function openAt(viewport: { width: number; height: number }, button: Frame) {
  details().removeAttribute("open");
  resize(viewport.width, viewport.height);
  buttonAt(button);
  flushSync(() => toggle().click());
}
function placed() {
  const { style } = q("[data-team-map-rooms-list]");
  const frame = details().getBoundingClientRect();
  const left = frame.left + parseFloat(style.left);
  return { left, right: left + parseFloat(style.width), top: frame.top + parseFloat(style.top), maxHeight: parseFloat(style.maxHeight) };
}

beforeEach(() => {
  setLocale("en");
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(TeamMapRooms) })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.restoreAllMocks();
  Object.assign(window, { innerWidth, innerHeight });
});

describe("the team map's group chat list", () => {
  it("opens 8 px under its button and ends at its button's right edge at desktop width", () => {
    openAt({ width: 1440, height: 900 }, DESKTOP_BUTTON);
    expect(details().hasAttribute("open")).toBe(true);
    expect(placed()).toEqual({ left: 1210 - 256, right: 1210, top: 53 + 8, maxHeight: 320 });
  });

  it("keeps ending at its button's right edge in a narrower window wherever that fits", () => {
    openAt({ width: 900, height: 800 }, { left: 344, top: 20, width: 108, height: 33 });
    expect(placed()).toMatchObject({ left: 452 - 256, right: 452 });
  });

  it("starts at its button's left edge where ending at its right edge would leave the window, as on a phone", () => {
    openAt({ width: 390, height: 844 }, PHONE_BUTTON);
    expect(placed()).toMatchObject({ left: 111, right: 367 });
  });

  it("stays 8 px inside a window too narrow for either edge, and narrows in one under 272 px", () => {
    openAt({ width: 300, height: 600 }, { left: 100, top: 70, width: 95, height: 33 });
    expect(placed()).toMatchObject({ left: 36, right: 300 - 8 });
    openAt({ width: 240, height: 600 }, { left: 100, top: 70, width: 95, height: 33 });
    expect(placed()).toMatchObject({ left: 8, right: 240 - 8 });
  });

  it("ends 8 px above the window's bottom, and follows the window while open", () => {
    openAt({ width: 1440, height: 300 }, DESKTOP_BUTTON);
    expect(placed().maxHeight).toBe(300 - 53 - 8 - 8);
    buttonAt(PHONE_BUTTON);
    resize(390, 844);
    expect(placed()).toMatchObject({ left: 111, right: 367, top: 103 + 8, maxHeight: 320 });
  });
});

describe("a group chat's own menu on the team map", () => {
  it("stays 8 px inside the window by its full size, not the smaller frame it pops in at", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-room-menu") ? MENU.width : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-room-menu") ? MENU.height : 0;
    });
    const measure = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-room-menu")) return rect({ left: 0, top: 0, width: MENU.width * POP_IN_START_SCALE, height: MENU.height * POP_IN_START_SCALE });
      if (this.hasAttribute("data-team-map-room-actions")) return rect({ left: 330, top: 800, width: 28, height: 28 });
      return measure.call(this);
    });
    resize(390, 844);
    details().setAttribute("open", "");
    flushSync(() => q('[data-team-map-room-actions="launch"]').click());
    expect(q("[data-room-menu]").style.left).toBe(`${390 - MENU.width - 8}px`);
    expect(q("[data-room-menu]").style.top).toBe(`${844 - MENU.height - 8}px`);
  });
});
