// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasSnapshot } from "../../../shared/project-canvas";
import type { ServerFrame } from "../../../shared/wire";
import { ApiError } from "../../state/api";
import type { AppState, Bot, Group } from "../../state/store";
import { setTeamProjects } from "../../state/team-projects";
import { t } from "../i18n";
import { publishLiveFrame, publishMissedFrames } from "../live-events";
import { CanvasBackendError, canvasErrorText } from "./backend";
import { createServerCanvasBackend } from "./server-backend";

type Answer = { status?: number; body?: unknown };
type Sent = { path: string; method: string; headers: Headers; body: unknown };

let answers: Answer[];
let sent: Sent[];

beforeEach(() => {
  answers = [];
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit = {}) => {
    sent.push({ path, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body });
    const answer = answers.shift() ?? {};
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const bot = (fields: Partial<Bot> & Pick<Bot, "id">): Bot => ({ name: fields.id, threadId: `${fields.id}-open`, color: "blue", tasks: [], ...fields }) as Bot;

function storeWith(bots: Bot[], groups: Group[] = []) {
  const dispatch = vi.fn();
  const state = { bots, groups, activeView: "chat", selectedId: null } as unknown as AppState;
  return { dispatch, store: { dispatch, state: () => state } };
}

const backendWith = (bots: Bot[] = [], groups: Group[] = []) => {
  const { dispatch, store } = storeWith(bots, groups);
  return { dispatch, backend: createServerCanvasBackend(store) };
};

const frame = (value: Record<string, unknown>) => value as unknown as ServerFrame;

describe("the project canvas on the app's server", () => {
  it("reads the snapshot and sends operations with their base revision through the app's API client", async () => {
    const { backend } = backendWith();
    answers.push({ body: { revision: 4, nodes: [] } }, { body: { revision: 5, nodeIds: ["n1"], connectionIds: [] } });
    expect(await backend.readSnapshot("p 1")).toEqual({ revision: 4, nodes: [] } as unknown as CanvasSnapshot);
    const ops = [{ type: "add_node" as const, id: "n1", nodeType: "text" as const }];
    expect(await backend.applyOps("p 1", { baseRevision: 4, ops })).toEqual({ revision: 5, nodeIds: ["n1"], connectionIds: [] });
    expect(sent.map(({ path, method }) => `${method} ${path}`)).toEqual(["GET /api/team-projects/p%201/canvas", "POST /api/team-projects/p%201/canvas/ops"]);
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ baseRevision: 4, ops });
  });

  it("turns a 409 conflict, stale canvas or archived project into a CanvasBackendError, and leaves other refusals to the app", async () => {
    const { backend } = backendWith();
    const conflict = { code: "canvas_conflict", error: "Someone changed it.", errorKey: "serverError.projectCanvas.conflict", revision: 9, changed: { nodes: ["n1"], connections: [] } };
    const archived = { code: "canvas_read_only", error: "Archived.", errorKey: "serverError.projectCanvas.archived", reason: "archived" };
    answers.push({ status: 409, body: conflict }, { status: 409, body: archived }, { status: 404, body: { error: "no node n2 on this canvas", code: "not_found" } });
    const ops = { ops: [{ type: "delete_node" as const, id: "n1" }] };
    const refused = await backend.applyOps("p1", ops).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CanvasBackendError);
    expect(refused).toMatchObject({ body: conflict, message: "Someone changed this part of the canvas after you last saw it, so your change wasn't made. Look at it again and redo your change." });
    await expect(backend.applyOps("p1", ops)).rejects.toMatchObject({ name: "CanvasBackendError", body: { code: "canvas_read_only", reason: "archived" } });
    const missing = await backend.applyOps("p1", ops).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).not.toBeInstanceOf(CanvasBackendError);
    expect(missing).toMatchObject({ status: 404, message: "no node n2 on this canvas" });
  });

  it("uploads a file's bytes with its type and place, and loads files by their path in the project", async () => {
    const { backend } = backendWith();
    answers.push({ status: 201, body: { revision: 2, nodeId: "n9", file: { path: "素材/board.png", mime: "image/png", bytes: 3, name: "board.png" } } });
    const file = new File(["png"], "board.png", { type: "image/png" });
    expect(await backend.uploadFile("p1", file, { x: 40.4, y: -12.6 })).toMatchObject({ nodeId: "n9", file: { path: "素材/board.png" } });
    expect(sent[0]).toMatchObject({ method: "POST", path: "/api/team-projects/p1/canvas/files?name=board.png&x=40&y=-13", body: file });
    expect(sent[0]!.headers.get("content-type")).toBe("image/png");
    answers.push({ status: 201, body: {} });
    await backend.uploadFile("p1", new File(["?"], "notes"));
    expect(sent[1]!.path).toBe("/api/team-projects/p1/canvas/files?name=notes");
    expect(sent[1]!.headers.get("content-type")).toBe("application/octet-stream");
    expect(backend.fileUrl("p1", { path: "素材/a b.png", mime: "image/png", bytes: 1, name: "a b.png" })).toBe("/api/team-projects/p1/canvas/files?path=%E7%B4%A0%E6%9D%90%2Fa+b.png");
  });

  it("sends a task with the text node its reply goes into and the language that names its references", async () => {
    const { backend } = backendWith();
    answers.push({ status: 202, body: { threadId: "t1", messageId: "m1", references: 2 } });
    const task = { botId: "writer", text: "Write the opening", threadId: "t1", targetNodeId: "n1", language: "pt-br" };
    expect(await backend.sendTask("p1", task)).toEqual({ threadId: "t1", messageId: "m1", references: 2 });
    expect(sent[0]).toMatchObject({ method: "POST", path: "/api/team-projects/p1/canvas/tasks" });
    expect(JSON.parse(String(sent[0]!.body))).toEqual(task);
  });

  it("hears its project's canvas events on the app's live stream, and the events the app missed", () => {
    const { backend } = backendWith();
    const onChange = vi.fn();
    const stop = backend.subscribe("p1", onChange);
    publishLiveFrame(frame({ kind: "project-canvas", projectId: "p1", revision: 3, reason: "document" }));
    publishLiveFrame(frame({ kind: "project-canvas", projectId: "p1", revision: 3, reason: "bots" }));
    publishLiveFrame(frame({ kind: "project-canvas", projectId: "p2", revision: 8, reason: "document" }));
    publishLiveFrame(frame({ kind: "message", threadId: "t1" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    publishMissedFrames();
    expect(onChange).toHaveBeenCalledTimes(3);
    stop();
    publishLiveFrame(frame({ kind: "project-canvas", projectId: "p1", revision: 4, reason: "document" }));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("reads and saves generation settings and lists models on generation's routes, resolving their refusals", async () => {
    const { backend } = backendWith();
    const wire = { settings: { image: { server: "studio" } }, servers: ["studio"] };
    const noServer = { code: "no_server", error: "Choose an MCP server first.", errorKey: "serverError.generation.noServer" };
    answers.push({ body: wire }, { body: wire }, { status: 422, body: noServer }, { body: { models: [{ id: "m1" }] } }, { status: 500, body: { error: "broken" } });
    expect(await backend.readGenerationSettings("p1")).toEqual(wire);
    const settings = wire.settings as never;
    expect(await backend.saveGenerationSettings("p1", settings)).toEqual(wire);
    expect(await backend.listModels("p1", "video")).toEqual({ refused: noServer });
    expect(await backend.listModels("p1", "image", { server: "local comfy" })).toEqual({ models: [{ id: "m1" }] });
    await expect(backend.listModels("p1", "image")).rejects.toBeInstanceOf(ApiError);
    expect(sent.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "GET /api/team-projects/p1/generation/settings",
      "PUT /api/team-projects/p1/generation/settings",
      "GET /api/team-projects/p1/generation/models?kind=video",
      "GET /api/team-projects/p1/generation/models?kind=image&server=local+comfy",
      "GET /api/team-projects/p1/generation/models?kind=image",
    ]);
    expect(JSON.parse(String(sent[1]!.body))).toEqual(settings);
  });

  it("generates a node on the canvas's route and stops its job on generation's, resolving generation's refusals", async () => {
    const { backend } = backendWith();
    const unusable = { code: "server_unusable", error: "The MCP server gen can't be used.", errorKey: "serverError.generation.serverUnusable", errorParams: { server: "gen" } };
    const archived = { code: "canvas_read_only", error: "Archived.", errorKey: "serverError.projectCanvas.archived", reason: "archived" };
    answers.push(
      { status: 202, body: { jobId: "job-1" } },
      { status: 503, body: unusable },
      { status: 409, body: archived },
      { status: 409, body: { error: "shot-1 is being generated already" } },
      { body: { job: { id: "job 1", status: "cancelled" } } },
      { status: 404, body: { error: "That job is gone.", code: "job_gone" } },
    );
    const request = { nodeId: "shot-1", language: "zh" };
    expect(await backend.startGeneration("p1", request)).toEqual({ jobId: "job-1" });
    expect(await backend.startGeneration("p1", request)).toEqual({ refused: unusable });
    await expect(backend.startGeneration("p1", request)).rejects.toMatchObject({ name: "CanvasBackendError", body: { reason: "archived" } });
    await expect(backend.startGeneration("p1", request)).rejects.toMatchObject({ status: 409, message: "shot-1 is being generated already" });
    await backend.cancelGeneration("p1", "job 1");
    await expect(backend.cancelGeneration("p1", "job 1")).rejects.toMatchObject({ status: 404 });
    expect(sent.map(({ path, method }) => `${method} ${path}`)).toEqual([
      ...Array<string>(4).fill("POST /api/team-projects/p1/canvas/generate"),
      "POST /api/team-projects/p1/generation/jobs/job%201/cancel",
      "POST /api/team-projects/p1/generation/jobs/job%201/cancel",
    ]);
    expect(JSON.parse(String(sent[0]!.body))).toEqual({ nodeId: "shot-1", language: "zh" });
  });

  it("selects a take, has what stopped go on, reads an episode's timeline, opens the draft and names the finished film on the production's routes, and leaves a refusal to the caller", async () => {
    const { backend } = backendWith();
    const archived = { code: "canvas_read_only", error: "Archived.", errorKey: "serverError.projectCanvas.archived", reason: "archived" };
    const production = { jobs: [], ready: true, episodes: [], tasks: [] };
    const timeline = { projectId: "p 1", episode: 3, clips: [], missingShots: ["s1"] };
    answers.push(
      { body: { revision: 9 } }, { status: 409, body: archived }, { body: production }, { status: 409, body: { error: "Nothing stopped there." } },
      { body: timeline }, { body: { projectId: "p 1", clips: [], missingShots: [] } }, { body: { opened: "app" } }, { body: { revision: 10 } }, { status: 400, body: { error: "That file is not a video." } },
    );
    expect(await backend.selectTake("p 1", "take-2")).toEqual({ revision: 9 });
    await expect(backend.selectTake("p 1", "take-2")).rejects.toMatchObject({ name: "CanvasBackendError", body: { reason: "archived" } });
    expect(await backend.retryProduction("p 1", { episode: 3 })).toEqual(production);
    await expect(backend.retryProduction("p 1", { job: "script" })).rejects.toMatchObject({ status: 409, message: "Nothing stopped there." });
    expect(await backend.readTimeline("p 1", 3)).toEqual(timeline);
    await backend.readTimeline("p 1");
    expect(await backend.openDraft("p 1")).toEqual({ opened: "app" });
    await backend.setFinalFilm("p 1", { path: "产出/film.mp4" });
    await expect(backend.setFinalFilm("p 1", { path: "产出/notes.txt" })).rejects.toThrow("That file is not a video.");
    expect(sent.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "POST /api/team-projects/p%201/canvas/select-take",
      "POST /api/team-projects/p%201/canvas/select-take",
      "POST /api/team-projects/p%201/production/retry",
      "POST /api/team-projects/p%201/production/retry",
      "GET /api/team-projects/p%201/timeline?episode=3",
      "GET /api/team-projects/p%201/timeline",
      "POST /api/team-projects/p%201/draft/open",
      "POST /api/team-projects/p%201/final",
      "POST /api/team-projects/p%201/final",
    ]);
    expect([0, 2, 3, 7].map((index) => JSON.parse(String(sent[index]!.body)))).toEqual([{ nodeId: "take-2" }, { episode: 3 }, { job: "script" }, { path: "产出/film.mp4" }]);
  });

  it("knows where a picked file is only in the desktop app on its own computer", () => {
    const file = new File(["x"], "film.mp4");
    expect(backendWith().backend.localPathOf).toBeUndefined();
    vi.stubGlobal("ogb", { getPathForFile: (picked: File) => `/dramas/${picked.name}` });
    expect(backendWith().backend.localPathOf!(file)).toBe("/dramas/film.mp4");
    vi.stubGlobal("ogb", { getPathForFile: () => "/elsewhere", remoteClient: { active: true } });
    expect(backendWith().backend.localPathOf).toBeUndefined();
  });

  it("names why a call failed in the person's words when its body gives a serverError key, else by its message", () => {
    const named = new ApiError("That bot is gone.", 404, { error: "That bot is gone.", errorKey: "serverError.projectCanvas.notMember" });
    const folder = new ApiError("No folder.", 409, { errorKey: "serverError.projectCanvas.folderMissing", errorParams: { folder: "/tmp/drama" } });
    expect(canvasErrorText(named)).toBe(t("serverError.projectCanvas.notMember"));
    expect(canvasErrorText(folder)).toBe(t("serverError.projectCanvas.folderMissing", { folder: "/tmp/drama" }));
    expect(canvasErrorText(new ApiError("Held.", 409, { errorKey: "approval.held.outbound" }))).toBe("Held.");
    expect(canvasErrorText(new ApiError("No folder.", 409, { errorKey: "serverError.projectCanvas.folderMissing" }))).toBe("No folder.");
    expect(canvasErrorText(new Error("Disk full"))).toBe("Disk full");
  });

  it("draws each bot as the app's store has it, unread as its row shows it", async () => {
    const { backend } = backendWith([
      bot({ id: "lead", color: "purple", avatarUrl: "/api/bots/lead/avatar", avatarZoom: 1.5, avatarFocusX: 0.2, avatarFocusY: 0.8, mascotBody: null }),
      bot({ id: "writer", color: "teal", mascotFaceColor: "light" as Bot["mascotFaceColor"] }),
      bot({ id: "editor", tasks: [{ threadId: "e-1" }, { threadId: "e-2", unread: true }] as Bot["tasks"] }),
      bot({ id: "runner", unread: true, tasks: [{ threadId: "r-1", unread: true, routineRunId: "run-1" }] as Bot["tasks"] }),
    ]);
    expect(await backend.readBotLooks("p1")).toEqual({
      lead: { color: "purple", avatarUrl: "/api/bots/lead/avatar", avatarZoom: 1.5, avatarFocusX: 0.2, avatarFocusY: 0.8, mascotBody: null },
      writer: { color: "teal", mascotFaceColor: "light" },
      editor: { color: "blue", unread: true },
      runner: { color: "blue" },
    });
    expect(sent).toEqual([]);
  });

  it("tells the open canvas when the store's bots look different from what it was given, and only then", async () => {
    const lead = bot({ id: "lead", color: "purple" });
    const { backend } = backendWith([lead]);
    const onChange = vi.fn();
    const stop = backend.subscribe("p1", onChange);
    await backend.readBotLooks("p1");
    backend.followBots([{ ...lead, busy: true }]);
    expect(onChange).not.toHaveBeenCalled();
    backend.followBots([{ ...lead, color: "red" }]);
    backend.followBots([lead, bot({ id: "writer" })]);
    backend.followBots([{ ...lead, unread: true }]);
    expect(onChange).toHaveBeenCalledTimes(3);
    stop();
    backend.followBots([{ ...lead, color: "green" }]);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("reads the conversation named, or the bot's main one, as opening it does, and only while it is unread", async () => {
    const { backend } = backendWith([
      bot({ id: "writer", threadId: "t-open", mainThreadId: "t-main", tasks: [{ threadId: "t-main", unread: true }, { threadId: "t-reply", unread: true }, { threadId: "t-open" }] as Bot["tasks"] }),
      bot({ id: "solo", unread: true }),
      bot({ id: "quiet" }),
    ]);
    backend.readConversation("p1", "writer", "t-reply");
    backend.readConversation("p1", "writer");
    backend.readConversation("p1", "writer", "t-open");
    backend.readConversation("p1", "solo");
    backend.readConversation("p1", "quiet");
    backend.readConversation("p1", "nobody");
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.map(({ method, path, body }) => [`${method} ${path}`, JSON.parse(String(body))])).toEqual([
      ["POST /api/bots/writer/read", { threadId: "t-reply" }],
      ["POST /api/bots/writer/read", { threadId: "t-main" }],
      ["POST /api/bots/solo/read", { threadId: "solo-open" }],
    ]);
  });

  it("reads a bot's latest exchange from the conversation its tasks go to", async () => {
    const { backend } = backendWith([bot({ id: "writer", threadId: "t-open", mainThreadId: "t-main" })]);
    answers.push({ body: { messages: [
      { id: "m1", role: "user", kind: "text", text: "An older ask", at: 1 },
      { id: "m2", role: "bot", kind: "text", text: "An older answer", at: 2 },
      { id: "m3", role: "user", kind: "text", text: "Write the opening", at: 3 },
      { id: "m4", role: "bot", kind: "activity", text: "Reading", at: 4 },
      { id: "m5", role: "bot", kind: "text", text: "  ", at: 5 },
      { id: "m6", role: "bot", kind: "text", text: "The bride runs.", at: 6 },
    ] } });
    expect(await backend.readExchange("p1", "writer")).toEqual([
      { id: "m3", role: "person", text: "Write the opening", at: 3 },
      { id: "m6", role: "bot", text: "The bride runs.", at: 6 },
    ]);
    expect(sent[0]!.path).toBe("/api/threads/t-main/messages?limit=40");
    expect(await backend.readExchange("p1", "nobody")).toEqual([]);
  });

  it("reads a bot's part of the project's group chat when it is newer, opens a reply there in the group chat, and leaves it unread", async () => {
    setTeamProjects({ root: "/dramas", projects: [{
      id: "p1", name: "p1", folder: "/dramas/p1", section: "p1", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"], follows: {}, episodeBots: {}, roomId: "room",
    }] });
    const room = { id: "room", threadId: "room-thread", name: "p1 team chat", memberIds: ["lead", "writer"], unread: true, tasks: [] } as unknown as Group;
    const { backend, dispatch } = backendWith([bot({ id: "writer", name: "Ink", threadId: "t-open", mainThreadId: "t-main" })], [room]);
    answers.push(
      { body: { messages: [{ id: "d1", role: "user", kind: "text", text: "A direct ask", at: 1 }, { id: "d2", role: "bot", kind: "text", text: "A direct answer", at: 2 }] } },
      { body: { messages: [
        { id: "r1", role: "user", kind: "text", text: "@Ink write the opening", at: 3 },
        { id: "r2", role: "bot", kind: "text", text: "The lead's aside", at: 4, from: { botId: "lead" } },
        { id: "r3", role: "user", kind: "text", text: "@Jade design her", at: 5 },
        { id: "r4", role: "bot", kind: "text", text: "The bride runs.", at: 6, from: { botId: "writer" } },
      ] } },
    );
    expect(await backend.readExchange("p1", "writer")).toEqual([
      { id: "r1", role: "person", text: "write the opening", at: 3 },
      { id: "r4", role: "bot", text: "The bride runs.", at: 6 },
    ]);
    expect(sent.map((one) => one.path)).toEqual(["/api/threads/t-main/messages?limit=40", "/api/threads/room-thread/messages?limit=120"]);
    backend.openChat("p1", "writer", "room-thread");
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "room" }]);
    backend.readConversation("p1", "writer", "room-thread");
    await new Promise((done) => setTimeout(done, 0));
    expect(sent).toHaveLength(2);
    setTeamProjects(null);
  });

  it("opens the bot's conversation, or the one named, with the app's navigation", () => {
    const writer = bot({ id: "writer", threadId: "t-open", tasks: [{ threadId: "t-open" }, { threadId: "t-asked" }] as Bot["tasks"] });
    const { backend, dispatch } = backendWith([writer]);
    backend.openChat("p1", "writer");
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "writer" }]);
    dispatch.mockClear();
    backend.openChat("p1", "writer", "t-asked");
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "writer" },
      { type: "switchTask", botId: "writer", threadId: "t-asked" },
      { type: "revealThread", threadId: "t-asked" },
    ]);
    dispatch.mockClear();
    backend.openChat("p1", "nobody");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("stops every conversation the bot is at work in with the app's Stop", async () => {
    const tasks = [{ threadId: "t-open", busy: false }, { threadId: "t-main", busy: true }, { threadId: "t-side", busy: true }] as Bot["tasks"];
    const { backend, dispatch } = backendWith([bot({ id: "writer", tasks }), bot({ id: "idle" })]);
    await backend.stopBot("p1", "writer");
    await backend.stopBot("p1", "idle");
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "interrupt", botId: "writer", threadId: "t-main" },
      { type: "interrupt", botId: "writer", threadId: "t-side" },
      { type: "interrupt", botId: "idle" },
    ]);
    expect(sent).toEqual([]);
  });

  it("stops the turn the bot is taking in the project's group chat, and leaves the other members' turns", async () => {
    setTeamProjects({ root: "/dramas", projects: [{
      id: "p1", name: "p1", folder: "/dramas/p1", section: "p1", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer", "editor"], follows: {}, episodeBots: {}, roomId: "room",
    }] });
    const room = { id: "room", threadId: "room-thread", memberIds: ["lead", "writer", "editor"], busyBotId: "writer", tasks: [{ threadId: "room-thread", busyBotId: "writer" }, { threadId: "room-side", busyBotId: "editor" }] } as unknown as Group;
    const { backend, dispatch } = backendWith([bot({ id: "writer" }), bot({ id: "editor" }), bot({ id: "lead" })], [room]);
    await backend.stopBot("p1", "writer");
    await backend.stopBot("p1", "editor");
    await backend.stopBot("p1", "lead");
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "interruptGroup", groupId: "room", threadId: "room-thread" },
      { type: "interruptGroup", groupId: "room", threadId: "room-side" },
      { type: "interrupt", botId: "lead" },
    ]);
    setTeamProjects(null);
  });
});
