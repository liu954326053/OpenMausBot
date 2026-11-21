// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamChangesInput, TeamChangesResult, TeamProjectsListWire, TeamProjectWire } from "../../../shared/team-projects";
import type { AppState, Bot, Group } from "@/state/store";

type Shown = Pick<AppState, "bots" | "groups" | "sections" | "selectedId" | "activeView" | "project" | "pendingQueued">;
const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), state: {} as Shown }));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: Shown) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("../MenuMotion", () => ({
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));

import { setLocale } from "@/lib/i18n";
import { SIDEBAR_OPEN_PROJECTS_KEY } from "@/lib/sidebar-projects";
import { setTeamProjects, useTeamProjectSide } from "@/state/team-projects";
import { SidebarTeamProjects, type SidebarTeamProjectsMode } from "./SidebarTeamProjects";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const room = (id: string, section: string): Group => ({
  id, threadId: `${id}-thread`, name: id, memberIds: [], messages: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1, section,
});
const project = (id: string, botIds: string[], extra: Partial<TeamProjectWire> = {}): TeamProjectWire => ({
  id, name: id, folder: `/dramas/${id}`, section: id, team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: botIds[0]!, createdAt: 1, folderState: "ready", botIds, ...extra,
});

const bride = project("The bride", ["bride-lead", "bride-writer", "bride-editor"]);
const heir = project("The heir", ["heir-lead", "heir-writer"]);
const team = () => [
  bot("sales", { section: "Sales" }), bot("main", { defaultBot: {}, chiefOfStaff: true }),
  bot("bride-editor", { section: "The bride" }), bot("bride-writer", { section: "The bride" }), bot("bride-lead", { section: "The bride", chiefOfStaff: true }),
  bot("heir-writer", { section: "The heir" }), bot("heir-lead", { section: "The heir", chiefOfStaff: true }),
];
let bots = team();
const rooms = [room("bride-room", "The bride"), room("sales-room", "Sales")];

interface Call { path: string; method: string }
let calls: Call[] = [];
let list: TeamProjectsListWire = { root: "/dramas", projects: [bride, heir] };
let refuse = false;
let decided: TeamChangesInput[] = [];
let decide: (project: TeamProjectWire) => TeamChangesResult = (project) => ({ project: { ...project, teamChanges: undefined }, skipped: [] });
let gate: Promise<void> | null = null;
let mode: SidebarTeamProjectsMode = { density: "comfortable", advanced: false, tight: true, remote: false, followed: true };
let query = "";
const onError = vi.fn();
const onNew = vi.fn();

let container: HTMLDivElement, root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const click = async (element: HTMLElement | null) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
const block = (id: string) => q(`[data-sidebar-team-project="${id}"]`);
const row = (id: string) => q(`[data-sidebar-project-row="${id}"]`);
const member = (id: string) => q(`[data-sidebar-project-member="${id}"]`);
const drawn = (id: string) => [...block(id)!.querySelectorAll<HTMLElement>("[data-sidebar-project-member], [data-row]")].map((one) => one.dataset.sidebarProjectMember ?? one.dataset.row);
const listed = () => all("[data-sidebar-team-project]").map((one) => one.dataset.sidebarTeamProject);
const TOGGLE = "button[aria-expanded]:not([aria-haspopup])";
const toggle = (id: string) => block(id)!.querySelector<HTMLElement>(TOGGLE);
const posts = () => calls.filter((call) => call.method === "POST").map((call) => call.path);
const shown = (id: string, botId?: string) => ({ type: "showProject", projectId: id, ...(botId ? { botId } : {}) });

function Harness() {
  const side = useTeamProjectSide();
  const matches = (name: string) => !query || name.toLowerCase().includes(query);
  return createElement(SidebarTeamProjects, {
    side, mode, query, onError, onNew,
    all: { bots, groups: rooms },
    found: { bots: bots.filter((one) => matches(one.name)), groups: rooms.filter((one) => matches(one.name)) },
    roomRow: (one: Group) => createElement("div", { key: one.id, "data-row": one.id }),
  });
}

async function draw(): Promise<void> {
  setTeamProjects(list);
  await act(async () => root.render(createElement(Harness)));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  localStorage.clear();
  calls = [];
  bots = team();
  list = { root: "/dramas", projects: [bride, heir] };
  refuse = false;
  decided = [];
  decide = (project) => ({ project: { ...project, teamChanges: undefined }, skipped: [] });
  gate = null;
  mode = { density: "comfortable", advanced: false, tight: true, remote: false, followed: true };
  query = "";
  fixture.state = { bots, groups: rooms, sections: ["The bride", "The heir", "Sales"], selectedId: "main", activeView: "chat", pendingQueued: {} };
  fixture.dispatch.mockClear();
  onError.mockClear();
  onNew.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), method: init?.method ?? "GET" };
    calls.push(call);
    await gate;
    const deciding = /\/api\/team-projects\/(.+)\/team-changes$/.exec(call.path);
    if (deciding) {
      decided.push(JSON.parse(String(init!.body)) as TeamChangesInput);
      const answer = decide(list.projects.find((one) => one.id === decodeURIComponent(deciding[1]!))!);
      list = { ...list, projects: list.projects.map((one) => (one.id === answer.project.id ? answer.project : one)) };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }
    const changed = /\/api\/team-projects\/(.+)\/(archive|restore)$/.exec(call.path);
    const [status, body] = call.path === "/api/team-projects/teams" ? [200, { teams: [] }]
      : !changed ? [200, list]
      : refuse ? [500, { error: "The disk is full." }]
      : [200, { project: { ...list.projects.find((one) => one.id === decodeURIComponent(changed[1]!))!, archivedAt: changed[2] === "archive" ? 5 : undefined } }];
    if (changed && status === 200) list = { ...list, projects: list.projects.map((one) => (one.id === (body as { project: TeamProjectWire }).project.id ? (body as { project: TeamProjectWire }).project : one)) };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
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

