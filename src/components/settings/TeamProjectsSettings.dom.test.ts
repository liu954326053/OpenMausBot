// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectsListWire, TeamProjectWire } from "../../../shared/team-projects";
import { setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { SettingsLook } from "../SettingsPrimitives";
import { TeamProjectsSettings } from "./TeamProjectsSettings";

const project = (id: string, name: string, over: Partial<TeamProjectWire> = {}): TeamProjectWire => ({
  id, name, folder: `/dramas/${name}`, section: name, team: { key: "team:urban", name: "Urban romance" }, follows: {},
  leadBotId: `${id}-lead`, createdAt: 1, folderState: "ready", botIds: [`${id}-lead`], episodeBots: {}, ...over,
});
const bride = project("p1", "The bride");
const heir = project("p2", "The heir", { archivedAt: 5 });
const lost = project("p3", "The lost son", { archivedAt: 6, folderState: "missing" });

interface Call { path: string; method: string; body: unknown }
type Answer = [number, unknown];
let calls: Call[] = [];
let list: TeamProjectsListWire | null = { root: "/dramas", projects: [bride, heir, lost] };
let saved: (path: string) => Answer = (path) => [200, { root: path }];
let restored: (id: string) => Answer | Promise<Answer> = (id) => [200, { project: { ...list!.projects.find((one) => one.id === id)!, archivedAt: undefined } }];
let pickFolder: ReturnType<typeof vi.fn<(current?: string) => Promise<string | null>>>;

let container: HTMLDivElement, root: Root;
const q = (selector: string) => container.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const click = async (element: HTMLElement | null) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
const changes = () => calls.filter((call) => call.method !== "GET");
const rootText = () => q("[data-team-projects-root]")?.textContent;
const alerts = () => all('[role="alert"]').map((alert) => alert.textContent);
const archivedNames = () => all("[data-team-project-archived]").map((row) => row.querySelector("[id]")!.textContent);
const pathField = () => q("[data-team-projects-path]") as HTMLInputElement | null;
const alertLines = () => [...q('[role="alert"]')!.children].map((line) => line.textContent);

function desktop(remote = false): void {
  // SAFETY: the test stands in for the desktop bridge with the two members this component reads.
  (window as unknown as { ogb?: unknown }).ogb = { pickFolder, ...(remote ? { remoteClient: { active: true } } : {}) };
}

async function open(): Promise<void> {
  setTeamProjects(list);
  await act(async () => root.render(createElement(SettingsLook.Provider, { value: true }, createElement(TeamProjectsSettings))));
  await settle();
}

async function type(value: string): Promise<void> {
  const field = pathField()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  await act(async () => { q("[data-team-projects-root-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  calls = [];
  list = { root: "/dramas", projects: [bride, heir, lost] };
  saved = (path) => [200, { root: path }];
  restored = (id) => [200, { project: { ...list!.projects.find((one) => one.id === id)!, archivedAt: undefined } }];
  pickFolder = vi.fn(async () => "/Volumes/Dramas");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const restore = call.path.match(/^\/api\/team-projects\/([\w-]+)\/restore$/);
    const [status, body]: Answer = call.method === "PUT" ? saved((call.body as { path: string }).path)
      : restore ? await restored(restore[1]!)
      : list ? [200, list] : [404, { error: "Not found" }];
    if (status === 200 && call.method === "PUT") list = { ...list!, root: (body as { root: string }).root };
    if (status === 200 && restore) list = { ...list!, projects: list!.projects.map((one) => (one.id === restore[1] ? (body as { project: TeamProjectWire }).project : one)) };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as unknown as { ogb?: unknown }).ogb;
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("the projects on Settings → Data", () => {
  it("are not drawn where the server has no projects", async () => {
    list = null;
    await open();
    expect(container.textContent).toBe("");
  });

  it("read the list again when the page opens", async () => {
    await open();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /api/team-projects"]);
  });

  it("are two groups Settings can scroll to: the folder for new projects, then the archived projects", async () => {
    await open();
    expect(all("[data-settings-block]").map((block) => [block.dataset.settingsBlock, block.querySelector("h3")!.textContent])).toEqual([
      ["projects", "Projects"], ["archived-projects", "Archived projects"],
    ]);
  });
});

describe("the folder for new projects", () => {
  it("shows the folder beside the picker's button, and says so when none is set", async () => {
    desktop();
    await open();
    expect(rootText()).toBe("/dramas");
    expect(q("[data-team-projects-root]")!.getAttribute("dir")).toBe("ltr");
    list = { root: null, projects: [] };
    await open();
    expect(rootText()).toBe("Not set yet");
  });

  it("shows the folder in the field where it is typed, once, and says so when none is set", async () => {
    await open();
    expect(pathField()!.value).toBe("/dramas");
    expect(rootText()).toBeUndefined();
    list = { root: null, projects: [] };
    await open();
    expect(pathField()!.value).toBe("");
    expect(rootText()).toBe("Not set yet");
  });

  it("says what changing it does and does not do", async () => {
    await open();
    expect(q('[data-settings-block="projects"]')!.textContent).toContain("Changing it doesn't move the projects you already have.");
  });

  it("is chosen with the desktop's folder picker, opened at the folder it has now, and saved at once", async () => {
    desktop();
    await open();
    expect(pathField()).toBeNull();
    await click(q("[data-team-projects-choose]"));
    expect(pickFolder).toHaveBeenCalledWith("/dramas");
    expect(changes()).toEqual([{ path: "/api/team-projects/root", method: "PUT", body: { path: "/Volumes/Dramas" } }]);
    expect(rootText()).toBe("/Volumes/Dramas");
    expect(alerts()).toEqual([]);
  });

  it("opens the picker where the desktop likes when no folder is set", async () => {
    desktop();
    list = { root: null, projects: [] };
    await open();
    await click(q("[data-team-projects-choose]"));
    expect(pickFolder).toHaveBeenCalledWith(undefined);
    expect(rootText()).toBe("/Volumes/Dramas");
  });

  it("stays as it is when the person closes the picker without choosing", async () => {
    desktop();
    pickFolder.mockResolvedValue(null);
    await open();
    await click(q("[data-team-projects-choose]"));
    expect(changes()).toEqual([]);
    expect(rootText()).toBe("/dramas");
  });

  it("shows the server's refusal beside it, in the app's language, under the folder it is about, and keeps the folder it had", async () => {
    desktop();
    saved = () => [422, { error: "English.", errorKey: "serverError.teamProject.rootInData" }];
    await open();
    await click(q("[data-team-projects-choose]"));
    expect(alertLines()).toEqual(["/Volumes/Dramas", "That folder is inside MagicBot's own data folder. Choose one outside it."]);
    expect(q('[data-settings-block="projects"] [data-setting-row]')!.contains(q('[role="alert"]'))).toBe(true);
    expect(rootText()).toBe("/dramas");
    saved = (path) => [200, { root: path }];
    await click(q("[data-team-projects-choose]"));
    expect(alerts()).toEqual([]);
  });

  it("says so when saving failed for a reason the server did not give", async () => {
    desktop();
    saved = () => [500, {}];
    await open();
    await click(q("[data-team-projects-choose]"));
    expect(alertLines()).toEqual(["/Volumes/Dramas", "Couldn't save this folder. Try again."]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await click(q("[data-team-projects-choose]"));
    expect(alertLines()).toEqual(["/Volumes/Dramas", "Couldn't save this folder. Try again."]);
    expect((q("[data-team-projects-choose]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("is typed as a path where there is no folder picker", async () => {
    await open();
    expect(q("[data-team-projects-choose]")).toBeNull();
    const field = pathField()!;
    expect(field.value).toBe("/dramas");
    expect(q(`label[for="${field.id}"]`)!.textContent).toBe("Folder for new projects");
    expect(field.placeholder).toBe("Full path of a folder");
    const save = q('[data-team-projects-root-form] button[type="submit"]') as HTMLButtonElement;
    expect(save.textContent).toBe("Save");
    expect(save.disabled).toBe(true);
    await type("  /srv/dramas ");
    expect(save.disabled).toBe(false);
    await submit();
    expect(changes()).toEqual([{ path: "/api/team-projects/root", method: "PUT", body: { path: "/srv/dramas" } }]);
    expect(pathField()!.value).toBe("/srv/dramas");
    expect(save.disabled).toBe(true);
  });

  it("shows the folder as the server saved it", async () => {
    saved = () => [200, { root: "/srv/dramas" }];
    await open();
    await type("/srv/dramas/");
    await submit();
    expect(pathField()!.value).toBe("/srv/dramas");
  });

  it("keeps what was typed when the server refuses it", async () => {
    saved = () => [422, { error: "Give the folder's full path." }];
    await open();
    await type("dramas");
    await submit();
    expect(alerts()).toEqual(["Give the folder's full path."]);
    expect(pathField()!.value).toBe("dramas");
    await type("/dramas2");
    expect(alerts()).toEqual([]);
  });

  it("is typed too in an app that drives another computer: the picker would choose a folder of this one", async () => {
    desktop(true);
    await open();
    expect(q("[data-team-projects-choose]")).toBeNull();
    expect(pathField()).toBeTruthy();
  });
});

describe("the archived projects", () => {
  it("are listed by name with their folders, the one archived last first, and only they", async () => {
    await open();
    expect(archivedNames()).toEqual(["The lost son", "The heir"]);
    expect(q('[data-team-project-archived="p2"]')!.textContent).toContain("/dramas/The heir");
  });

  it("say so when a project's folder cannot be found", async () => {
    await open();
    expect(q('[data-team-project-archived="p3"] [data-team-project-missing]')!.textContent).toBe("Project folder not found");
    expect(q('[data-team-project-archived="p2"] [data-team-project-missing]')).toBeNull();
  });

  it("say in one line where they come from when there are none", async () => {
    list = { root: "/dramas", projects: [bride] };
    await open();
    expect(all("[data-team-project-archived]")).toEqual([]);
    expect(q('[data-settings-block="archived-projects"] [data-settings-empty]')!.textContent).toBe("No archived projects. To archive a project, open its menu in the sidebar.");
  });

  it("each have a Restore button named for the project, which brings it back", async () => {
    await open();
    const button = q('[data-team-project-restore="p2"]') as HTMLButtonElement;
    expect([button.textContent, button.getAttribute("aria-label")]).toEqual(["Restore", "Restore The heir"]);
    await click(button);
    expect(changes()).toEqual([{ path: "/api/team-projects/p2/restore", method: "POST", body: undefined }]);
    expect(archivedNames()).toEqual(["The lost son"]);
    expect(alerts()).toEqual([]);
  });

  it("keep the keyboard's place when a row leaves: the next project's button, else the last one's, else the line that says none is archived", async () => {
    list = { root: "/dramas", projects: [bride, heir, lost, project("p4", "The twin", { archivedAt: 7 })] };
    await open();
    expect(archivedNames()).toEqual(["The twin", "The lost son", "The heir"]);
    const restore = async (id: string) => {
      q(`[data-team-project-restore="${id}"]`)!.focus();
      await click(q(`[data-team-project-restore="${id}"]`));
    };
    await restore("p4");
    expect(document.activeElement).toBe(q('[data-team-project-restore="p3"]'));
    await restore("p2");
    expect(document.activeElement).toBe(q('[data-team-project-restore="p3"]'));
    await restore("p3");
    expect(document.activeElement!.textContent).toBe("No archived projects. To archive a project, open its menu in the sidebar.");
    expect(document.activeElement!.getAttribute("tabindex")).toBe("-1");
  });

  it("leave the keyboard where the person has moved it meanwhile", async () => {
    let finish: (answer: Answer) => void = () => {};
    restored = () => new Promise<Answer>((resolve) => { finish = resolve; });
    await open();
    await click(q('[data-team-project-restore="p2"]'));
    pathField()!.focus();
    await act(async () => finish([200, { project: { ...heir, archivedAt: undefined } }]));
    await settle();
    expect(document.activeElement).toBe(pathField());
  });

  it("cannot be asked twice while one is on its way", async () => {
    let finish: (answer: Answer) => void = () => {};
    restored = () => new Promise<Answer>((resolve) => { finish = resolve; });
    await open();
    await click(q('[data-team-project-restore="p2"]'));
    expect(all("[data-team-project-restore]").map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true]);
    await act(async () => finish([200, { project: { ...heir, archivedAt: undefined } }]));
    await settle();
    expect(archivedNames()).toEqual(["The lost son"]);
    expect((q('[data-team-project-restore="p3"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("say on the project's own row when it could not be restored", async () => {
    restored = () => [500, {}];
    await open();
    await click(q('[data-team-project-restore="p3"]'));
    expect(alerts()).toEqual(["Couldn't restore The lost son. Try again."]);
    expect(q('[data-team-project-archived="p3"]')!.contains(q('[role="alert"]'))).toBe(true);
    expect(archivedNames()).toEqual(["The lost son", "The heir"]);
    restored = (id) => [200, { project: { ...list!.projects.find((one) => one.id === id)!, archivedAt: undefined } }];
    await click(q('[data-team-project-restore="p3"]'));
    expect(alerts()).toEqual([]);
    expect(archivedNames()).toEqual(["The heir"]);
  });
});
