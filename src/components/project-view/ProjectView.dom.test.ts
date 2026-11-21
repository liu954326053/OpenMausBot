// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), state: { bots: [] as unknown[], groups: [] as unknown[], pendingQueued: {} } }));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));

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
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer", "editor"],
};
const bots = [
  bot("main", { defaultBot: {} }),
  bot("editor", { section: "The bride", title: "Editor", unread: true }),
  bot("writer", { section: "The bride", title: "Writer", busy: true }),
  bot("lead", { section: "The bride", chiefOfStaff: true, activity: "waiting-on-you" }),
  bot("sales", { section: "Sales" }),
];

let container: HTMLDivElement, root: Root;
const q = (selector: string) => container.querySelector<HTMLElement>(selector);
const rows = () => [...container.querySelectorAll<HTMLElement>("[data-project-member]")].map((row) => row.dataset.projectMember);
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const draw = async (props: { projectId: string; selectedBotId?: string }) => {
  await act(async () => root.render(createElement(ProjectView, props)));
  await settle();
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  fixture.state = { bots, groups: [room("bride-room", "The bride", { unread: true }), room("sales-room", "Sales")], pendingQueued: {} };
  fixture.dispatch.mockClear();
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
  it("shows the lead first, then the members, each with what it is doing", async () => {
    await draw({ projectId: "p-bride" });
    expect(q("h1")?.textContent).toBe("The bride");
    expect(rows()).toEqual(["lead", "writer", "editor"]);
    expect(q('[data-project-member="lead"]')?.textContent).toContain("Chief of Staff");
    expect(q('[data-project-member="lead"] [data-member-status]')?.textContent).toBe("Waiting on you");
    expect(q('[data-project-member="writer"] [data-member-status]')?.textContent).toBe("Working");
    expect(q('[data-project-member="editor"] [data-member-status]')?.textContent).toBe("Unread");
  });

  it("opens a member's chat from its row", async () => {
    await draw({ projectId: "p-bride" });
    await act(async () => q('[data-project-member="writer"] [data-open-chat]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "writer" });
  });

  it("marks the member chosen in the sidebar, and a click on another chooses it", async () => {
    await draw({ projectId: "p-bride", selectedBotId: "writer" });
    expect(q('[data-project-member="writer"]')?.getAttribute("aria-current")).toBe("true");
    expect(q('[data-project-member="lead"]')?.hasAttribute("aria-current")).toBe(false);
    await act(async () => q('[data-project-member="editor"] [data-choose-member]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showProject", projectId: "p-bride", botId: "editor" });
  });

  it("lists the project's own group chats and opens them", async () => {
    await draw({ projectId: "p-bride" });
    expect([...container.querySelectorAll<HTMLElement>("[data-project-room]")].map((row) => row.dataset.projectRoom)).toEqual(["bride-room"]);
    expect(q('[data-project-room="bride-room"] [data-member-status]')?.textContent).toBe("Unread");
    await act(async () => q('[data-project-room="bride-room"] [data-open-chat]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "bride-room" });
  });

  it("waits for the list of projects", async () => {
    setTeamProjects(null);
    await draw({ projectId: "p-bride" });
    expect(rows()).toEqual([]);
    expect(q("[data-project-loading]")).toBeTruthy();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("opens MagicBot when the project is no longer there", async () => {
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 5 }] });
    await draw({ projectId: "p-bride" });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "main" });
  });
});