describe("the projects in the sidebar", () => {
  it("draws nothing until the list is read, and reads it", async () => {
    let answer = () => {};
    gate = new Promise((resolve) => { answer = resolve; });
    await act(async () => root.render(createElement(Harness)));
    expect(q("[data-sidebar-team-projects]")).toBeNull();
    await act(async () => answer());
    await settle();
    expect(calls.filter((call) => call.path.startsWith("/api/team-projects"))).toEqual([{ path: "/api/team-projects", method: "GET" }]);
    expect(listed()).toEqual(["The bride", "The heir"]);
  });

  it("is one closed row per project, and a click on one opens the project's view", async () => {
    await draw();
    expect([listed(), drawn("The bride"), drawn("The heir")]).toEqual([["The bride", "The heir"], [], []]);
    expect(row("The bride")!.textContent).toBe("The bride");
    await click(row("The heir"));
    expect(fixture.dispatch.mock.calls).toEqual([[shown("The heir")]]);
  });

  it("opens a project's team under its row: the lead, then the members in the server's order", async () => {
    await draw();
    expect([toggle("The bride")!.getAttribute("aria-expanded"), toggle("The bride")!.getAttribute("aria-label")]).toEqual(["false", "Expand The bride"]);
    await click(toggle("The bride"));
    expect(drawn("The bride")).toEqual(["bride-lead", "bride-writer", "bride-editor"]);
    expect(member("bride-lead")!.querySelector('[aria-label="Chief of Staff"]')).not.toBeNull();
    expect([q('[data-sidebar-project-member="sales"]'), drawn("The heir")]).toEqual([null, []]);
    expect(block("The bride")!.querySelector('[role="group"]')!.getAttribute("aria-label")).toBe("The bride");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("opens the project with a member chosen when the member is clicked", async () => {
    await draw();
    await click(toggle("The bride"));
    await click(member("bride-writer"));
    expect(fixture.dispatch.mock.calls).toEqual([[shown("The bride", "bride-writer")]]);
  });

  it("remembers on this device which projects are open", async () => {
    await draw();
    await click(toggle("The heir"));
    expect(JSON.parse(localStorage.getItem(SIDEBAR_OPEN_PROJECTS_KEY)!)).toEqual(["The heir"]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await draw();
    expect(drawn("The heir")).toEqual(["heir-lead", "heir-writer"]);
    await click(toggle("The heir"));
    expect([drawn("The heir"), JSON.parse(localStorage.getItem(SIDEBAR_OPEN_PROJECTS_KEY)!)]).toEqual([[], []]);
  });

  it("marks the project whose view is open, or the member chosen in it", async () => {
    fixture.state = { ...fixture.state, activeView: "project", project: { id: "The bride" } };
    await draw();
    expect([row("The bride")!.getAttribute("aria-current"), row("The heir")!.getAttribute("aria-current")]).toEqual(["page", null]);
    fixture.state = { ...fixture.state, project: { id: "The bride", botId: "bride-writer" } };
    await draw();
    expect(row("The bride")!.getAttribute("aria-current")).toBe("page");
    await click(toggle("The bride"));
    expect([row("The bride")!.getAttribute("aria-current"), member("bride-writer")!.getAttribute("aria-current"), member("bride-lead")!.getAttribute("aria-current")]).toEqual([null, "page", null]);
  });

  it("marks the member whose chat is open", async () => {
    fixture.state = { ...fixture.state, selectedId: "bride-editor" };
    await draw();
    await click(toggle("The bride"));
    expect([member("bride-editor")!.getAttribute("aria-current"), row("The bride")!.getAttribute("aria-current")]).toEqual(["page", null]);
  });

  it("shows what each member is doing", async () => {
    bots = bots.map((one) => one.id === "bride-lead" ? { ...one, busy: true } : one.id === "bride-writer" ? { ...one, activity: "waiting-on-you" as const } : one.id === "bride-editor" ? { ...one, unread: true } : one);
    await draw();
    await click(toggle("The bride"));
    expect(member("bride-lead")!.querySelector('[data-testid="working-dot"]')).not.toBeNull();
    expect([member("bride-writer")!.querySelector('[data-testid="waiting-dot"]') !== null, member("bride-writer")!.textContent]).toEqual([true, "bride-writerWaiting for you…"]);
    expect([member("bride-editor")!.querySelector('[data-testid="unread-dot"]') !== null, member("bride-editor")!.textContent]).toEqual([true, "bride-editorUnread"]);
  });

  it("leaves archived projects out", async () => {
    list = { root: "/dramas", projects: [{ ...bride, archivedAt: 3 }, heir] };
    await draw();
    expect(listed()).toEqual(["The heir"]);
  });

  it("ends with New project, which is all there is with no projects, and asks the sidebar for its dialog", async () => {
    await draw();
    const last = q("[data-sidebar-team-projects]")!.lastElementChild as HTMLElement;
    expect([last.dataset.teamProjectNew, last.textContent]).toEqual(["", "New project"]);
    list = { root: "/dramas", projects: [] };
    await draw();
    expect(listed()).toEqual([]);
    expect(q("[data-sidebar-team-projects]")!.textContent).toBe("New project");
    await click(q("[data-team-project-new]"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("says on the row when the project's folder is not there, and shows its team as unavailable", async () => {
    list = { root: "/dramas", projects: [bride, { ...heir, folderState: "missing" }] };
    await draw();
    expect(block("The bride")!.querySelector("[data-team-project-missing]")).toBeNull();
    expect(block("The heir")!.querySelector("[data-team-project-missing]")!.textContent).toBe("Project folder not found");
    await click(toggle("The heir"));
    expect([block("The heir")!.querySelector<HTMLElement>("[data-team-project-team]")!.className.includes("opacity-50"), drawn("The heir")]).toEqual([true, ["heir-lead", "heir-writer"]]);
  });

  it("marks a closed project when something in it is unread, and leaves the mark to the members once it is open", async () => {
    bots = bots.map((one) => (one.id === "bride-writer" ? { ...one, unread: true } : one));
    await draw();
    expect(block("The bride")!.querySelector("[data-section-mark]")!.getAttribute("data-section-mark")).toBe("unread");
    expect(block("The heir")!.querySelector("[data-section-mark]")).toBeNull();
    await click(toggle("The bride"));
    expect(row("The bride")!.querySelector("[data-section-mark]")).toBeNull();
  });
});

describe("a search", () => {
  it("keeps the projects that have a match, open, with only what matches", async () => {
    query = "writer";
    await draw();
    expect(listed()).toEqual(["The bride", "The heir"]);
    expect([drawn("The bride"), drawn("The heir")]).toEqual([["bride-writer"], ["heir-writer"]]);
    expect([toggle("The bride"), q("[data-team-project-new]")]).toEqual([null, null]);
  });

  it("shows the whole team of a project whose name matches, and a group chat that matches", async () => {
    query = "the heir";
    await draw();
    expect([listed(), drawn("The heir")]).toEqual([["The heir"], ["heir-lead", "heir-writer"]]);
    query = "bride-room";
    await draw();
    expect([listed(), drawn("The bride")]).toEqual([["The bride"], ["bride-room"]]);
  });
});

describe("the project's menu", () => {
  const menuButton = (id: string) => block(id)!.querySelector<HTMLElement>('button[aria-haspopup="menu"]');

  it("opens from the row's ⋯, named for the project, and holds Archive", async () => {
    await draw();
    expect(menuButton("The bride")!.getAttribute("aria-label")).toBe("Actions for the project The bride");
    await click(menuButton("The bride"));
    expect(q('[role="menu"]')!.getAttribute("aria-label")).toBe("The bride");
    expect(all('[role="menuitem"]').map((item) => item.textContent)).toEqual(["Archive"]);
    expect(menuButton("The bride")!.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("opens on a right-click of the row too", async () => {
    await draw();
    await act(async () => { row("The heir")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 })); });
    expect(q('[role="menu"]')!.getAttribute("aria-label")).toBe("The heir");
  });

  it("is also there in Advanced mode", async () => {
    mode = { ...mode, advanced: true };
    await draw();
    await click(menuButton("The bride"));
    expect(all('[role="menuitem"]').map((item) => item.textContent)).toEqual(["Archive"]);
  });

  it("closes on Escape without archiving", async () => {
    await draw();
    await click(menuButton("The bride"));
    await act(async () => { q('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect([q('[role="menu"]'), posts()]).toEqual([null, []]);
  });

  it("archives at once, with no question, and offers Undo, which puts the project back", async () => {
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    expect(posts()).toEqual(["/api/team-projects/The%20bride/archive"]);
    expect([q('[role="menu"]'), q('[role="dialog"]'), listed()]).toEqual([null, null, ["The heir"]]);
    const toast = q('[role="status"]')!;
    expect(toast.textContent).toBe("The bride archivedUndo");
    await click(toast.querySelector("button"));
    expect(posts()).toEqual(["/api/team-projects/The%20bride/archive", "/api/team-projects/The%20bride/restore"]);
    expect([listed(), q('[role="status"]')]).toEqual([["The bride", "The heir"], null]);
  });

  it("leaves the chat of a project it archives for the main bot, and comes back to it on Undo", async () => {
    fixture.state = { ...fixture.state, selectedId: "bride-writer" };
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "main" }]]);
    fixture.state = { ...fixture.state, selectedId: "main" };
    await draw();
    await click(q('[role="status"] button'));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "main" }], [{ type: "select", id: "bride-writer" }]]);
  });

  it("leaves the view of the project it archives for the main bot", async () => {
    fixture.state = { ...fixture.state, activeView: "project", project: { id: "The bride" } };
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "main" }]]);
  });

  it("stays where the person is when another project is archived", async () => {
    fixture.state = { ...fixture.state, selectedId: "heir-lead" };
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("says so when the project could not be archived, and keeps it", async () => {
    refuse = true;
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    expect(onError.mock.calls).toEqual([["Couldn't archive The bride. Try again."]]);
    expect([listed(), q('[role="status"]')]).toEqual([["The bride", "The heir"], null]);
  });

  it("says where to restore the project when Undo fails", async () => {
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    refuse = true;
    await click(q('[role="status"] button'));
    expect(q('[role="status"]')!.textContent).toBe("Couldn't undo that. Restore the project in Settings → Data.");
  });

  it("is not offered, and neither is New project, when this app drives another computer", async () => {
    mode = { ...mode, remote: true };
    await draw();
    expect([menuButton("The bride"), q("[data-team-project-new]")]).toEqual([null, null]);
    await click(toggle("The bride"));
    expect(drawn("The bride")).toHaveLength(3);
  });
});

