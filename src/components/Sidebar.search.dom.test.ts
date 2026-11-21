// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamProjectWire } from "../../shared/team-projects";
import type { AppState, Bot, Group, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ advanced: true }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => fixture.advanced,
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));

const { Sidebar } = await import("./Sidebar");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");
const { setTeamProjects } = await import("@/state/team-projects");

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green", notifications: true, unread: false, busy: false,
  messages: [], modelSelection: { instanceId: "test", model: "m" }, ...extra,
});
const room = (id: string, name: string, section?: string): Group => ({
  id, threadId: `${id}-thread`, name, memberIds: ["atlas"], messages: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
  ...(section ? { section } : {}),
});
const project = (id: string, name: string, botIds: string[]): TeamProjectWire => ({
  id, name, folder: `/dramas/${name}`, section: name, team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: botIds[0]!, createdAt: 1, folderState: "ready", botIds,
});

const state: AppState = {
  ...initialState,
  connected: true,
  selectedId: "magic",
  activeView: "chat",
  bots: [
    bot("magic", "MagicBot", { defaultBot: {} }),
    bot("atlas", "Atlas", { messages: [{ id: "z", role: "bot", kind: "text", text: "The striped zebra is drafted", at: 1 }] }),
    bot("dodo", "Dodo", { section: "Work launch" }),
    bot("echo", "Echo writer", { section: "Work launch" }),
  ],
  groups: [room("launch", "Launch room"), room("set", "On set", "Work launch")],
  sections: ["Work launch", "The bride"],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
};

const dispatch = vi.fn();
const fetched = vi.fn((_path: unknown) => new Promise<Response>(() => {}));
let root: Root, host: HTMLDivElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const q = (selector: string) => host.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const projects = () => all("[data-sidebar-team-project]").map((one) => one.dataset.sidebarTeamProject);
const botRows = () => all("[data-sidebar-bot-row]").map((one) => one.dataset.sidebarBotRow);
const noMatch = () => q("[data-sidebar-no-project-match]")?.textContent ?? null;

async function draw() {
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: true, onClose: () => {} }) })));
  await settle();
}
function field(): HTMLInputElement {
  if (!fixture.advanced && !q("[data-sidebar-search-pill]")) flushSync(() => q("[data-sidebar-search-toggle]")!.click());
  return q('input[aria-label="Search projects"]') as HTMLInputElement;
}
async function search(text: string) {
  const input = field();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
  await settle();
}
async function clear() {
  if (fixture.advanced) flushSync(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  else flushSync(() => q('[data-sidebar-search-pill] button[aria-label="Close search"]')!.click());
  await settle();
}

beforeEach(async () => {
  setLocale("en");
  vi.stubGlobal("fetch", fetched);
  fetched.mockClear();
  setTeamProjects({ root: "/dramas", projects: [project("work", "Work launch", ["dodo", "echo"]), project("bride", "The bride", [])] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe.each([["Advanced", true], ["Simple", false]] as const)("the sidebar's search in %s", (_mode, advanced) => {
  beforeEach(async () => {
    fixture.advanced = advanced;
    await draw();
  });

  it("is named for projects, and lists every project with nothing under any until something is typed", () => {
    const input = field();
    expect([input.placeholder, input.getAttribute("aria-label")]).toEqual(["Search projects", "Search projects"]);
    expect([projects(), botRows(), all("[data-sidebar-group-row]"), noMatch()]).toEqual([["work", "bride"], ["magic"], [], null]);
  });

  it("finds a project by a part of its name in any case, as one row with nothing under it, and keeps the main bot and the inbox", async () => {
    await search(" LAUNCH ");
    expect([projects(), noMatch()]).toEqual([["work"], null]);
    expect([...q('[data-sidebar-team-project="work"]')!.children].map((one) => one.querySelector("[data-sidebar-project-row]") !== null)).toEqual([true]);
    expect([botRows(), all("[data-sidebar-group-row]"), q("[data-sidebar-inbox]") !== null]).toEqual([["magic"], [], true]);
    q('[data-sidebar-project-row="work"]')!.click();
    expect(dispatch.mock.calls.at(-1)).toEqual([{ type: "showProject", projectId: "work" }]);
  });

  it("finds no project by a bot's name, a group chat's or a message's words, and lists none of them", async () => {
    for (const asked of ["Echo", "atlas", "Launch room", "zebra"]) {
      await search(asked);
      expect([asked, projects(), noMatch()]).toEqual([asked, [], `No project matches “${asked}”`]);
      expect([botRows(), all("[data-sidebar-group-row]"), q("mark"), q("[data-sidebar-inbox]") !== null]).toEqual([["magic"], [], null, true]);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetched.mock.calls.filter(([path]) => String(path).includes("/api/search"))).toEqual([]);
  });

  it("gives the plain list back when it is cleared", async () => {
    await search("bride");
    expect(projects()).toEqual(["bride"]);
    await clear();
    expect([projects(), botRows(), noMatch()]).toEqual([["work", "bride"], ["magic"], null]);
  });
});
