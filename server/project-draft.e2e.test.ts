// A project's timeline and JianYing draft on a real server with the scripted fake engine, as the server stands before
// a canvas is connected to them: the routes answer, a server the desktop app did not start writes no draft and opens
// no JianYing, and a bot that is not at the post stage has no timeline tool. Nothing here reaches the user's data,
// JianYing's own folder or port 8799: the server's home is a temporary folder.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";

const TEAM = "Draft crew";

type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type Line = { role?: string; text?: string };
type Turn = { botId: string; planKey?: string; evidence: any[] };

describe("a project's timeline and draft", () => {
  let server: RestartableServer;
  let root: string;
  let project: TeamProjectWire;
  let editor: Bot;

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
  const at = (part: string) => `/api/team-projects/${project.id}/${part}`;

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-draft-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const member = async (name: string, title: string) => {
      const made = await api("POST", "/api/bots", { name, section: TEAM });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      expect((await api("PATCH", `/api/bots/${made.body.bot.id}`, { title })).status).toBe(200);
      return made.body.bot as Bot;
    };
    const director = await member("Director", "Runs the production");
    await member("Editor", "Cuts the film");
    expect((await api("PATCH", `/api/bots/${director.id}`, { chiefOfStaff: true })).status).toBe(200);
    await settled();
    const made = await api("POST", "/api/team-projects", { name: "Draft drama", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
    editor = (await bots()).find((one) => project.botIds.includes(one.id) && one.id !== project.leadBotId)!;
    expect(editor).toBeTruthy();
    await settled();
  }, hostTimeout(90_000));

  afterAll(async () => {
    await server?.close();
    if (root) await removeTempDir(root);
  });

  it("reads a project's timeline, empty while no canvas gives it shots, and refuses an order naming a shot it has not", async () => {
    expect(await api("GET", at("timeline"))).toEqual({ status: 200, body: { projectId: project.id, clips: [], missingShots: [] } });
    expect(await api("PUT", at("timeline"), { shotIds: ["shot-1"] })).toEqual({
      status: 422, body: { error: "shot-1 isn't a shot of this project.", errorKey: "serverError.projectDraft.unknownShot", errorParams: { shot: "shot-1" } },
    });
    expect((await api("GET", "/api/team-projects/no-such-project/timeline")).status).toBe(404);
  });

  it("opens no JianYing from a server the desktop app did not start, and says the draft is elsewhere", async () => {
    expect(await api("POST", at("draft/open"))).toMatchObject({ status: 409, body: { errorKey: "serverError.projectDraft.remote" } });
  });

  it("takes no file from outside the project folder, and no file that is not a video, as the finished film", async () => {
    writeFileSync(join(root, "outside.mp4"), "outside");
    writeFileSync(join(project.folder, "notes.mp4"), "the shooting notes");
    expect(await api("POST", at("final"), { path: "../outside.mp4" })).toMatchObject({ status: 400, body: { errorKey: "serverError.projectCanvas.outsideFolder" } });
    expect(await api("POST", at("final"), { path: join(root, "outside.mp4") })).toMatchObject({ status: 400, body: { errorKey: "serverError.projectCanvas.outsideFolder" } });
    expect(await api("POST", at("final"), { path: "notes.mp4" })).toMatchObject({ status: 422, body: { errorKey: "serverError.projectDraft.notVideo" } });
  });

  it("gives a bot that is not at the post stage no timeline tool", async () => {
    writeFileSync(server.planPath, JSON.stringify({ [editor.id]: { script: [{ key: "timeline", match: ["READ-TIMELINE"], reply: "TRIED", steps: [
      { tool: "timeline_get_state", arguments: {}, expectError: true },
      { tool: "timeline_set_order", arguments: { shot_ids: [] }, expectError: true },
    ] }] } }));
    const sent = await api("POST", `/api/bots/${editor.id}/messages`, { text: "READ-TIMELINE", threadId: editor.threadId, sendId: crypto.randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    await expect.poll(async () => ((await api("GET", `/api/threads/${editor.threadId}/messages`)).body.messages as Line[]).some((line) => line.text === "TRIED"), { timeout: 30_000 }).toBe(true);
    await settled();
    const turns: Turn[] = readFileSync(`${server.planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const turn = turns.find((one) => one.botId === editor.id && one.planKey === "timeline")!;
    const answers = turn.evidence.filter((item) => item.step).map((item) => item.response as { result?: { isError?: boolean }; error?: unknown });
    expect(answers).toHaveLength(2);
    for (const answer of answers) expect(Boolean(answer.error || answer.result?.isError)).toBe(true);
  }, hostTimeout(60_000));

  it("made no JianYing folder in the server's home and kept no timeline in the project folder", () => {
    expect(existsSync(join(server.dataDir, "Movies"))).toBe(false);
    expect(existsSync(join(project.folder, "project-timelines"))).toBe(false);
  });
});
