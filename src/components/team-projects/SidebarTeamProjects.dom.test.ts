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
import { forgetDisclosuresForTests } from "@/lib/remembered-disclosure";
import { setTeamProjects, useTeamProjectSide } from "@/state/team-projects";
import { TOAST_CLEAR_OF_COMPOSER } from "../NoticeCard";
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
const teamRooms = () => [room("bride-room", "The bride"), room("sales-room", "Sales")];
let rooms = teamRooms();

interface Call { path: string; method: string }
let calls: Call[] = [];
let list: TeamProjectsListWire = { root: "/dramas", projects: [bride, heir] };
let refuse = false;
let decided: TeamChangesInput[] = [];
let decide: (project: TeamProjectWire) => TeamChangesResult = (project) => ({ project: { ...project, teamChanges: undefined }, skipped: [] });
let gate: Promise<void> | null = null;
let mode: SidebarTeamProjectsMode = { density: "comfortable", advanced: false, tight: true, remote: false };
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
const under = (id: string) => [...block(id)!.children].slice(1);
const listed = () => all("[data-sidebar-team-project]").map((one) => one.dataset.sidebarTeamProject);
const expandedOf = (id: string) => row(id)!.getAttribute("aria-expanded");
const lead = (id: string) => q(`[data-sidebar-project-lead="${id}"]`);
const leadsUnder = (id: string) => under(id).map((one) => (one as HTMLElement).dataset.sidebarProjectLead);
const mark = (id: string) => row(id)!.querySelector<HTMLElement>("[data-section-mark]");
const noMatch = () => q("[data-sidebar-no-project-match]")?.textContent ?? null;
const posts = () => calls.filter((call) => call.method === "POST").map((call) => call.path);
const shown = (id: string) => ({ type: "showProject", projectId: id });
const opened = (id: string) => ({ type: "select", id });

