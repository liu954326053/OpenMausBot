import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PERSON_STOPPED_TURN_NAME } from "../../shared/client-cancel.ts";
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { botNodeId, CANVAS_NODE_SIZE, type CanvasFileRef, type CanvasOp, type ProjectCanvasEvent } from "../../shared/project-canvas.ts";
import { DEFAULT_GENERATION_SETTINGS, type GenerationFailure, type GenerationJob, type GenerationRequester, type StartGenerationInput } from "../../shared/project-generation.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import type { RequestAuth } from "../request-auth.ts";
import { addServerLinePacks } from "../server-lines.ts";
import type { BotRecord, GroupRecord, Message, TaskRecord } from "../store.ts";
import { canvasStateText } from "./agent-tools.ts";
import { CanvasDocuments } from "./document-store.ts";
import type { ProjectPipeline } from "./flow.ts";
import { parseCanvasOps } from "./ops.ts";
import { LANE_GAP, NODE_GAP } from "./placement.ts";
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
  const project = { id: "p1", name: "Stand-in bride", folder, section: "Stand-in bride", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"], follows: {}, episodeBots: {} } as TeamProjectWire;
  const bots: Record<string, Partial<BotRecord>> = {
    lead: { id: "lead", name: "Lead", title: "Producer", threadId: "lead-main", teamProject: { id: "p1", role: "producer" } },
    writer: { id: "writer", name: "Writer", title: "Writes the episodes", threadId: "writer-main", teamProject: { id: "p1", role: "writer" } },
    plain: { id: "plain", name: "Plain", threadId: "plain-main" },
  };
  let next = 0;
  const pipeline: ProjectPipeline = { stages: {}, lines: [] };
  const generation = fakeGeneration();
  const groups: Record<string, GroupRecord> = {};
  const roomSent: Array<Parameters<ProjectCanvasServiceDeps["sendToRoom"]>[1]> = [];
  const speakers = new Map<string, string>();
  const roomsWorking = new Set<string>();
  const service = new ProjectCanvasService({
    store: {
      bot: (id) => (bots[id] ?? null) as BotRecord | null,
      botByThread: (threadId) => (Object.values(bots).find((bot) => bot.threadId === threadId) ?? null) as BotRecord | null,
      tasks: (id) => (bots[id] ? [{ threadId: bots[id].threadId, createdAt: 1 }] : []) as TaskRecord[],
      taskByThread: (botId, threadId) => (bots[botId]?.threadId === threadId ? { threadId, createdAt: 1 } as TaskRecord : undefined),
      messagesTail: (threadId) => ({ messages: threads[threadId] ?? [], hasMore: false, activeLeafId: null }),
      group: (id) => groups[id],
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
    sendToRoom: (_auth, message) => {
      roomSent.push(message);
      return { ok: true, threadId: message.threadId, message: { id: `room-sent-${roomSent.length}`, at: 10 + roomSent.length, role: "user", kind: "text", text: message.to[0]!.text } };
    },
    roomSpeaker: (threadId) => speakers.get(threadId),
    roomWorking: (threadId) => roomsWorking.has(threadId),
    pipelineOf: () => pipeline,
    generation: generation.api,
    openCards: () => [],
    queuedThreads: () => new Set(),
    stillQueued: () => false,
    saveImage: () => ({ path: join(dir, "attachments", "saved.png") }),
    language: () => undefined,
    newId: () => `id-${++next}`,
    log: () => undefined,
    ...patch,
  });
  return { service, project, events, sent, threads, generation, pipeline, groups, roomSent, speakers, roomsWorking };
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

  it("carries the nodes the person named with it as if they were connected, each once, and refuses a list that is not one of ids", async () => {
    const { service, project, sent } = setup();
    const [brief, scene] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "The swap." } },
      { type: "add_node", nodeType: "text", title: "Scene", metadata: { content: "Rain on the steps." } },
    )).nodeIds as [string, string];
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: brief, toNodeId: botNodeId("writer") }));
    const answer = await service.task("p1", auth, { botId: "writer", text: "Write it", references: [scene, brief, scene, "gone", botNodeId("lead")] });
    expect(answer).toMatchObject({ references: 2 });
    expect(sent.at(-1)?.text).toBe("Write it\n\nConnected to your node on the project's canvas:\n\nText 1 \"Brief\":\n\n> The swap.\n\nText 2 \"Scene\":\n\n> Rain on the steps.");
    expect(service.botView(service.project("p1")).connections.filter((one) => one.kind === "content" && one.toNodeId === botNodeId("writer"))).toHaveLength(1);
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", references: "scene" })).rejects.toMatchObject({ status: 400 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", references: [7] })).rejects.toMatchObject({ status: 400 });
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

  it("is numbered from the text node it was written in, as that node's panel numbers it, its own text first as the text to revise, and only a text node of this canvas takes it", async () => {
    const { service, project, sent } = setup();
    const [brief, scene, logline, take] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "Goes to the bot only" } },
      { type: "add_node", nodeType: "text", title: "Scene", metadata: { content: "Rain on the steps." } },
      { type: "add_node", nodeType: "text", title: "Logline", metadata: { content: "Draft" } },
      { type: "add_node", nodeType: "shot", title: "Shot 1" },
    )).nodeIds as [string, string, string, string];
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: brief, toNodeId: botNodeId("writer") }, { type: "connect_nodes", fromNodeId: scene, toNodeId: logline }));
    expect(await service.task("p1", auth, { botId: "writer", text: "Write the logline from @Text 2", targetNodeId: logline })).toMatchObject({ references: 1 });
    expect(sent.map((one) => one.text)).toEqual([
      "Revise the text according to the instructions.\n\nOriginal:\nText 1 \"Logline\":\n\n> Draft\n\nInstructions:\nWrite the logline from @Text 2"
      + "\n\nWhat the text node \"Logline\" on the project's canvas refers to:\n\nText 2 \"Scene\":\n\n> Rain on the steps.",
    ]);
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", targetNodeId: take })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", targetNodeId: "gone" })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", targetNodeId: 7 })).rejects.toMatchObject({ status: 400 });
    expect(sent).toHaveLength(1);
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

