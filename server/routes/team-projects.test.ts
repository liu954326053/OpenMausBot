import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { CreateTeamProjectResult, ProjectTeamWire, TeamProjectRefusal, TeamProjectWire } from "../../shared/team-projects.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord } from "../store.ts";
import type { TeamComputers } from "../team-computers.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "../team-projects/testing.ts";
import type { RouteHandler } from "./table.ts";
import type { TeamProjectRouteHost } from "./team-projects.ts";

const OWNER = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
const BOT_SHELL = { kind: "loopback", scopes: ["admin"], trust: "service" } as unknown as RequestAuth;
const PHONE = { kind: "session", scopes: ["client"] } as unknown as RequestAuth;

const servers: Server[] = [];
let app: TeamProjectsTestApp | undefined;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

/** The project routes in front of `behind`, answering as the server's own request handler does. */
async function serve(host: TeamProjectRouteHost, behind: RouteHandler[] = [], auth: RequestAuth = OWNER) {
  const { json, readBody } = await import("../harness/http.ts");
  const { userErrorFields } = await import("../user-errors.ts");
  const { dispatchRoutes } = await import("./table.ts");
  const { createTeamProjectRoutes } = await import("./team-projects.ts");
  const routes = [createTeamProjectRoutes(host), ...behind];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
    } catch (error) {
      json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message, ...userErrorFields(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
}

const PROJECT: TeamProjectWire = {
  id: "project-1", name: "Stand-in bride", folder: "/dramas/Stand-in bride", section: "Stand-in bride",
  team: { key: "team:sales", name: "Sales desk" }, leadBotId: "bot-1", createdAt: 1, folderState: "ready", botIds: ["bot-1", "bot-2"], follows: { "bot-1": "src-1" },
};

const TEAMS: ProjectTeamWire[] = [
  { name: "Sales desk", context: "We sell seats.", chief: { id: "src-1", name: "Morgan", title: "Sales lead" }, members: [{ id: "src-1", name: "Morgan", title: "Sales lead" }] },
  { name: "Marketing", context: "", chief: null, members: [{ id: "src-2", name: "Helper", title: "" }], unusable: "no_chief" },
];

function fakeHost(overrides: Partial<TeamProjectRouteHost> = {}): TeamProjectRouteHost & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    listWire: () => ({ root: "/dramas", projects: [PROJECT] }),
    teams: () => TEAMS,
    create: async (input) => { asked.push(input); return { project: PROJECT }; },
    archive: (id) => (id === PROJECT.id ? { ...PROJECT, archivedAt: 5 } : null),
    restore: (id) => (id === PROJECT.id ? PROJECT : null),
    setRoot: (path) => (path === "/dramas" ? { root: "/dramas" } : { error: "Give the folder's full path.", errorKey: "serverError.teamProject.rootNotAbsolute" }),
    moveRefusalFor: () => null,
    departmentRefusal: () => null,
    copyRefusal: () => null,
    copyChangeRefusal: () => null,
    contextRefusal: () => null,
    ...overrides,
  };
}

