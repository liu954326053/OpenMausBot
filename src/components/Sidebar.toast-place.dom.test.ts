// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ phone: false, foot: 0 }));
vi.mock("@/lib/use-media-query", async (original) => {
  const actual = await original<typeof import("@/lib/use-media-query")>();
  return { ...actual, useMediaQuery: (query: string, fallback = false) => (query === actual.PHONE_LAYOUT ? fixture.phone : fallback) };
});
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => false,
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));

const { Sidebar } = await import("./Sidebar");
const { UndoToast } = await import("./bot-access/ShareBotButton");
const { NoticeToast } = await import("./NoticeCard");
const { SIDEBAR_FOOT } = await import("@/lib/sidebar-foot");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green", notifications: true, unread: false, busy: false,
  messages: [], modelSelection: { instanceId: "test", model: "m" }, ...extra,
});
const state: AppState = {
  ...initialState,
  connected: true,
  selectedId: "magic",
  activeView: "chat",
  bots: [bot("magic", "MagicBot", { defaultBot: {} }), bot("atlas", "Atlas")],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
};

const REM = 16;
let root: Root, host: HTMLDivElement, toastRoot: Root, toastHost: HTMLDivElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const published = () => document.documentElement.style.getPropertyValue(SIDEBAR_FOOT);

async function drawSidebar(props: { open?: boolean; collapseToIcons?: boolean } = {}) {
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: props.open ?? false, onClose: () => {}, collapseToIcons: props.collapseToIcons }) })));
  await settle();
}

/** A toast's `bottom` in px, worked out from its Tailwind class and the custom properties on `<html>`. */
function bottomOf(toast: HTMLElement): number {
  const token = [...toast.classList].find((one) => one.startsWith("bottom-"));
  if (!token) throw new Error(`no bottom in ${toast.className}`);
  const spacing = /^bottom-(\d+(?:\.\d+)?)$/.exec(token);
  if (spacing) return (Number(spacing[1]) * REM) / 4;
  const expression = /^bottom-\[(.+)\]$/.exec(token)?.[1]?.replaceAll("_", " ") ?? "";
  const resolved = expression.replace(/var\((--[\w-]+),([^)]*)\)/g, (_all, name: string, fallback: string) => document.documentElement.style.getPropertyValue(name) || fallback);
  return [...resolved.matchAll(/(-?\d+(?:\.\d+)?)(px|rem)/g)].reduce((sum, [, amount, unit]) => sum + Number(amount) * (unit === "rem" ? REM : 1), 0);
}

function toasts(): HTMLElement[] {
  flushSync(() => toastRoot.render(createElement("div", null,
    createElement(UndoToast, { clearOfComposer: true, text: "Archived Atlas", onUndo: async () => {}, onDone: () => {} }),
    createElement(NoticeToast, { text: "Saved", onDone: () => {} }),
  )));
  return [document.querySelector<HTMLElement>("[data-access-toast]")!, document.querySelector<HTMLElement>("[data-notice-toast]")!];
}

beforeEach(() => {
  setLocale("en");
  fixture.phone = false;
  fixture.foot = 0;
  const measured = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute("data-sidebar-foot")) return measured.call(this);
    return { x: 0, y: innerHeight - fixture.foot, top: innerHeight - fixture.foot, bottom: innerHeight, left: 0, right: 280, width: 280, height: fixture.foot, toJSON: () => ({}) };
  });
  host = document.createElement("div");
  toastHost = document.createElement("div");
  document.body.append(host, toastHost);
  root = createRoot(host);
  toastRoot = createRoot(toastHost);
});

afterEach(() => {
  flushSync(() => { root.unmount(); toastRoot.unmount(); });
  host.remove();
  toastHost.remove();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(SIDEBAR_FOOT);
});

describe("the corner's toasts and the sidebar's foot", () => {
  it("sit above the foot of the open sidebar at desktop width, clear of its account button", async () => {
    fixture.foot = 76;
    await drawSidebar();
    const sidebarFoot = fixture.foot;
    for (const toast of toasts()) expect(bottomOf(toast), toast.className).toBeGreaterThan(sidebarFoot);
    expect(published()).toBe("76px");
  });

  it("sit above the foot of the collapsed sidebar at desktop width", async () => {
    fixture.foot = 148;
    await drawSidebar({ collapseToIcons: true });
    const sidebarFoot = fixture.foot;
    for (const toast of toasts()) expect(bottomOf(toast), toast.className).toBeGreaterThan(sidebarFoot);
    expect(document.querySelector("[data-sidebar-foot] [data-sidebar-rail-footer]")).not.toBeNull();
  });

  it("sit above the phone drawer's bar while the drawer is open, and back in the corner once it closes", async () => {
    fixture.phone = true;
    fixture.foot = 64;
    await drawSidebar({ open: true });
    const sidebarFoot = fixture.foot;
    for (const toast of toasts()) expect(bottomOf(toast), toast.className).toBeGreaterThan(sidebarFoot);

    await drawSidebar({ open: false });
    expect(published()).toBe("");
    expect(toasts().map(bottomOf)).toEqual([REM, REM]);
  });

  it("stop making room once the sidebar is gone", async () => {
    fixture.foot = 76;
    await drawSidebar();
    flushSync(() => root.render(createElement("div")));
    expect(published()).toBe("");
  });
});
