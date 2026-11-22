// A project's group chat on a real server with the scripted fake engine: made with the project, never made again once
// the person deleted it, made at the next start for a project from before there were any, and joined by a bot that
// joins the project. Nothing here reaches the user's data: the server's home is a temporary folder.
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";

const TEAM = "Harbour crew";
type Room = { id: string; name: string; section?: string; cwd?: string; memberIds: string[]; defaultResponder: unknown };

describe("a project's group chat on the real server", () => {
  let server: RestartableServer;
  let root: string;
  let project: TeamProjectWire;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const rooms = (): Room[] => {
    const stored = JSON.parse(readFileSync(join(server.dataDir, "groups.json"), "utf8")) as Room[] | { groups: Room[] };
    return Array.isArray(stored) ? stored : stored.groups;
  };
  const listed = async () => ((await api("GET", "/api/team-projects")).body.projects as TeamProjectWire[]).find((one) => one.id === project.id)!;
  const restart = async () => {
    await server.stop();
    await server.start();
  };

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-room-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const member = async (name: string) => {
      const made = await api("POST", "/api/bots", { name, section: TEAM });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      return made.body.bot as { id: string };
    };
    const lead = await member("Mo");
    await member("Ink");
    expect((await api("PATCH", `/api/bots/${lead.id}`, { chiefOfStaff: true })).status).toBe(200);
    const made = await api("POST", "/api/team-projects", { name: "Harbour bride", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
  }, hostTimeout(120_000));

  afterAll(async () => {
    await server?.close();
    if (root) await removeTempDir(root);
  });

  it("is made with the project: every bot of it, its lead answering, in its folder", () => {
    const room = rooms().find((one) => one.id === project.roomId);
    expect(room).toMatchObject({ name: "Harbour bride team chat", section: "Harbour bride", cwd: project.folder, defaultResponder: { kind: "member", botId: project.leadBotId } });
    expect([...room!.memberIds].sort()).toEqual([...project.botIds].sort());
  });

  it("takes in a bot that joins the project's department", async () => {
    const joined = await api("POST", "/api/bots", { name: "Cut", section: project.section });
    expect(joined.status, JSON.stringify(joined.body)).toBeLessThan(300);
    await expect.poll(() => rooms().find((one) => one.id === project.roomId)?.memberIds.includes(joined.body.bot.id), { timeout: 15_000 }).toBe(true);
  });

  it("is not made again once the person deleted it, and is made at the next start for a project from before there were any", async () => {
    const first = project.roomId!;
    expect((await api("DELETE", `/api/groups/${first}`)).status).toBe(200);
    await restart();
    expect((await listed()).roomId).toBe(first);
    expect(rooms().filter((one) => one.section === project.section)).toEqual([]);

    await server.stop();
    const file = join(server.dataDir, "projects.json");
    const stored = JSON.parse(readFileSync(file, "utf8")) as { projects: Array<Record<string, unknown>> };
    writeFileSync(file, JSON.stringify({ ...stored, projects: stored.projects.map(({ roomId: _roomId, ...older }) => older) }, null, 2));
    await server.start();
    await expect.poll(async () => (await listed()).roomId, { timeout: 15_000 }).toEqual(expect.any(String));
    const again = await listed();
    expect(again.roomId).not.toBe(first);
    const room = rooms().find((one) => one.id === again.roomId)!;
    expect(room).toMatchObject({ section: project.section, defaultResponder: { kind: "member", botId: project.leadBotId } });
    expect([...room.memberIds].sort()).toEqual([...again.botIds].sort());
  }, hostTimeout(120_000));
});
