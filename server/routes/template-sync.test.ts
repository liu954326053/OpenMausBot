import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { PackageAgent } from "../../shared/package-format.ts";
import type { TeamTemplateContent, TemplateRoleExtras } from "../../shared/template-library.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { TemplateLibraryError } from "../template-library.ts";
import type { ProjectForSync, SavedTemplate, TemplateSyncDeps } from "../template-sync-service.ts";
import { userError } from "../user-errors.ts";
import { createTemplateSyncRoutes } from "./template-sync.ts";
import { dispatchRoutes } from "./table.ts";

function content(agents: PackageAgent[], extras: Record<string, TemplateRoleExtras>): TeamTemplateContent {
  return { id: "t1", name: "都市短剧团队", version: 2, document: { package: { agents } }, extras } as unknown as TeamTemplateContent;
}

const PROJECT: ProjectForSync = {
  id: "p1", name: "我的短剧", section: "剧本部", template: { id: "t1", name: "都市短剧团队", version: 1 },
  bots: [{ id: "bot-writer", name: "编剧", soul: "old", teamProject: { id: "p1", role: "writer" } }],
};
const TEMPLATE = content(
  [{ key: "writer", name: "编剧", appearance: { color: "maus" }, soul: "new" } as unknown as PackageAgent],
  { writer: { librarySkills: [] } },
);

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(opts: { auth?: RequestAuth; throwSaveVersion?: TemplateLibraryError } = {}) {
  const versions: Array<{ projectId: string; version: number }> = [];
  const starter: Array<{ roleKey: string; entry: string }> = [];
  const deps: TemplateSyncDeps = {
    project: (id) => (id === "p1" ? PROJECT : undefined),
    readTemplate: (id) => (id === "t1" ? TEMPLATE : null),
    applyRole: () => {},
    setTemplate: (projectId, template) => { versions.push({ projectId, version: template.version }); return null; },
    saveDepartmentAsVersion: () => { if (opts.throwSaveVersion) throw opts.throwSaveVersion; return { id: "t1", name: "都市短剧团队", version: 3 } satisfies SavedTemplate; },
    saveDepartmentAsNew: () => ({ id: "t2", name: "新模板", version: 1 }),
    addStarterMemory: (_templateId, roleKey, entry) => { starter.push({ roleKey, entry }); return { id: "t1", name: "都市短剧团队", version: 4 }; },
    projectBot: (botId) => (botId === "bot-writer" ? { project: PROJECT, role: "writer" } : null),
    readMemory: (_botId, path) => (path === "memory/notes.md" ? "我学到的东西" : path === "memory/empty.md" ? "   " : null),
  };
  const routes = [createTemplateSyncRoutes(deps)];
  const auth = opts.auth ?? ({ kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { versions, starter, post, base };
}

describe("template sync routes", () => {
  it("shows the update preview and refuses a project that is gone", async () => {
    const { post } = await serve();
    const ok = await post("/api/template-sync/projects/p1/update/preview");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ can: true, diff: { changed: [{ key: "writer", fields: ["persona"] }] } });
    const gone = await post("/api/template-sync/projects/nope/update/preview");
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ errorKey: "serverError.templateSync.noProject" });
  });

  it("applies an update and records the new version", async () => {
    const { versions, post } = await serve();
    const res = await post("/api/template-sync/projects/p1/update");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: 1, toVersion: 2 });
    expect(versions).toEqual([{ projectId: "p1", version: 2 }]);
  });

  it("saves back as a new version, rejects a bad mode, and maps the library's own refusal", async () => {
    const { versions, post } = await serve();
    const res = await post("/api/template-sync/projects/p1/save-back", { mode: "version" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templateId: "t1", name: "都市短剧团队", version: 3, mode: "version" });
    expect(versions).toEqual([{ projectId: "p1", version: 3 }]);
    expect((await post("/api/template-sync/projects/p1/save-back", { mode: "wat" })).status).toBe(400);

    const full = await serve({ throwSaveVersion: new TemplateLibraryError(userError("serverError.templateLibrary.full", { count: 8 }), 409) });
    const refused = await full.post("/api/template-sync/projects/p1/save-back", { mode: "version" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ errorKey: "serverError.templateLibrary.full" });
  });

  it("deposits one memory entry and refuses a bot that is not in a project", async () => {
    const { starter, post } = await serve();
    const ok = await post("/api/template-sync/memory/deposit", { botId: "bot-writer", path: "memory/notes.md" });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: "t1", name: "都市短剧团队", version: 4 });
    expect(starter).toEqual([{ roleKey: "writer", entry: "我学到的东西" }]);
    const bad = await post("/api/template-sync/memory/deposit", { botId: "nobody", path: "memory/notes.md" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ errorKey: "serverError.templateSync.notProjectBot" });
    expect((await post("/api/template-sync/memory/deposit", { botId: "bot-writer" })).status).toBe(400);
  });

  it("answers 403 for a guest and leaves non-template-sync paths to the next handler", async () => {
    const guest = await serve({ auth: { kind: "session", scopes: ["chat"] } as unknown as RequestAuth });
    expect((await guest.post("/api/template-sync/projects/p1/update")).status).toBe(403);
    const owner = await serve();
    expect(await (await owner.post("/api/other")).json()).toEqual({ from: "inline routes" });
    expect((await owner.post("/api/template-sync/projects/p1/update")).status).toBe(200);
  });
});
