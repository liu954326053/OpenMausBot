// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectsListWire, TeamProjectWire } from "../../../shared/team-projects";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), state: { bots: [] as unknown[], groups: [] as unknown[], sections: [] as string[], selectedId: "" } }));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("../MenuMotion", () => ({
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));

import { setLocale } from "@/lib/i18n";
import { teamProjectSectionId } from "@/lib/team-projects";
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
const bots = [
  bot("sales", { section: "Sales" }), bot("main", { defaultBot: {}, chiefOfStaff: true }),
  bot("bride-editor", { section: "The bride" }), bot("bride-writer", { section: "The bride" }), bot("bride-lead", { section: "The bride", chiefOfStaff: true }),
  bot("heir-writer", { section: "The heir" }), bot("heir-lead", { section: "The heir", chiefOfStaff: true }),
];
const rooms = [room("bride-room", "The bride"), room("sales-room", "Sales")];

interface Call { path: string; method: string }
let calls: Call[] = [];
let list: TeamProjectsListWire = { root: "/dramas", projects: [bride, heir] };
let refuse = false;
let gate: Promise<void> | null = null;
let mode: SidebarTeamProjectsMode = { density: "comfortable", advanced: false, tight: true, remote: false, followed: true };
let query = "";
let collapsedIds: string[] = [];
const onError = vi.fn();

let container: HTMLDivElement, root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const click = async (element: HTMLElement | null) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
const block = (id: string) => q(`[data-sidebar-team-project="${id}"]`);
const drawn = (id: string) => [...block(id)!.querySelectorAll<HTMLElement>("[data-row]")].map((row) => row.dataset.row);
const listed = () => all("[data-sidebar-team-project]").map((one) => one.dataset.sidebarTeamProject);
const TOGGLE = "button[aria-expanded]:not([aria-haspopup])";
const posts = () => calls.filter((call) => call.method === "POST").map((call) => call.path);

function Harness() {
  const side = useTeamProjectSide();
  const [closed, setClosed] = useState(collapsedIds);
  const interactive = mode.density !== "icons" && !query;
  const matches = (name: string) => !query || name.toLowerCase().includes(query);
  return createElement(SidebarTeamProjects, {
    side, mode, query, onError,
    all: { bots, groups: rooms },
    found: { bots: bots.filter((one) => matches(one.name)), groups: rooms.filter((one) => matches(one.name)) },
    sections: {
      interactive,
      collapsed: (id: string) => interactive && closed.includes(id),
      toggle: (id: string) => setClosed((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id])),
    },
    botRow: (one: Bot) => createElement("div", { key: one.id, "data-row": one.id }),
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
  calls = [];
  list = { root: "/dramas", projects: [bride, heir] };
  refuse = false;
  gate = null;
  mode = { density: "comfortable", advanced: false, tight: true, remote: false, followed: true };
  query = "";
  collapsedIds = [];
  fixture.state = { bots, groups: rooms, sections: ["The bride", "The heir", "Sales"], selectedId: "main" };
  fixture.dispatch.mockClear();
  onError.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), method: init?.method ?? "GET" };
    calls.push(call);
    await gate;
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

  it("lists each project with its team under it: the lead, the members in the server's order, then its group chats", async () => {
    await draw();
    expect(listed()).toEqual(["The bride", "The heir"]);
    expect(drawn("The bride")).toEqual(["bride-lead", "bride-writer", "bride-editor", "bride-room"]);
    expect(drawn("The heir")).toEqual(["heir-lead", "heir-writer"]);
    expect(all("[data-row]").map((row) => row.dataset.row)).not.toContain("sales");
    expect(block("The bride")!.querySelector("[data-section]")!.getAttribute("data-section")).toBe("The bride");
  });

  it("leaves archived projects out", async () => {
    list = { root: "/dramas", projects: [{ ...bride, archivedAt: 3 }, heir] };
    await draw();
    expect(listed()).toEqual(["The heir"]);
  });

  it("ends with New project, which is all there is with no projects", async () => {
    await draw();
    const last = q("[data-sidebar-team-projects]")!.lastElementChild as HTMLElement;
    expect([last.dataset.teamProjectNew, last.textContent]).toEqual(["", "New project"]);
    list = { root: "/dramas", projects: [] };
    await draw();
    expect(listed()).toEqual([]);
    expect(q("[data-sidebar-team-projects]")!.textContent).toBe("New project");
  });

  it("opens the New project dialog", async () => {
    await draw();
    await click(q("[data-team-project-new]"));
    expect(q('[role="dialog"]')!.textContent).toContain("New project");
  });

  it("closes and opens a project from its row, and remembers it under the project's own id", async () => {
    collapsedIds = [teamProjectSectionId("The heir")];
    await draw();
    expect([drawn("The bride").length, drawn("The heir").length]).toEqual([4, 0]);
    const toggle = block("The bride")!.querySelector<HTMLElement>(TOGGLE)!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await click(toggle);
    expect(drawn("The bride")).toEqual([]);
    await click(block("The heir")!.querySelector<HTMLElement>(TOGGLE));
    expect(drawn("The heir")).toEqual(["heir-lead", "heir-writer"]);
  });

  it("says on the row when the project's folder is not there, and shows its team as unavailable", async () => {
    list = { root: "/dramas", projects: [bride, { ...heir, folderState: "missing" }] };
    await draw();
    expect(block("The bride")!.querySelector("[data-team-project-missing]")).toBeNull();
    expect(block("The heir")!.querySelector("[data-team-project-missing]")!.textContent).toBe("Project folder not found");
    const team = (id: string) => block(id)!.querySelector<HTMLElement>("[data-team-project-team]")!;
    expect([team("The bride").className.includes("opacity-50"), team("The heir").className.includes("opacity-50")]).toEqual([false, true]);
    expect(drawn("The heir")).toEqual(["heir-lead", "heir-writer"]);
  });

  it("still says the folder is not there on a closed project", async () => {
    list = { root: "/dramas", projects: [{ ...heir, folderState: "missing" }] };
    collapsedIds = [teamProjectSectionId("The heir")];
    await draw();
    expect([drawn("The heir"), block("The heir")!.querySelector("[data-team-project-missing]")!.textContent]).toEqual([[], "Project folder not found"]);
  });

  it("marks a closed project when something in it is unread", async () => {
    collapsedIds = [teamProjectSectionId("The bride")];
    fixture.state = { ...fixture.state };
    bots[3] = bot("bride-writer", { section: "The bride", unread: true });
    await draw();
    bots[3] = bot("bride-writer", { section: "The bride" });
    expect(block("The bride")!.querySelector("[data-section-mark]")!.getAttribute("data-section-mark")).toBe("unread");
  });
});

