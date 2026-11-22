// A project's pipeline run on a real server with the scripted fake engine: the project's group chat is made with the
// project, the lead hands the script to the first stage, each stage's end gives the next one its task in the group
// chat, the person is asked before the shots' videos are generated, and the end of the run goes back to the lead there.
// A run the person starts in the group chat works there from the first stage on. Nothing here reaches the user's data,
// JianYing's own folder or port 8799: the server's home is a temporary folder, and a server the desktop app did not
// start writes no draft.
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PipelineRunWire } from "../shared/pipeline-run.ts";
import type { CanvasSnapshot } from "../shared/project-canvas.ts";
import type { TeamProjectMembership, TeamProjectWire } from "../shared/team-projects.ts";
import { serverLine } from "./server-lines.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";

const TEAM = "Relay crew";
const SCRIPT = "EXT. HARBOUR, NIGHT. The bride runs along the water.";
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type StoredBot = { id: string; teamProject?: TeamProjectMembership };
type Line = {
  id: string; role?: string; kind?: string; text?: string; tool?: { name: string; ok?: boolean }; from?: { botId: string };
  roomRequest?: { id: string; phase: string; botIds?: string[] };
};
type Room = { id: string; threadId: string; name: string; section?: string; cwd?: string; memberIds: string[]; defaultResponder: unknown };

