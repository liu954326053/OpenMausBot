import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { userErrorFields } from "../user-errors.ts";
import { createProjectDraftRoutes } from "./routes.ts";
import { draftsHarness, fakeMp4 } from "./testing.ts";

const OWNER = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
const ADMIN_AWAY = { kind: "session", scopes: ["admin", "client"] } as unknown as RequestAuth;
const GUEST = { kind: "session", scopes: ["client"] } as unknown as RequestAuth;
const BOT_SHELL = { kind: "loopback", scopes: ["client"], trust: "service" } as unknown as RequestAuth;

const servers: Server[] = [];
const made: Array<{ cleanup(): void }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const one of made.splice(0)) one.cleanup();
});

async function serve(auth: RequestAuth = OWNER) {
  const harness = draftsHarness();
  made.push(harness);
  const routes = [createProjectDraftRoutes(harness.drafts)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "the routes behind" });
    } catch (error) {
      json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message, ...userErrorFields(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { ...harness, call };
}

describe("the draft's routes", () => {
  it("read a project's timeline and set its order", async () => {
    const { call, canvas, shot } = await serve();
    canvas.set("p1", [shot("s1"), shot("s2"), shot("s3", null)]);
    const read = await call("GET", "/api/team-projects/p1/timeline");
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ projectId: "p1", missingShots: ["s3"] });
    expect(read.body.clips.map((clip: { shotId: string }) => clip.shotId)).toEqual(["s1", "s2"]);
    const set = await call("PUT", "/api/team-projects/p1/timeline", { shotIds: ["s2", "s1"] });
    expect(set.status).toBe(200);
    expect(set.body.clips.map((clip: { shotId: string }) => clip.shotId)).toEqual(["s2", "s1"]);
    expect(set.body.leftOut).toEqual(["s3"]);
    expect((await call("GET", "/api/team-projects/p1/timeline")).body.clips.map((clip: { shotId: string }) => clip.shotId)).toEqual(["s2", "s1"]);
  });

  it("answer a refusal with its status and the words a client can translate", async () => {
    const { call, canvas, shot } = await serve();
    canvas.set("p1", [shot("s1")]);
    expect(await call("PUT", "/api/team-projects/p1/timeline", { shotIds: ["nope"] })).toEqual({
      status: 422, body: { error: "nope isn't a shot of this project.", errorKey: "serverError.projectDraft.unknownShot", errorParams: { shot: "nope" } },
    });
    expect(await call("GET", "/api/team-projects/gone/timeline")).toMatchObject({ status: 404, body: { errorKey: "serverError.teamProject.notFound" } });
  });

  it("open JianYing for the person at this computer", async () => {
    const { call, state } = await serve();
    expect(await call("POST", "/api/team-projects/p1/draft/open")).toEqual({ status: 200, body: { opened: "app" } });
    expect(state.launched).toHaveLength(1);
  });

  it("do not open JianYing for an admin at another computer", async () => {
    const { call, state } = await serve(ADMIN_AWAY);
    expect(await call("POST", "/api/team-projects/p1/draft/open")).toMatchObject({ status: 409, body: { errorKey: "serverError.projectDraft.remote" } });
    expect(state.launched).toEqual([]);
  });

  it("make a file the person names the finished film, and refuse one outside the project folder", async () => {
    const { call, canvas, folder, base } = await serve();
    writeFileSync(join(folder, "产出", "成片.mp4"), fakeMp4());
    writeFileSync(join(base, "outside.mp4"), fakeMp4());
    expect(await call("POST", "/api/team-projects/p1/final", { path: "产出/成片.mp4" })).toEqual({ status: 201, body: { nodeId: "final-1" } });
    expect(await call("POST", "/api/team-projects/p1/final", { path: "../outside.mp4" })).toMatchObject({ status: 400, body: { errorKey: "serverError.projectCanvas.outsideFolder" } });
    expect(canvas.finals).toHaveLength(1);
  });

  it("are the owner's and admins' alone", async () => {
    for (const auth of [GUEST, BOT_SHELL]) {
      const { call, state, canvas, shot } = await serve(auth);
      canvas.set("p1", [shot("s1")]);
      for (const [method, path, body] of [
        ["GET", "/api/team-projects/p1/timeline"], ["PUT", "/api/team-projects/p1/timeline", { shotIds: [] }],
        ["POST", "/api/team-projects/p1/draft/open"], ["POST", "/api/team-projects/p1/final", { path: "产出/视频/s1.mp4" }],
      ] as const) {
        expect(await call(method, path, body), `${method} ${path}`).toMatchObject({ status: 403, body: { errorKey: "serverError.chat.ownerOrAdmin" } });
      }
      expect(state.launched).toEqual([]);
      expect(canvas.finals).toEqual([]);
    }
  });

  it("answer 405 for a method a path does not take, and pass every other path on", async () => {
    const { call } = await serve();
    expect((await call("DELETE", "/api/team-projects/p1/timeline")).status).toBe(405);
    expect((await call("GET", "/api/team-projects/p1/draft/open")).status).toBe(405);
    expect((await call("GET", "/api/team-projects/p1/final")).status).toBe(405);
    expect(await call("GET", "/api/team-projects/p1/canvas")).toEqual({ status: 404, body: { from: "the routes behind" } });
    expect(await call("GET", "/api/team-projects/p1/timeline/more")).toEqual({ status: 404, body: { from: "the routes behind" } });
  });
});
