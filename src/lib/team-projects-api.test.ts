import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects";
import { archiveTeamProject, createTeamProject, listProjectTeams, listTeamProjects, restoreTeamProject, saveTeamProjectsRoot } from "./team-projects-api";

const project: TeamProjectWire = {
  id: "p1", name: "The bride", folder: "/dramas/The bride", section: "The bride", team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead"],
};

interface Call { path: string; method: string; body: unknown }

function answer(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("the project routes", () => {
  it("reads the list", async () => {
    const calls = answer(200, { root: "/dramas", projects: [project] });
    expect(await listTeamProjects()).toEqual({ root: "/dramas", projects: [project] });
    expect(calls).toEqual([{ path: "/api/team-projects", method: "GET", body: undefined }]);
  });

  it("reads the teams a project can be made from", async () => {
    const teams = [{ name: "Urban", context: "", chief: { id: "head", name: "Head", title: "" }, members: [{ id: "head", name: "Head", title: "" }] }];
    const calls = answer(200, { teams });
    expect(await listProjectTeams()).toEqual(teams);
    expect(calls).toEqual([{ path: "/api/team-projects/teams", method: "GET", body: undefined }]);
    answer(200, {});
    expect(await listProjectTeams()).toEqual([]);
  });

  it("makes a project from a team", async () => {
    const calls = answer(201, { project });
    expect(await createTeamProject({ name: "The bride", team: "Urban" })).toEqual({ project });
    expect(calls).toEqual([{ path: "/api/team-projects", method: "POST", body: { name: "The bride", team: "Urban" } }]);
  });

  it("gives a refusal as its code and the server's sentence", async () => {
    answer(409, { error: "A project already has this name.", code: "name_taken" });
    expect(await createTeamProject({ name: "The bride", team: "Urban" })).toEqual({ refused: "name_taken", error: "A project already has this name." });
    answer(422, { error: "No folder is set.", code: "no_root" });
    expect(await createTeamProject({ name: "x", team: "Urban" })).toEqual({ refused: "no_root", error: "No folder is set." });
  });

  it("gives a refusal it does not know without a code", async () => {
    answer(422, { error: "Not today.", code: "something_new" });
    expect(await createTeamProject({ name: "x", team: "Urban" })).toEqual({ refused: null, error: "Not today." });
    answer(500, { error: "The list of projects cannot be read." });
    expect(await createTeamProject({ name: "x", team: "Urban" })).toEqual({ refused: null, error: "The list of projects cannot be read." });
  });

  it("gives the server's sentence in the app's language when the server names it, and none when the server sent none", async () => {
    answer(500, { error: "English.", code: "failed", errorKey: "serverError.teamProject.failedLeftovers", errorParams: { detail: "disk full" } });
    expect(await createTeamProject({ name: "x", team: "Urban" })).toEqual({ refused: "failed", error: "The project couldn't be made, and part of it couldn't be removed again. (disk full)" });
    answer(502, "<html>Bad gateway</html>");
    expect(await createTeamProject({ name: "x", team: "Urban" })).toEqual({ refused: null, error: "" });
    answer(422, {});
    expect(await saveTeamProjectsRoot("/dramas")).toEqual({ error: "" });
  });

  it("leaves a request that never arrived to its caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(createTeamProject({ name: "x", team: "Urban" })).rejects.toThrow("Failed to fetch");
    await expect(saveTeamProjectsRoot("/dramas")).rejects.toThrow("Failed to fetch");
  });

  it("archives and restores by id", async () => {
    const calls = answer(200, { project: { ...project, archivedAt: 9 } });
    expect((await archiveTeamProject("p 1")).archivedAt).toBe(9);
    await restoreTeamProject("p 1");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /api/team-projects/p%201/archive", "POST /api/team-projects/p%201/restore"]);
  });

  it("saves the folder for new projects", async () => {
    const calls = answer(200, { root: "/dramas" });
    expect(await saveTeamProjectsRoot("/dramas")).toEqual({ root: "/dramas" });
    expect(calls).toEqual([{ path: "/api/team-projects/root", method: "PUT", body: { path: "/dramas" } }]);
  });

  it("gives the server's sentence when the folder is refused", async () => {
    answer(422, { error: "Choose a folder outside the app's own data." });
    expect(await saveTeamProjectsRoot("/data/inside")).toEqual({ error: "Choose a folder outside the app's own data." });
  });
});