describe("a project whose team changed", () => {
  const ada = { id: "src-ada", name: "Ada", title: "Researcher" };
  const editor = { id: "bride-editor", name: "bride-editor", title: "" };
  const changedBride = { ...bride, teamChanges: { joined: [ada], left: [editor] } };
  const radio = (copy: string, label: string) =>
    [...q(`[data-team-change-copy="${copy}"]`)!.querySelectorAll<HTMLElement>('[role="radio"]')].find((one) => one.textContent === label)!;

  beforeEach(() => { list = { root: "/dramas", projects: [changedBride, heir] }; });

  it("says so on the project's row, and only there", async () => {
    await draw();
    expect(block("The bride")!.querySelector("[data-team-project-changes]")!.textContent).toBe("Team changed");
    expect(block("The heir")!.querySelector("[data-team-project-changes]")).toBeNull();
  });

  it("offers the new members as added and the bots that left as kept, and makes only what the person chose", async () => {
    await draw();
    await click(block("The bride")!.querySelector("[data-team-project-changes]"));
    const dialog = q('[data-team-changes="The bride"]')!;
    expect(dialog.querySelector("h2")!.textContent).toBe("Team changes");
    const add = dialog.querySelector<HTMLInputElement>('[data-team-change-member="src-ada"] input')!;
    expect([add.checked, add.getAttribute("aria-label")]).toEqual([true, "Add Ada to The bride"]);
    expect(radio("bride-editor", "Keep").getAttribute("aria-checked")).toBe("true");
    await click(radio("bride-editor", "Remove"));
    await click(q("[data-team-changes-apply]"));
    expect(decided).toEqual([{ add: ["src-ada"], remove: ["bride-editor"], keep: [] }]);
    expect([q("[data-team-changes]"), block("The bride")!.querySelector("[data-team-project-changes]")]).toEqual([null, null]);
  });

  it("adds no one the person unticked, and keeps the bots that left unless told otherwise", async () => {
    await draw();
    await click(block("The bride")!.querySelector("[data-team-project-changes]"));
    await click(q('[data-team-change-member="src-ada"] input'));
    await click(q("[data-team-changes-apply]"));
    expect(decided).toEqual([{ add: [], remove: [], keep: ["bride-editor"] }]);
  });

  it("stays open with what is still to decide when some changes were not made", async () => {
    decide = (project) => ({ project: { ...project, teamChanges: { joined: [ada], left: [] } }, skipped: ["src-ada"] });
    await draw();
    await click(block("The bride")!.querySelector("[data-team-project-changes]"));
    await click(q("[data-team-changes-apply]"));
    expect(q("[data-team-changes-problem]")!.textContent).toBe("Some changes weren't made: the team changed again, or a bot was busy. Check the list and try again.");
    expect([q("[data-team-changes-left]"), document.body.querySelector<HTMLInputElement>('[data-team-change-member="src-ada"] input')!.checked]).toEqual([null, true]);
  });

  it("opens from the project's menu too, before Archive", async () => {
    await draw();
    await click(block("The bride")!.querySelector<HTMLElement>('button[aria-haspopup="menu"]'));
    expect(all('[role="menuitem"]').map((item) => item.textContent)).toEqual(["Review team changes…", "Archive"]);
    await click(q("[data-team-project-review]"));
    expect([q('[role="menu"]'), q('[data-team-changes="The bride"]') !== null]).toEqual([null, true]);
  });

  it("is not offered when this app drives another computer", async () => {
    mode = { ...mode, remote: true };
    await draw();
    expect(q("[data-team-project-changes]")).toBeNull();
  });

  it("is a named mark in the narrow column of icons", async () => {
    mode = { density: "icons", advanced: false, tight: false, remote: false, followed: true };
    await draw();
    const mark = block("The bride")!.querySelector<HTMLElement>("[data-team-project-changes]")!;
    expect([mark.getAttribute("aria-label"), mark.getAttribute("title")]).toEqual(["The bride: team changed", "The bride: team changed"]);
    await click(mark);
    expect(q('[data-team-changes="The bride"]')).not.toBeNull();
  });
});

