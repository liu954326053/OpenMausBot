import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { botNodeId, type CanvasFileRef, type CanvasGenerationUpdate, type CanvasOp, type ProjectCanvasEvent } from "../../shared/project-canvas.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord, Message, TaskRecord } from "../store.ts";
import { CanvasDocuments } from "./document-store.ts";
import { parseCanvasOps } from "./ops.ts";
import { BOT_GENERATIONS_AT_ONCE, CanvasRefusal, canvasRefusalOf, ProjectCanvasService, type ProjectCanvasServiceDeps } from "./service.ts";

let dir: string;
let folder: string;
const auth = {} as RequestAuth;
const person = { kind: "person" } as const;
const writer = { kind: "bot", botId: "writer" } as const;

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
    startGeneration: async () => {
      throw new CanvasRefusal(503, { error: "Generation is not set up yet." });
    },
    openCards: () => [],
    queuedThreads: () => new Set(),
    saveImage: () => ({ path: join(dir, "attachments", "saved.png") }),
    newId: () => `id-${++next}`,
    log: () => undefined,
    ...patch,
  });
  return { service, project, events, sent, threads };
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
    expect(sent).toEqual([{ botId: "writer", threadId: "writer-main", text: "Write it\n\nConnected to your node on the project's canvas:\n\nText \"Brief\":\n\n> The swap." }]);
  });

  it("is refused for a bot outside the project, a conversation the person cannot open, and nothing to say", async () => {
    const { service } = setup();
    await expect(service.task("p1", auth, { botId: "plain", text: "Go" })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "Go", threadId: "lead-main" })).rejects.toMatchObject({ status: 404 });
    await expect(setup({ visibleFor: () => ({ thread: () => false }) }).service.task("p1", auth, { botId: "writer", text: "Go" })).rejects.toMatchObject({ status: 404 });
    await expect(service.task("p1", auth, { botId: "writer", text: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(service.task("p1", auth, { botId: "writer" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("generating a node", () => {
  const shot = (prompt = "A bride alone at the altar") => ({ type: "add_node", nodeType: "shot", metadata: { prompt } });

  it("is refused while generation is not set up, and leaves the node as it was", async () => {
    const { service, project } = setup();
    const id = service.apply(project, person, opsOf(shot())).nodeIds[0]!;
    await expect(service.generate(project, person, id)).rejects.toMatchObject({ status: 503, message: "Generation is not set up yet." });
    expect(nodeOf(service, id)!.metadata).toEqual({ prompt: "A bride alone at the altar" });
  });

  it("lets a bot ask only for its own nodes, and a few at a time", async () => {
    let jobs = 0;
    const { service, project } = setup({ startGeneration: async () => ({ jobId: `job-${++jobs}` }) });
    const theirs = service.apply(project, person, opsOf(shot())).nodeIds[0]!;
    await expect(service.generate(project, writer, theirs)).rejects.toMatchObject({ code: "not_yours" });
    const mine = service.apply(project, writer, opsOf(...Array.from({ length: BOT_GENERATIONS_AT_ONCE + 1 }, () => shot()))).nodeIds;
    for (const id of mine.slice(0, BOT_GENERATIONS_AT_ONCE)) expect(await service.generate(project, writer, id)).toEqual({ jobId: expect.stringMatching(/^job-/) });
    await expect(service.generate(project, writer, mine.at(-1))).rejects.toMatchObject({ status: 429 });
    await expect(service.generate(project, writer, mine[0])).rejects.toMatchObject({ status: 409 });
    expect(nodeOf(service, mine[0]!)!.metadata).toMatchObject({ status: "loading", jobId: "job-1" });
  });

  it("puts a finished job's first file in an empty image node and the rest to its right, connected from it", async () => {
    let told!: (update: CanvasGenerationUpdate) => void;
    const { service, project } = setup({ startGeneration: async (_request, onUpdate) => { told = onUpdate; return { jobId: "j1" }; } });
    const id = service.apply(project, person, opsOf({ type: "add_node", nodeType: "image", position: { x: 0, y: 0 }, metadata: { prompt: "A poster" } })).nodeIds[0]!;
    await service.generate(project, person, id);
    const file = (name: string): CanvasFileRef => ({ path: `产出/${name}`, mime: "image/png", bytes: 3, name });
    told({ projectId: "p1", nodeId: id, jobId: "other", status: "success", outputs: [file("stray.png")] });
    told({ projectId: "p1", nodeId: id, jobId: "j1", status: "success", outputs: [file("a.png"), file("b.png")] });
    const view = service.botView(project);
    const node = view.nodes.find((one) => one.id === id)!;
    expect(node.metadata).toEqual({ prompt: "A poster", status: "success", jobId: "j1", file: file("a.png") });
    const rest = view.nodes.find((one) => one.metadata?.file?.name === "b.png")!;
    expect(rest).toMatchObject({ type: "image", position: { x: node.position.x + node.width + 80, y: node.position.y }, createdBy: person });
    expect(view.connections).toContainEqual(expect.objectContaining({ fromNodeId: id, toNodeId: rest.id, kind: "content" }));
    expect(view.nodes.some((one) => one.metadata?.file?.name === "stray.png")).toBe(false);
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
