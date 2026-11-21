import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { botNodeId, type CanvasFileRef, type CanvasOp, type ProjectCanvasEvent } from "../../shared/project-canvas.ts";
import { DEFAULT_GENERATION_SETTINGS, type GenerationFailure, type GenerationJob, type GenerationRequester, type StartGenerationInput } from "../../shared/project-generation.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import type { RequestAuth } from "../request-auth.ts";
import { addServerLinePacks } from "../server-lines.ts";
import type { BotRecord, Message, TaskRecord } from "../store.ts";
import { CanvasDocuments } from "./document-store.ts";
import { parseCanvasOps } from "./ops.ts";
import { canvasRefusalOf, ProjectCanvasService, type ProjectCanvasServiceDeps } from "./service.ts";

let dir: string;
let folder: string;
const auth = {} as RequestAuth;
const person = { kind: "person" } as const;
const writer = { kind: "bot", botId: "writer" } as const;

const jobOf = (id: string, nodeId: string): GenerationJob => ({
  id, projectId: "p1", nodeId, kind: "image", settings: DEFAULT_GENERATION_SETTINGS.image.defaults, status: "queued", requester: person, prompt: "A poster",
  references: { images: [], audio: [] }, server: "gen", tool: "generate_image", files: [], createdAt: 1, updatedAt: 1,
});