function Harness() {
  const side = useTeamProjectSide();
  return createElement(SidebarTeamProjects, { side, mode, query, onError, onNew, all: { bots, groups: rooms } });
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
  forgetDisclosuresForTests();
  calls = [];
  bots = team();
  rooms = teamRooms();
  list = { root: "/dramas", projects: [bride, heir] };
  refuse = false;
  decided = [];
  decide = (project) => ({ project: { ...project, teamChanges: undefined }, skipped: [] });
  gate = null;
  mode = { density: "comfortable", advanced: false, tight: true, remote: false };
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

  it("is one row per project with nothing under it, and a click opens the lead's conversation and shows the lead under the row", async () => {
    await draw();
    expect([listed(), under("The bride"), under("The heir")]).toEqual([["The bride", "The heir"], [], []]);
    expect([expandedOf("The bride"), expandedOf("The heir")]).toEqual(["false", "false"]);
    expect(row("The bride")!.textContent).toBe("The bride");
    await click(row("The heir"));
    expect(fixture.dispatch.mock.calls).toEqual([[opened("heir-lead")]]);
    expect([expandedOf("The heir"), leadsUnder("The heir"), expandedOf("The bride"), under("The bride")]).toEqual(["true", ["heir-lead"], "false", []]);
    expect(lead("heir-lead")!.textContent).toBe("heir-lead");
    await click(lead("heir-lead"));
    expect(fixture.dispatch.mock.calls).toEqual([[opened("heir-lead")], [opened("heir-lead")]]);
  });

  it("marks the lead's row while the lead's conversation is open, folds the project on a click of its row, and marks the row then", async () => {
    await draw();
    await click(row("The bride"));
    fixture.state = { ...fixture.state, activeView: "chat", selectedId: "bride-lead" };
    await draw();
    expect([row("The bride")!.getAttribute("aria-current"), lead("bride-lead")!.getAttribute("aria-current")]).toEqual([null, "page"]);
    fixture.dispatch.mockClear();
    await click(row("The bride"));
    expect([fixture.dispatch.mock.calls, under("The bride"), expandedOf("The bride"), row("The bride")!.getAttribute("aria-current")]).toEqual([[], [], "false", "page"]);
    await click(row("The bride"));
    expect([fixture.dispatch.mock.calls, leadsUnder("The bride")]).toEqual([[[opened("bride-lead")]], ["bride-lead"]]);
  });

  it("opens the lead's conversation from the row of a project that is open but not on screen, and keeps it open", async () => {
    await draw();
    await click(row("The bride"));
    fixture.state = { ...fixture.state, activeView: "team-map", selectedId: "bride-lead" };
    await draw();
    fixture.dispatch.mockClear();
    await click(row("The bride"));
    expect([fixture.dispatch.mock.calls, leadsUnder("The bride")]).toEqual([[[opened("bride-lead")]], ["bride-lead"]]);
  });

  it("shows no lead under a project whose lead is not listed, and opens its canvas instead", async () => {
    bots = bots.filter((one) => one.id !== "heir-lead");
    await draw();
    await click(row("The heir"));
    expect([fixture.dispatch.mock.calls, under("The heir"), expandedOf("The heir")]).toEqual([[[shown("The heir")]], [], "false"]);
  });

  it("is one row per project in Advanced mode too, which opens the same way", async () => {
    mode = { ...mode, advanced: true };
    await draw();
    expect([listed(), under("The bride"), under("The heir"), expandedOf("The bride"), expandedOf("The heir")]).toEqual([["The bride", "The heir"], [], [], "false", "false"]);
    await click(row("The bride"));
    expect([fixture.dispatch.mock.calls, leadsUnder("The bride")]).toEqual([[[opened("bride-lead")]], ["bride-lead"]]);
  });

  it("keeps a project the sidebar of an older version kept open folded", async () => {
    localStorage.setItem("openmausbot.sidebarOpenProjects.v1", JSON.stringify(["The bride"]));
    await draw();
    expect([under("The bride"), expandedOf("The bride")]).toEqual([[], "false"]);
  });

  it("marks the project whose canvas is open, whichever of its bots is chosen there", async () => {
    fixture.state = { ...fixture.state, activeView: "project", project: { id: "The bride" } };
    await draw();
    expect([row("The bride")!.getAttribute("aria-current"), row("The heir")!.getAttribute("aria-current")]).toEqual(["page", null]);
    fixture.state = { ...fixture.state, project: { id: "The bride", botId: "bride-writer" } };
    await draw();
    expect([row("The bride")!.getAttribute("aria-current"), under("The bride")]).toEqual(["page", []]);
  });

  it("marks the project whose bot's or group chat's conversation is open, in the rail too", async () => {
    const current = () => [row("The bride")!.getAttribute("aria-current"), row("The heir")!.getAttribute("aria-current")];
    for (const open of ["bride-writer", "bride-room"]) {
      fixture.state = { ...fixture.state, activeView: "chat", selectedId: open };
      await draw();
      expect([open, ...current()]).toEqual([open, "page", null]);
    }
    mode = { ...mode, density: "icons" };
    await draw();
    expect(block("The bride")!.querySelector('[aria-current="page"]')).toBeTruthy();
  });

  it("leaves the mark to the conversation's own row, and to a view that is not that conversation", async () => {
    bots = bots.map((one) => (one.id === "bride-writer" ? { ...one, pinned: true } : one));
    fixture.state = { ...fixture.state, activeView: "chat", selectedId: "bride-writer" };
    await draw();
    expect(row("The bride")!.getAttribute("aria-current")).toBeNull();
    bots = team();
    fixture.state = { ...fixture.state, activeView: "team-map", selectedId: "bride-editor" };
    await draw();
    expect(row("The bride")!.getAttribute("aria-current")).toBeNull();
  });

  it("leaves archived projects out", async () => {
    list = { root: "/dramas", projects: [{ ...bride, archivedAt: 3 }, heir] };
    await draw();
    expect(listed()).toEqual(["The heir"]);
  });

  it("starts with New project, a filled button as wide as the list, which is all there is with no projects, and asks the sidebar for its dialog", async () => {
    await draw();
    const first = q("[data-sidebar-team-projects]")!.firstElementChild as HTMLElement;
    expect([first.dataset.teamProjectNew, first.textContent]).toEqual(["", "New project"]);
    expect([...first.classList]).toEqual(expect.arrayContaining(["ui-button", "ui-button-primary", "w-full"]));
    list = { root: "/dramas", projects: [] };
    await draw();
    expect(listed()).toEqual([]);
    expect(q("[data-sidebar-team-projects]")!.textContent).toBe("New project");
    await click(q("[data-team-project-new]"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("heads the projects with a label and sets them in from it, and has no label with no project", async () => {
    await draw();
    const label = q("[data-sidebar-projects-label]")!;
    const projects = q("[data-sidebar-project-list]")!;
    expect([label.textContent, projects.getAttribute("role"), projects.getAttribute("aria-labelledby")]).toEqual(["Projects", "group", label.id]);
    expect(label.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q("[data-team-project-new]")!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...projects.classList]).toContain("ps-3");
    expect(all("[data-sidebar-team-project]").map((one) => one.parentElement === projects)).toEqual([true, true]);
    list = { root: "/dramas", projects: [] };
    await draw();
    expect([q("[data-sidebar-projects-label]"), q("[data-sidebar-project-list]")]).toEqual([null, null]);
  });

  it("says on the row when the project's folder is not there", async () => {
    list = { root: "/dramas", projects: [bride, { ...heir, folderState: "missing" }] };
    await draw();
    expect(block("The bride")!.querySelector("[data-team-project-missing]")).toBeNull();
    expect(block("The heir")!.querySelector("[data-team-project-missing]")!.textContent).toBe("Project folder not found");
  });

  it("marks a project with what goes on among all its bots and group chats", async () => {
    bots = bots.map((one) => (one.id === "bride-writer" ? { ...one, unread: true } : one));
    rooms = rooms.map((one) => (one.id === "bride-room" ? { ...one, unread: true } : one));
    await draw();
    expect([mark("The bride")!.getAttribute("data-section-mark"), mark("The bride")!.title, mark("The heir")]).toEqual(["unread", "2 unread", null]);
    expect(row("The bride")!.textContent).toBe("The bride2 unread");
  });
});

describe("a search", () => {
  it("finds projects by a part of their name in any case, each one row with nothing under it, even one that is open", async () => {
    await draw();
    await click(row("The heir"));
    query = "HEIR";
    await draw();
    expect([listed(), under("The heir"), noMatch()]).toEqual([["The heir"], [], null]);
    query = "the";
    await draw();
    expect([listed(), under("The bride"), under("The heir")]).toEqual([["The bride", "The heir"], [], []]);
    expect([expandedOf("The bride"), expandedOf("The heir"), q("[data-sidebar-bot-row], [data-row], [data-sidebar-project-lead]")]).toEqual([null, null, null]);
  });

  it("finds no project by a bot's name, a group chat's or a message's text, and says so in one muted line", async () => {
    bots = bots.map((one): Bot => (one.id === "bride-writer" ? { ...one, messages: [{ id: "m1", role: "bot", kind: "text", at: 1, text: "The striped zebra is drafted" }] } : one));
    for (const asked of ["writer", "bride-lead", "bride-room", "zebra"]) {
      query = asked;
      await draw();
      expect([asked, listed(), noMatch(), q("[data-sidebar-bot-row]")]).toEqual([asked, [], `No project matches “${asked}”`, null]);
    }
    expect(q("[data-sidebar-no-project-match]")!.className).toContain("text-ink-secondary");
    expect(all("[data-sidebar-no-project-match]")).toHaveLength(1);
  });

  it("opens the lead's conversation of a project it found as a click does without a search", async () => {
    query = "bride";
    await draw();
    await click(row("The bride"));
    expect(fixture.dispatch.mock.calls).toEqual([[opened("bride-lead")]]);
  });

  it("offers no New project while it runs, and gives the whole list back when it is cleared", async () => {
    query = "zzz";
    await draw();
    expect([listed(), q("[data-team-project-new]") === null, noMatch()]).toEqual([[], true, "No project matches “zzz”"]);
    expect(q("[data-sidebar-projects-label]"), "no label over no project").toBeNull();
    query = "";
    await draw();
    expect([listed(), q("[data-team-project-new]") === null, noMatch()]).toEqual([["The bride", "The heir"], false, null]);
  });

  it("keeps the project's mark for all its bots and group chats", async () => {
    bots = bots.map((one) => (one.id === "bride-writer" ? { ...one, unread: true } : one));
    rooms = rooms.map((one) => (one.id === "bride-room" ? { ...one, unread: true } : one));
    query = "bride";
    await draw();
    expect([under("The bride"), mark("The bride")!.getAttribute("data-section-mark"), mark("The bride")!.title]).toEqual([[], "unread", "2 unread"]);
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

  it("offers Undo in the notices' corner, clear of the composer", async () => {
    await draw();
    await click(menuButton("The bride"));
    await click(q("[data-team-project-archive]"));
    expect(q("[data-access-toast]")!.className).toContain(TOAST_CLEAR_OF_COMPOSER);
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
    mode = { density: "icons", advanced: false, tight: false, remote: false };
    await draw();
    const mark = block("The bride")!.querySelector<HTMLElement>("[data-team-project-changes]")!;
    expect([mark.getAttribute("aria-label"), mark.getAttribute("title")]).toEqual(["The bride: team changed", "The bride: team changed"]);
    await click(mark);
    expect(q('[data-team-changes="The bride"]')).not.toBeNull();
  });
});

describe("the narrow column of icons", () => {
  beforeEach(() => { mode = { density: "icons", advanced: false, tight: false, remote: false }; });

  it("draws each project as a square named for it that opens its lead's conversation, with no team under it, and New project as a named button", async () => {
    await draw();
    expect(all('[role="group"]').map((group) => group.getAttribute("aria-label"))).toEqual(["The bride", "The heir"]);
    expect([row("The heir")!.getAttribute("aria-label"), row("The heir")!.textContent, under("The heir")]).toEqual(["The heir", "T", []]);
    await click(row("The heir"));
    expect([fixture.dispatch.mock.calls, under("The heir")]).toEqual([[[opened("heir-lead")]], []]);
    const add = q("[data-team-project-new]")!;
    expect([add.getAttribute("aria-label"), add.getAttribute("title"), add.textContent]).toEqual(["New project", "New project", ""]);
  });

  it("names what is going on in a project on its square", async () => {
    bots = bots.map((one) => (one.id === "heir-writer" ? { ...one, unread: true } : one));
    await draw();
    expect(row("The heir")!.getAttribute("aria-label")).toBe("The heir, 1 unread");
  });

  it("parts the projects from what is above", async () => {
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