describe("a task in the project's group chat", () => {
  const ROOM = "room-thread";
  const inRoom = (memberIds: string[]) => {
    const world = setup();
    (world.project as { roomId?: string }).roomId = "room";
    world.groups.room = { id: "room", threadId: ROOM, memberIds, name: "Stand-in bride team chat" } as GroupRecord;
    return world;
  };
  const said = (botId: string, id: string, at: number, text: string): Message =>
    ({ id, at, role: "bot", kind: "text", text, turnTerminal: true, turnSucceeded: true, from: { botId, name: botId, color: "blue" } }) as Message;

  it("goes into the group chat for the bot it is for, unless the person names a conversation or the bot is not in it", async () => {
    const { service, sent, roomSent, groups } = inRoom(["lead", "writer"]);
    expect(await service.task("p1", auth, { botId: "writer", text: "Write it" })).toEqual({ threadId: ROOM, messageId: "room-sent-1", references: 0 });
    expect(roomSent).toEqual([{ groupId: "room", threadId: ROOM, to: [{ botId: "writer", name: "Writer", text: "Write it" }] }]);
    expect(sent).toEqual([]);

    await service.task("p1", auth, { botId: "writer", text: "Just here", threadId: "writer-main" });
    groups.room!.memberIds = ["lead"];
    await service.task("p1", auth, { botId: "writer", text: "Not in the room" });
    expect(sent.map((one) => [one.threadId, one.text])).toEqual([["writer-main", "Just here"], ["writer-main", "Not in the room"]]);
    expect(roomSent).toHaveLength(1);
  });

  it("keeps the person's own words as written, and makes plain the mentions in what it quotes", async () => {
    const { service, project, roomSent } = inRoom(["lead", "writer"]);
    const made = service.apply(project, person, opsOf({ type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "@Lead wants @everyone on it." } }));
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: made.nodeIds[0], toNodeId: botNodeId("writer") }));
    await service.task("p1", auth, { botId: "writer", text: "Write it from @Text 1" });
    expect(roomSent[0]!.to[0]!.text).toBe("Write it from @Text 1\n\nConnected to your node on the project's canvas:\n\nText 1 \"Brief\":\n\n> ＠Lead wants ＠everyone on it.");
  });

  it("fills the text node with the reply of the bot it was for, and not with another member's", async () => {
    const { service, project, roomsWorking } = inRoom(["lead", "writer"]);
    const [nodeId] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "text", title: "Logline" })).nodeIds;
    roomsWorking.add(ROOM);
    await service.task("p1", auth, { botId: "writer", text: "Write the logline", targetNodeId: nodeId });
    expect(service.snapshot("p1", auth).bots.writer!.writingInto).toEqual([nodeId]);
    service.taskLine(ROOM, said("lead", "lead-line", 12, "I will let the writer answer."));
    expect(nodeOf(service, nodeId!)?.metadata?.content).toBeUndefined();
    service.taskLine(ROOM, said("writer", "writer-line", 13, "A bride takes her sister's place."));
    expect(nodeOf(service, nodeId!)?.metadata?.content).toBe("A bride takes her sister's place.");
  });

  it("shows a task as written while the group chat works on it, and no more once it stopped working", async () => {
    const { service, project, roomsWorking } = inRoom(["lead", "writer"]);
    const [nodeId] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "text", title: "Logline" })).nodeIds;
    roomsWorking.add(ROOM);
    await service.task("p1", auth, { botId: "writer", text: "Write the logline", targetNodeId: nodeId });
    expect(service.snapshot("p1", auth).bots.writer!.writingInto).toEqual([nodeId]);
    roomsWorking.delete(ROOM);
    expect(service.snapshot("p1", auth).bots.writer!.writingInto).toBeUndefined();
  });

  it("shows on the canvas what each member says and does in the group chat", () => {
    const { service, threads, speakers } = inRoom(["lead", "writer"]);
    threads[ROOM] = [said("writer", "w1", 20, "The script is on the canvas."), said("lead", "l1", 21, "Thanks, the characters are next.")];
    speakers.set(ROOM, "writer");
    const { bots } = service.snapshot("p1", auth);
    expect(bots.writer).toMatchObject({ status: "working", output: { text: "The script is on the canvas.", threadId: ROOM, messageId: "w1" } });
    expect(bots.lead).toMatchObject({ status: "idle", output: { text: "Thanks, the characters are next.", threadId: ROOM } });
  });
});