function fakeGeneration() {
  const jobs = new Map<string, GenerationJob>();
  const started: Array<{ input: StartGenerationInput; requester: GenerationRequester }> = [];
  let refusal: GenerationFailure | undefined;
  const api: ProjectCanvasServiceDeps["generation"] = {
    start: async (projectId, input, { requester }) => {
      started.push({ input, requester });
      if (refusal) return { refused: refusal };
      const job = { ...jobOf(`job-${jobs.size + 1}`, input.nodeId), projectId, requester, prompt: input.prompt };
      jobs.set(job.id, job);
      return { job };
    },
    job: (_projectId, jobId) => jobs.get(jobId) ?? null,
  };
  return { api, jobs, started, refuseWith: (failure: GenerationFailure | undefined) => { refusal = failure; } };
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-service-")));
  folder = join(dir, "Stand-in bride");
  mkdirSync(join(dir, "attachments"), { recursive: true });
  mkdirSync(folder);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(patch: Partial<ProjectCanvasServiceDeps> = {}) {
  const events: ProjectCanvasEvent[] = [];
  const sent: Array<{ botId: string; threadId: string; text: string }> = [];
  const threads: Record<string, Message[]> = {};
  const project = { id: "p1", name: "Stand-in bride", folder, section: "Stand-in bride", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"], follows: {} } as TeamProjectWire;
  const bots: Record<string, Partial<BotRecord>> = {
    lead: { id: "lead", name: "Lead", title: "Producer", threadId: "lead-main", teamProject: { id: "p1", role: "producer" } },
    writer: { id: "writer", name: "Writer", title: "Writes the episodes", threadId: "writer-main", teamProject: { id: "p1", role: "writer" } },
    plain: { id: "plain", name: "Plain", threadId: "plain-main" },
  };
  let next = 0;
  const generation = fakeGeneration();
  const service = new ProjectCanvasService({
    store: {
      bot: (id) => (bots[id] ?? null) as BotRecord | null,
      botByThread: (threadId) => (Object.values(bots).find((bot) => bot.threadId === threadId) ?? null) as BotRecord | null,
      tasks: (id) => (bots[id] ? [{ threadId: bots[id].threadId, createdAt: 1 }] : []) as TaskRecord[],
      taskByThread: (botId, threadId) => (bots[botId]?.threadId === threadId ? { threadId, createdAt: 1 } as TaskRecord : undefined),
      messagesTail: (threadId) => ({ messages: threads[threadId] ?? [], hasMore: false, activeLeafId: null }),
    },
    projects: { list: () => [project] },
    documents: new CanvasDocuments(join(dir, "canvases"), () => undefined),
    broadcast: (event) => events.push(event),
    visibleFor: () => ({ thread: () => true }),
    threadBusy: () => false,
    mainThread: (botId) => bots[botId]?.threadId,
    send: async (_auth, message) => {
      sent.push(message);
      return { ok: true, threadId: message.threadId, message: { id: "sent-1", at: 1, role: "user", kind: "text", text: message.text } };
    },
    parentOf: () => undefined,
    generation: generation.api,
    openCards: () => [],
    queuedThreads: () => new Set(),
    saveImage: () => ({ path: join(dir, "attachments", "saved.png") }),
    language: () => undefined,
    newId: () => `id-${++next}`,
    log: () => undefined,
    ...patch,
  });
  return { service, project, events, sent, threads, generation };
}

const opsOf = (...ops: unknown[]): CanvasOp[] => parseCanvasOps(ops);
const nodeOf = (service: ProjectCanvasService, id: string) => service.botView(service.project("p1")).nodes.find((node) => node.id === id);

describe("changing a project's canvas", () => {
  it("stores a bot's node where the layout shows it once the bot adds a node beside it, and tells open apps once", () => {
    const { service, project, events } = setup();
    expect(service.botView(project).bots.writer!.placed).toBe(false);
    const outcome = service.apply(project, writer, opsOf({ type: "add_node", nodeType: "text", metadata: { content: "Act one" } }));
    expect(outcome).toEqual({ revision: 1, nodeIds: ["id-1"], connectionIds: ["id-2"] });
    expect(service.botView(project).bots.writer!.placed).toBe(true);
    expect(events).toEqual([{ kind: "project-canvas", projectId: "p1", revision: 1, reason: "document" }]);
  });

  it("keeps a bot's node the bot's when the person deletes it and adds it back, as undo does", () => {
    const { service, project } = setup();
    const [shotId] = service.apply(project, writer, opsOf({ type: "add_node", nodeType: "shot", title: "Shot 1", metadata: { prompt: "Veil, dawn" } })).nodeIds;
    const made = nodeOf(service, shotId!)!;
    service.apply(project, person, opsOf({ type: "delete_node", id: shotId }));
    service.apply(project, person, opsOf({ type: "add_node", id: shotId, nodeType: "shot", title: made.title, position: made.position, metadata: made.metadata }));
    expect(nodeOf(service, shotId!)?.createdBy).toEqual(writer);
    service.apply(project, writer, opsOf({ type: "update_node", id: shotId, metadata: { prompt: "Veil, dusk" } }));
    expect(nodeOf(service, shotId!)?.metadata?.prompt).toBe("Veil, dusk");
  });

  it("refuses every change to an archived project's canvas", async () => {
    const { service, project } = setup();
    project.archivedAt = 5;
    const read = (() => { try { service.apply(project, person, opsOf({ type: "add_node", nodeType: "text" })); } catch (error) { return error; } })();
    expect(canvasRefusalOf(read)).toEqual({ status: 409, body: expect.objectContaining({ code: "canvas_read_only", reason: "archived" }) });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go" })).rejects.toMatchObject({ status: 409 });
    await expect(service.generate(project, person, "n1")).rejects.toMatchObject({ status: 409 });
    expect(service.snapshot("p1", auth).readOnly).toBe("archived");
  });

  it("answers a project it does not know with not found, and a bot of no project with no canvas", () => {
    const { service } = setup();
    expect(() => service.project("gone")).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => service.projectOfBot("plain")).toThrow(expect.objectContaining({ status: 403 }));
    expect(service.projectOfBot("writer").id).toBe("p1");
  });
});

describe("the flow's lines between a project's bots", () => {
  it("names the projects whose canvas draws other lines than when last asked, a project made since included", () => {
    const superiors: Record<string, string> = {};
    const listed: TeamProjectWire[] = [];
    const { service, project } = setup({ projects: { list: () => listed }, parentOf: (projectId, botId) => (projectId === "p1" ? superiors[botId] : undefined) });
    listed.push({ ...project, botIds: ["lead", "writer", "board"] });
    expect(service.linesMoved()).toEqual(["p1"]);
    expect(service.linesMoved()).toEqual([]);

    superiors.board = "writer";
    expect(service.linesMoved()).toEqual(["p1"]);
    expect(service.linesMoved()).toEqual([]);
    superiors.board = "lead";
    expect(service.linesMoved()).toEqual(["p1"]);
    delete superiors.board;
    superiors.writer = "someone-elsewhere";
    expect(service.linesMoved()).toEqual([]);

    listed.push({ ...project, id: "p2", botIds: ["lead-2", "writer-2"], leadBotId: "lead-2" });
    superiors.board = "writer";
    expect(service.linesMoved()).toEqual(["p1", "p2"]);
  });
});

describe("a file a project's bot attaches", () => {
  const attached = (patch: Partial<Message> = {}): Message => ({
    id: "m1", at: 1, role: "bot", kind: "text", text: "",
    attachments: [{ kind: "image", path: join(dir, "attachments", "copy.png"), mime: "image/png", name: "poster.png", source: join(folder, "poster.png") }],
    ...patch,
  });

  beforeEach(() => {
    writeFileSync(join(folder, "poster.png"), "poster bytes");
    writeFileSync(join(dir, "attachments", "copy.png"), "poster bytes");
  });

  it("becomes one node in its lane, connected from it, and none when it is attached again", async () => {
    const { service, events } = setup();
    await service.handOverLine("writer-main", attached());
    await service.handOverLine("writer-main", attached({ id: "m2" }));
    const view = service.botView(service.project("p1"));
    const files = view.nodes.filter((node) => node.metadata?.file);
    expect(files).toEqual([expect.objectContaining({ type: "image", title: "poster.png", createdBy: writer, metadata: { file: { path: "poster.png", mime: "image/png", bytes: 12, name: "poster.png" } } })]);
    expect(view.connections).toContainEqual({ id: expect.any(String), fromNodeId: botNodeId("writer"), toNodeId: files[0]!.id, kind: "content" });
    expect(events.filter((event) => event.reason === "document")).toHaveLength(1);
  });

  it("is left off the canvas for a bot of no project, a reply with words, and an image a tool made", async () => {
    const { service } = setup();
    await service.handOverLine("plain-main", attached());
    await service.handOverLine("writer-main", attached({ text: "Here it is" }));
    await service.handOverLine("writer-main", attached({ attachments: [{ kind: "image", path: join(dir, "attachments", "copy.png"), mime: "image/png", source: join(folder, "poster.png"), fromTool: true }] }));
    expect(service.botView(service.project("p1")).nodes.filter((node) => node.metadata?.file)).toEqual([]);
  });
});

describe("a task sent from the canvas", () => {
  it("goes to the bot's conversation with what is connected into its node", async () => {
    const { service, project, sent } = setup();
    const made = service.apply(project, person, opsOf({ type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "The swap." } }));
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: made.nodeIds[0], toNodeId: botNodeId("writer") }));
    expect(await service.task("p1", auth, { botId: "writer", text: "Write it" })).toEqual({ threadId: "writer-main", messageId: "sent-1", references: 1 });
    expect(sent).toEqual([{ botId: "writer", threadId: "writer-main", text: "Write it\n\nConnected to your node on the project's canvas:\n\nText 1 \"Brief\":\n\n> The swap." }]);
  });

  it("names the references in the language the person's request names, else in the server's", async () => {
    addServerLinePacks({ zh: { "server.projectCanvas.reference.text": "文本", "server.projectCanvas.task.connected": "项目画布上连到你的节点的内容：" } });
    let serverLanguage: string | undefined;
    const { service, project, sent } = setup({ language: () => serverLanguage });
    const made = service.apply(project, person, opsOf({ type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "The swap." } }));
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: made.nodeIds[0], toNodeId: botNodeId("writer") }));
    await service.task("p1", auth, { botId: "writer", text: "@文本 1", language: " ZH " });
    serverLanguage = "zh";
    await service.task("p1", auth, { botId: "writer", text: "@文本 1" });
    await service.task("p1", auth, { botId: "writer", text: "@Text 1", language: "en" });
    const inChinese = "@文本 1\n\n项目画布上连到你的节点的内容：\n\n文本 1 \"Brief\":\n\n> The swap.";
    expect(sent.map((one) => one.text)).toEqual([inChinese, inChinese, "@Text 1\n\nConnected to your node on the project's canvas:\n\nText 1 \"Brief\":\n\n> The swap."]);
  });

  it("is refused for a bot outside the project, a conversation the person cannot open, a language that is no language, and nothing to say", async () => {
    const { service, sent } = setup();
    await expect(service.task("p1", auth, { botId: "plain", text: "Go" })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", threadId: "lead-main" })).rejects.toMatchObject({ status: 404 });
    await expect(setup({ visibleFor: () => ({ thread: () => false }) }).service.task("p1", auth, { botId: "writer", text: "Go" })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", language: "中文" })).rejects.toMatchObject({ status: 400 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", language: 7 })).rejects.toMatchObject({ status: 400 });
    await expect(service.task("p1", auth, { botId: "writer", text: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(service.task("p1", auth, { botId: "writer" })).rejects.toMatchObject({ status: 400 });
    expect(sent).toEqual([]);
  });
});

