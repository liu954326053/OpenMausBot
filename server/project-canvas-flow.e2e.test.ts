// A project's canvas drawing its team's pipeline, on a real server with the scripted fake engine: the lines between the
// project's bots, an open canvas told when the team's pipeline moves one, and a project whose bots follow no team.
// Nothing here reaches the user's data or port 8799.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { botIdOfNode, botNodeId, type CanvasSnapshot, type ProjectCanvasEvent } from "../shared/project-canvas.ts";
import type { ProjectPipelineWire } from "../shared/team-pipeline.ts";
import type { TeamProjectMembership, TeamProjectRecord, TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";
import { openSse, type SseRecorder } from "./testing/sse.ts";

const TEAM = "Flow studio";
const OLD_SHOW = "Old show";
const OLD_PROJECT = "project-old";
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type StoredBot = { id: string; name: string; teamProject?: TeamProjectMembership };

const keep = (name: string, value: unknown) => {
  if (evidenceDir) writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

/** The dispatch lines a canvas draws, as superior → subordinate by the names its bots show. */
const lines = (canvas: CanvasSnapshot) => canvas.connections.filter((one) => one.kind === "dispatch")
  .map((one) => `${canvas.bots[botIdOfNode(one.fromNodeId)!]!.name} → ${canvas.bots[botIdOfNode(one.toNodeId)!]!.name}`).sort();

describe("a project's canvas drawing its team's pipeline", () => {
  let server: RestartableServer;
  let root: string;
  let events: SseRecorder;
  let chief: Bot;
  let writer: Bot;
  let board: Bot;
  let project: TeamProjectWire;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as Bot[];
  const settled = async () => {
    const until = Date.now() + 30_000;
    while ((await bots()).some((one) => one.busy)) {
      if (Date.now() > until) throw new Error("a bot is still at work");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const member = async (name: string, section: string) => {
    const made = await api("POST", "/api/bots", { name, section });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    return made.body.bot as Bot;
  };
  const appoint = async (bot: Bot) => expect((await api("PATCH", `/api/bots/${bot.id}`, { chiefOfStaff: true })).status).toBe(200);
  const canvas = async (projectId: string): Promise<CanvasSnapshot> => {
    const read = await api("GET", `/api/team-projects/${projectId}/canvas`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    return read.body;
  };
  const projectFlow = async (projectId: string) => (await api("GET", `/api/team-pipelines/projects/${projectId}`)).body as ProjectPipelineWire;
  /** The person places every bot but the lead, which shows them before the work reaches them. */
  const place = async (projectId: string) => {
    const shown = await canvas(projectId);
    const others = Object.keys(shown.bots).filter((botId) => botId !== shown.project.leadBotId);
    const ops = others.map((botId, index) => ({ type: "update_node", id: botNodeId(botId), patch: { position: { x: 420 * (index + 1), y: 0 } } }));
    const placed = await api("POST", `/api/team-projects/${projectId}/canvas/ops`, { baseRevision: shown.revision, ops });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
  };
  const line = async (from: Bot, to: Bot, present: boolean) => {
    const drawn = await api("PUT", "/api/team-pipelines/line", { from: from.id, to: to.id, present });
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
  };
  const stored = () => JSON.parse(readFileSync(join(server.dataDir, "bots.json"), "utf8")) as StoredBot[];
  const copyOf = (source: Bot) => stored().find((bot) => bot.teamProject?.id === project.id && bot.teamProject.source === source.id)!.id;
  const toldOf = (projectId: string): ProjectCanvasEvent[] => events.frames.filter((frame) => frame.kind === "project-canvas" && frame.projectId === projectId);
  /** Until no event about the project has come for a while, so the next one is the one a change sends. */
  const quiet = async (projectId: string) => {
    for (let seen = -1; seen !== toldOf(projectId).length;) {
      seen = toldOf(projectId).length;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  };

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-flow-")));
    const director = await member("Director", OLD_SHOW);
    const scribe = await member("Scribe", OLD_SHOW);
    const editor = await member("Editor", OLD_SHOW);
    await appoint(director);
    await settled();
    await server.stop();
    const folder = join(root, OLD_SHOW);
    mkdirSync(folder);
    const old: TeamProjectRecord = { id: OLD_PROJECT, name: OLD_SHOW, folder, section: OLD_SHOW, template: { id: "one-team-template", name: "Short drama crew", version: 1 }, leadBotId: director.id, createdAt: Date.now() };
    writeFileSync(join(server.dataDir, "projects.json"), JSON.stringify({ version: 1, projects: [old] }, null, 2));
    const onDisk = stored();
    for (const [bot, role] of [[director, "director"], [scribe, "writer"], [editor, "editor"]] as const) onDisk.find((one) => one.id === bot.id)!.teamProject = { id: old.id, role };
    writeFileSync(join(server.dataDir, "bots.json"), JSON.stringify(onDisk, null, 2));
    await server.start();

    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    chief = await member("Chief", TEAM);
    writer = await member("Writer", TEAM);
    board = await member("Board", TEAM);
    await appoint(chief);
    const staged = await api("PUT", "/api/team-pipelines/restore", {
      section: TEAM,
      state: { stages: { [writer.id]: ["script"], [board.id]: ["storyboard"] }, judged: {}, manual: [writer.id, board.id], added: [], removed: [] },
    });
    expect(staged.status, JSON.stringify(staged.body)).toBe(200);
    await settled();
    const made = await api("POST", "/api/team-projects", { name: "Flow drama", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
    await settled();
    events = await openSse(`${server.url}/api/events`, { origin: server.url });
    keep("00-fixture.json", { url: server.url, dataDir: server.dataDir, logPath: server.logPath, team: { chief, writer, board }, project, oldProject: old });
  }, hostTimeout(120_000));

  afterAll(async () => {
    events?.close();
    await server?.close();
    if (root) await removeTempDir(root);
  });

  it("shows the lead alone while the work reaches no copy, and once the person placed the copies draws the team's flow between them: the Chief's over the Writer's, the Writer's over the Board's", async () => {
    const before = await canvas(project.id);
    expect([before.nodes.map((one) => one.id), lines(before)]).toEqual([[botNodeId(project.leadBotId)], []]);
    await place(project.id);
    const drawn = await canvas(project.id);
    expect(project.leadBotId).toBe(copyOf(chief));
    expect(lines(drawn)).toEqual(["Chief → Writer", "Writer → Board"]);
    expect(drawn.connections.filter((one) => one.kind === "dispatch").map((one) => [one.fromNodeId, one.toNodeId])).toEqual(expect.arrayContaining([
      [botNodeId(copyOf(chief)), botNodeId(copyOf(writer))], [botNodeId(copyOf(writer)), botNodeId(copyOf(board))],
    ]));
    keep("01-the-team-flow-on-the-canvas.json", { lead: before.nodes, lines: lines(drawn), projectFlow: await projectFlow(project.id), connections: drawn.connections, nodes: drawn.nodes });
  });

  it("tells an open canvas when the Board moves under the Chief in the team, and then draws the Chief's copy over the Board's", async () => {
    await quiet(project.id);
    const before = await canvas(project.id);
    const mark = events.frames.length;
    await line(chief, board, true);
    await line(writer, board, false);
    const told = await events.until((frame) => events.frames.indexOf(frame) >= mark && frame.kind === "project-canvas" && frame.projectId === project.id, 10_000);
    expect(told).toMatchObject({ kind: "project-canvas", projectId: project.id, revision: before.revision, reason: "bots" } satisfies ProjectCanvasEvent);
    const after = await canvas(project.id);
    expect(lines(before)).toEqual(["Chief → Writer", "Writer → Board"]);
    expect(lines(after)).toEqual(["Chief → Board", "Chief → Writer"]);
    expect(after.revision).toBe(before.revision);
    keep("02-board-moved-under-the-chief.json", { before: lines(before), event: told, after: lines(after), projectFlow: await projectFlow(project.id), eventsSinceTheLine: events.frames.slice(mark) });
  });

  it("tells it again when the Writer is archived in the team, and the Board's copy moves up under the Chief's", async () => {
    await line(writer, board, true);
    await line(chief, board, false);
    await expect.poll(async () => lines(await canvas(project.id)), { timeout: 10_000 }).toEqual(["Chief → Writer", "Writer → Board"]);
    await quiet(project.id);
    const mark = events.frames.length;
    const archived = await api("PATCH", `/api/bots/${writer.id}`, { hidden: true });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const told = await events.until((frame) => events.frames.indexOf(frame) >= mark && frame.kind === "project-canvas" && frame.projectId === project.id, 10_000);
    expect(told).toMatchObject({ kind: "project-canvas", projectId: project.id, reason: "bots" });
    await expect.poll(async () => lines(await canvas(project.id)), { timeout: 10_000 }).toEqual(["Chief → Board", "Chief → Writer"]);
    keep("03-writer-archived-in-the-team.json", {
      event: told, after: lines(await canvas(project.id)), projectFlow: await projectFlow(project.id),
      copies: stored().filter((bot) => bot.teamProject?.id === project.id), eventsSinceTheArchive: events.frames.slice(mark),
    });
  });

  it("draws every bot of a project made before projects had a source team under its lead, once the person placed them", async () => {
    await place(OLD_PROJECT);
    const drawn = await canvas(OLD_PROJECT);
    expect(drawn.project).toMatchObject({ id: OLD_PROJECT, name: OLD_SHOW });
    expect(lines(drawn)).toEqual(["Director → Editor", "Director → Scribe"]);
    keep("04-a-project-without-a-source-team.json", { lines: lines(drawn), projectFlow: await projectFlow(OLD_PROJECT), bots: stored().filter((bot) => bot.teamProject?.id === OLD_PROJECT) });
  });
});