describe("the project routes", () => {
  it("stay behind the admin gate", async () => {
    const { requiredScope } = await import("../request-auth.ts");
    for (const [method, path] of [
      ["GET", "/api/team-projects"], ["GET", "/api/team-projects/teams"], ["POST", "/api/team-projects"], ["PUT", "/api/team-projects/root"],
      ["POST", "/api/team-projects/project-1/archive"], ["POST", "/api/team-projects/project-1/restore"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });

  it("list the projects with the folder they are made in", async () => {
    const call = await serve(fakeHost());
    expect(await call("GET", "/api/team-projects")).toEqual({ status: 200, body: { root: "/dramas", projects: [PROJECT] } });
  });

  it("list the teams a project can be made from, the ones it cannot be made from with the reason", async () => {
    const call = await serve(fakeHost());
    expect(await call("GET", "/api/team-projects/teams")).toEqual({ status: 200, body: { teams: TEAMS } });
  });

  it("make a project from a team and answer 201 with it", async () => {
    const host = fakeHost();
    const call = await serve(host);
    expect(await call("POST", "/api/team-projects", { name: "Stand-in bride", team: "Sales desk", extra: "ignored" })).toEqual({
      status: 201, body: { project: PROJECT },
    });
    expect(host.asked).toEqual([{ name: "Stand-in bride", team: "Sales desk" }]);
  });

  it.each<[TeamProjectRefusal, number]>([
    ["no_root", 422], ["root_missing", 422], ["bad_name", 422], ["no_team", 422], ["team_unusable", 422], ["name_taken", 409], ["folder_exists", 409], ["failed", 500],
  ])("answer a project refused for %s with %i, the code and words the app can translate", async (code, status) => {
    const refusal: CreateTeamProjectResult = { error: "Refused.", code, errorKey: "serverError.teamProject.failed", errorParams: { detail: "why" } };
    const call = await serve(fakeHost({ create: async () => refusal }));
    expect(await call("POST", "/api/team-projects", { name: "X", team: "Sales desk" })).toEqual({ status, body: refusal });
  });

  it("hand a body that is no object on as a project with no name", async () => {
    const host = fakeHost();
    const call = await serve(host);
    await call("POST", "/api/team-projects", ["not", "an", "object"]);
    expect(host.asked).toEqual([{ name: undefined, team: undefined }]);
  });

  it("archive and restore a project, and answer 404 for one that is not there", async () => {
    const call = await serve(fakeHost());
    expect(await call("POST", "/api/team-projects/project-1/archive")).toEqual({ status: 200, body: { project: { ...PROJECT, archivedAt: 5 } } });
    expect(await call("POST", "/api/team-projects/project-1/restore")).toEqual({ status: 200, body: { project: PROJECT } });
    const missing = { status: 404, body: { error: "That project is no longer there.", errorKey: "serverError.teamProject.notFound" } };
    expect(await call("POST", "/api/team-projects/nope/archive")).toEqual(missing);
    expect(await call("POST", "/api/team-projects/nope/restore")).toEqual(missing);
  });

  it("save the folder for projects, and answer 422 with the reason when it cannot hold them", async () => {
    const call = await serve(fakeHost());
    expect(await call("PUT", "/api/team-projects/root", { path: "/dramas" })).toEqual({ status: 200, body: { root: "/dramas" } });
    expect(await call("PUT", "/api/team-projects/root", { path: "dramas" })).toEqual({
      status: 422, body: { error: "Give the folder's full path.", errorKey: "serverError.teamProject.rootNotAbsolute" },
    });
    expect((await call("PUT", "/api/team-projects/root", {})).status).toBe(422);
  });

  it("say so, with words the app can translate, when the list of projects cannot be read", async () => {
    const { userErrorThrown } = await import("../user-errors.ts");
    const unreadable = () => { throw Object.assign(userErrorThrown("serverError.teamProject.unreadable"), { status: 500 }); };
    const call = await serve(fakeHost({ listWire: unreadable, archive: unreadable }));
    const answer = { status: 500, body: { error: expect.stringContaining("couldn't be read"), errorKey: "serverError.teamProject.unreadable" } };
    expect(await call("GET", "/api/team-projects")).toEqual(answer);
    expect(await call("POST", "/api/team-projects/project-1/archive")).toEqual(answer);
  });

  it("leave every other request to the routes behind them", async () => {
    const call = await serve(fakeHost());
    for (const [method, path] of [
      ["GET", "/api/team-projects/root"], ["DELETE", "/api/team-projects/project-1"], ["POST", "/api/team-projects/project-1/delete"],
      ["POST", "/api/team-projects/a%2Fb/archive"], ["GET", "/api/bots"], ["GET", "/api/sidebar-sections"],
    ] as const) expect(await call(method, path), `${method} ${path}`).toEqual({ status: 404, body: { from: "inline routes" } });
  });

  it.each([["a bot's shell on a shared computer", BOT_SHELL], ["a signed-in device that is not an admin", PHONE]])("let %s read and change nothing", async (_who, auth) => {
    const host = fakeHost({ archive: () => { throw new Error("reached"); }, restore: () => { throw new Error("reached"); }, setRoot: () => { throw new Error("reached"); } });
    const call = await serve(host, [], auth);
    const refused = { status: 403, body: { error: "Only the owner or an admin can do that.", errorKey: "serverError.chat.ownerOrAdmin" } };
    expect(await call("GET", "/api/team-projects")).toEqual(refused);
    expect(await call("GET", "/api/team-projects/teams")).toEqual(refused);
    expect(await call("POST", "/api/team-projects", { name: "X", team: "Sales desk" })).toEqual(refused);
    expect(await call("PUT", "/api/team-projects/root", { path: "/dramas" })).toEqual(refused);
    expect(await call("POST", "/api/team-projects/project-1/archive")).toEqual(refused);
    expect(await call("POST", "/api/team-projects/project-1/restore")).toEqual(refused);
    expect(host.asked).toEqual([]);
  });
});

/** A real project in a real store, with the app's own department routes and stand-ins for the bot settings routes behind the guards. */
async function withProject() {
  app = await teamProjectsInstallation();
  const { createSidebarSectionRoutes } = await import("./sidebar-sections.ts");
  const table = await import("./table.ts");
  const installation = app;
  installation.projects.start();
  installation.salesTeam();
  installation.projects.setRoot(installation.root);
  const made = await installation.projects.create({ name: "Stand-in bride", team: "Sales desk" });
  if (!("project" in made)) throw new Error(made.error);
  const outsider = installation.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false });
  const writer = installation.byRole(made.project.id).get("writer")!;

  const teamComputers = { forSection: () => undefined, renameSection: () => false } as unknown as TeamComputers;
  const departments = createSidebarSectionRoutes({
    store: installation.store, teamComputers, maxBots: 100, assertTeamComputerChangeIdle: () => {}, wireBot: (bot: BotRecord) => ({ id: bot.id, section: bot.section }) as never,
  });
  const patchBot: RouteHandler = async ({ req, res, path, method, json, readBody }) => {
    const match = method === "PATCH" ? path.match(/^\/api\/bots\/([\w-]+)$/) : null;
    if (!match) return table.PASS;
    const body = await readBody(req);
    return json(res, 200, { bot: installation.store.patchBot(match[1]!, body) });
  };
  const botSettings: RouteHandler = async ({ req, res, path, json, readBody }) => {
    if (!/^\/api\/bots\/[\w-]+\/(profile|model|avatar\/generate|soul\/apply-file|history\/rollback)$/.test(path)) return table.PASS;
    return json(res, 200, { read: await readBody(req) });
  };
  const call = await serve(installation.projects, [patchBot, botSettings, departments]);
  const sectionOf = (id: string) => installation.store.bot(id)!.section;
  return { app: installation, project: made.project, outsider, writer, call, sectionOf };
}

describe("the guard on a project's department", () => {
  const stays = (bot: string) => ({ status: 409, body: { error: `${bot} belongs to a project and can't move to another department.`, errorKey: "serverError.teamProject.botStays", errorParams: { bot } } });
  const noJoin = { status: 409, body: { error: expect.stringContaining("Stand-in bride is a project's team"), errorKey: "serverError.teamProject.noJoin", errorParams: { department: "Stand-in bride" } } };
  const fixed = { status: 409, body: { error: "Stand-in bride is a project's team, so it can't be renamed or deleted.", errorKey: "serverError.teamProject.departmentFixed", errorParams: { department: "Stand-in bride" } } };

  it("refuses to move a project's bot out through its settings, and a bot that is already there in", async () => {
    const { outsider, writer, call, sectionOf } = await withProject();
    expect(await call("PATCH", `/api/bots/${writer.id}`, { section: "Marketing" })).toEqual(stays("Quill"));
    expect(await call("PATCH", `/api/bots/${writer.id}`, { section: "" })).toEqual(stays("Quill"));
    expect(await call("PATCH", `/api/bots/${writer.id}`, { section: null })).toEqual(stays("Quill"));
    expect(await call("PATCH", `/api/bots/${outsider.id}`, { section: "Stand-in bride" })).toEqual(noJoin);
    expect(sectionOf(writer.id)).toBe("Stand-in bride");
    expect(sectionOf(outsider.id)).toBe("Marketing");
  });

  it("lets every other change to a bot through, a project's bot included", async () => {
    const { app, outsider, writer, call, sectionOf } = await withProject();
    expect((await call("PATCH", `/api/bots/${writer.id}`, { voice: "calm" })).status).toBe(200);
    expect((await call("PATCH", `/api/bots/${writer.id}`, { section: "Stand-in bride", pinned: true })).status).toBe(200);
    expect((await call("PATCH", `/api/bots/${outsider.id}`, { section: "Sales" })).status).toBe(200);
    expect(app.store.bot(writer.id)).toMatchObject({ voice: "calm", pinned: true });
    expect(sectionOf(outsider.id)).toBe("Sales");
  });

  it("refuses the same moves through the department's own page", async () => {
    const { outsider, writer, call, sectionOf } = await withProject();
    expect(await call("PUT", "/api/sidebar-sections?section=Stand-in%20bride", { addBotIds: [outsider.id], removeBotIds: [] })).toEqual(noJoin);
    expect(await call("PUT", "/api/sidebar-sections?section=Stand-in%20bride", { addBotIds: [], removeBotIds: [writer.id] })).toEqual(stays("Quill"));
    expect(await call("PUT", "/api/sidebar-sections?section=Marketing", { addBotIds: [writer.id], removeBotIds: [] })).toEqual(stays("Quill"));
    expect(await call("POST", "/api/sidebar-sections", { name: "Stand-in bride", botIds: [outsider.id] })).toEqual(noJoin);
    expect(await call("POST", "/api/sidebar-sections", { name: "A new department", botIds: [outsider.id, writer.id] })).toEqual(stays("Quill"));
    expect(await call("POST", "/api/sidebar-sections", { name: "", botIds: [writer.id] })).toEqual(stays("Quill"));
    expect(sectionOf(writer.id)).toBe("Stand-in bride");
    expect(sectionOf(outsider.id)).toBe("Marketing");
  });

  it("refuses to rename or delete a project's department", async () => {
    const { app, project, call } = await withProject();
    expect(await call("PATCH", "/api/sidebar-sections?section=Stand-in%20bride", { name: "Renamed" })).toEqual(fixed);
    expect(await call("DELETE", "/api/sidebar-sections?section=Stand-in%20bride")).toEqual(fixed);
    expect(await call("DELETE", "/api/sidebar-sections?section=%20Stand-in%20bride%20")).toEqual(fixed);
    expect(app.store.sections).toContain("Stand-in bride");
    expect(app.botsOf(project.id).every((bot) => bot.section === "Stand-in bride")).toBe(true);
  });

  it("leaves other departments alone: they are made, filled, renamed and deleted as before", async () => {
    const { app, outsider, call, sectionOf } = await withProject();
    expect((await call("POST", "/api/sidebar-sections", { name: "Sales", botIds: [outsider.id] })).status).toBe(200);
    expect(sectionOf(outsider.id)).toBe("Sales");
    expect((await call("PUT", "/api/sidebar-sections?section=Marketing", { addBotIds: [outsider.id], removeBotIds: [] })).status).toBe(200);
    expect(sectionOf(outsider.id)).toBe("Marketing");
    expect((await call("PATCH", "/api/sidebar-sections?section=Marketing", { name: "Growth" })).status).toBe(200);
    expect(sectionOf(outsider.id)).toBe("Growth");
    expect((await call("DELETE", "/api/sidebar-sections?section=Growth")).status).toBe(200);
    expect(app.store.sections).not.toContain("Growth");
    expect((await call("GET", "/api/sidebar-sections")).status).toBe(200);
  });

  it("lets a bot of the project be listed again in its own department", async () => {
    const { writer, call, sectionOf } = await withProject();
    expect((await call("PUT", "/api/sidebar-sections?section=Stand-in%20bride", { addBotIds: [writer.id], removeBotIds: [] })).status).toBe(200);
    expect(sectionOf(writer.id)).toBe("Stand-in bride");
  });
});

describe("the guard on a copy", () => {
  const follows = { errorKey: "serverError.teamProject.copyFollows", errorParams: { bot: "Quill", source: "Quill", team: "Sales desk" } };

  it("refuses, through every route that would, a change to what a copy takes from its source, and says where to make it", async () => {
    const { app, writer, call } = await withProject();
    const before = structuredClone(app.store.bot(writer.id));
    for (const [method, path, body] of [
      ["PATCH", `/api/bots/${writer.id}`, { title: "Head writer" }],
      ["PATCH", `/api/bots/${writer.id}`, { name: "Penn", pinned: true }],
      ["PATCH", `/api/bots/${writer.id}`, { color: "red" }],
      ["PATCH", `/api/bots/${writer.id}`, { modelSelection: { instanceId: "codex", model: "gpt-test" } }],
      ["PATCH", `/api/bots/${writer.id}/profile`, { soul: "Write longer." }],
      ["PATCH", `/api/bots/${writer.id}/profile`, { avatarZoom: 2 }],
      ["PATCH", `/api/bots/${writer.id}/model`, { instanceId: "codex", model: "gpt-test" }],
      ["POST", `/api/bots/${writer.id}/avatar/generate`, { prompt: "A fox" }],
      ["POST", `/api/bots/${writer.id}/soul/apply-file`, { expectedRevision: "r", fileText: "x" }],
      ["POST", `/api/bots/${writer.id}/history/rollback`, { id: "row", expectedRevision: "r" }],
    ] as const) {
      expect(await call(method, path, body), `${method} ${path} ${JSON.stringify(body)}`).toEqual({
        status: 409, body: { error: "Quill follows Quill in Sales desk. Change Quill in Sales desk instead.", ...follows },
      });
    }
    expect(app.store.bot(writer.id)).toEqual(before);
  });

  it("lets through a change that leaves what a copy follows as it is, and any change to a bot that follows nobody", async () => {
    const { app, writer, outsider, call } = await withProject();
    const copy = app.store.bot(writer.id)!;
    expect((await call("PATCH", `/api/bots/${writer.id}`, { name: "Quill", title: copy.title, color: copy.color, pinned: true })).status).toBe(200);
    expect((await call("PATCH", `/api/bots/${writer.id}/profile`, { name: "Quill ", soul: copy.soul, voice: "calm" })).status).toBe(200);
    expect((await call("PATCH", `/api/bots/${writer.id}/model`, copy.modelSelection)).status).toBe(200);
    expect((await call("PATCH", `/api/bots/${outsider.id}`, { title: "Greeter" })).status).toBe(200);

    app.store.patchBot(writer.id, { teamProject: { ...copy.teamProject!, sourceLeft: true } });
    expect((await call("PATCH", `/api/bots/${writer.id}`, { title: "Head writer" })).status).toBe(200);
    expect((await call("POST", `/api/bots/${writer.id}/avatar/generate`, { prompt: "A fox" })).status).toBe(200);
    expect(app.store.bot(writer.id)!.title).toBe("Head writer");
  });

  it("refuses new shared instructions for a project's department while its team is there, and for no other department", async () => {
    const { app, call } = await withProject();
    expect(await call("PUT", "/api/section-context?section=Stand-in%20bride", { text: "Our own." })).toEqual({
      status: 409, body: { error: "Stand-in bride takes its shared instructions from Sales desk. Change them in Sales desk instead.", errorKey: "serverError.teamProject.contextFollows", errorParams: { department: "Stand-in bride", team: "Sales desk" } },
    });
    expect((await call("PUT", "/api/section-context?section=Marketing", { text: "Theirs." })).body).toEqual({ from: "inline routes" });
    expect((await call("GET", "/api/section-context?section=Stand-in%20bride")).body).toEqual({ from: "inline routes" });

    expect(app.store.deleteSection("Sales desk")).toBeUndefined();
    expect((await call("PUT", "/api/section-context?section=Stand-in%20bride", { text: "Our own." })).body).toEqual({ from: "inline routes" });
  });
});