describe("a task whose reply goes into a text node", () => {
  const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
  const turnEnd = (requestMessageId: string, text: string, patch: Partial<Message> = {}): Message => ({
    id: `reply-to-${requestMessageId}`, at: 5, role: "bot", kind: "text", text, turnId: "t1", turnTerminal: true, turnSucceeded: true, requestMessageId, ...patch,
  });
  const textNodes = (service: ProjectCanvasService, project: TeamProjectWire, ...titles: string[]) =>
    service.apply(project, person, opsOf(...titles.map((title) => ({ type: "add_node", nodeType: "text", title, metadata: { content: "Draft" } })))).nodeIds;
  const contentOf = (service: ProjectCanvasService, id: string | undefined) => nodeOf(service, id!)?.metadata?.content;
  const writingInto = (service: ProjectCanvasService) => service.snapshot("p1", auth).bots.writer!.writingInto;

  it("gets the bot's reply once its turn ends well, secrets redacted, and shows the bot writing into it until then", async () => {
    let busy = true;
    const { service, project, events } = setup({ threadBusy: () => busy });
    const [logline] = textNodes(service, project, "Logline");
    await service.task("p1", auth, { botId: "writer", text: "Write the logline", targetNodeId: logline });
    expect(writingInto(service)).toEqual([logline]);
    service.taskLine("writer-main", turnEnd("sent-1", "A bride swaps places.", { turnSucceeded: undefined }));
    expect(contentOf(service, logline)).toBe("Draft");
    busy = false;
    const told = events.length;
    service.taskLine("writer-main", turnEnd("sent-1", `A bride swaps places. Key: ${KEY}`));
    expect(contentOf(service, logline)).toMatch(/^A bride swaps places\. Key: «redacted/);
    expect(contentOf(service, logline)).not.toContain(KEY);
    expect(nodeOf(service, logline!)?.createdBy).toEqual(person);
    expect(events.slice(told)).toEqual([{ kind: "project-canvas", projectId: "p1", revision: expect.any(Number), reason: "document" }]);
    expect(writingInto(service)).toBeUndefined();
  });

  it("waits for a queued task's message to reach the conversation, and takes no reply for a task steered into a running turn", async () => {
    let receipt: DirectSendReceipt = { ok: true, queued: true, queueId: "q1", threadId: "writer-main" };
    const queued = new Set(["writer-main"]);
    const { service, project } = setup({ send: async () => receipt, queuedThreads: () => queued });
    const [logline, notes] = textNodes(service, project, "Logline", "Notes");
    await service.task("p1", auth, { botId: "writer", text: "Write the logline", targetNodeId: logline });
    expect(writingInto(service)).toEqual([logline]);
    queued.clear();
    service.taskLine("writer-main", { id: "m7", at: 7, role: "user", kind: "text", text: "Write the logline", queueId: "q1" });
    service.taskLine("writer-main", turnEnd("m7", "Swapped at the altar.", { at: 9 }));
    expect(contentOf(service, logline)).toBe("Swapped at the altar.");
    receipt = { ok: true, threadId: "writer-main", message: { id: "m10", at: 10, role: "user", kind: "text", text: "Notes too" }, steered: true };
    await service.task("p1", auth, { botId: "writer", text: "Notes too", targetNodeId: notes });
    service.taskLine("writer-main", turnEnd("m10", "Both done.", { at: 12 }));
    expect(contentOf(service, notes)).toBe("Draft");
  });

  it("stays as it was after a failed or stopped turn, the end of a later message's turn, on an archived canvas, and once the node is gone", async () => {
    const { service, project, events } = setup({ threadBusy: () => true });
    const [logline] = textNodes(service, project, "Logline");
    const ask = () => service.task("p1", auth, { botId: "writer", text: "Write it", targetNodeId: logline });
    await ask();
    service.taskLine("writer-main", turnEnd("earlier", "An older reply, changed again", { at: 0 }));
    expect(writingInto(service)).toEqual([logline]);
    service.taskLine("writer-main", turnEnd("sent-1", "Half a line", { turnSucceeded: false }));
    expect(writingInto(service)).toBeUndefined();
    await ask();
    service.taskLine("writer-main", turnEnd("later", "A reply to a later message"));
    expect(writingInto(service)).toBeUndefined();
    service.taskLine("writer-main", turnEnd("sent-1", "Too late"));
    await ask();
    project.archivedAt = 9;
    service.taskLine("writer-main", turnEnd("sent-1", "Into an archived canvas"));
    delete project.archivedAt;
    expect(contentOf(service, logline)).toBe("Draft");
    await ask();
    service.apply(project, person, opsOf({ type: "delete_node", id: logline }));
    const told = events.length;
    service.taskLine("writer-main", turnEnd("sent-1", "Into nothing"));
    expect(nodeOf(service, logline!)).toBeUndefined();
    expect(events.slice(told)).toEqual([]);
  });

  it("is refused for anything but a text node of this canvas, and nothing is sent", async () => {
    const { service, project, sent } = setup();
    const [shot] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "shot", title: "Shot 1" })).nodeIds;
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", targetNodeId: shot })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", targetNodeId: "gone" })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", targetNodeId: 7 })).rejects.toMatchObject({ status: 400 });
    expect(sent).toEqual([]);
  });
});

