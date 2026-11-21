import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectsEvent, TeamProjectsListWire, TeamProjectWire } from "../../shared/team-projects";
import type { ServerFrame } from "../../shared/wire";
import { publishLiveFrame, publishMissedFrames } from "../lib/live-events";
import {
  archiveProject, createProject, currentTeamProjectSide, followTeamProjectEvents, refreshTeamProjects, restoreProject, saveProjectsRoot, setTeamProjects,
} from "./team-projects";

const project = (id: string, extra: Partial<TeamProjectWire> = {}): TeamProjectWire => ({
  id, name: id, folder: `/dramas/${id}`, section: id, team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: `${id}-lead`, createdAt: 1, folderState: "ready", botIds: [`${id}-lead`], ...extra,
});

interface Waiting { path: string; method: string; answer(status: number, body: unknown): Promise<void> }

/** Every request waits until the test answers it, so a test decides which answer lands first. */
function server(): Waiting[] {
  const waiting: Waiting[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
    waiting.push({
      path: String(input), method: init?.method ?? "GET",
      answer: async (status, body) => {
        resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
        await new Promise((done) => setTimeout(done, 0));
      },
    });
  })));
  return waiting;
}

/** A page out of sight, as a minimized window is. `show()` brings it back. */
function hiddenPage(): { show(): void } {
  const listeners = new Set<() => void>();
  const page = {
    visibilityState: "hidden",
    addEventListener: (_name: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_name: string, listener: () => void) => { listeners.delete(listener); },
  };
  vi.stubGlobal("document", page);
  return { show: () => { page.visibilityState = "visible"; for (const listener of listeners) listener(); } };
}

const soon = () => new Promise((done) => setTimeout(done, 0));
const names = () => currentTeamProjectSide().projects.map((one) => one.id);
const list = (...projects: TeamProjectWire[]): TeamProjectsListWire => ({ root: "/dramas", projects });

beforeEach(() => setTeamProjects(null));
afterEach(() => vi.unstubAllGlobals());

describe("reading the projects", () => {
  it("shows nothing until the list is read, then the server's list", async () => {
    const calls = server();
    expect(currentTeamProjectSide().shown).toBe(false);
    const read = refreshTeamProjects();
    await calls[0]!.answer(200, list(project("bride")));
    await read;
    expect([currentTeamProjectSide().shown, names(), currentTeamProjectSide().root]).toEqual([true, ["bride"], "/dramas"]);
  });

  it("stops asking a server that has no projects", async () => {
    const calls = server();
    const read = refreshTeamProjects();
    await calls[0]!.answer(404, { error: "Not found" });
    await read;
    await refreshTeamProjects();
    expect([currentTeamProjectSide().shown, calls.length]).toEqual([false, 1]);
  });

  it("stops asking on a device that may not read them", async () => {
    const calls = server();
    setTeamProjects(list(project("bride")));
    const read = refreshTeamProjects();
    await calls[0]!.answer(403, { error: "Not allowed from this device" });
    await read;
    await refreshTeamProjects();
    expect([currentTeamProjectSide().shown, calls.filter((call) => call.path === "/api/team-projects").length]).toEqual([false, 1]);
  });

  it("keeps the list on screen when a later read fails, and asks again next time", async () => {
    const calls = server();
    setTeamProjects(list(project("bride")));
    const read = refreshTeamProjects();
    await calls[0]!.answer(500, { error: "The list of projects cannot be read." });
    await read;
    void refreshTeamProjects();
    expect([names(), calls.length]).toEqual([["bride"], 2]);
  });

  it("takes an answer that is not a list for no answer", async () => {
    const calls = server();
    const read = refreshTeamProjects();
    await calls[0]!.answer(200, {});
    await read;
    void refreshTeamProjects();
    expect([currentTeamProjectSide().shown, calls.length]).toEqual([false, 2]);
  });

  it("reads once more after the read on its way, however often it is asked meanwhile", async () => {
    const calls = server();
    const first = refreshTeamProjects();
    void refreshTeamProjects();
    void refreshTeamProjects();
    await calls[0]!.answer(200, list(project("bride")));
    expect(calls.length).toBe(2);
    await calls[1]!.answer(200, list(project("bride"), project("palace")));
    await first;
    expect([calls.length, names()]).toEqual([2, ["bride", "palace"]]);
  });

  it("waits with a read nobody asked for while the page is out of sight, and reads when it shows again", async () => {
    const calls = server();
    const page = hiddenPage();
    setTeamProjects(list(project("bride")));
    const read = refreshTeamProjects({ background: true });
    await soon();
    expect(calls.length).toBe(0);
    page.show();
    await soon();
    await calls[0]!.answer(200, list(project("bride"), project("palace")));
    await read;
    expect(names()).toEqual(["bride", "palace"]);
  });

  it("does not wait while there is no list yet: until then a project's department would show as a department", async () => {
    const calls = server();
    hiddenPage();
    const read = refreshTeamProjects({ background: true });
    await soon();
    expect(calls.length).toBe(1);
    await calls[0]!.answer(200, list(project("bride")));
    await read;
    expect(names()).toEqual(["bride"]);
  });

  it("reads at once for the person's own change, also behind a read that waits for the page to show", async () => {
    const calls = server();
    hiddenPage();
    setTeamProjects(list(project("bride")));
    void refreshTeamProjects({ background: true });
    await soon();
    const read = refreshTeamProjects();
    await soon();
    expect(calls.length).toBe(1);
    await calls[0]!.answer(200, list(project("bride"), project("palace")));
    await read;
    expect(names()).toEqual(["bride", "palace"]);
  });
});

