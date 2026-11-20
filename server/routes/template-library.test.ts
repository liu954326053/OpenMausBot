import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BotTemplateWire, TeamTemplateInput, TeamTemplateWire, TemplateRole } from "../../shared/template-library.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type { BotRecord } from "../store.ts";
import { createTemplateLibrary } from "../template-library.ts";
import { dispatchRoutes } from "./table.ts";
import { createTemplateLibraryRoutes } from "./template-library.ts";

const OWNER = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
const BOT_SHELL = { kind: "loopback", scopes: ["admin"], trust: "service" } as unknown as RequestAuth;
const PHONE = { kind: "session", scopes: ["client"] } as unknown as RequestAuth;

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function role(overrides: Partial<TemplateRole> = {}): TemplateRole {
  return { key: "writer", name: "剧本编写", title: "把大纲写成分集剧本", description: "", soul: "", look: { color: "blue" }, ownSkills: [], memory: "", librarySkills: [], ...overrides };
}
const team = (overrides: Partial<TeamTemplateInput> = {}): TeamTemplateInput => ({
  name: "都市短剧创作团队", genre: "都市短剧", context: "", lead: "lead", roles: [role({ key: "lead", name: "总编剧" }), role()], skills: [], ...overrides,
});

async function serve(auth: RequestAuth = OWNER) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-template-routes-"));
  folders.push(dataDir);
  const bots = [{ id: "bot-1", name: "Helper", color: "blue", section: "Ops" }] as BotRecord[];
  const library = createTemplateLibrary({
    root: join(dataDir, "templates"), bots: () => bots, routines: () => [], ownSkillNames: () => [],
    exportDocument: (target) => ({
      keys: Object.fromEntries((target.scope === "bot" ? [target.bot] : target.bots).map((bot) => [bot.id, bot.id])),
      document: {
        format: "openmaus.package", version: 2,
        package: {
          id: "shared", release: "1.0.0", name: "Shared", tagline: "Shared.", summary: "Shared.", category: "Community", author: { name: "Someone" }, license: "Unspecified",
          outcomes: ["Work."], setupMinutes: 2, requirements: { apps: [], capabilities: [] }, team: { name: "Shared" },
          agents: (target.scope === "bot" ? [target.bot] : target.bots).map((bot) => ({ key: bot.id, name: bot.name, appearance: { color: "blue" as const } })),
        },
      },
    }),
  });
  const routes = [createTemplateLibraryRoutes(library)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
    } catch (error) {
      json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/template-library`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { call, library };
}

describe("template library routes", () => {
  it("stay behind the admin gate, the list included", () => {
    expect(requiredScope("GET", "/api/template-library")).toBe("admin");
    expect(requiredScope("POST", "/api/template-library/teams")).toBe("admin");
    expect(requiredScope("DELETE", "/api/template-library/bots/0123456789abcdef")).toBe("admin");
  });

  it("list both kinds", async () => {
    const { call } = await serve();
    expect(await call("GET", "")).toEqual({ status: 200, body: { bots: [], teams: [] } });
    const made = await call("POST", "/teams", team());
    expect(made.status).toBe(201);
    const template = made.body.template as TeamTemplateWire;
    await call("POST", "/bots", { role: role({ key: "picker", name: "选书", title: "挑小说" }), skills: [] });
    const list = await call("GET", "");
    expect(list.body).toMatchObject({
      bots: [{ name: "选书", title: "挑小说", version: 1 }],
      teams: [{ id: template.id, name: "都市短剧创作团队", genre: "都市短剧", version: 1, lead: "lead", roles: [{ key: "lead", name: "总编剧" }, { key: "writer", name: "剧本编写" }] }],
    });
  });

  it("read, update, delete and put back one template", async () => {
    const { call } = await serve();
    const { id } = (await call("POST", "/teams", team())).body.template as TeamTemplateWire;
    expect((await call("GET", `/teams/${id}`)).body).toMatchObject({ template: { id, version: 1, context: "", roles: [{ key: "lead" }, { key: "writer" }] } });
    const updated = await call("PUT", `/teams/${id}`, team({ genre: "古风", lead: "writer" }));
    expect(updated).toMatchObject({ status: 200, body: { template: { id, version: 2, genre: "古风", lead: "writer" } } });

    const removed = await call("DELETE", `/teams/${id}`);
    expect(removed).toMatchObject({ status: 200, body: { ok: true } });
    expect((await call("GET", "")).body).toEqual({ bots: [], teams: [] });
    expect(await call("GET", `/teams/${id}`)).toMatchObject({ status: 404, body: { errorKey: "serverError.templateLibrary.notFound" } });
    expect(await call("POST", "/restore", { undo: removed.body.undo })).toEqual({ status: 200, body: { ok: true, kind: "team", id } });
    expect((await call("GET", `/teams/${id}`)).body).toMatchObject({ template: { version: 2 } });
    expect(await call("POST", "/restore", { undo: removed.body.undo })).toMatchObject({ status: 409, body: { errorKey: "serverError.templateLibrary.undoGone" } });
    expect(await call("POST", "/restore", {})).toMatchObject({ status: 409, body: { errorKey: "serverError.templateLibrary.undoGone" } });
  });

  it("keep the two kinds apart and answer a missing template with 404", async () => {
    const { call } = await serve();
    const { id } = (await call("POST", "/bots", { role: role(), skills: [] })).body.template as BotTemplateWire;
    expect((await call("GET", `/bots/${id}`)).body).toMatchObject({ template: { id, name: "剧本编写", role: { key: "writer" } } });
    expect((await call("GET", `/teams/${id}`)).status).toBe(404);
    expect(await call("PUT", `/teams/${id}`, team())).toMatchObject({ status: 404, body: { errorKey: "serverError.templateLibrary.notFound" } });
    expect(await call("DELETE", `/teams/${id}`)).toMatchObject({ status: 404, body: { errorKey: "serverError.templateLibrary.notFound" } });
    expect(await call("GET", "/teams/..%2F..%2Fbots")).toEqual({ status: 404, body: { from: "inline routes" } });
    expect(await call("GET", "/teams/0123456789ABCDEF")).toEqual({ status: 404, body: { from: "inline routes" } });
    expect(await call("PATCH", `/bots/${id}`, {})).toEqual({ status: 404, body: { from: "inline routes" } });
  });

  it("say why a template was not saved, in words the app can translate", async () => {
    const { call } = await serve();
    await call("POST", "/teams", team());
    expect(await call("POST", "/teams", team())).toMatchObject({ status: 409, body: { errorKey: "serverError.templateLibrary.nameTaken", errorParams: { name: "都市短剧创作团队" }, error: "You already have a template named \"都市短剧创作团队\". Choose another name." } });
    expect(await call("POST", "/teams", team({ name: "" }))).toMatchObject({ status: 400, body: { errorKey: "serverError.templateLibrary.nameRule" } });
    expect(await call("POST", "/teams", "not a template")).toMatchObject({ status: 400, body: { errorKey: "serverError.templateLibrary.invalid" } });
    expect(await call("POST", "/bots", { role: role({ look: { color: "blue", picture: "nonsense" } }), skills: [] })).toMatchObject({ status: 400, body: { errorKey: "serverError.templateLibrary.picture" } });
    const tooBig = await call("POST", "/bots", { role: role({ soul: "x".repeat(7 * 1024 * 1024) }), skills: [] });
    expect(tooBig.status).toBe(413);
    expect((await call("GET", "")).body).toMatchObject({ bots: [], teams: [{ version: 1 }] });
  });

  it("save an existing bot and an existing department as templates", async () => {
    const { call } = await serve();
    expect(await call("POST", "/bots/from-bot", { botId: "bot-1" })).toMatchObject({ status: 201, body: { template: { name: "Helper", version: 1, role: { key: "bot-1", name: "Helper" } } } });
    expect(await call("POST", "/bots/from-bot", { botId: "nobody" })).toMatchObject({ status: 404, body: { errorKey: "serverError.bot.missing" } });
    expect(await call("POST", "/bots/from-bot", {})).toMatchObject({ status: 404, body: { errorKey: "serverError.bot.missing" } });
    expect(await call("POST", "/teams/from-department", { department: "Ops" })).toMatchObject({ status: 201, body: { template: { name: "Ops", version: 1, lead: "bot-1", roles: [{ key: "bot-1", name: "Helper" }] } } });
    expect(await call("POST", "/teams/from-department", { department: "Nowhere" })).toMatchObject({ status: 404, body: { errorKey: "serverError.templateLibrary.noBots" } });
    expect(await call("POST", "/teams/from-department", { department: 7 })).toMatchObject({ status: 404, body: { errorKey: "serverError.templateLibrary.noBots" } });
    expect((await call("GET", "")).body).toMatchObject({ bots: [{ name: "Helper" }], teams: [{ name: "Ops" }] });
  });

  it.each([["a bot's shell on a shared computer", BOT_SHELL], ["a signed-in device that is not an admin", PHONE]])("let %s change and read nothing", async (_who, auth) => {
    const { call, library } = await serve(auth);
    const { id } = library.saveTeam(team());
    const refused = { status: 403, body: { errorKey: "serverError.chat.ownerOrAdmin" } };
    expect(await call("GET", `/teams/${id}`)).toMatchObject(refused);
    expect(await call("POST", "/teams", team({ name: "另一个" }))).toMatchObject(refused);
    expect(await call("PUT", `/teams/${id}`, team({ genre: "改" }))).toMatchObject(refused);
    expect(await call("DELETE", `/teams/${id}`)).toMatchObject(refused);
    expect(await call("POST", "/restore", { undo: `team.${id}.00000000-0000-0000-0000-000000000000` })).toMatchObject(refused);
    expect(await call("POST", "/bots/from-bot", { botId: "bot-1" })).toMatchObject(refused);
    expect(await call("POST", "/teams/from-department", { department: "Ops" })).toMatchObject(refused);
    expect(library.list()).toMatchObject({ bots: [], teams: [{ id, version: 1, genre: "都市短剧" }] });
  });
});