describe("generating a node", () => {
  const shot = (prompt = "A bride alone at the altar") => ({ type: "add_node", nodeType: "shot", metadata: { prompt } });

  const file = (path: string, mime = "image/png"): CanvasFileRef => ({ path, mime, bytes: 3, name: path.split("/").at(-1)! });

  it("starts the node's prompt, settings and title with the files connected into it, and shows the node loading", async () => {
    const { service, project, generation } = setup();
    const [still, song, poster] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", metadata: { file: file("refs/still.png") } },
      { type: "add_node", nodeType: "audio", metadata: { file: file("refs/song.mp3", "audio/mpeg") } },
      { type: "add_node", nodeType: "image", title: " Poster ", metadata: { prompt: "A poster", settings: { aspect: "16:9", count: 2 } } },
    )).nodeIds as [string, string, string];
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: still, toNodeId: poster }, { type: "connect_nodes", fromNodeId: song, toNodeId: poster }));
    const take = service.apply(project, person, opsOf(shot())).nodeIds[0]!;
    expect(await service.generate(project, person, poster)).toEqual({ job: expect.objectContaining({ id: "job-1" }) });
    await service.generate(project, person, take);
    const numbering = [
      "Reference image labels: Image 1. Use these labels to interpret image references in the prompt.",
      "Reference audio labels: Audio 1. Use these labels to interpret audio references in the prompt.",
    ].join("\n");
    expect(generation.started).toEqual([
      { input: { kind: "image", nodeId: poster, prompt: `${numbering}\n\nA poster`, references: { images: ["refs/still.png"], audio: ["refs/song.mp3"] }, overrides: { aspect: "16:9", count: 2 }, name: "Poster" }, requester: person },
      { input: { kind: "video", nodeId: take, prompt: "A bride alone at the altar", references: { images: [], audio: [] } }, requester: person },
    ]);
    expect(nodeOf(service, poster)!.metadata).toMatchObject({ status: "loading", jobId: "job-1" });
  });

  it("starts a config node from its prompt and settings with its own references, groups opened, numbered as the person saw them", async () => {
    const { service, project, generation } = setup();
    const [still, refs, brief, config, clip] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", title: "Still", metadata: { file: file("refs/still.png") } },
      { type: "add_node", nodeType: "group", title: "Refs" },
      { type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "The swap." } },
      { type: "add_node", nodeType: "config", title: "生成配置", metadata: { prompt: "@Image 2 at dawn", generationMode: "image", settings: { model: "pixel-1", count: 2 } } },
      { type: "add_node", nodeType: "config", metadata: { prompt: "Rain", generationMode: "video" } },
    )).nodeIds as [string, string, string, string, string];
    const [, take] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "image", groupId: refs, metadata: { file: file("refs/veil.png") } }, shot())).nodeIds as [string, string];
    service.apply(project, person, opsOf(...[still, refs, brief, take].map((from) => ({ type: "connect_nodes", fromNodeId: from, toNodeId: config }))));
    await service.generate(project, person, config);
    await service.generate(project, person, take);
    await service.generate(project, person, clip);
    const numbering = "Reference image labels: Image 1, Image 2. Use these labels to interpret image references in the prompt.";
    const images = ["refs/still.png", "refs/veil.png"];
    expect(generation.started.map((one) => one.input)).toEqual([
      { kind: "image", nodeId: config, prompt: `${numbering}\n\n@Image 2 at dawn\n\n【Text 1】\nThe swap.`, references: { images, audio: [] }, overrides: { model: "pixel-1", count: 2 }, name: "生成配置" },
      { kind: "video", nodeId: take, prompt: `${numbering}\n\nA bride alone at the altar\n\n【Text 1】\nThe swap.`, references: { images, audio: [] } },
      { kind: "video", nodeId: clip, prompt: "Rain", references: { images: [], audio: [] } },
    ]);
    expect(nodeOf(service, config)!.metadata).toMatchObject({ status: "loading", jobId: "job-1" });
    service.jobChanged({ ...generation.jobs.get("job-1")!, status: "done", files: [file("产出/图片/a.png"), file("产出/图片/b.png")] });
    const view = service.botView(project);
    const made = view.nodes.filter((one) => one.metadata?.file?.path.startsWith("产出/"));
    expect(made.map((one) => one.type)).toEqual(["image", "image"]);
    for (const one of made) expect(view.connections).toContainEqual(expect.objectContaining({ fromNodeId: config, toNodeId: one.id, kind: "content" }));
    expect(nodeOf(service, config)!.metadata).toMatchObject({ status: "success" });
    await expect(service.generate(project, writer, clip)).rejects.toMatchObject({ code: "not_yours" });
    await expect(service.generate(project, person, brief)).rejects.toMatchObject({ code: "invalid_op" });
  });

  it("numbers the references in the language the person's request names, a bot's in the server's, and refuses one that is no language", async () => {
    addServerLinePacks({ zh: {
      "server.projectCanvas.reference.image": "图片", "server.projectCanvas.reference.separator": "、",
      "server.projectCanvas.reference.imageLine": "参考图片编号：{labels}。请按这些编号理解提示词中的图片引用。",
    } });
    let serverLanguage: string | undefined;
    const { service, project, generation } = setup({ language: () => serverLanguage });
    const [still, poster] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", metadata: { file: file("refs/still.png") } },
      { type: "add_node", nodeType: "image", metadata: { prompt: "@图片 1 at dawn" } },
    )).nodeIds as [string, string];
    const mine = service.apply(project, writer, opsOf(shot("@图片 1 in the rain"))).nodeIds[0]!;
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: still, toNodeId: poster }, { type: "connect_nodes", fromNodeId: still, toNodeId: mine }));
    await expect(service.generate(project, person, poster, "图片")).rejects.toMatchObject({ status: 400 });
    expect(nodeOf(service, poster)!.metadata).toEqual({ prompt: "@图片 1 at dawn" });
    await service.generate(project, person, poster, "zh-Hans");
    serverLanguage = "zh";
    await service.generate(project, writer, mine);
    expect(generation.started.map((one) => one.input.prompt)).toEqual([
      "参考图片编号：图片 1。请按这些编号理解提示词中的图片引用。\n\n@图片 1 at dawn",
      "参考图片编号：图片 1。请按这些编号理解提示词中的图片引用。\n\n@图片 1 in the rain",
    ]);
  });

  it("answers generation's refusal as it is, and leaves the node as it was, its last error too", async () => {
    const { service, project, generation } = setup();
    const timedOut = { status: "error", errorDetails: "gen gave no result within 10 minutes.", errorKey: "serverError.projectGeneration.timedOut", errorParams: { server: "gen", minutes: 10 } };
    const id = service.apply(project, person, opsOf({ ...shot(), metadata: { prompt: "A bride", ...timedOut, jobId: "old" } })).nodeIds[0]!;
    const before = nodeOf(service, id)!.metadata;
    const refusal: GenerationFailure = { code: "no_server", error: "Choose an MCP server for videos in this project's settings first.", errorKey: "serverError.projectGeneration.noVideoServer" };
    generation.refuseWith(refusal);
    expect(await service.generate(project, person, id)).toEqual({ refused: refusal });
    expect(nodeOf(service, id)!.metadata).toEqual(before);
    generation.refuseWith(undefined);
    await service.generate(project, person, id);
    expect(nodeOf(service, id)!.metadata).toEqual({ prompt: "A bride", status: "loading", jobId: "job-1" });
  });

  it("lets a bot start only its own nodes, and a node only once while its job runs", async () => {
    const { service, project, generation } = setup();
    const theirs = service.apply(project, person, opsOf(shot())).nodeIds[0]!;
    await expect(service.generate(project, writer, theirs)).rejects.toMatchObject({ code: "not_yours" });
    const mine = service.apply(project, writer, opsOf(shot())).nodeIds[0]!;
    await service.generate(project, writer, mine);
    await expect(service.generate(project, writer, mine)).rejects.toMatchObject({ status: 409 });
    expect(generation.started.map((one) => one.requester)).toEqual([writer]);
  });

  it("refuses a node that is gone, has no prompt or is generating already with a line the person reads in their language", async () => {
    const { service, project, generation } = setup();
    const [blank, busy] = service.apply(project, person, opsOf(shot("  "), shot())).nodeIds as [string, string];
    await service.generate(project, person, busy);
    const refusalOf = (nodeId: string) => service.generate(project, person, nodeId).then(() => null, (error: unknown) => canvasRefusalOf(error));
    expect(await refusalOf("gone")).toEqual({ status: 404, body: { code: "not_found", error: "That node isn't on the canvas.", errorKey: "serverError.projectCanvas.nodeMissing" } });
    expect(await refusalOf(blank)).toEqual({ status: 400, body: { code: "no_prompt", error: "Write a prompt for this node first.", errorKey: "serverError.projectCanvas.noPrompt" } });
    expect(await refusalOf(busy)).toEqual({ status: 409, body: { code: "generating", error: "This node is being generated already.", errorKey: "serverError.projectCanvas.alreadyGenerating" } });
    expect(nodeOf(service, blank)!.metadata).toEqual({ prompt: "  " });
    expect(generation.started).toHaveLength(1);
  });

  it("shows a job on its node: each file it made as a node to its right, connected from it, once", async () => {
    const { service, project, generation } = setup();
    const id = service.apply(project, writer, opsOf(shot("A poster"))).nodeIds[0]!;
    await service.generate(project, writer, id);
    service.jobChanged({ ...jobOf("stray", id), status: "done", files: [file("产出/视频/stray.mp4", "video/mp4")] });
    const done: GenerationJob = { ...generation.jobs.get("job-1")!, status: "done", files: [file("产出/视频/a.mp4", "video/mp4"), file("产出/视频/b.mp4", "video/mp4")] };
    service.jobChanged(done);
    service.jobChanged(done);
    const view = service.botView(project);
    const node = view.nodes.find((one) => one.id === id)!;
    expect(node.metadata).toEqual({ prompt: "A poster", status: "success", jobId: "job-1" });
    const made = view.nodes.filter((one) => one.metadata?.file);
    expect(made.map((one) => [one.type, one.title, one.metadata!.file!.path])).toEqual([["video", "a.mp4", "产出/视频/a.mp4"], ["video", "b.mp4", "产出/视频/b.mp4"]]);
    expect(made.map((one) => one.position.x)).toEqual([node.position.x + node.width + 80, node.position.x + node.width + 80]);
    expect(made[1]!.position.y).toBeGreaterThan(made[0]!.position.y);
    expect(made.every((one) => one.createdBy?.kind === "bot" && one.createdBy.botId === "writer")).toBe(true);
    for (const one of made) expect(view.connections).toContainEqual(expect.objectContaining({ fromNodeId: id, toNodeId: one.id, kind: "content" }));
  });

  it("puts a failure on its node in English and as generation's key and values, and a cancelled job leaves the node idle", async () => {
    const { service, project, generation } = setup();
    const [failed, cancelled] = service.apply(project, person, opsOf(shot(), shot())).nodeIds as [string, string];
    await service.generate(project, person, failed);
    await service.generate(project, person, cancelled);
    const failure: GenerationFailure = {
      code: "task_failed", error: "gen couldn't make it: no faces", errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "no faces" }, reason: "no faces",
    };
    service.jobChanged({ ...generation.jobs.get("job-1")!, status: "failed", failure });
    service.jobChanged({ ...generation.jobs.get("job-2")!, status: "cancelled" });
    expect(nodeOf(service, failed)!.metadata).toEqual({
      prompt: "A bride alone at the altar", status: "error", jobId: "job-1",
      errorDetails: "gen couldn't make it: no faces", errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "no faces" },
    });
    expect(nodeOf(service, cancelled)!.metadata).toMatchObject({ status: "idle", jobId: "job-2" });
    expect(nodeOf(service, cancelled)!.metadata).not.toHaveProperty("errorKey");
  });

  it("follows each loading node again at start: an ended job's outcome, a job generation no longer has, a node that never got one", () => {
    const { service, project, generation } = setup();
    const [ended, gone, never] = service.apply(project, person, opsOf(
      { ...shot(), metadata: { prompt: "A", status: "loading", jobId: "j-ended" } },
      { ...shot(), metadata: { prompt: "B", status: "loading", jobId: "j-gone" } },
      { ...shot(), metadata: { prompt: "C", status: "loading" } },
    )).nodeIds as [string, string, string];
    generation.jobs.set("j-ended", { ...jobOf("j-ended", ended), kind: "video", settings: DEFAULT_GENERATION_SETTINGS.video.defaults, status: "done", files: [file("产出/视频/a.mp4", "video/mp4")] });
    service.reconcileGenerations();
    expect(nodeOf(service, ended)!.metadata).toMatchObject({ status: "success" });
    expect(service.botView(project).nodes.find((one) => one.metadata?.file?.path === "产出/视频/a.mp4")).toMatchObject({ type: "video" });
    expect(nodeOf(service, gone)!.metadata).toEqual({
      prompt: "B", status: "error", jobId: "j-gone", errorDetails: "That generation is no longer there.", errorKey: "serverError.projectGeneration.jobGone",
    });
    expect(nodeOf(service, never)!.metadata).toEqual({ prompt: "C" });
  });
});