describe("the narrow column of icons", () => {
  beforeEach(() => { mode = { density: "icons", advanced: false, tight: false, remote: false, followed: true }; });

  it("draws each project as a square named for it that opens its view, with no team under it, and New project as a named button", async () => {
    await draw();
    expect(all('[role="group"]').map((group) => group.getAttribute("aria-label"))).toEqual(["The bride", "The heir"]);
    expect([row("The heir")!.getAttribute("aria-label"), row("The heir")!.textContent, drawn("The heir")]).toEqual(["The heir", "T", []]);
    await click(row("The heir"));
    expect(fixture.dispatch.mock.calls).toEqual([[shown("The heir")]]);
    const add = q("[data-team-project-new]")!;
    expect([add.getAttribute("aria-label"), add.getAttribute("title"), add.textContent]).toEqual(["New project", "New project", ""]);
  });

  it("names what is going on in a project on its square", async () => {
    bots = bots.map((one) => (one.id === "heir-writer" ? { ...one, unread: true } : one));
    await draw();
    expect(row("The heir")!.getAttribute("aria-label")).toBe("The heir, 1 unread");
  });

  it("parts the projects from what is above and what follows", async () => {
    await draw();
    expect(all("[data-sidebar-rail-separator]")).toHaveLength(2);
    mode = { ...mode, followed: false };
    await draw();
    expect(all("[data-sidebar-rail-separator]")).toHaveLength(1);
  });

  it("marks a project whose folder is not there", async () => {
    list = { root: "/dramas", projects: [{ ...heir, folderState: "missing" }] };
    await draw();
    const mark = block("The heir")!.querySelector<HTMLElement>("[data-team-project-missing]")!;
    expect([mark.getAttribute("aria-label"), mark.getAttribute("title")]).toEqual(["The heir: project folder not found", "The heir: project folder not found"]);
  });
});