describe("the server's word", () => {
  const folder = (folderState: TeamProjectWire["folderState"]) =>
    publishLiveFrame({ kind: "team-projects", projectId: "bride", folderState } satisfies TeamProjectsEvent as unknown as ServerFrame);

  it("reads the list again when a project's folder goes missing or comes back, and after the frames were missed", async () => {
    const calls = server();
    setTeamProjects(list(project("bride")));
    const stop = followTeamProjectEvents();
    folder("missing");
    await soon();
    await calls[0]!.answer(200, list(project("bride", { folderState: "missing" })));
    expect(currentTeamProjectSide().projects.map((one) => one.folderState)).toEqual(["missing"]);
    publishLiveFrame({ kind: "sections", sections: [] });
    await soon();
    expect(calls.length).toBe(1);
    publishMissedFrames();
    await soon();
    await calls[1]!.answer(200, list(project("bride")));
    expect(currentTeamProjectSide().projects.map((one) => one.folderState)).toEqual(["ready"]);
    stop();
    folder("missing");
    await soon();
    expect(calls.length).toBe(2);
  });
});

describe("the person's own changes", () => {
  it("archive a project at once and read the list again", async () => {
    const calls = server();
    setTeamProjects(list(project("bride"), project("palace")));
    const archiving = archiveProject("bride");
    await calls[0]!.answer(200, { project: project("bride", { archivedAt: 9 }) });
    await archiving;
    expect([names(), currentTeamProjectSide().archived.map((one) => one.id)]).toEqual([["palace"], ["bride"]]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /api/team-projects/bride/archive", "GET /api/team-projects"]);
  });

  it("restore a project at once", async () => {
    const calls = server();
    setTeamProjects(list(project("bride", { archivedAt: 9 })));
    const restoring = restoreProject("bride");
    await calls[0]!.answer(200, { project: project("bride") });
    await restoring;
    expect([names(), currentTeamProjectSide().archived]).toEqual([["bride"], []]);
  });

  it("are not undone by an older answer that lands after them", async () => {
    const calls = server();
    setTeamProjects(list(project("bride")));
    const reading = refreshTeamProjects();
    const archiving = archiveProject("bride");
    await calls[1]!.answer(200, { project: project("bride", { archivedAt: 9 }) });
    await archiving;
    await calls[0]!.answer(200, list(project("bride")));
    expect(names()).toEqual([]);
    await calls[2]!.answer(200, list(project("bride", { archivedAt: 9 })));
    await reading;
    expect(names()).toEqual([]);
  });

  it("leave the list alone when the server refuses", async () => {
    const calls = server();
    setTeamProjects(list(project("bride")));
    const refused = expect(archiveProject("bride")).rejects.toThrow("No such project");
    await calls[0]!.answer(404, { error: "No such project" });
    await refused;
    expect(names()).toEqual(["bride"]);
  });

  it("add a new project to the list at once, and keep its department out of the departments while it is made", async () => {
    const calls = server();
    setTeamProjects(list());
    const creating = createProject({ name: " The bride ", team: "Urban" });
    expect(currentTeamProjectSide().department("The bride")).toBe(false);
    await calls[0]!.answer(201, { project: project("bride", { name: "The bride", section: "The bride" }) });
    expect(await creating).toMatchObject({ project: { id: "bride" } });
    expect([names(), currentTeamProjectSide().department("The bride")]).toEqual([["bride"], false]);
  });

  it("list nothing new when a project is refused", async () => {
    const calls = server();
    setTeamProjects(list());
    const creating = createProject({ name: "The bride", team: "Urban" });
    await calls[0]!.answer(409, { error: "Taken.", code: "name_taken" });
    expect(await creating).toEqual({ refused: "name_taken", error: "Taken." });
    expect([names(), currentTeamProjectSide().department("The bride")]).toEqual([[], true]);
  });

  it("set the folder for new projects at once", async () => {
    const calls = server();
    setTeamProjects({ root: null, projects: [] });
    const saving = saveProjectsRoot("/dramas");
    await calls[0]!.answer(200, { root: "/dramas" });
    expect(await saving).toEqual({ root: "/dramas" });
    expect(currentTeamProjectSide().root).toBe("/dramas");
  });

  it("keep the folder when the server refuses the new one", async () => {
    const calls = server();
    setTeamProjects({ root: "/dramas", projects: [] });
    const saving = saveProjectsRoot("relative");
    await calls[0]!.answer(422, { error: "Give a full path." });
    expect(await saving).toEqual({ error: "Give a full path." });
    expect(currentTeamProjectSide().root).toBe("/dramas");
  });
});