describe("what a viewer reads of a bot's conversations", () => {
  it("is the bot's latest reply only from a conversation the viewer may open", () => {
    const reply: Message = { id: "r1", at: 2, role: "bot", kind: "text", text: "Draft ready.", turnId: "t1", turnTerminal: true };
    const open = setup();
    open.threads["writer-main"] = [reply];
    expect(open.service.snapshot("p1", auth).bots.writer!.output).toMatchObject({ text: "Draft ready.", threadId: "writer-main", messageId: "r1" });
    expect(open.service.botView(open.project).bots.writer!.output).toBeUndefined();
    const closed = setup({ visibleFor: () => ({ thread: () => false }) });
    closed.threads["writer-main"] = [reply];
    expect(closed.service.snapshot("p1", auth).bots.writer!.output).toBeUndefined();
  });
});

describe("a refusal", () => {
  it("is answered with its status and words, and anything else is not a refusal", () => {
    const sendRefused = Object.assign(new Error("Spending is capped"), { status: 409, body: { error: "Spending is capped", code: "spend_cap" } });
    expect(canvasRefusalOf(sendRefused)).toEqual({ status: 409, body: { error: "Spending is capped", code: "spend_cap" } });
    expect(canvasRefusalOf(new Error("boom"))).toBeNull();
    expect(canvasRefusalOf("boom")).toBeNull();
  });
});
