// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEAM_PROJECT_NAME_MAX, type TeamProjectsListWire, type TeamProjectWire } from "../../../shared/team-projects";
import type { TeamTemplateSummary } from "../../../shared/template-library";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => fixture.dispatch }));

import { loadLocale, setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { NewTeamProjectDialog } from "./NewTeamProjectDialog";

const urban: TeamTemplateSummary = {
  id: "urban", name: "Urban romance", genre: "City love stories, sweet and fast", version: 3, updatedAt: 1, lead: "head",
  roles: [{ key: "writer", name: "Episode writer", title: "" }, { key: "head", name: "Head writer", title: "" }, { key: "editor", name: "Editor", title: "" }],
};
const costume: TeamTemplateSummary = {
  id: "costume", name: "Costume drama", genre: "", version: 1, updatedAt: 2, lead: "lead", roles: [{ key: "lead", name: "Showrunner", title: "" }],
};
const made: TeamProjectWire = {
  id: "p1", name: "The bride", folder: "/dramas/The bride", section: "The bride", template: { id: "urban", name: "Urban romance", version: 3 },
  leadBotId: "lead-1", createdAt: 1, folderState: "ready", botIds: ["lead-1", "writer-1"],
};

interface Call { path: string; method: string; body: unknown }
let calls: Call[] = [];
let teams: TeamTemplateSummary[] | number = [];
let list: TeamProjectsListWire = { root: "/dramas", projects: [] };
let created: () => [number, unknown] | Promise<[number, unknown]> = () => [201, { project: made, missingSkills: [] }];

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
  created = () => [201, { project: made, missingSkills: [] }];
  fixture.dispatch.mockClear();
  onClose.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, body] = call.path === "/api/template-library" ? (typeof teams === "number" ? [teams, { error: "Not now" }] : [200, { bots: [], teams }])
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
  it("is a dialog named New project, with a name, the team templates and the folder that will be made", async () => {
    await open();
    const dialog = q('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("New project");
    expect(document.activeElement).toBe(q("[data-team-project-form] input"));
    expect(q('[role="radiogroup"]')!.getAttribute("aria-labelledby")).toBeTruthy();
    expect(all("[data-team-template]").map((row) => row.dataset.teamTemplate)).toEqual(["urban", "costume"]);
  });

  it("lists the team templates and makes the project when React mounts it twice, as it does in development", async () => {
    setTeamProjects(list);
    await act(async () => root.render(createElement(StrictMode, null, createElement(NewTeamProjectDialog, { onClose }))));
    await settle();
    expect(all("[data-team-template]").map((row) => row.dataset.teamTemplate)).toEqual(["urban", "costume"]);
    await type("The bride");
    await click(q('[data-team-template="urban"]'));
    await submit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows each team template's name, what it suits and its roles, the lead first", async () => {
    await open();
    const lines = (id: string) => [...q(`[data-team-template="${id}"]`)!.querySelectorAll("span[dir]")].map((line) => line.textContent);
    expect(lines("urban")).toEqual(["Urban romance", "City love stories, sweet and fast", "Lead: Head writer · Members: Episode writer, Editor"]);
    expect(lines("costume")).toEqual(["Costume drama", "Lead: Showrunner"]);
  });

  it("lists the roles the way the language writes a list", async () => {
    await loadLocale("zh");
    setLocale("zh");
    await open();
    expect(q('[data-team-template="urban"]')!.querySelectorAll("span[dir]")[2]!.textContent).toBe("负责人：Head writer · 成员：Episode writer、Editor");
  });

  it("lists the roles without a lead when the template names one it does not have", async () => {
    teams = [{ ...urban, lead: "gone" }, costume];
    await open();
    expect(q('[data-team-template="urban"]')!.querySelectorAll("span[dir]")[2]!.textContent).toBe("Episode writer, Head writer, Editor");
  });

  it("chooses the only team template by itself, and none of several", async () => {
    await open();
    expect(all('[data-team-template][aria-checked="true"]')).toEqual([]);
    await act(async () => root.unmount());
    root = createRoot(container);
    teams = [costume];
    await open();
    expect(all('[data-team-template][aria-checked="true"]').map((row) => row.dataset.teamTemplate)).toEqual(["costume"]);
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

  it("asks for a team template beside the list when none is chosen, without asking the server", async () => {
    await open();
    await type("The bride");
    await click(createButton());
    expect(posts()).toEqual([]);
    const problem = q('[data-team-project-problem="template"]')!;
    expect(problem.getAttribute("role")).toBe("alert");
    expect(problem.textContent).toBe("Choose a team template for this project.");
    expect((document.activeElement as HTMLElement).dataset.teamTemplate).toBe("urban");
    await click(q('[data-team-template="costume"]'));
    expect(q("[data-team-project-problem]")).toBeNull();
    await click(createButton());
    expect(posts().map((call) => call.body)).toEqual([{ name: "The bride", templateId: "costume" }]);
  });

  it("stops asking for a team template once one is chosen with the arrow keys", async () => {
    await open();
    await type("The bride");
    await click(createButton());
    expect(q('[data-team-project-problem="template"]')).toBeTruthy();
    await press("ArrowDown");
    expect(q('[aria-checked="true"]')!.dataset.teamTemplate).toBe("costume");
    expect(q("[data-team-project-problem]")).toBeNull();
  });

  it("moves through the team templates with the arrow keys, from the one that has the keyboard", async () => {
    await open();
    const state = () => [q('[aria-checked="true"]')?.dataset.teamTemplate, (document.activeElement as HTMLElement).dataset.teamTemplate];
    q('[data-team-template="urban"]')!.focus();
    await press("ArrowDown");
    expect(state()).toEqual(["costume", "costume"]);
    await press("ArrowDown");
    expect(state()).toEqual(["urban", "urban"]);
    await press("ArrowUp");
    expect(state()).toEqual(["costume", "costume"]);
  });

  it("leaves the team template alone when an arrow key is pressed in the name", async () => {
    await open();
    await press("ArrowDown");
    expect(all('[aria-checked="true"]')).toEqual([]);
  });
});

describe("making the project", () => {
  const fill = async () => {
    await open();
    await type(" The bride ");
    await click(q('[data-team-template="urban"]'));
  };

  it("sends the trimmed name and the chosen template, then opens the lead's chat and closes", async () => {
    await fill();
    await submit();
    expect(posts()).toEqual([{ path: "/api/team-projects", method: "POST", body: { name: "The bride", templateId: "urban" } }]);
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "lead-1" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
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
    await act(async () => finish([201, { project: made, missingSkills: [] }]));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names the library skills the template asks for and the library lacks, with the lead's chat already open", async () => {
    created = () => [201, { project: made, missingSkills: ["storyboard", "shot-list"] }];
    await fill();
    await submit();
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "lead-1" }]]);
    expect(onClose).not.toHaveBeenCalled();
    const dialog = q('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("The bride is ready");
    expect(all("[data-team-project-missing-skills] li").map((item) => item.textContent)).toEqual(["storyboard", "shot-list"]);
    expect(dialog.textContent).toContain("Its team template names these skills, and the skills library doesn't have them:");
    await click(q("[data-team-project-done]"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a refusal", () => {
  const refuse = async (status: number, code: string | undefined, error = "The server's own sentence.") => {
    created = () => [status, { error, ...(code ? { code } : {}) }];
    await open();
    await type("The bride");
    await click(q('[data-team-template="urban"]'));
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

  it("of a team template that is gone is told beside the templates, and the list is read again", async () => {
    await refuse(422, "no_template");
    expect(problems().map(([place]) => place)).toEqual(["template"]);
    expect(calls.filter((call) => call.path === "/api/template-library")).toHaveLength(2);
  });

  it("when the project could not be made says what the server says, above the buttons: only the server knows whether anything was left behind", async () => {
    created = () => [500, { error: "English.", code: "failed", errorKey: "serverError.teamProject.failedLeftovers", errorParams: { detail: "the disk is full" } }];
    await open();
    await type("The bride");
    await click(q('[data-team-template="urban"]'));
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
    await click(q('[data-team-template="urban"]'));
    await submit();
    expect(problems()).toEqual([["form", "The project couldn't be made. Try again."]]);
  });

  it("is also told when the request never arrives", async () => {
    created = () => { throw new TypeError("Failed to fetch"); };
    await open();
    await type("The bride");
    await click(q('[data-team-template="urban"]'));
    await submit();
    expect(problems()).toEqual([["form", "The project couldn't be made. Try again."]]);
    expect(createButton().disabled).toBe(false);
  });

  it("of a name that cannot be a folder's is told at once, without asking the server", async () => {
    await open();
    await click(q('[data-team-template="urban"]'));
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

  it("with no team template says so and leads to the Templates page of Settings", async () => {
    teams = [];
    await open();
    expect(q("[data-team-project-form]")).toBeNull();
    expect(q('[data-team-project-setup="templates"]')!.textContent).toBe("A project gets its team from a team template, and there isn't one yet. Make one in Settings → Templates, then come back here.");
    await click(q('[data-team-project-settings="templates"]'));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "toggleAppSettings", open: true, section: "templates" }]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("when the team templates cannot be read says so, and reads them again on Try again", async () => {
    teams = 500;
    await open();
    expect(q("[data-team-templates]")).toBeNull();
    expect(q("[data-team-project-form] [role='alert']")!.textContent).toContain("Couldn't load the team templates.");
    teams = [urban];
    await click(q("[data-team-templates-retry]"));
    expect(all("[data-team-template]").map((row) => row.dataset.teamTemplate)).toEqual(["urban"]);
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

  it("goes to Done when the project is made with skills missing, and back to what opened the dialog after", async () => {
    created = () => [201, { project: made, missingSkills: ["storyboard"] }];
    await openFromAButton();
    await type("The bride");
    await click(q('[data-team-template="urban"]'));
    await submit();
    expect(document.activeElement).toBe(q("[data-team-project-done]"));
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

  it("moves to the way to Settings when the team templates turn out to be none", async () => {
    teams = [];
    await openFromAButton();
    expect(document.activeElement).toBe(q('[data-team-project-settings="templates"]'));
  });
});