const keep = (name: string, value: unknown) => {
  if (evidenceDir) writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

describe("a project's pipeline run", () => {
  let server: RestartableServer;
  let root: string;
  let project: TeamProjectWire;
  const copies: Record<"lead" | "writer" | "designer" | "boarder" | "editor", Bot> = {} as never;

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
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=500`)).body.messages as Line[];
  const canvas = async (): Promise<CanvasSnapshot> => (await api("GET", `/api/team-projects/${project.id}/canvas`)).body;
  const run = async (): Promise<PipelineRunWire | undefined> => (await canvas()).run;
  const statuses = async () => (await run())?.stages.map(({ stage, status }) => `${stage}:${status}`);
  const videos = (action: string) => api("POST", `/api/team-projects/${project.id}/pipeline/videos`, { action });
  const room = (): Room => {
    const stored = JSON.parse(readFileSync(join(server.dataDir, "groups.json"), "utf8")) as Room[] | { groups: Room[] };
    return (Array.isArray(stored) ? stored : stored.groups).find((one) => one.id === project.roomId)!;
  };
  const notesIn = (lines: Line[]) => lines.filter((line) => line.kind === "activity" && line.tool?.name.startsWith("Pipeline:")).map((line) => line.tool!.name);

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-pipeline-run-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const member = async (name: string, title: string) => {
      const made = await api("POST", "/api/bots", { name, section: TEAM });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      expect((await api("PATCH", `/api/bots/${made.body.bot.id}`, { title })).status).toBe(200);
      return made.body.bot as Bot;
    };
    const team = {
      lead: await member("Mo", "Showrunner"),
      writer: await member("Ink", "Screenwriter"),
      designer: await member("Jade", "Character designer"),
      boarder: await member("Frame", "Storyboard artist"),
      editor: await member("Cut", "Editor"),
    };
    expect((await api("PATCH", `/api/bots/${team.lead.id}`, { chiefOfStaff: true })).status).toBe(200);
    await settled();
    const staged = await api("PUT", "/api/team-pipelines/restore", {
      section: TEAM,
      state: {
        stages: { [team.writer.id]: ["script"], [team.designer.id]: ["character"], [team.boarder.id]: ["storyboard"], [team.editor.id]: ["post"] },
        judged: {}, manual: [team.writer.id, team.designer.id, team.boarder.id, team.editor.id], added: [], removed: [],
      },
    });
    expect(staged.status, JSON.stringify(staged.body)).toBe(200);
    const made = await api("POST", "/api/team-projects", { name: "Harbour bride", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
    await settled();
    const stored = JSON.parse(readFileSync(join(server.dataDir, "bots.json"), "utf8")) as StoredBot[];
    const listed = await bots();
    for (const role of Object.keys(team) as Array<keyof typeof team>) {
      const copy = stored.find((bot) => bot.teamProject?.id === project.id && bot.teamProject.source === team[role].id)!;
      copies[role] = listed.find((bot) => bot.id === copy.id)!;
    }
    expect(copies.lead.id).toBe(project.leadBotId);
    writeFileSync(server.planPath, JSON.stringify({
      [copies.lead.id]: { script: [
        { key: "start", match: ["MAKE-THE-DRAMA"], steps: [{ arguments: { bot_ids: [copies.writer.id], message: "WRITE-THE-SCRIPT" } }], reply: "Ink is writing it." },
        { key: "again", match: ["MAKE-IT-AGAIN-IN-THE-ROOM"], steps: [{ arguments: { bot_ids: [copies.writer.id], message: "WRITE-IT-AGAIN" } }], reply: "Ink is writing it again." },
        { key: "any", match: [""], repeat: true, reply: "Noted." },
      ] },
      [copies.writer.id]: { script: [
        { key: "script", match: ["WRITE-THE-SCRIPT"], reply: SCRIPT },
        { key: "script-again", match: ["WRITE-IT-AGAIN"], reply: SCRIPT },
      ] },
      [copies.designer.id]: { script: ["characters", "characters-again"].map((key) => ({ key, match: ["Design the characters it needs"], reply: "The bride and the groom are on the canvas." })) },
      [copies.boarder.id]: { script: ["shots", "shots-again"].map((key) => ({
        key, match: ["Break the script into shots"], reply: "One shot.",
        steps: [{ tool: "canvas_apply_ops", arguments: { ops: [{ type: "add_node", nodeType: "shot", title: "Harbour run", metadata: { prompt: "A bride runs along the harbour at night" } }] } }],
      })) },
      [copies.editor.id]: { script: ["post", "post-again"].map((key) => ({ key, match: ["the work before yours is done"], reply: "The order is right." })) },
    }));
    keep("00-fixture.json", { url: server.url, dataDir: server.dataDir, logPath: server.logPath, project, copies });
  }, hostTimeout(120_000));

  afterAll(async () => {
    await server?.close();
    if (root) await removeTempDir(root);
  });

  it("makes the project's group chat with every bot of the project, its lead answering, in the project's folder", () => {
    expect(project.roomId).toEqual(expect.any(String));
    const made = room();
    expect(made).toMatchObject({ name: "Harbour bride team chat", section: "Harbour bride", cwd: project.folder, defaultResponder: { kind: "member", botId: copies.lead.id } });
    expect([...made.memberIds].sort()).toEqual(Object.values(copies).map((bot) => bot.id).sort());
    keep("00-group-chat.json", made);
  });

  it("goes from the lead's hand-off through every stage in the group chat, asks before the videos, and goes back to the lead there at the end", async () => {
    const sent = await api("POST", `/api/bots/${copies.lead.id}/messages`, { text: "MAKE-THE-DRAMA", threadId: copies.lead.threadId, sendId: crypto.randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);

    await expect.poll(async () => (await run())?.videos.status, { timeout: 90_000, interval: 500 }).toBe("confirm");
    expect(await statuses()).toEqual(["script:done", "character:done", "storyboard:done", "post:waiting"]);
    const drawn = await canvas();
    const script = drawn.nodes.find((node) => node.type === "text" && node.metadata?.role === "script");
    expect(script?.metadata?.content).toBe(SCRIPT);
    expect(drawn.run?.videos).toEqual({ status: "confirm", shots: 1, ready: 0, failed: 0 });
    const task = serverLine("en", "server.pipelineRun.task.character", { project: "Harbour bride", lead: "Mo" });
    const character = (await messages(room().threadId)).find((line) => line.role === "user" && line.text?.includes(task));
    expect(character?.text?.startsWith(`@Jade ${task}`)).toBe(true);
    expect((await messages(copies.designer.threadId)).some((line) => line.role === "user")).toBe(false);
    expect((await messages(room().threadId)).find((line) => line.from?.botId === copies.designer.id && line.text)?.text).toBe("The bride and the groom are on the canvas.");
    keep("01-asked-before-the-videos.json", { run: drawn.run, script, character: character?.text });

    const started = await videos("start");
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    await expect.poll(async () => (await run())?.videos.status, { timeout: 30_000, interval: 500 }).toBe("failed");
    expect((await run())?.videos).toEqual({ status: "failed", shots: 1, ready: 0, failed: 1 });

    const skipped = await videos("skip");
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    await expect.poll(async () => (await run())?.endedAt, { timeout: 60_000, interval: 500 }).toBeTypeOf("number");
    const ended = (await run())!;
    expect(ended.stages.map(({ status }) => status)).toEqual(["done", "done", "done", "done"]);
    expect(ended.videos).toMatchObject({ status: "done", shots: 1, ready: 0 });
    await settled();

    const roomLines = await messages(room().threadId);
    const notes = notesIn(roomLines);
    expect(notes).toEqual(expect.arrayContaining([
      serverLine("en", "server.pipelineRun.note.stageDone", { stage: "script" }),
      "Pipeline: 1 shot is ready to generate. Confirm on the canvas to start.",
      "Pipeline: 1 shot has no video. Retry it on the canvas, or go on without it.",
      "Pipeline: going on without 1 shot that has no video.",
      serverLine("en", "server.pipelineRun.note.stageDone", { stage: "post-production" }),
    ]));
    expect(notesIn(await messages(copies.lead.threadId))).toEqual([]);
    expect(roomLines.some((line) => line.role === "user" && line.text === `@Mo ${serverLine("en", "server.pipelineRun.lead.doneNoDraft", { project: "Harbour bride" })}`)).toBe(true);
    const file = join(server.dataDir, "pipeline-runs", `${project.id}.json`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, projectId: project.id, run: { id: ended.id } });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    keep("02-the-run-ended.json", { run: ended, notes, room: roomLines.map(({ role, kind, text, tool, from }) => ({ role, kind, text, tool, from })) });
  }, hostTimeout(240_000));

  it("runs from the person's line in the group chat: the lead answers and hands the script there, and every stage works there", async () => {
    const first = (await run())!.id;
    const said = await api("POST", `/api/groups/${project.roomId}/messages`, { text: "MAKE-IT-AGAIN-IN-THE-ROOM", sendId: crypto.randomUUID() });
    expect(said.status, JSON.stringify(said.body)).toBeLessThan(300);

    await expect.poll(async () => (await run())?.videos.status, { timeout: 90_000, interval: 500 }).toBe("confirm");
    const again = (await run())!;
    expect(again.id).not.toBe(first);
    expect(again.stages.map(({ status }) => status)).toEqual(["done", "done", "done", "waiting"]);
    expect((await videos("start")).status).toBe(200);
    await expect.poll(async () => (await run())?.videos.status, { timeout: 30_000, interval: 500 }).toBe("failed");
    expect((await videos("skip")).status).toBe(200);
    await expect.poll(async () => (await run())?.endedAt, { timeout: 60_000, interval: 500 }).toBeTypeOf("number");
    await settled();

    const lines = await messages(room().threadId);
    const asked = lines.findLast((line) => line.role === "user" && line.text === "MAKE-IT-AGAIN-IN-THE-ROOM")!;
    const after = lines.slice(lines.indexOf(asked));
    const handed = after.find((line) => line.roomRequest?.phase === "request");
    expect(handed).toMatchObject({ from: { botId: copies.lead.id }, roomRequest: { botIds: [copies.writer.id] } });
    expect(after.find((line) => line.from?.botId === copies.writer.id && line.text === SCRIPT)).toBeTruthy();
    for (const [bot, words] of [[copies.designer, "Design the characters it needs"], [copies.boarder, "Break the script into shots"], [copies.editor, "the work before yours is done"]] as const) {
      expect(after.some((line) => line.role === "user" && line.text?.startsWith(`@${bot.name} `) && line.text.includes(words)), bot.name).toBe(true);
    }
    expect(after.filter((line) => line.role === "user" && line.text?.startsWith("@Mo ")).map((line) => line.text))
      .toEqual([`@Mo ${serverLine("en", "server.pipelineRun.lead.doneNoDraft", { project: "Harbour bride" })}`]);
    for (const bot of [copies.writer, copies.designer, copies.boarder, copies.editor]) {
      expect((await messages(bot.threadId)).filter((line) => line.role === "user").map((line) => line.text), bot.name).toEqual([]);
    }
    keep("03-run-in-the-group-chat.json", after.map(({ role, kind, text, tool, from, roomRequest }) => ({ role, kind, text, tool, from, roomRequest })));
  }, hostTimeout(240_000));

  it("refuses an answer about the videos it is not waiting for, and one it does not know", async () => {
    expect(await videos("retry")).toMatchObject({ status: 409, body: { errorKey: "serverError.pipelineRun.notWaiting" } });
    expect(await videos("later")).toMatchObject({ status: 400, body: { errorKey: "serverError.pipelineRun.actionInvalid" } });
    expect((await api("POST", "/api/team-projects/no-such-project/pipeline/videos", { action: "start" })).status).toBe(404);
  });

  it("made no JianYing folder in the server's home", () => {
    expect(existsSync(join(server.dataDir, "Movies"))).toBe(false);
  });
});
