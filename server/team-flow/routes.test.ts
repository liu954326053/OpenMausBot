import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { TeamPipelinesWire } from "../../shared/team-pipeline.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { userError } from "../user-errors.ts";
import { createTeamFlowRoutes, type TeamFlowRouteHost } from "./routes.ts";

const OWNER = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
const BOT_SHELL = { kind: "loopback", scopes: ["admin"], trust: "service" } as unknown as RequestAuth;
const PHONE = { kind: "session", scopes: ["client"] } as unknown as RequestAuth;

const PIPELINES: TeamPipelinesWire = {
  readable: true,
  teams: [{ section: "Studio", chiefId: "chief", stages: { chief: ["lead"], w: ["script"] }, pending: [], manual: [], lines: [{ from: "chief", to: "w" }] }],
};
const UNDO = { section: "Studio", state: { stages: { w: ["script"] } } };

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

function fakeHost(): TeamFlowRouteHost & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    pipelines: () => PIPELINES,
    projectPipeline: (projectId) => ({ projectId, leadId: null, stages: {}, lines: [] }),
    setLine: (input) => {
      asked.push(input);
      return input.from === "loop" ? { ok: false, status: 409, error: userError("serverError.teamFlow.loop", { from: "A", to: "B" }) } : { ok: true, pipelines: PIPELINES };
    },
    rejudge: (section) => {
      asked.push(section);
      return section === "Studio" ? { ok: true, pipelines: PIPELINES, undo: UNDO } : { ok: false, status: 404, error: userError("serverError.teamFlow.noTeam") };
    },
    restore: (input) => {
      asked.push(input);
      return input.state === "strange" ? null : { ok: true, pipelines: PIPELINES };
    },
    flowsWire: () => ({ readable: true, teams: [{ section: "Studio", chiefId: "chief", parents: { w: "chief" }, placed: [] }] }),
    projectFlowWire: (projectId) => ({ projectId, leadId: null, parents: {} }),
    setSuperior: (input) => {
      asked.push(input);
      return { ok: true, flows: { readable: true, teams: [] } };
    },
  };
}

async function serve(host: TeamFlowRouteHost, auth: RequestAuth = OWNER) {
  const routes = [createTeamFlowRoutes(host)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "the routes behind" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
}

describe("the team pipeline routes", () => {
  it("reads every team's pipeline and a project's", async () => {
    const call = await serve(fakeHost());
    expect(await call("GET", "/api/team-pipelines")).toEqual({ status: 200, body: PIPELINES });
    expect(await call("GET", "/api/team-pipelines/projects/project-1")).toEqual({ status: 200, body: { projectId: "project-1", leadId: null, stages: {}, lines: [] } });
  });

  it("draws or takes away a line, and answers a refusal with its reason", async () => {
    const host = fakeHost();
    const call = await serve(host);
    expect(await call("PUT", "/api/team-pipelines/line", { from: "a", to: "b", present: true })).toEqual({ status: 200, body: PIPELINES });
    expect(await call("PUT", "/api/team-pipelines/line", { from: "loop", to: "b", present: false, extra: 1 })).toMatchObject({ status: 409, body: { errorKey: "serverError.teamFlow.loop" } });
    expect(host.asked).toEqual([{ from: "a", to: "b", present: true }, { from: "loop", to: "b", present: false }]);
  });

  it.each([
    [{ from: "a", to: "b" }],
    [{ from: "a", present: true }],
    [{ from: "", to: "b", present: true }],
    [{ from: "a", to: 7, present: true }],
    [{ from: "a", to: "b", present: "yes" }],
    [["a", "b", true]],
  ])("asks nothing for a line sent as %j", async (body) => {
    const host = fakeHost();
    const call = await serve(host);
    expect((await call("PUT", "/api/team-pipelines/line", body)).status).toBe(422);
    expect(host.asked).toEqual([]);
  });

  it("judges a team again and answers the undo, which restore takes back whole", async () => {
    const host = fakeHost();
    const call = await serve(host);
    expect(await call("POST", "/api/team-pipelines/rejudge", { section: "Studio" })).toEqual({ status: 200, body: { pipelines: PIPELINES, undo: UNDO } });
    expect(await call("POST", "/api/team-pipelines/rejudge", { section: "Nowhere" })).toMatchObject({ status: 404, body: { errorKey: "serverError.teamFlow.noTeam" } });
    expect((await call("POST", "/api/team-pipelines/rejudge", { team: "Studio" })).status).toBe(422);
    expect(await call("PUT", "/api/team-pipelines/restore", UNDO)).toEqual({ status: 200, body: PIPELINES });
    expect((await call("PUT", "/api/team-pipelines/restore", { section: "Studio", state: "strange" })).status).toBe(422);
    expect((await call("PUT", "/api/team-pipelines/restore", { state: UNDO.state })).status).toBe(422);
    expect(host.asked).toEqual(["Studio", "Nowhere", UNDO, { section: "Studio", state: "strange" }]);
  });

  it("keeps answering the tree routes", async () => {
    const host = fakeHost();
    const call = await serve(host);
    expect((await call("GET", "/api/team-flows")).body).toMatchObject({ teams: [{ parents: { w: "chief" } }] });
    expect(await call("GET", "/api/team-flows/projects/project-1")).toEqual({ status: 200, body: { projectId: "project-1", leadId: null, parents: {} } });
    expect((await call("PUT", "/api/team-flows/line", { botId: "w", superiorId: null })).status).toBe(200);
    expect((await call("PUT", "/api/team-flows/line", { botId: "w" })).status).toBe(422);
    expect(host.asked).toEqual([{ botId: "w", superiorId: null }]);
  });

  it.each([
    ["a bot's shell", BOT_SHELL],
    ["a session without the admin scope", PHONE],
  ])("is closed to %s, for reading and for changing", async (_who, auth) => {
    const host = fakeHost();
    const call = await serve(host, auth);
    for (const [method, path, body] of [
      ["GET", "/api/team-pipelines"], ["GET", "/api/team-pipelines/projects/project-1"],
      ["PUT", "/api/team-pipelines/line", { from: "a", to: "b", present: true }],
      ["POST", "/api/team-pipelines/rejudge", { section: "Studio" }], ["PUT", "/api/team-pipelines/restore", UNDO],
      ["GET", "/api/team-flows"], ["PUT", "/api/team-flows/line", { botId: "w", superiorId: null }],
    ] as const) {
      expect(await call(method, path, body), `${method} ${path}`).toMatchObject({ status: 403, body: { errorKey: "serverError.chat.ownerOrAdmin" } });
    }
    expect(host.asked).toEqual([]);
  });

  it("leaves every other path, and a method it has no route for, to the routes behind it", async () => {
    const call = await serve(fakeHost());
    expect(await call("GET", "/api/teams")).toEqual({ status: 404, body: { from: "the routes behind" } });
    expect(await call("DELETE", "/api/team-pipelines/line")).toEqual({ status: 404, body: { from: "the routes behind" } });
    expect(await call("GET", "/api/team-pipelines/projects/a/b")).toEqual({ status: 404, body: { from: "the routes behind" } });
  });
});