describe("a task written in a text node", () => {
  const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
  const turnEnd = (requestMessageId: string, text: string, patch: Partial<Message> = {}): Message => ({
    id: `reply-to-${requestMessageId}`, at: 5, role: "bot", kind: "text", text, turnId: "t1", turnTerminal: true, turnSucceeded: true, requestMessageId, ...patch,
  });
  const textNodes = (service: ProjectCanvasService, project: TeamProjectWire, content: string | undefined, ...titles: string[]) =>
    service.apply(project, person, opsOf(...titles.map((title) => ({ type: "add_node", nodeType: "text", title, ...(content ? { metadata: { content } } : {}) })))).nodeIds;
  const contentOf = (service: ProjectCanvasService, id: string | undefined) => nodeOf(service, id!)?.metadata?.content;
  const beside = (service: ProjectCanvasService, id: string | undefined) => {
    const view = service.botView(service.project("p1"));
    const to = new Set(view.connections.filter((connection) => connection.fromNodeId === id && connection.kind === "content").map((connection) => connection.toNodeId));
    return view.nodes.filter((node) => to.has(node.id));
  };
  const writingInto = (service: ProjectCanvasService) => service.snapshot("p1", auth).bots.writer!.writingInto;
  const writingBeside = (service: ProjectCanvasService) => service.snapshot("p1", auth).bots.writer!.writingBeside;
  const numberedSends = (): ProjectCanvasServiceDeps["send"] => {
    let count = 0;
    return async (_auth, message) => {
      count += 1;
      return { ok: true, threadId: message.threadId, message: { id: `sent-${count}`, at: count, role: "user", kind: "text", text: message.text } };
    };
  };

  it("fills an empty text node with the bot's reply once its turn ends well, secrets redacted, and shows the bot writing into it until then", async () => {
    let busy = true;
    const { service, project, events } = setup({ threadBusy: () => busy });
    const [logline] = textNodes(service, project, undefined, "Logline");
    await service.task("p1", auth, { botId: "writer", text: "Write the logline", targetNodeId: logline });
    expect(writingInto(service)).toEqual([logline]);
    expect(writingBeside(service)).toBeUndefined();
    service.taskLine("writer-main", turnEnd("sent-1", "A bride swaps places.", { turnSucceeded: undefined }));
    expect(contentOf(service, logline)).toBeUndefined();
    busy = false;
    const told = events.length;
    service.taskLine("writer-main", turnEnd("sent-1", `A bride swaps places. Key: ${KEY}`));
    expect(contentOf(service, logline)).toMatch(/^A bride swaps places\. Key: «redacted/);
    expect(contentOf(service, logline)).not.toContain(KEY);
    expect(nodeOf(service, logline!)?.createdBy).toEqual(person);
    expect(beside(service, logline)).toEqual([]);
    expect(events.slice(told)).toEqual([{ kind: "project-canvas", projectId: "p1", revision: expect.any(Number), reason: "document" }]);
    expect(writingInto(service)).toBeUndefined();
  });

  it("shows the node a reply beside a text node with text becomes from the moment the task is sent, which the reply takes exactly, connected from the node that keeps its text", async () => {
    let busy = true;
    const { service, project, events } = setup({ threadBusy: () => busy });
    const [logline] = textNodes(service, project, "Draft", "Logline");
    const source = nodeOf(service, logline!)!;
    const request = "Make it one sentence,\nwith the rain and the ring in it";
    const told = events.length;
    await service.task("p1", auth, { botId: "writer", text: request, targetNodeId: logline });
    const [placeholder] = writingBeside(service)!;
    expect(writingBeside(service)).toEqual([{ id: expect.any(String), nodeId: logline, position: { x: source.position.x + source.width + LANE_GAP, y: source.position.y }, ...CANVAS_NODE_SIZE.text }]);
    expect(writingInto(service)).toBeUndefined();
    expect(events.slice(told)).toEqual([{ kind: "project-canvas", projectId: "p1", revision: expect.any(Number), reason: "bots" }]);
    expect(service.snapshot("p1", auth).nodes.map((node) => node.id)).not.toContain(placeholder!.id);
    expect(canvasStateText(service.botView(project), "writer", {})).not.toContain(`"${placeholder!.id}"`);
    busy = false;
    const replied = events.length;
    service.taskLine("writer-main", turnEnd("sent-1", `Rain, a ring, a swap. Key: ${KEY}`));
    expect(contentOf(service, logline)).toBe("Draft");
    const [first] = beside(service, logline);
    expect(first).toMatchObject({
      id: placeholder!.id, type: "text", title: "Make it one sentence, with the r", position: placeholder!.position, width: placeholder!.width, height: placeholder!.height,
      createdBy: writer, metadata: { content: expect.stringMatching(/^Rain, a ring, a swap\. Key: «redacted/) },
    });
    expect(first!.metadata!.content).not.toContain(KEY);
    expect(events.slice(replied)).toEqual([{ kind: "project-canvas", projectId: "p1", revision: expect.any(Number), reason: "document" }]);
    expect(writingBeside(service)).toBeUndefined();
    busy = true;
    await service.task("p1", auth, { botId: "writer", text: "Shorter", targetNodeId: logline });
    const [next] = writingBeside(service)!;
    expect(next!.position).toEqual({ x: first!.position.x, y: first!.position.y + first!.height + NODE_GAP });
    service.taskLine("writer-main", turnEnd("sent-1", "Rain, a swap."));
    expect(beside(service, logline).find((node) => node.id !== first!.id)).toMatchObject({ id: next!.id, title: "Shorter", position: next!.position, metadata: { content: "Rain, a swap." } });
    expect(contentOf(service, logline)).toBe("Draft");
  });

  it("gives two pending revisions of a node two placeholders that do not overlap, each taken by its own reply whichever turn ends first", async () => {
    const { service, project } = setup({ threadBusy: () => true, send: numberedSends() });
    const [logline] = textNodes(service, project, "Draft", "Logline");
    await service.task("p1", auth, { botId: "writer", text: "Shorter", targetNodeId: logline });
    await service.task("p1", auth, { botId: "lead", text: "Darker", targetNodeId: logline });
    const { writer: shorter, lead: darker } = service.snapshot("p1", auth).bots;
    const [mine, theirs] = [shorter!.writingBeside![0]!, darker!.writingBeside![0]!];
    expect(theirs.position).toEqual({ x: mine.position.x, y: mine.position.y + mine.height + NODE_GAP });
    service.taskLine("lead-main", turnEnd("sent-2", "Darker now"));
    expect(writingBeside(service)).toEqual([mine]);
    service.taskLine("writer-main", turnEnd("sent-1", "Shorter now"));
    expect(beside(service, logline)).toEqual([
      expect.objectContaining({ id: theirs.id, position: theirs.position, metadata: { content: "Darker now" } }),
      expect.objectContaining({ id: mine.id, position: mine.position, metadata: { content: "Shorter now" } }),
    ]);
  });

  it("shows a queued task while its message waits, and neither shows nor takes a reply for a task from the moment it is merged into a later message's turn, taken out of the queue, or steered into a running turn", async () => {
    let receipt: DirectSendReceipt = { ok: true, queued: true, queueId: "q1", threadId: "writer-main" };
    const queue = new Set(["q1"]);
    const { service, project } = setup({ send: async () => receipt, stillQueued: (_botId, _threadId, queueId) => queue.has(queueId), threadBusy: () => true });
    const [logline, notes] = textNodes(service, project, undefined, "Logline", "Notes");
    const [draft] = textNodes(service, project, "Draft", "Synopsis");
    await service.task("p1", auth, { botId: "writer", text: "Write the logline", targetNodeId: logline });
    expect(writingInto(service)).toEqual([logline]);
    queue.clear();
    service.taskLine("writer-main", { id: "m7", at: 7, role: "user", kind: "text", text: "Write the logline", queueId: "q1" });
    expect(writingInto(service)).toEqual([logline]);
    service.taskLine("writer-main", turnEnd("m7", "Swapped at the altar.", { at: 9 }));
    expect(contentOf(service, logline)).toBe("Swapped at the altar.");

    for (const queueId of ["q2", "q3"]) {
      receipt = { ok: true, queued: true, queueId, threadId: "writer-main" };
      queue.add(queueId);
      await service.task("p1", auth, { botId: "writer", text: `Revise ${queueId}`, targetNodeId: draft });
    }
    const [merged, kept] = writingBeside(service)!;
    expect(kept!.position.y).toBe(merged!.position.y + merged!.height + NODE_GAP);
    queue.clear();
    service.taskLine("writer-main", { id: "m10", at: 10, role: "user", kind: "text", text: "Revise q2", queueId: "q2" });
    service.taskLine("writer-main", { id: "m11", at: 11, role: "user", kind: "text", text: "Revise q3", queueId: "q3" });
    expect(writingBeside(service)).toEqual([kept]);
    service.taskLine("writer-main", turnEnd("m11", "Both at once.", { at: 12 }));
    expect(beside(service, draft)).toEqual([expect.objectContaining({ id: kept!.id, position: kept!.position, metadata: { content: "Both at once." } })]);
    expect(writingBeside(service)).toBeUndefined();

    receipt = { ok: true, queued: true, queueId: "q4", threadId: "writer-main" };
    queue.add("q4");
    await service.task("p1", auth, { botId: "writer", text: "Drop this", targetNodeId: draft });
    expect(writingBeside(service)).toHaveLength(1);
    queue.delete("q4");
    expect(writingBeside(service)).toBeUndefined();

    receipt = { ok: true, threadId: "writer-main", message: { id: "m13", at: 13, role: "user", kind: "text", text: "Notes too" }, steered: true };
    await service.task("p1", auth, { botId: "writer", text: "Notes too", targetNodeId: notes });
    await service.task("p1", auth, { botId: "writer", text: "Synopsis too", targetNodeId: draft });
    expect(writingInto(service)).toBeUndefined();
    expect(writingBeside(service)).toBeUndefined();
    service.taskLine("writer-main", turnEnd("m13", "Both done.", { at: 14 }));
    expect(contentOf(service, notes)).toBeUndefined();
    expect(beside(service, notes)).toEqual([]);
    expect(beside(service, draft)).toHaveLength(1);
  });

  it("adds nothing and shows nothing after a turn that fails or is stopped, with or without a line of its own, the end of a later message's turn, on an archived canvas, and once the node is gone", async () => {
    const { service, project, events } = setup({ threadBusy: () => true });
    const [logline, empty] = [...textNodes(service, project, "Draft", "Logline"), ...textNodes(service, project, undefined, "Empty")];
    const ask = (targetNodeId = logline) => service.task("p1", auth, { botId: "writer", text: "Write it", targetNodeId });
    await ask(empty);
    service.taskLine("writer-main", turnEnd("sent-1", "Half a line", { turnSucceeded: false }));
    expect(contentOf(service, empty)).toBeUndefined();
    expect(writingInto(service)).toBeUndefined();
    await ask();
    service.taskLine("writer-main", turnEnd("earlier", "An older reply, changed again", { at: 0 }));
    expect(writingBeside(service)).toEqual([expect.objectContaining({ nodeId: logline })]);
    service.taskLine("writer-main", turnEnd("sent-1", "Half a line", { turnSucceeded: false }));
    expect(writingBeside(service)).toBeUndefined();
    await ask();
    service.taskLine("writer-main", { id: "stopped", at: 2, role: "bot", kind: "activity", tool: { name: PERSON_STOPPED_TURN_NAME, ok: true }, turnId: "t1" });
    expect(writingBeside(service)).toBeUndefined();
    await ask(empty);
    service.taskLine("writer-main", { id: "failed", at: 2, role: "bot", kind: "activity", tool: failedTurnTool("The engine stopped answering.") });
    expect(writingInto(service)).toBeUndefined();
    service.taskLine("writer-main", turnEnd("sent-1", "After it failed"));
    expect(contentOf(service, empty)).toBeUndefined();
    expect(beside(service, logline)).toEqual([]);
    await ask();
    service.taskLine("writer-main", turnEnd("later", "A reply to a later message"));
    expect(writingBeside(service)).toBeUndefined();
    service.taskLine("writer-main", turnEnd("sent-1", "Too late"));
    await ask();
    project.archivedAt = 9;
    service.taskLine("writer-main", turnEnd("sent-1", "Into an archived canvas"));
    delete project.archivedAt;
    expect(contentOf(service, logline)).toBe("Draft");
    expect([...beside(service, logline), ...beside(service, empty)]).toEqual([]);
    await ask();
    service.apply(project, person, opsOf({ type: "delete_node", id: logline }));
    expect(writingBeside(service)).toBeUndefined();
    const told = events.length;
    service.taskLine("writer-main", turnEnd("sent-1", "Into nothing"));
    expect(nodeOf(service, logline!)).toBeUndefined();
    expect(events.slice(told)).toEqual([]);
  });

  it("adds and shows nothing for a task whose turn ends after a restart", async () => {
    const before = setup();
    const [logline, empty] = [...textNodes(before.service, before.project, "Draft", "Logline"), ...textNodes(before.service, before.project, undefined, "Empty")];
    await before.service.task("p1", auth, { botId: "writer", text: "Write it", targetNodeId: logline });
    await before.service.task("p1", auth, { botId: "writer", text: "Write it", targetNodeId: empty });
    const after = setup({ threadBusy: () => true });
    expect(writingInto(after.service)).toBeUndefined();
    expect(writingBeside(after.service)).toBeUndefined();
    const told = after.events.length;
    after.service.taskLine("writer-main", turnEnd("sent-1", "After the restart"));
    expect(contentOf(after.service, logline)).toBe("Draft");
    expect(contentOf(after.service, empty)).toBeUndefined();
    expect([...beside(after.service, logline), ...beside(after.service, empty)]).toEqual([]);
    expect(after.events.slice(told)).toEqual([]);
  });

  it("decides when the task is sent whether its reply fills the node: one given text meanwhile gets the reply beside it, one emptied meanwhile gets it in its placeholder", async () => {
    const { service, project } = setup({ threadBusy: () => true, send: numberedSends() });
    const [draft] = textNodes(service, project, "Draft", "Synopsis");
    const [empty] = textNodes(service, project, undefined, "Empty");
    await service.task("p1", auth, { botId: "writer", text: "Write it", targetNodeId: empty });
    expect(writingInto(service)).toEqual([empty]);
    service.apply(project, person, opsOf({ type: "update_node", id: empty, metadata: { content: "Typed meanwhile" } }));
    service.taskLine("writer-main", turnEnd("sent-1", "The bot's line", { at: 1 }));
    const source = nodeOf(service, empty!)!;
    expect(source.metadata?.content).toBe("Typed meanwhile");
    expect(beside(service, empty)).toEqual([expect.objectContaining({ title: "Write it", position: { x: source.position.x + source.width + LANE_GAP, y: source.position.y }, metadata: { content: "The bot's line" } })]);
    await service.task("p1", auth, { botId: "writer", text: "Shorter", targetNodeId: draft });
    const [placeholder] = writingBeside(service)!;
    service.apply(project, person, opsOf({ type: "update_node", id: draft, metadata: { content: null } }));
    service.taskLine("writer-main", turnEnd("sent-2", "Shorter now", { at: 2 }));
    expect(contentOf(service, draft)).toBeUndefined();
    expect(beside(service, draft)).toEqual([expect.objectContaining({ id: placeholder!.id, position: placeholder!.position, metadata: { content: "Shorter now" } })]);
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
  const empty = (prompt = "A bride alone at the altar") => ({ type: "add_node", nodeType: "video", metadata: { prompt } });

  const file = (path: string, mime = "image/png"): CanvasFileRef => ({ path, mime, bytes: 3, name: path.split("/").at(-1)! });

  it("starts the node's prompt, settings and title with the files connected into it, and shows the node loading", async () => {
    const { service, project, generation } = setup();
    const [still, song, poster] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", metadata: { file: file("refs/still.png") } },
      { type: "add_node", nodeType: "audio", metadata: { file: file("refs/song.mp3", "audio/mpeg") } },
      { type: "add_node", nodeType: "image", title: " Poster ", metadata: { prompt: "A poster", settings: { aspect: "16:9", count: 2 } } },
    )).nodeIds as [string, string, string];
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: still, toNodeId: poster }, { type: "connect_nodes", fromNodeId: song, toNodeId: poster }));
    const take = service.apply(project, person, opsOf(empty())).nodeIds[0]!;
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
    const [, take] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "image", groupId: refs, metadata: { file: file("refs/veil.png") } }, empty())).nodeIds as [string, string];
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
    const id = service.apply(project, person, opsOf({ ...empty(), metadata: { prompt: "A bride", ...timedOut, jobId: "old" } })).nodeIds[0]!;
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

  it("fills an empty image or video node with the first file of its kind, and puts each other one to its right", async () => {
    const { service, project, generation } = setup();
    const [poster, clip] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", title: "Poster", metadata: { prompt: "A poster", settings: { count: 2 } } },
      { type: "add_node", nodeType: "video", title: "Clip", metadata: { prompt: "Rain" } },
    )).nodeIds as [string, string];
    await service.generate(project, person, poster);
    await service.generate(project, person, clip);
    const done: GenerationJob = { ...generation.jobs.get("job-1")!, status: "done", files: [file("产出/图片/a.png"), file("产出/图片/b.png")] };
    service.jobChanged(done);
    service.jobChanged(done);
    service.jobChanged({ ...generation.jobs.get("job-2")!, status: "done", files: [file("产出/视频/a.mp4", "video/mp4")] });
    const view = service.botView(project);
    const filled = view.nodes.find((one) => one.id === poster)!;
    expect(filled).toMatchObject({ type: "image", title: "Poster", metadata: { prompt: "A poster", settings: { count: 2 }, status: "success", jobId: "job-1", file: file("产出/图片/a.png") } });
    expect(nodeOf(service, clip)!.metadata).toEqual({ prompt: "Rain", status: "success", jobId: "job-2", file: file("产出/视频/a.mp4", "video/mp4") });
    const made = view.nodes.filter((one) => one.metadata?.file && one.id !== poster && one.id !== clip);
    expect(made.map((one) => [one.type, one.metadata!.file!.path])).toEqual([["image", "产出/图片/b.png"]]);
    expect(made[0]!.position.x).toBe(filled.position.x + filled.width + 80);
    expect(view.connections.filter((one) => one.fromNodeId === poster || one.fromNodeId === clip)).toEqual([expect.objectContaining({ fromNodeId: poster, toNodeId: made[0]!.id, kind: "content" })]);
  });

  it("sends an image node's own picture first, as Image 1, and puts what it makes to its right; a video node never sends its own clip", async () => {
    const { service, project, generation } = setup();
    const [cover, still, take] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", title: "Cover", metadata: { file: file("refs/cover.png"), prompt: "@Image 1 at night, the veil from @Image 2" } },
      { type: "add_node", nodeType: "image", metadata: { file: file("refs/still.png") } },
      { type: "add_node", nodeType: "video", metadata: { file: file("refs/take.mp4", "video/mp4"), prompt: "Slower" } },
    )).nodeIds as [string, string, string];
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: still, toNodeId: cover }, { type: "connect_nodes", fromNodeId: still, toNodeId: take }));
    await service.generate(project, person, cover);
    await service.generate(project, person, take);
    const labels = (names: string) => `Reference image labels: ${names}. Use these labels to interpret image references in the prompt.`;
    expect(generation.started.map((one) => [one.input.prompt, one.input.references])).toEqual([
      [`${labels("Image 1, Image 2")}\n\n@Image 1 at night, the veil from @Image 2`, { images: ["refs/cover.png", "refs/still.png"], audio: [] }],
      [`${labels("Image 1")}\n\nSlower`, { images: ["refs/still.png"], audio: [] }],
    ]);
    service.jobChanged({ ...generation.jobs.get("job-1")!, status: "done", files: [file("产出/图片/night.png")] });
    service.jobChanged({ ...generation.jobs.get("job-2")!, status: "done", files: [file("产出/视频/slow.mp4", "video/mp4")] });
    expect(nodeOf(service, cover)!.metadata!.file).toEqual(file("refs/cover.png"));
    expect(nodeOf(service, take)!.metadata!.file).toEqual(file("refs/take.mp4", "video/mp4"));
    const view = service.botView(project);
    for (const [from, path] of [[cover, "产出/图片/night.png"], [take, "产出/视频/slow.mp4"]] as const) {
      const made = view.nodes.find((one) => one.metadata?.file?.path === path)!;
      expect(made.position.x).toBeGreaterThan(nodeOf(service, from)!.position.x);
      expect(view.connections).toContainEqual(expect.objectContaining({ fromNodeId: from, toNodeId: made.id, kind: "content" }));
    }
  });

  it("puts a failure on its node in English and as generation's key and values, and a cancelled job leaves the node idle", async () => {
    const { service, project, generation } = setup();
    const [failed, cancelled] = service.apply(project, person, opsOf(empty(), empty())).nodeIds as [string, string];
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