describe("a search", () => {
  it("keeps the projects that have a match, with only what matches", async () => {
    query = "writer";
    await draw();
    expect(listed()).toEqual(["The bride", "The heir"]);
    expect([drawn("The bride"), drawn("The heir")]).toEqual([["bride-writer"], ["heir-writer"]]);
    expect(q("[data-team-project-new]")).toBeNull();
  });

  it("shows the whole team of a project whose name matches", async () => {
    query = "the heir";
    await draw();
    expect(listed()).toEqual(["The heir"]);
    expect(drawn("The heir")).toEqual(["heir-lead", "heir-writer"]);
  });

  it("opens what it finds in a project that was closed", async () => {
    collapsedIds = [teamProjectSectionId("The bride")];
    query = "bride-lead";
    await draw();
    expect(drawn("The bride")).toEqual(["bride-lead"]);
    expect(block("The bride")!.querySelector(TOGGLE)).toBeNull();
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
  });

  it("opens on a right-click of the row too", async () => {
    await draw();
    await act(async () => { block("The heir")!.querySelector("[data-section]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 })); });
    expect(q('[role="menu"]')!.getAttribute("aria-label")).toBe("The heir");
  });

  it("is also there in Advanced mode", async () => {
    mode = { ...mode, advanced: true };
    await draw();
    expect(block("The bride")!.querySelector("[data-sidebar-section-line]")).toBeNull();
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
    expect(drawn("The bride")).toHaveLength(4);
  });
});

describe("the narrow column of icons", () => {
  beforeEach(() => { mode = { density: "icons", advanced: false, tight: false, remote: false, followed: true }; });

  it("draws each team as a named group with no row of its own, and New project as a named button", async () => {
    await draw();
    expect(all("[data-section]")).toEqual([]);
    expect(all('[role="group"]').map((group) => group.getAttribute("aria-label"))).toEqual(["The bride", "The heir"]);
    expect(drawn("The heir")).toEqual(["heir-lead", "heir-writer"]);
    const add = q("[data-team-project-new]")!;
    expect([add.getAttribute("aria-label"), add.getAttribute("title"), add.textContent]).toEqual(["New project", "New project", ""]);
  });

  it("parts the teams from each other and from what follows", async () => {
    await draw();
    expect(all("[data-sidebar-rail-separator]")).toHaveLength(3);
    mode = { ...mode, followed: false };
    await draw();
    expect(all("[data-sidebar-rail-separator]")).toHaveLength(2);
  });

  it("marks a team whose folder is not there", async () => {
    list = { root: "/dramas", projects: [{ ...heir, folderState: "missing" }] };
    await draw();
    const mark = block("The heir")!.querySelector<HTMLElement>("[data-team-project-missing]")!;
    expect([mark.getAttribute("aria-label"), mark.getAttribute("title")]).toEqual(["The heir: project folder not found", "The heir: project folder not found"]);
  });
});
