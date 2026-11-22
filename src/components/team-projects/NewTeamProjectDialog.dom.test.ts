// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEAM_PROJECT_NAME_MAX, type ProjectTeamWire, type TeamProjectsListWire, type TeamProjectWire } from "../../../shared/team-projects";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/state/store-select", () => ({
  useStoreDispatch: () => fixture.dispatch,
  useStoreSelector: <T,>(select: (state: never) => T) => select(fixture.state as never),
  sameItems: (left: readonly unknown[], right: readonly unknown[]) => left.length === right.length && left.every((item, index) => item === right[index]),
}));

import { loadLocale, setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { NewTeamProjectDialog } from "./NewTeamProjectDialog";

const HEAD = { id: "head", name: "Head writer", title: "" };
const urban: ProjectTeamWire = {
  name: "Urban romance", context: "City love stories, sweet and fast", chief: HEAD,
  members: [HEAD, { id: "writer", name: "Episode writer", title: "" }, { id: "editor", name: "Editor", title: "" }],
};
const SHOWRUNNER = { id: "lead", name: "Showrunner", title: "" };
const costume: ProjectTeamWire = { name: "Costume drama", context: "", chief: SHOWRUNNER, members: [SHOWRUNNER] };
const leaderless: ProjectTeamWire = {
  name: "Night shift", context: "Thrillers", chief: null, members: [{ id: "nia", name: "Nia", title: "" }, { id: "ode", name: "Ode", title: "" }], unusable: "no_chief",
};
const mainLed: ProjectTeamWire = {
  name: "General", context: "", chief: { id: "magicbot", name: "MagicBot", title: "" }, members: [{ id: "gus", name: "Gus", title: "" }], unusable: "main_bot_chief",
};
const empty: ProjectTeamWire = { name: "Empty room", context: "", chief: null, members: [], unusable: "empty" };
const made: TeamProjectWire = {
  id: "p1", name: "The bride", folder: "/dramas/The bride", section: "The bride", team: { key: "team:urban", name: "Urban romance" },
  leadBotId: "lead-1", createdAt: 1, folderState: "ready", botIds: ["lead-1", "writer-1"], follows: { "lead-1": "head", "writer-1": "writer" },
};
const LEAD = { id: "lead-1", threadId: "lead-1-thread", name: "Head writer", tasks: [] };

interface Call { path: string; method: string; body: unknown }
let calls: Call[] = [];
let teams: ProjectTeamWire[] | number = [];
let list: TeamProjectsListWire = { root: "/dramas", projects: [] };
let created: () => [number, unknown] | Promise<[number, unknown]> = () => [201, { project: made }];

let container: HTMLDivElement, root: Root;
let opener: HTMLButtonElement | null = null;
const onClose = vi.fn();
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const click = async (element: HTMLElement | null) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
const createButton = () => q("[data-team-project-create]") as HTMLButtonElement;
const press = (key: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const posts = () => calls.filter((call) => call.method === "POST");
const teamReads = () => calls.filter((call) => call.path === "/api/team-projects/teams");
const rows = () => all("[data-team]").map((row) => row.dataset.team);
const row = (name: string) => q(`[data-team="${name}"]`) as HTMLButtonElement;
const lines = (name: string) => [...row(name).querySelectorAll("span[dir]")].map((line) => line.textContent);

async function open(): Promise<void> {
  setTeamProjects(list);
  await act(async () => root.render(createElement(NewTeamProjectDialog, { onClose })));
  await settle();
}

async function type(value: string): Promise<void> {
  const field = q("[data-team-project-form] input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  await act(async () => { q("[data-team-project-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  calls = [];
  teams = [urban, costume];
  list = { root: "/dramas", projects: [] };
  created = () => [201, { project: made }];
  fixture.state = { bots: [LEAD] };
  fixture.dispatch.mockClear();
  onClose.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, body] = call.path === "/api/team-projects/teams" ? (typeof teams === "number" ? [teams, { error: "Not now" }] : [200, { teams }])
      : call.method === "PATCH" ? [200, { bot: { id: call.path.split("/").pop(), chiefOfStaff: true } }]
      : call.path === "/api/inbox" ? [404, {}]
      : call.method === "POST" ? await created() : [200, list];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  opener?.remove();
  opener = null;
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("what the dialog asks for", () => {
  it("is a dialog named New project, with a name, the teams and the folder that will be made", async () => {
    await open();
    const dialog = q('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("New project");
    expect(document.activeElement).toBe(q("[data-team-project-form] input"));
    expect(q('[role="radiogroup"]')!.getAttribute("aria-labelledby")).toBeTruthy();
    expect(rows()).toEqual(["Urban romance", "Costume drama"]);
  });

  it("lists the teams and makes the project when React mounts it twice, as it does in development", async () => {
    setTeamProjects(list);
    await act(async () => root.render(createElement(StrictMode, null, createElement(NewTeamProjectDialog, { onClose }))));
    await settle();
    expect(rows()).toEqual(["Urban romance", "Costume drama"]);
    await type("The bride");
    await click(row("Urban romance"));
    await submit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows each team's name, its context, and who would lead the project and who else comes", async () => {
    await open();
    expect(lines("Urban romance")).toEqual(["Urban romance", "City love stories, sweet and fast", "Chief of Staff: Head writer · Members: Episode writer, Editor"]);
    expect(lines("Costume drama")).toEqual(["Costume drama", "Chief of Staff: Showrunner"]);
  });

  it("lists the members the way the language writes a list", async () => {
    await loadLocale("zh");
    setLocale("zh");
    await open();
    expect(lines("Urban romance")[2]).toBe("参谋长：Head writer · 成员：Episode writer、Editor");
  });

  it("shows a team no project can be made from, unavailable and with the reason, and never chooses it", async () => {
    teams = [urban, leaderless, mainLed, empty];
    await open();
    expect(rows()).toEqual(["Urban romance", "Night shift", "General", "Empty room"]);
    expect([leaderless, mainLed, empty].map((team) => [row(team.name).disabled, row(team.name).dataset.teamUnusable])).toEqual([
      [true, "no_chief"], [true, "main_bot_chief"], [true, "empty"],
    ]);
    expect(lines("Night shift")).toEqual(["Night shift", "Thrillers", "Members: Nia, Ode", "It has no Chief of Staff to lead a project yet."]);
    expect(lines("General")).toEqual(["General", "Members: Gus", "MagicBot is its Chief of Staff, and MagicBot can't lead a project."]);
    expect(lines("Empty room")).toEqual(["Empty room", "It has no bots yet."]);
    expect(row("Urban romance").disabled).toBe(false);
    await type("The bride");
    await click(row("Night shift"));
    expect(all('[aria-checked="true"]').map((chosen) => chosen.dataset.team)).toEqual(["Urban romance"]);
    await submit();
    expect(posts().map((call) => call.body)).toEqual([{ name: "The bride", team: "Urban romance" }]);
  });

  it("opens with the team it was asked for, and then chooses no other team for the person", async () => {
    setTeamProjects(list);
    await act(async () => root.render(createElement(NewTeamProjectDialog, { team: "Costume drama", onClose })));
    await settle();
    expect(all('[data-team][aria-checked="true"]').map((chosen) => chosen.dataset.team)).toEqual(["Costume drama"]);
    await act(async () => root.unmount());
    root = createRoot(container);
    teams = [leaderless, costume];
    await act(async () => root.render(createElement(NewTeamProjectDialog, { team: "Night shift", onClose })));
    await settle();
    expect(all('[data-team][aria-checked="true"]')).toEqual([]);
  });

  it("chooses the only team a project can be made from by itself, and none of several", async () => {
    await open();
    expect(all('[data-team][aria-checked="true"]')).toEqual([]);
    await act(async () => root.unmount());
    root = createRoot(container);
    teams = [leaderless, costume];
    await open();
    expect(all('[data-team][aria-checked="true"]').map((chosen) => chosen.dataset.team)).toEqual(["Costume drama"]);
  });

  it("shows the folder the project gets as the name is typed", async () => {
    await open();
    expect(q("[data-team-project-folder]")!.textContent).toBe("/dramas/…");
    await type("  The bride ");
    expect(q("[data-team-project-folder]")!.textContent).toBe("/dramas/The bride");
  });

  it("offers Create once the project has a name", async () => {
    await open();
    expect(createButton().disabled).toBe(true);
    await type("The bride");
    expect(createButton().disabled).toBe(false);
    await type("   ");
    expect(createButton().disabled).toBe(true);
  });

  it("asks for a team beside the list when none is chosen, without asking the server", async () => {
    teams = [leaderless, urban, costume];
    await open();
    await type("The bride");
    await click(createButton());
    expect(posts()).toEqual([]);
    const problem = q('[data-team-project-problem="team"]')!;
    expect(problem.getAttribute("role")).toBe("alert");
    expect(problem.textContent).toBe("Choose a team for this project.");
    expect((document.activeElement as HTMLElement).dataset.team).toBe("Urban romance");
    await click(row("Costume drama"));
    expect(q("[data-team-project-problem]")).toBeNull();
    await click(createButton());
    expect(posts().map((call) => call.body)).toEqual([{ name: "The bride", team: "Costume drama" }]);
  });

  it("stops asking for a team once one is chosen with the arrow keys", async () => {
    await open();
    await type("The bride");
    await click(createButton());
    expect(q('[data-team-project-problem="team"]')).toBeTruthy();
    await press("ArrowDown");
    expect(q('[aria-checked="true"]')!.dataset.team).toBe("Costume drama");
    expect(q("[data-team-project-problem]")).toBeNull();
  });

  it("moves through the teams with the arrow keys, from the one that has the keyboard, past the ones no project can be made from", async () => {
    teams = [urban, leaderless, costume];
    await open();
    const state = () => [q('[aria-checked="true"]')?.dataset.team, (document.activeElement as HTMLElement).dataset.team];
    row("Urban romance").focus();
    await press("ArrowDown");
    expect(state()).toEqual(["Costume drama", "Costume drama"]);
    await press("ArrowDown");
    expect(state()).toEqual(["Urban romance", "Urban romance"]);
    await press("ArrowUp");
    expect(state()).toEqual(["Costume drama", "Costume drama"]);
  });

  it("leaves the team alone when an arrow key is pressed in the name", async () => {
    await open();
    await press("ArrowDown");
    expect(all('[aria-checked="true"]')).toEqual([]);
  });
});

describe("a team without a Chief of Staff", () => {
  const member = (id: string, name: string) => ({ id, threadId: `thread-${id}`, name, title: "", color: "green", section: "Night shift", modelSelection: { instanceId: "codex", model: "m" } });
  const ledNight: ProjectTeamWire = { ...leaderless, chief: { id: "nia", name: "Nia", title: "" } };
  delete ledNight.unusable;
  beforeEach(() => {
    fixture.state = { bots: [member("nia", "Nia"), member("ode", "Ode")], instances: [{ instanceId: "codex", capabilities: { agentsMcp: true } }] };
    teams = [leaderless, urban];
  });

  it("says so and offers to choose its Chief beside it, from the team's own bots", async () => {
    await open();
    const offer = q('[data-choose-chief="Night shift"]')!;
    expect(lines("Night shift")).toContain("It has no Chief of Staff to lead a project yet.");
    expect([offer.textContent, offer.getAttribute("aria-haspopup"), offer.getAttribute("aria-expanded")]).toEqual(["Choose Chief of Staff", "menu", "false"]);
    expect(q('[data-choose-chief="Urban romance"]')).toBeNull();
    await click(offer);
    expect(q('[data-chief-picker="Night shift"]')).toBeTruthy();
    expect(all("[data-chief-choice]").map((choice) => choice.dataset.chiefChoice)).toEqual(["nia", "ode"]);
    expect(offer.getAttribute("aria-expanded")).toBe("true");
  });

  it("chooses the team once its Chief is chosen, with the keyboard on it, ready to create", async () => {
    await open();
    await click(q('[data-choose-chief="Night shift"]'));
    teams = [ledNight, urban];
    await click(q('[data-chief-choice="nia"]'));
    await settle();
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([{ path: "/api/bots/nia", method: "PATCH", body: { chiefOfStaff: true } }]);
    expect([q("[data-chief-picker]"), q("[data-choose-chief]")]).toEqual([null, null]);
    expect([row("Night shift").disabled, row("Night shift").getAttribute("aria-checked")]).toEqual([false, "true"]);
    expect(document.activeElement).toBe(row("Night shift"));
    await type("The bride");
    await submit();
    expect(posts().map((call) => call.body)).toEqual([{ name: "The bride", team: "Night shift" }]);
  });
});

describe("making the project", () => {
  const fill = async () => {
    await open();
    await type(" The bride ");
    await click(row("Urban romance"));
  };

  it("sends the trimmed name and the chosen team, then opens the lead's conversation and closes", async () => {
    await fill();
    await submit();
    expect(posts()).toEqual([{ path: "/api/team-projects", method: "POST", body: { name: "The bride", team: "Urban romance" } }]);
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "lead-1" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays on Creating… until the lead reaches the app, then opens the lead's conversation", async () => {
    fixture.state = { bots: [] };
    await fill();
    await submit();
    expect([fixture.dispatch.mock.calls, onClose.mock.calls.length, createButton().textContent, createButton().disabled]).toEqual([[], 0, "Creating…", true]);
    fixture.state = { bots: [LEAD] };
    await act(async () => root.render(createElement(NewTeamProjectDialog, { onClose })));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "lead-1" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the project's canvas when its lead does not reach the app in time", async () => {
    fixture.state = { bots: [] };
    await fill();
    await submit();
    const later = Date.now() + 10_001;
    vi.spyOn(Date, "now").mockReturnValue(later);
    fixture.state = { bots: [] };
    await act(async () => root.render(createElement(NewTeamProjectDialog, { onClose })));
    await settle();
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "showProject", projectId: "p1" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("waits for the project's group chat to reach the app, though its lead is there first, and opens it", async () => {
    created = () => [201, { project: { ...made, roomId: "room-1" } }];
    fixture.state = { bots: [LEAD], groups: [] };
    await fill();
    await submit();
    expect([fixture.dispatch.mock.calls, onClose.mock.calls.length, createButton().textContent]).toEqual([[], 0, "Creating…"]);
    fixture.state = { bots: [LEAD], groups: [{ id: "room-1", threadId: "room-1-thread", name: "The bride team chat" }] };
    await act(async () => root.render(createElement(NewTeamProjectDialog, { onClose })));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "room-1" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the lead's conversation when the project's group chat does not reach the app in time", async () => {
    created = () => [201, { project: { ...made, roomId: "room-1" } }];
    fixture.state = { bots: [LEAD], groups: [] };
    await fill();
    await submit();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
    fixture.state = { bots: [LEAD], groups: [] };
    await act(async () => root.render(createElement(NewTeamProjectDialog, { onClose })));
    await settle();
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "lead-1" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("says Creating… and cannot be closed or sent twice while the project is made", async () => {
    let finish: (answer: [number, unknown]) => void = () => {};
    created = () => new Promise((resolve) => { finish = resolve; });
    await fill();
    await submit();
    expect([createButton().textContent, createButton().disabled]).toEqual(["Creating…", true]);
    await submit();
    await act(async () => { q('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect([posts().length, onClose.mock.calls.length]).toEqual([1, 0]);
    await act(async () => finish([201, { project: made }]));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a refusal", () => {
  const refuse = async (status: number, code: string | undefined, error = "The server's own sentence.") => {
    created = () => [status, { error, ...(code ? { code } : {}) }];
    await open();
    await type("The bride");
    await click(row("Urban romance"));
    await submit();
    expect(onClose).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  };
  const problems = () => all("[data-team-project-problem]").map((problem) => [problem.dataset.teamProjectProblem, problem.querySelector("p")!.textContent]);

  it("of a name that is taken is told beside the name, and goes when the name changes", async () => {
    await refuse(409, "name_taken");
    expect(problems()).toEqual([["name", "A project or a department already has this name. Choose another one."]]);
    expect(q("[data-team-project-form] input")!.getAttribute("aria-invalid")).toBe("true");
    expect(q('[data-team-project-problem="name"]')!.getAttribute("role")).toBe("alert");
    await type("The bride 2");
    expect(problems()).toEqual([]);
    expect(createButton().disabled).toBe(false);
  });

  it("of a name that cannot be a folder's, or whose folder is already there, is told beside the name too", async () => {
    await refuse(422, "bad_name");
    expect(problems().map(([place]) => place)).toEqual(["name"]);
    expect(problems()[0]![1]).toContain("/ \\ : * ? \" < > |");
    created = () => [409, { error: "x", code: "folder_exists" }];
    await submit();
    expect(problems()).toEqual([["name", "The folder for new projects already has a folder with this name. Choose another name."]]);
  });

  it("about the folder for new projects is told beside the folder, with the way to Settings → Data", async () => {
    await refuse(422, "root_missing");
    expect(problems()).toEqual([["folder", "The folder for new projects can't be found. Connect its drive, or choose another folder in Settings → Data."]]);
    await click(q('[data-team-project-problem="folder"] [data-team-project-settings]'));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "toggleAppSettings", open: true, section: "data" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("of a team that is gone is told beside the teams, and the list is read again", async () => {
    await refuse(422, "no_team");
    expect(problems()).toEqual([["team", "This team is no longer there. Choose another one."]]);
    expect(teamReads()).toHaveLength(2);
  });

  it("of a team no project can be made from now says why the way the server says it, beside the teams, and the list is read again", async () => {
    await refuse(422, "team_unusable", "Urban romance has no Chief of Staff to lead the project. Make one of its bots the Chief of Staff first.");
    expect(problems()).toEqual([["team", "Urban romance has no Chief of Staff to lead the project. Make one of its bots the Chief of Staff first."]]);
    expect(teamReads()).toHaveLength(2);
  });

  it("when the project could not be made says what the server says, above the buttons: only the server knows whether anything was left behind", async () => {
    created = () => [500, { error: "English.", code: "failed", errorKey: "serverError.teamProject.failedLeftovers", errorParams: { detail: "the disk is full" } }];
    await open();
    await type("The bride");
    await click(row("Urban romance"));
    await submit();
    expect(problems()).toEqual([["form", "The project couldn't be made, and part of it couldn't be removed again. (the disk is full)"]]);
    expect(createButton().disabled).toBe(false);
  });

  it("without a code this app knows says what the server says", async () => {
    await refuse(400, "from_the_future", "Something new.");
    expect(problems()).toEqual([["form", "Something new."]]);
  });

  it("without a sentence from the server still says the project was not made", async () => {
    created = () => [502, "<html>Bad gateway</html>"];
    await open();
    await type("The bride");
    await click(row("Urban romance"));
    await submit();
    expect(problems()).toEqual([["form", "The project couldn't be made. Try again."]]);
  });

  it("is also told when the request never arrives", async () => {
    created = () => { throw new TypeError("Failed to fetch"); };
    await open();
    await type("The bride");
    await click(row("Urban romance"));
    await submit();
    expect(problems()).toEqual([["form", "The project couldn't be made. Try again."]]);
    expect(createButton().disabled).toBe(false);
  });

  it("of a name that cannot be a folder's is told at once, without asking the server", async () => {
    await open();
    await click(row("Urban romance"));
    for (const name of ["a/b", "notes.", ".hidden", "CON", "what?"]) {
      await type(name);
      await submit();
      expect([name, ...problems().map(([place]) => place)]).toEqual([name, "name"]);
    }
    expect(posts()).toEqual([]);
    await type("The bride");
    await submit();
    expect(posts()).toHaveLength(1);
  });

  it("takes no more characters than a project's name may have", async () => {
    await open();
    expect((q("[data-team-project-form] input") as HTMLInputElement).maxLength).toBe(TEAM_PROJECT_NAME_MAX);
  });
});

describe("what is missing before a project can be made", () => {
  it("with no folder for new projects says so and leads to Settings → Data", async () => {
    list = { root: null, projects: [] };
    await open();
    expect(q("[data-team-project-form]")).toBeNull();
    expect(q('[data-team-project-setup="root"]')!.textContent).toBe("New projects need a folder to be made in. Choose it in Settings → Data, then come back here.");
    await click(q('[data-team-project-settings="root"]'));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "toggleAppSettings", open: true, section: "data" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with no team says how a team comes to be, and closes on OK", async () => {
    teams = [];
    await open();
    expect(q("[data-team-project-form]")).toBeNull();
    expect(q('[data-team-project-setup="teams"]')!.textContent).toBe(
      "A project gets copies of one team's bots, and there's no team yet. Make a department in the sidebar and give it a Chief of Staff, or ask MagicBot to propose a team.",
    );
    await click(q("[data-team-project-done]"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("when the teams cannot be read says so, and reads them again on Try again", async () => {
    teams = 500;
    await open();
    expect(q("[data-teams]")).toBeNull();
    expect(q("[data-team-project-form] [role='alert']")!.textContent).toContain("Couldn't load the teams.");
    teams = [urban];
    await click(q("[data-teams-retry]"));
    expect(rows()).toEqual(["Urban romance"]);
  });
});

describe("the keyboard", () => {
  const openFromAButton = async (strict = false) => {
    opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    setTeamProjects(list);
    const dialog = createElement(NewTeamProjectDialog, { onClose });
    await act(async () => root.render(strict ? createElement(StrictMode, null, dialog) : dialog));
    await settle();
  };
  const closeIt = () => act(async () => root.render(null));

  it("starts in the name and goes back to what opened the dialog", async () => {
    await openFromAButton();
    expect(document.activeElement).toBe(q("[data-team-project-form] input"));
    await closeIt();
    expect(document.activeElement).toBe(opener);
  });

  it("does the same when React mounts the dialog twice, as it does in development", async () => {
    await openFromAButton(true);
    expect(document.activeElement).toBe(q("[data-team-project-form] input"));
    await closeIt();
    expect(document.activeElement).toBe(opener);
  });

  it("starts on the way to Settings when something is missing, and goes back to what opened the dialog", async () => {
    list = { root: null, projects: [] };
    await openFromAButton();
    expect(document.activeElement).toBe(q('[data-team-project-settings="root"]'));
    await closeIt();
    expect(document.activeElement).toBe(opener);
  });

  it("moves to OK when the teams turn out to be none, and goes back to what opened the dialog", async () => {
    teams = [];
    await openFromAButton();
    expect(document.activeElement).toBe(q("[data-team-project-done]"));
    await closeIt();
    expect(document.activeElement).toBe(opener);
  });
});
