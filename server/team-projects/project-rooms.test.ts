import { afterEach, describe, expect, it } from "vitest";

import type { GroupRecord } from "../store.ts";
import { inOwnProjectRoom, ProjectRooms } from "./project-rooms.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

async function installation(refused: { now?: string } = {}) {
  app = await teamProjectsInstallation();
  app.projects.start();
  app.salesTeam();
  app.projects.setRoot(app.root);
  const { store } = app;
  const published: GroupRecord[] = [];
  const retries: Array<() => void> = [];
  const logged: string[] = [];
  const rooms = new ProjectRooms({
    registry: app.registry,
    store,
    updateRoom: (groupId, patch) => {
      if (refused.now) throw new Error(refused.now);
      return store.patchGroup(groupId, patch)!;
    },
    published: (group) => published.push(group),
    language: () => undefined,
    later: (retry) => retries.push(retry),
    log: (line) => logged.push(line),
  });
  const service = app.restarted({ registry: app.registry, rooms });
  return { app, store, rooms, service, published, retries, logged };
}

async function made(service: Awaited<ReturnType<typeof installation>>["service"], name = "Stand-in bride") {
  const result = await service.create({ name, team: "Sales desk" });
  if (!("project" in result)) throw new Error(result.error);
  return result.project;
}

describe("a project's group chat", () => {
  it("is a room of a bot's own project when it is in the department that is the bot's project's team", () => {
    const bot = { teamProject: { id: "p1", role: "writer" }, section: "Stand-in bride" };
    expect([
      inOwnProjectRoom(bot, { section: " Stand-in bride " }),
      inOwnProjectRoom(bot, { section: "Sales desk" }),
      inOwnProjectRoom(bot, { section: undefined }),
      inOwnProjectRoom(bot, { section: "Stand-in bride", dm: true }),
      inOwnProjectRoom({ section: "Stand-in bride" }, { section: "Stand-in bride" }),
      inOwnProjectRoom(bot, undefined),
    ]).toEqual([true, false, false, false, false, false]);
  });
  it("is made with the project: every bot of it, its lead answering, in its folder", async () => {
    const { store, service, published, app } = await installation();
    const project = await made(service);
    expect(project.roomId).toEqual(expect.any(String));
    const room = store.group(project.roomId!)!;
    expect(room).toMatchObject({
      name: "Stand-in bride team chat",
      section: project.section,
      cwd: project.folder,
      defaultResponder: { kind: "member", botId: project.leadBotId },
      setupCompletedAt: expect.any(Number),
    });
    expect(room.dm).toBeUndefined();
    expect(room.memberIds[0]).toBe(project.leadBotId);
    expect([...room.memberIds].sort()).toEqual([...project.botIds].sort());
    expect(app.registry.find(project.id)?.roomId).toBe(room.id);
    expect(published.map((group) => group.id)).toEqual([room.id]);
  });

  it("is made once for a project made before there were any", async () => {
    const { app, store, rooms } = await installation();
    const result = await app.projects.create({ name: "Older drama", team: "Sales desk" });
    if (!("project" in result)) throw new Error(result.error);
    expect(result.project.roomId).toBeUndefined();
    const before = store.groups.length;
    rooms.start();
    rooms.start();
    const roomId = app.registry.find(result.project.id)?.roomId;
    expect(store.groups).toHaveLength(before + 1);
    expect(store.group(roomId!)?.memberIds.sort()).toEqual([...result.project.botIds].sort());
  });

  it("is not made again once the person deleted it", async () => {
    const { store, rooms, service, app } = await installation();
    const project = await made(service);
    store.deleteGroup(project.roomId!);
    const before = store.groups.length;
    expect(rooms.ensure(project.id)).toBeUndefined();
    rooms.start();
    expect(store.groups).toHaveLength(before);
    expect(app.registry.find(project.id)?.roomId).toBe(project.roomId);
  });

  it("takes in a bot that joins the project later, and leaves out one the person took out", async () => {
    const { store, rooms, service } = await installation();
    const project = await made(service);
    rooms.start();
    const [lead, member] = [project.leadBotId, project.botIds.find((id) => id !== project.leadBotId)!];
    store.patchGroup(project.roomId!, { memberIds: store.group(project.roomId!)!.memberIds.filter((id) => id !== member) });
    store.patchBotProfile(member, { soul: "Still in the project." });
    expect(store.group(project.roomId!)!.memberIds).not.toContain(member);

    const joiner = store.bots.find((bot) => !bot.teamProject && bot.section === "Sales desk")!;
    store.patchBot(joiner.id, { teamProject: { id: project.id, role: "member-0000aaaa" } });
    expect(store.group(project.roomId!)!.memberIds).toContain(joiner.id);
    expect(store.group(project.roomId!)!.defaultResponder).toEqual({ kind: "member", botId: lead });
  });

  it("takes in a joining bot later when the room cannot change now", async () => {
    const refused = { now: undefined as string | undefined };
    const { store, rooms, service, retries, logged } = await installation(refused);
    const project = await made(service);
    rooms.start();
    const joiner = store.bots.find((bot) => !bot.teamProject && bot.section === "Sales desk")!;
    refused.now = "this channel is working or waiting on you — finish that turn first";
    store.patchBot(joiner.id, { teamProject: { id: project.id, role: "member-0000bbbb" } });
    store.patchBotProfile(joiner.id, { soul: "Changed while the room was busy." });
    expect(store.group(project.roomId!)!.memberIds).not.toContain(joiner.id);
    expect(logged.filter((line) => line.includes("did not join its group chat yet"))).toHaveLength(1);
    expect(retries).toHaveLength(1);
    refused.now = undefined;
    retries[0]!();
    expect(store.group(project.roomId!)!.memberIds).toContain(joiner.id);
  });
});
