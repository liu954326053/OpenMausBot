// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { bots: [] as unknown[], groups: [] as unknown[], pendingQueued: {} },
  canvas: null as null | { projectId: string; selectedBotId?: string },
}));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
vi.mock("@/components/project-canvas/ServerProjectCanvas", async () => {
  const { createElement: element } = await import("react");
  return {
    ServerProjectCanvas: ({ projectId, selectedBotId, topBarSlot }: { projectId: string; selectedBotId?: string; topBarSlot?: ReactNode }) => {
      fixture.canvas = { projectId, selectedBotId };
      return element("header", { "data-canvas-top-bar": projectId }, topBarSlot);
    },
  };
});

import { setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { ProjectView } from "./ProjectView";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const room = (id: string, section: string, extra: Partial<Group> = {}): Group => ({
  id, threadId: `${id}-thread`, name: id, memberIds: [], messages: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1, section, ...extra,
});
const bride: TeamProjectWire = {
  id: "p-bride", name: "The bride", folder: "/dramas/The bride", section: "The bride", team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"],
};
const teamChanges = { joined: [{ id: "colorist", name: "Colorist", title: "Grades the picture" }], left: [] };
const bots = [
  bot("main", { defaultBot: {} }),
  bot("writer", { section: "The bride", title: "Writer" }),
  bot("lead", { section: "The bride", chiefOfStaff: true }),
];

let container: HTMLDivElement, root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const draw = async (props: { projectId: string; selectedBotId?: string }) => {
  await act(async () => root.render(createElement(ProjectView, props)));
  await settle();
};
const roomsButton = () => q('[data-canvas-top-bar] button[aria-label="Group chats"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  fixture.state = { bots, groups: [room("bride-room", "The bride", { unread: true }), room("cast-room", "The bride"), room("sales-room", "Sales")], pendingQueued: {} };
  fixture.dispatch.mockClear();
  fixture.canvas = null;
  setTeamProjects({ root: "/dramas", projects: [bride] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("the project view", () => {
  it("draws the project's canvas with the member chosen in the sidebar", async () => {
    await draw({ projectId: "p-bride", selectedBotId: "writer" });
    expect(q("[data-project-view]")?.dataset.projectView).toBe("p-bride");
    expect(fixture.canvas).toEqual({ projectId: "p-bride", selectedBotId: "writer" });
  });

  it("names the project's folder in the canvas's top bar, set as a path, while the folder is there", async () => {
    await draw({ projectId: "p-bride" });
    const folder = q("[data-project-folder]")!;
    expect(folder.textContent).toBe("/dramas/The bride");
    expect(folder.title).toBe("/dramas/The bride");
    expect(folder.classList).toContain("font-mono");
    expect(folder.classList).toContain("truncate");
    await act(async () => setTeamProjects({ root: "/dramas", projects: [{ ...bride, folderState: "missing" }] }));
    expect(q("[data-project-folder]")).toBeNull();
  });

  it("opens the project's own group chats from a menu in the top bar", async () => {
    await draw({ projectId: "p-bride" });
    await act(async () => roomsButton()!.click());
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
    expect(items.map((item) => item.dataset.menuKey)).toEqual(["bride-room", "cast-room"]);
    expect(items[0]!.textContent).toContain("Unread");
    expect(items[1]!.textContent).not.toContain("Unread");
    await act(async () => items[0]!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "bride-room" });
  });

  it("has no group chats menu while the project has none", async () => {
    fixture.state = { ...fixture.state, groups: [room("sales-room", "Sales")] };
    await draw({ projectId: "p-bride" });
    expect(q("[data-canvas-top-bar]")).toBeTruthy();
    expect(roomsButton()).toBeNull();
  });

  it("says in the top bar that the team changed, and reviews the changes from there", async () => {
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, teamChanges }] });
    await draw({ projectId: "p-bride" });
    expect(q("[data-project-team-changes]")?.textContent).toBe("Team changed");
    await act(async () => q("[data-project-team-changes]")!.click());
    expect(q('[data-team-changes="p-bride"] [data-team-change-member="colorist"]')).toBeTruthy();
  });

  it("leaves the team's changes to the computer this app drives", async () => {
    vi.stubGlobal("ogb", { remoteClient: { active: true } });
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, teamChanges }] });
    await draw({ projectId: "p-bride" });
    expect(q("[data-canvas-top-bar]")).toBeTruthy();
    expect(q("[data-project-team-changes]")).toBeNull();
  });

  it("switches to the lead's conversation from the top bar, where the canvas is the one chosen", async () => {
    await draw({ projectId: "p-bride" });
    const options = [...document.body.querySelectorAll<HTMLElement>("[data-canvas-top-bar] [data-project-mode-option]")];
    expect(options.map((one) => [one.textContent, one.getAttribute("aria-pressed")])).toEqual([["Chat", "false"], ["Canvas", "true"]]);
    await act(async () => options[1]!.click());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    await act(async () => options[0]!.click());
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "lead" }]]);
  });

  it("waits for the list of projects", async () => {
    setTeamProjects(null);
    await draw({ projectId: "p-bride" });
    expect(fixture.canvas).toBeNull();
    expect(q("[data-project-loading]")).toBeTruthy();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("opens MagicBot when the project is no longer there", async () => {
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 5 }] });
    await draw({ projectId: "p-bride" });
    expect(fixture.canvas).toBeNull();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "main" });
  });

  it("opens MagicBot when the open project is archived", async () => {
    await draw({ projectId: "p-bride" });
    expect(fixture.dispatch).not.toHaveBeenCalled();
    await act(async () => setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 5 }] }));
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "main" });
  });
});
