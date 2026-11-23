import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CanvasFileRef, CanvasNode, CanvasOp, CanvasSnapshot, ProjectCanvasEvent } from "../../shared/project-canvas.ts";
import { DEFAULT_GENERATION_SETTINGS, type GenerationFailure, type GenerationJob, type GenerationRequester, type StartGenerationInput } from "../../shared/project-generation.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { BotRecord, TaskRecord } from "../store.ts";
import { CanvasDocuments } from "./document-store.ts";
import type { ProjectPipeline } from "./flow.ts";
import { parseCanvasOps } from "./ops.ts";
import { createCanvasPipeline, type CanvasPipelineEvent } from "./pipeline-api.ts";
import { LANE_GAP, NODE_GAP } from "./placement.ts";
import { canvasRefusalOf, ProjectCanvasService, type ProjectCanvasServiceDeps } from "./service.ts";

let dir: string;
let folder: string;
const auth = {} as RequestAuth;
const person = { kind: "person" } as const;
const bot = (botId: string) => ({ kind: "bot", botId }) as const;
const boards = bot("boards");

const DRAMA: ProjectPipeline = {
  stages: { lead: ["lead"], writer: ["script"], faces: ["character"], boards: ["storyboard"], editor: ["post"] },
  lines: [{ from: "lead", to: "writer" }, { from: "writer", to: "faces" }, { from: "writer", to: "boards" }, { from: "faces", to: "boards" }, { from: "boards", to: "editor" }],
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-pipeline-")));
  folder = join(dir, "Stand-in bride");
  mkdirSync(join(folder, "产出"), { recursive: true });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A drama of episodes: the first two have a storyboard bot and a post bot of their own. */
const EPISODES: { pipeline: ProjectPipeline; episodeBots: TeamProjectWire["episodeBots"] } = {
  pipeline: {
    stages: { lead: ["lead"], writer: ["script"], faces: ["character"], sets: ["scene"], "boards-1": ["storyboard"], "boards-2": ["storyboard"], "editor-1": ["post"], "editor-2": ["post"] },
    lines: [{ from: "lead", to: "writer" }, { from: "writer", to: "faces" }, { from: "writer", to: "sets" }],
  },
  episodeBots: {
    "boards-1": { number: 1, job: "storyboard" }, "boards-2": { number: 2, job: "storyboard" }, "editor-1": { number: 1, job: "post" }, "editor-2": { number: 2, job: "post" },
  },
};

function setup(pipeline: ProjectPipeline = structuredClone(DRAMA), episodeBots: TeamProjectWire["episodeBots"] = {}) {
  const broadcasts: ProjectCanvasEvent[] = [];
  const told: CanvasPipelineEvent[] = [];
  const botIds = Object.keys({ lead: true, ...pipeline.stages });
  const project: TeamProjectWire = { id: "p1", name: "Stand-in bride", folder, section: "Stand-in bride", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds, follows: {}, episodeBots };
  const jobs = new Map<string, GenerationJob>();
  const started: Array<{ input: StartGenerationInput; requester: GenerationRequester }> = [];
  let next = 0;
  const current = { pipeline };
  const service = new ProjectCanvasService({
    store: {
      bot: (id) => (botIds.includes(id) ? { id, name: id, threadId: `${id}-main`, teamProject: { id: "p1", role: id } } : null) as BotRecord | null,
      botByThread: () => null,
      tasks: () => [] as TaskRecord[],
      taskByThread: () => undefined,
      messagesTail: () => ({ messages: [], hasMore: false, activeLeafId: null }),
      group: () => undefined,
    },
    projects: { list: () => [project] },
    documents: new CanvasDocuments(join(dir, "canvases"), () => undefined),
    broadcast: (event) => broadcasts.push(event),
    visibleFor: () => ({ thread: () => true }),
    threadBusy: () => false,
    mainThread: () => undefined,
    send: async () => { throw new Error("no task is sent here"); },
    sendToRoom: () => { throw new Error("no task is sent here"); },
    roomSpeaker: () => undefined,
    roomWorking: () => false,
    pipelineOf: () => current.pipeline,
    generation: {
      start: async (projectId, input, { requester }) => {
        started.push({ input, requester });
        const job = {
          id: `job-${jobs.size + 1}`, projectId, nodeId: input.nodeId, kind: "video", settings: DEFAULT_GENERATION_SETTINGS.video.defaults, status: "queued", requester, prompt: input.prompt,
          references: { images: [], audio: [] }, server: "gen", tool: "generate_video", files: [], createdAt: 1, updatedAt: 1,
        } satisfies GenerationJob;
        jobs.set(job.id, job);
        return { job };
      },
      job: (_projectId, jobId) => jobs.get(jobId) ?? null,
    },
    openCards: () => [],
    queuedThreads: () => new Set(),
    stillQueued: () => false,
    saveImage: () => ({ path: join(dir, "saved.png") }),
    language: () => undefined,
    newId: () => `id-${++next}`,
    log: () => undefined,
  } satisfies ProjectCanvasServiceDeps);
  const pipelineApi = createCanvasPipeline(service);
  pipelineApi.on((event) => told.push(event));
  const view = (): CanvasSnapshot => service.botView(project);
  const find = (id: string): CanvasNode | undefined => view().nodes.find((node) => node.id === id);
  const links = (id: string) => view().connections.filter((one) => one.kind === "content" && (one.fromNodeId === id || one.toNodeId === id))
    .map((one) => `${one.fromNodeId} ${one.pipeline ? "=>" : "->"} ${one.toNodeId}`);
  const creationOf = (shotId: string) => view().nodes.find((node) => node.metadata?.role === "creation" && node.metadata.shotId === shotId)!;
  const takesOf = (shotId: string) => view().nodes.filter((node) => node.metadata?.role === "take" && node.metadata.shotId === shotId);
  const addShot = (title: string, prompt: string, actor: typeof person | ReturnType<typeof bot> = boards, extra: Record<string, unknown> = {}) =>
    service.apply(project, actor, opsOf({ type: "add_node", nodeType: "shot", title, metadata: { prompt, ...extra } })).nodeIds[0]!;
  /** Generates the node and ends its job as the generation would. */
  const generated = async (nodeId: string, end: Partial<GenerationJob> = {}) => {
    const outcome = await service.generate(project, person, nodeId);
    if (!("job" in outcome)) throw new Error("refused");
    const done = { ...jobs.get(outcome.job.id)!, status: "done", files: [video(`${outcome.job.id}.mp4`)], ...end } as GenerationJob;
    service.jobChanged(done);
    return done;
  };
  return { service, pipeline: pipelineApi, project, broadcasts, told, started, jobs, current, view, find, links, creationOf, takesOf, addShot, generated };
}

const opsOf = (...ops: unknown[]): CanvasOp[] => parseCanvasOps(ops);
const video = (name: string): CanvasFileRef => ({ path: `产出/视频/${name}`, mime: "video/mp4", bytes: 3, name });
const image = (name: string): CanvasFileRef => ({ path: `素材/${name}`, mime: "image/png", bytes: 3, name });
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return canvasRefusalOf(error);
  }
  throw new Error("expected a refusal");
};

describe("a shot on a project's canvas", () => {
  it("gets its creation node when a storyboard bot adds it, the links made by the server, and the bot cannot take them away", () => {
    const { service, project, find, links, creationOf, addShot } = setup();
    const shotId = addShot("Shot 1", "Veil, dawn", boards, { settings: { seconds: 10 } });
    const creation = creationOf(shotId);
    expect(creation).toMatchObject({ type: "config", title: "Shot 1", createdBy: boards, metadata: { generationMode: "video", role: "creation", shotId, settings: { seconds: 10 } } });
    expect(creation.position).toEqual({ x: find(shotId)!.position.x + 340 + LANE_GAP, y: find(shotId)!.position.y });
    expect(links(shotId)).toEqual([`bot:boards => ${shotId}`, `${shotId} => ${creation.id}`]);
    const [fromBot, toCreation] = service.botView(project).connections.filter((one) => one.pipeline).map((one) => one.id);
    for (const id of [fromBot, toCreation]) expect(refusal(() => service.apply(project, boards, opsOf({ type: "delete_connections", id })))?.body).toMatchObject({ code: "not_allowed" });
    service.apply(project, person, opsOf({ type: "delete_connections", id: toCreation }));
    service.apply(project, person, opsOf({ type: "add_node", nodeType: "text", title: "Note" }));
    expect(links(shotId)).toEqual([`bot:boards => ${shotId}`]);
  });

  it("gets one when the person adds it, and each of two storyboard bots' shots gets its own", () => {
    const { creationOf, addShot, links } = setup({ ...DRAMA, stages: { ...DRAMA.stages, faces: ["storyboard"] } });
    const [mine, first, second] = [addShot("Mine", "Ring", person), addShot("A", "Veil"), addShot("B", "Altar", bot("faces"))];
    expect(creationOf(mine)).toMatchObject({ createdBy: person, metadata: { shotId: mine } });
    expect(creationOf(first)).toMatchObject({ createdBy: boards });
    expect(creationOf(second)).toMatchObject({ createdBy: bot("faces") });
    expect(links(mine)).toEqual([`${mine} => ${creationOf(mine).id}`]);
    expect(links(second)).toEqual([`bot:faces => ${second}`, `${second} => ${creationOf(second).id}`]);
  });

  it("generates through its creation node whoever asks, from the shot's prompt and title and the creation node's settings and references", async () => {
    const { service, project, started, jobs, find, creationOf, addShot } = setup();
    const shotId = addShot("Shot 1", "Veil, dawn", boards, { settings: { seconds: 10 } });
    const creation = creationOf(shotId);
    const [face, hum] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "image", metadata: { file: image("face.png") } }, { type: "add_node", nodeType: "audio", metadata: { file: { ...image("hum.mp3"), mime: "audio/mpeg" } } },
    )).nodeIds as [string, string];
    service.apply(project, boards, opsOf({ type: "connect_nodes", fromNodeId: face, toNodeId: shotId }));
    service.apply(project, person, opsOf({ type: "connect_nodes", fromNodeId: hum, toNodeId: creation.id }, { type: "update_node", id: creation.id, metadata: { settings: { seconds: 5, resolution: "1080p" } } }));
    await service.generate(project, boards, shotId);
    const numbering = [
      "Reference image labels: Image 1. Use these labels to interpret image references in the prompt.",
      "Reference audio labels: Audio 1. Use these labels to interpret audio references in the prompt.",
    ].join("\n");
    const input = { kind: "video", nodeId: creation.id, prompt: `${numbering}\n\nVeil, dawn`, references: { images: ["素材/face.png"], audio: ["素材/hum.mp3"] }, overrides: { seconds: 5, resolution: "1080p" }, name: "Shot 1" };
    expect(started).toEqual([{ input, requester: boards }]);
    expect(find(creation.id)?.metadata).toMatchObject({ status: "loading", jobId: "job-1" });
    expect(find(shotId)?.metadata).toEqual({ prompt: "Veil, dawn", settings: { seconds: 10 } });
    await expect(service.generate(project, person, shotId)).rejects.toMatchObject({ status: 409 });
    service.jobChanged({ ...jobs.get("job-1")!, status: "cancelled" });
    await service.generate(project, person, creation.id);
    expect(started[1]).toEqual({ input, requester: person });
  });

  it("is refused to a bot that did not make it, and without a prompt, and generates as before when it has no creation node", async () => {
    const { service, project, started, addShot, creationOf, find, view } = setup();
    const shotId = addShot("Shot 1", "Veil");
    await expect(service.generate(project, bot("writer"), shotId)).rejects.toMatchObject({ code: "not_yours" });
    await expect(service.generate(project, bot("writer"), creationOf(shotId).id)).rejects.toMatchObject({ code: "not_yours" });
    const blank = addShot("Shot 2", "  ");
    await expect(service.generate(project, person, blank)).rejects.toMatchObject({ status: 400, body: { code: "no_prompt" } });
    await expect(service.generate(project, person, creationOf(blank).id)).rejects.toMatchObject({ status: 400, body: { code: "no_prompt" } });

    const loose = addShot("Sketch", "A sketch", bot("writer"));
    expect(view().nodes.filter((node) => node.metadata?.shotId === loose)).toEqual([]);
    await service.generate(project, bot("writer"), loose);
    expect(started.at(-1)!.input).toMatchObject({ nodeId: loose, prompt: "A sketch" });
    service.jobChanged({ ...jobOf("job-1", loose), files: [video("sketch.mp4")] });
    const made = view().nodes.find((node) => node.metadata?.file?.name === "sketch.mp4")!;
    expect(made.metadata).toEqual({ file: video("sketch.mp4") });
    expect(made.position.x).toBe(find(loose)!.position.x + 340 + LANE_GAP);
  });
});

const jobOf = (id: string, nodeId: string): GenerationJob => ({
  id, projectId: "p1", nodeId, kind: "video", settings: DEFAULT_GENERATION_SETTINGS.video.defaults, status: "done", requester: person, prompt: "",
  references: { images: [], audio: [] }, server: "gen", tool: "generate_video", files: [], createdAt: 1, updatedAt: 2,
});

describe("a shot's takes", () => {
  it("land to the right of the creation node, a later one below, the newest selected and sent on to post", async () => {
    const { told, find, links, creationOf, takesOf, addShot, generated } = setup();
    const shotId = addShot("Shot 1", "Veil");
    const creation = creationOf(shotId);
    told.length = 0;
    await generated(shotId);
    const [first] = takesOf(shotId);
    expect(first).toMatchObject({
      type: "video", title: "job-1.mp4", createdBy: boards, position: { x: creation.position.x + 340 + LANE_GAP, y: creation.position.y },
      metadata: { file: video("job-1.mp4"), role: "take", shotId, selected: true },
    });
    expect(links(first!.id)).toEqual([`${creation.id} => ${first!.id}`, `${first!.id} => bot:editor`]);
    expect(find(creation.id)?.metadata).toMatchObject({ status: "success" });
    expect(told).toEqual([
      { kind: "role", projectId: "p1", role: "take", nodeId: first!.id, shotId },
      { kind: "selected", projectId: "p1", shotId, nodeId: first!.id },
      { kind: "take", projectId: "p1", shotId, creationNodeId: creation.id, jobId: "job-1", ok: true, nodeId: first!.id },
    ]);

    await generated(creation.id);
    const [, second] = takesOf(shotId);
    expect(second).toMatchObject({ position: { x: first!.position.x, y: first!.position.y + 236 + NODE_GAP }, metadata: { selected: true } });
    expect(find(first!.id)?.metadata).not.toHaveProperty("selected");
    expect(links(first!.id)).toEqual([`${creation.id} => ${first!.id}`]);
    expect(links(second!.id)).toEqual([`${creation.id} => ${second!.id}`, `${second!.id} => bot:editor`]);
  });

  it("are none when the generation fails: the creation node says why, the selected take stays, and the failure is told", async () => {
    const { service, project, told, find, creationOf, takesOf, addShot, generated, jobs } = setup();
    const shotId = addShot("Shot 1", "Veil");
    const creation = creationOf(shotId);
    await generated(shotId);
    told.length = 0;
    const failure: GenerationFailure = { code: "task_failed", error: "gen failed the task: out of credit.", errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "out of credit" } };
    await service.generate(project, person, shotId);
    service.jobChanged({ ...jobs.get("job-2")!, status: "failed", failure });
    expect(takesOf(shotId).map((take) => take.metadata?.selected)).toEqual([true]);
    expect(find(creation.id)?.metadata).toMatchObject({ status: "error", errorDetails: failure.error, errorKey: failure.errorKey });
    expect(told).toEqual([{ kind: "take", projectId: "p1", shotId, creationNodeId: creation.id, jobId: "job-2", ok: false, cancelled: false, failure }]);
    await service.generate(project, person, shotId);
    service.jobChanged({ ...jobs.get("job-3")!, status: "cancelled" });
    expect(told.at(-1)).toEqual({ kind: "take", projectId: "p1", shotId, creationNodeId: creation.id, jobId: "job-3", ok: false, cancelled: true });
  });

  it("and the creation node are stale once the shot's prompt changes, and generating again clears the creation node", async () => {
    const { service, project, find, creationOf, takesOf, addShot, generated } = setup();
    const shotId = addShot("Shot 1", "Veil, dawn");
    await generated(shotId);
    service.apply(project, boards, opsOf({ type: "update_node", id: shotId, metadata: { prompt: "Veil, dusk" } }));
    expect(find(creationOf(shotId).id)?.metadata?.stale).toBe(true);
    expect(takesOf(shotId).map((take) => take.metadata?.stale)).toEqual([true]);
    await generated(shotId);
    expect(find(creationOf(shotId).id)?.metadata).not.toHaveProperty("stale");
    expect(takesOf(shotId).map((take) => [take.metadata?.stale, take.metadata?.selected])).toEqual([[true, undefined], [undefined, true]]);
  });

  it("go to nobody in a project without a post bot, and are still the shot's", async () => {
    const { pipeline, links, takesOf, addShot, generated } = setup({ stages: { lead: ["lead"], boards: ["storyboard"] }, lines: [{ from: "lead", to: "boards" }] });
    const shotId = addShot("Shot 1", "Veil");
    await generated(shotId);
    const [take] = takesOf(shotId);
    expect(links(take!.id)).toEqual([expect.stringMatching(/ => /)]);
    expect(pipeline.shots("p1")).toEqual([expect.objectContaining({ shotId, take: expect.objectContaining({ nodeId: take!.id }) })]);
  });

  it("come back as takes when the person deletes one and adds it back, as undo does", async () => {
    const { service, project, find, links, creationOf, takesOf, addShot, generated } = setup();
    const shotId = addShot("Shot 1", "Veil");
    await generated(shotId);
    const take = takesOf(shotId)[0]!;
    service.apply(project, person, opsOf({ type: "delete_node", id: take.id }));
    expect(takesOf(shotId)).toEqual([]);
    service.apply(project, person, opsOf(
      { type: "add_node", id: take.id, nodeType: "video", title: take.title, position: take.position, metadata: take.metadata },
      { type: "connect_nodes", id: "undo-1", fromNodeId: creationOf(shotId).id, toNodeId: take.id },
    ));
    expect(find(take.id)).toMatchObject({ createdBy: boards, metadata: { role: "take", shotId, selected: true } });
    expect(links(take.id)).toEqual([`${creationOf(shotId).id} => ${take.id}`, `${take.id} => bot:editor`]);
  });
});

describe("selecting a take", () => {
  it("moves the mark and the link to post, tells it once, and answers the revision", async () => {
    const { service, pipeline, told, find, links, takesOf, addShot, generated } = setup();
    const shotId = addShot("Shot 1", "Veil");
    await generated(shotId);
    await generated(shotId);
    const [first, second] = takesOf(shotId) as [CanvasNode, CanvasNode];
    told.length = 0;
    const before = service.revisionOf("p1")!;
    expect(pipeline.selectTake("p1", first.id)).toEqual({ revision: before + 1 });
    expect([find(first.id)?.metadata?.selected, find(second.id)?.metadata?.selected]).toEqual([true, undefined]);
    expect(links(first.id)).toContain(`${first.id} => bot:editor`);
    expect(links(second.id)).not.toContain(`${second.id} => bot:editor`);
    expect(told).toEqual([{ kind: "selected", projectId: "p1", shotId, nodeId: first.id }]);
    expect(pipeline.selectTake("p1", first.id)).toEqual({ revision: before + 1 });
    expect(told).toHaveLength(1);
    expect(pipeline.selectTake("p1", second.id)).toEqual({ revision: before + 2 });
    expect(told.at(-1)).toEqual({ kind: "selected", projectId: "p1", shotId, nodeId: second.id });
  });

  it("is refused for a node that is no take, one that is gone, and an archived project", async () => {
    const { pipeline, project, takesOf, addShot, generated } = setup();
    const shotId = addShot("Shot 1", "Veil");
    await generated(shotId);
    expect(refusal(() => pipeline.selectTake("p1", shotId))).toMatchObject({ status: 400, body: { code: "not_a_take" } });
    expect(refusal(() => pipeline.selectTake("p1", "gone"))).toMatchObject({ status: 404 });
    expect(refusal(() => pipeline.selectTake("p9", "gone"))).toMatchObject({ status: 404 });
    project.archivedAt = 5;
    expect(refusal(() => pipeline.selectTake("p1", takesOf(shotId)[0]!.id))).toMatchObject({ status: 409, body: { code: "canvas_read_only" } });
  });
});

describe("the project's shots for post", () => {
  it("are listed in the order they were added, wherever they stand, each with its selected take's file, duration and size, or none", async () => {
    const { service, pipeline, project, creationOf, takesOf, generated } = setup();
    const [first, second, bare] = service.apply(project, person, opsOf(
      { type: "add_node", nodeType: "shot", title: "First", position: { x: 0, y: 900 }, metadata: { prompt: "Veil" } },
      { type: "add_node", nodeType: "shot", title: "Second", position: { x: 0, y: 300 }, metadata: { prompt: "Ring" } },
      { type: "add_node", nodeType: "shot", title: "Third", position: { x: 0, y: 1500 }, metadata: { prompt: "Altar" } },
    )).nodeIds as [string, string, string];
    await generated(second);
    await generated(first);
    const take = takesOf(first)[0]!;
    service.apply(project, person, opsOf({ type: "update_node", id: take.id, metadata: { durationMs: 5200, naturalWidth: 1280, naturalHeight: 720 } }));
    service.apply(project, person, opsOf({ type: "delete_node", id: creationOf(bare).id }));
    expect(pipeline.shots("p1")).toEqual([
      { shotId: first, title: "First", prompt: "Veil", creationNodeId: creationOf(first).id, status: "success", takes: 1, take: { nodeId: take.id, title: "job-2.mp4", file: video("job-2.mp4"), durationMs: 5200, width: 1280, height: 720 } },
      { shotId: second, title: "Second", prompt: "Ring", creationNodeId: creationOf(second).id, status: "success", takes: 1, take: { nodeId: takesOf(second)[0]!.id, title: "job-1.mp4", file: video("job-1.mp4") } },
      { shotId: bare, title: "Third", prompt: "Altar", creationNodeId: null, status: "idle", takes: 0, take: null },
    ]);
  });

  it("come episode by episode: a shot is of the episode whose storyboard bot added it, and so are its creation node and its takes, which go to that episode's post bot", async () => {
    const { pipeline, find, links, creationOf, takesOf, addShot, generated } = setup(structuredClone(EPISODES.pipeline), EPISODES.episodeBots);
    const late = addShot("2-1", "Altar", bot("boards-2"));
    const [a, b] = [addShot("1-1", "Veil", bot("boards-1")), addShot("1-2", "Ring", bot("boards-1"))];
    await generated(a);
    await generated(late);
    expect(find(a)?.metadata).toMatchObject({ episode: 1 });
    expect(creationOf(late).metadata).toMatchObject({ episode: 2 });
    expect(takesOf(a)[0]!.metadata).toMatchObject({ episode: 1, selected: true });
    expect(links(takesOf(a)[0]!.id)).toEqual([`${creationOf(a).id} => ${takesOf(a)[0]!.id}`, `${takesOf(a)[0]!.id} => bot:editor-1`]);
    expect(links(takesOf(late)[0]!.id)).toContain(`${takesOf(late)[0]!.id} => bot:editor-2`);
    expect(pipeline.shots("p1").map((shot) => [shot.shotId, shot.episode, shot.take !== null])).toEqual([[a, 1, true], [b, 1, false], [late, 2, true]]);
  });
});

describe("the finished film", () => {
  const film = (name: string, bytes = "film") => writeFileSync(join(folder, "产出", name), bytes);

  it("becomes a video node from a file in the project folder, connected from every post bot, and the next film takes its place", async () => {
    const { pipeline, told, find, links, view } = setup({ ...DRAMA, stages: { ...DRAMA.stages, faces: ["post"] } });
    film("cut.mp4");
    const added = await pipeline.addFinal("p1", "产出/cut.mp4");
    expect(find(added.nodeId)).toMatchObject({ type: "video", title: "cut.mp4", createdBy: person, metadata: { role: "final", file: { path: "产出/cut.mp4", mime: "video/mp4", bytes: 4, name: "cut.mp4" } } });
    expect(links(added.nodeId)).toEqual([`bot:faces => ${added.nodeId}`, `bot:editor => ${added.nodeId}`]);
    expect(told).toEqual([{ kind: "role", projectId: "p1", role: "final", nodeId: added.nodeId }]);
    expect(await pipeline.addFinal("p1", "产出/cut.mp4")).toEqual(added);
    film("cut 2.mp4", "longer film");
    const again = await pipeline.addFinal("p1", "产出/cut 2.mp4");
    expect(again).toEqual({ nodeId: added.nodeId, revision: added.revision + 1 });
    expect(find(added.nodeId)).toMatchObject({ title: "cut 2.mp4", metadata: { role: "final", file: { path: "产出/cut 2.mp4", bytes: 11 } } });
    expect(view().nodes.filter((node) => node.metadata?.role === "final")).toHaveLength(1);
  });

  it("is the node that already shows the file, and stands alone in a project without a post bot", async () => {
    const { service, pipeline, project, links, find } = setup({ stages: { lead: ["lead"], boards: ["storyboard"] }, lines: [{ from: "lead", to: "boards" }] });
    film("cut.mp4");
    const [shown] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "video", title: "My cut", metadata: { file: { path: "产出/cut.mp4", mime: "video/mp4", bytes: 4, name: "cut.mp4" } } })).nodeIds;
    expect((await pipeline.addFinal("p1", "产出/cut.mp4")).nodeId).toBe(shown);
    expect(find(shown!)).toMatchObject({ title: "My cut", metadata: { role: "final" } });
    expect(links(shown!)).toEqual([]);
  });

  it("is refused for a file outside the project folder, one that is not there, one that is no video, and an archived project", async () => {
    const { pipeline, project } = setup();
    writeFileSync(join(dir, "outside.mp4"), "x");
    writeFileSync(join(folder, "产出", "notes.txt"), "x");
    await expect(pipeline.addFinal("p1", "../outside.mp4")).rejects.toMatchObject({ status: 400 });
    await expect(pipeline.addFinal("p1", "产出/missing.mp4")).rejects.toMatchObject({ status: 404 });
    await expect(pipeline.addFinal("p1", "产出/notes.txt")).rejects.toMatchObject({ status: 400, body: { code: "not_a_video" } });
    film("cut.mp4");
    project.archivedAt = 5;
    await expect(pipeline.addFinal("p1", "产出/cut.mp4")).rejects.toMatchObject({ status: 409 });
  });
});

describe("the brief", () => {
  it("goes on the canvas as the lead's, with the node of the lead's split of the work, and on to the script bot; planning again changes its rows and adds nothing", () => {
    const { service, pipeline, find, links, view } = setup(structuredClone(EPISODES.pipeline), EPISODES.episodeBots);
    const titles = { brief: "Brief", plan: "Task split" };
    const before = service.revisionOf("p1") ?? 0;
    expect(pipeline.setBrief("p1", "lead", [["Episodes", "20 × 2 min"], ["Style", "Period drama"]], titles)).toEqual({ revision: before + 1 });
    const brief = view().nodes.find((node) => node.metadata?.role === "brief")!;
    const plan = view().nodes.find((node) => node.metadata?.role === "plan")!;
    expect(brief).toMatchObject({ type: "text", title: "Brief", createdBy: bot("lead"), metadata: { card: { rows: [["Episodes", "20 × 2 min"], ["Style", "Period drama"]] } } });
    expect(plan).toMatchObject({ type: "text", title: "Task split", createdBy: bot("lead") });
    expect(links(brief.id)).toEqual([`bot:lead => ${brief.id}`, `${brief.id} => bot:writer`]);
    expect(links(plan.id)).toEqual([`bot:lead => ${plan.id}`]);

    expect(pipeline.setBrief("p1", "lead", [["Episodes", "20 × 2 min"], ["Style", "Period drama"]], titles)).toEqual({ revision: before + 1 });
    expect(pipeline.setBrief("p1", "lead", [["Episodes", "12 × 3 min"]], titles)).toEqual({ revision: before + 2 });
    expect(find(brief.id)?.metadata?.card?.rows).toEqual([["Episodes", "12 × 3 min"]]);
    expect(view().nodes.filter((node) => node.metadata?.role === "brief" || node.metadata?.role === "plan")).toHaveLength(2);
  });
});

describe("an episode on a project's canvas", () => {
  const episode = (number: number, title: string) => ({ type: "add_node", nodeType: "text", title, metadata: { content: `Script of ${title}`, role: "episode", episode: number, card: { subtitle: "A bride is swapped" } } });

  it("is added by the script bot alone, each number once, and goes on to its own storyboard bot", () => {
    const { service, pipeline, project, told, links } = setup(structuredClone(EPISODES.pipeline), EPISODES.episodeBots);
    expect(refusal(() => service.apply(project, bot("faces"), opsOf(episode(1, "The swap"))))?.body).toMatchObject({ code: "not_allowed" });
    expect(refusal(() => service.apply(project, bot("writer"), opsOf({ type: "add_node", nodeType: "text", metadata: { role: "episode" } })))?.body).toMatchObject({ code: "invalid_op" });
    const [second, first, third] = service.apply(project, bot("writer"), opsOf(episode(2, "The vow"), episode(1, "The swap"), episode(3, "The flight"))).nodeIds as [string, string, string];
    expect(refusal(() => service.apply(project, bot("writer"), opsOf(episode(2, "Again"))))?.body).toMatchObject({ code: "invalid_op" });
    expect(pipeline.episodes("p1")).toEqual([
      { episode: 1, nodeId: first, title: "The swap" }, { episode: 2, nodeId: second, title: "The vow" }, { episode: 3, nodeId: third, title: "The flight" },
    ]);
    expect(links(first)).toEqual([`bot:writer => ${first}`, `${first} => bot:boards-1`]);
    expect(links(second)).toEqual([`bot:writer => ${second}`, `${second} => bot:boards-2`]);
    expect(links(third)).toEqual([`bot:writer => ${third}`]);
    expect(told).toContainEqual({ kind: "role", projectId: "p1", role: "episode", nodeId: first });
  });

  it("gets its storyboard bot's line the next time the canvas is read once the project has that bot", () => {
    const { service, project, current, links } = setup({ stages: { lead: ["lead"], writer: ["script"] }, lines: [{ from: "lead", to: "writer" }] });
    const [first] = service.apply(project, bot("writer"), opsOf(episode(1, "The swap"))).nodeIds as [string];
    expect(links(first)).toEqual([`bot:writer => ${first}`]);
    project.botIds.push("boards-1");
    project.episodeBots = { "boards-1": { number: 1, job: "storyboard" } };
    current.pipeline = { stages: { ...current.pipeline.stages, "boards-1": ["storyboard"] }, lines: current.pipeline.lines };
    service.snapshot("p1", auth);
    expect(links(first)).toEqual([`bot:writer => ${first}`, `${first} => bot:boards-1`]);
  });
});

describe("the drama's characters and scenes", () => {
  it("are listed in the order they were added, each with the pictures of its group and where each picture stands", async () => {
    const { service, pipeline, project, jobs } = setup(structuredClone(EPISODES.pipeline), EPISODES.episodeBots);
    const [mei, front, side] = service.apply(project, bot("faces"), opsOf(
      { type: "add_node", nodeType: "text", title: "Mei", metadata: { content: "The bride", role: "character", card: { badge: "Lead", subtitle: "24, seamstress" } } },
      { type: "add_node", nodeType: "image", title: "Mei, front", metadata: { prompt: "Front view" } },
      { type: "add_node", nodeType: "image", title: "Mei, side", metadata: { prompt: "Side view" } },
    )).nodeIds as [string, string, string];
    service.apply(project, bot("faces"), opsOf({ type: "connect_nodes", fromNodeId: mei, toNodeId: front }, { type: "connect_nodes", fromNodeId: mei, toNodeId: side }));
    expect(refusal(() => service.apply(project, bot("faces"), opsOf({ type: "add_node", nodeType: "text", title: "Hall", metadata: { role: "scene" } })))?.body).toMatchObject({ code: "not_allowed" });
    const [hall] = service.apply(project, bot("sets"), opsOf({ type: "add_node", nodeType: "text", title: "Hall", metadata: { content: "The wedding hall", role: "scene" } })).nodeIds as [string];
    await service.generate(project, person, front);
    expect(pipeline.profiles("p1")).toEqual([
      { nodeId: mei, role: "character", title: "Mei", subtitle: "24, seamstress", pictures: [{ nodeId: front, state: "loading" }, { nodeId: side, state: "empty" }] },
      { nodeId: hall, role: "scene", title: "Hall", pictures: [] },
    ]);
    service.jobChanged({ ...jobs.get("job-1")!, kind: "image", settings: DEFAULT_GENERATION_SETTINGS.image.defaults, status: "done", files: [image("mei.png")] });
    expect(pipeline.profiles("p1")[0]!.pictures).toEqual([{ nodeId: front, state: "ready" }, { nodeId: side, state: "empty" }]);
  });
});

describe("marking nodes stale", () => {
  it("marks the nodes named that are on the canvas, and clears the mark again", () => {
    const { service, pipeline, project, find } = setup();
    const [a, b] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "text" }, { type: "add_node", nodeType: "text" })).nodeIds as [string, string];
    const before = service.revisionOf("p1")!;
    expect(pipeline.markStale("p1", [a, "gone", "bot:lead"])).toEqual({ revision: before + 1 });
    expect([find(a)?.metadata?.stale, find(b)?.metadata?.stale]).toEqual([true, undefined]);
    expect(pipeline.markStale("p1", [a])).toEqual({ revision: before + 1 });
    expect(pipeline.markStale("p1", [a, b], false)).toEqual({ revision: before + 2 });
    expect(find(a)).not.toHaveProperty("metadata");
  });
});

describe("a character on a project's canvas", () => {
  it("is added by the character bot alone, in a group of its own with the pictures connected from it", () => {
    const { service, project, find, links, view } = setup();
    const add = { type: "add_node", nodeType: "text", title: "Mei", metadata: { content: "The bride", role: "character" } };
    expect(refusal(() => service.apply(project, boards, opsOf(add)))?.body).toMatchObject({ code: "not_allowed" });
    const [mei] = service.apply(project, bot("faces"), opsOf(add)).nodeIds;
    const group = view().nodes.find((node) => node.type === "group")!;
    expect(group).toMatchObject({ title: "Mei", createdBy: bot("faces") });
    expect(find(mei!)).toMatchObject({ groupId: group.id, metadata: { role: "character" } });
    expect(links(mei!)).toEqual([`bot:faces => ${mei}`]);

    const [face] = service.apply(project, person, opsOf({ type: "add_node", nodeType: "image", position: { x: 4000, y: 4000 }, metadata: { file: image("mei.png") } })).nodeIds;
    service.apply(project, bot("faces"), opsOf({ type: "connect_nodes", fromNodeId: mei, toNodeId: face }));
    expect(find(face!)).toMatchObject({ groupId: group.id, position: { x: find(mei!)!.position.x + 340 + NODE_GAP, y: find(mei!)!.position.y } });
    const grown = find(group.id)!;
    expect(grown.width).toBeGreaterThan(group.width);
    expect(grown.position.x + grown.width).toBeGreaterThan(find(face!)!.position.x + 340);
  });
});

describe("a character's pictures", () => {
  it("are generated by the character bot in image nodes it adds: the profile goes with the prompt, and what the generation makes joins the group", async () => {
    const { service, project, started, jobs, find, view } = setup();
    const faces = bot("faces");
    const [mei, front] = service.apply(project, faces, opsOf(
      { type: "add_node", nodeType: "text", title: "Mei", metadata: { content: "The bride, 24, calm.", role: "character" } },
      { type: "add_node", nodeType: "image", title: "Mei, front", metadata: { prompt: "Front view, white dress", settings: { count: 2 } } },
    )).nodeIds as [string, string];
    service.apply(project, faces, opsOf({ type: "connect_nodes", fromNodeId: mei, toNodeId: front }));
    const groupId = find(mei)!.groupId!;
    expect(find(front)).toMatchObject({ groupId, position: { x: find(mei)!.position.x + 340 + NODE_GAP, y: find(mei)!.position.y } });

    await service.generate(project, faces, front);
    expect(started[0]).toEqual({ input: { kind: "image", nodeId: front, prompt: "Front view, white dress\n\n【Text 1】\nThe bride, 24, calm.", references: { images: [], audio: [] }, overrides: { count: 2 }, name: "Mei, front" }, requester: faces });
    service.jobChanged({ ...jobs.get("job-1")!, kind: "image", settings: DEFAULT_GENERATION_SETTINGS.image.defaults, status: "done", files: [image("mei-1.png"), image("mei-2.png")] });
    expect(find(front)?.metadata).toMatchObject({ file: image("mei-1.png"), status: "success" });
    const second = view().nodes.find((node) => node.metadata?.file?.name === "mei-2.png")!;
    expect(second).toMatchObject({ type: "image", groupId, createdBy: faces, position: { x: find(front)!.position.x + 340 + NODE_GAP, y: find(mei)!.position.y } });
    const group = find(groupId)!;
    expect(group.position.x + group.width).toBe(second.position.x + 340 + 24);
  });
});

describe("a canvas stored before the pipeline", () => {
  const legacy = () => {
    mkdirSync(join(dir, "canvases"), { recursive: true });
    const node = (id: string, type: string, x: number, y: number, metadata: object, createdBy: object = boards) => ({ id, type, title: id, position: { x, y }, width: type === "video" ? 420 : 340, height: type === "video" ? 236 : 240, metadata, createdBy });
    writeFileSync(join(dir, "canvases", "p1.json"), JSON.stringify({
      version: 1,
      document: {
        projectId: "p1", revision: 7, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots",
        nodes: [
          ...["lead", "writer", "faces", "boards", "editor"].map((id, row) => ({ id: `bot:${id}`, type: "bot", title: "", position: { x: -2000, y: row * 300 }, width: 300, height: 180 })),
          node("shot-1", "shot", 0, 0, { prompt: "Veil" }), node("old", "video", 420, 0, { file: video("old.mp4") }), node("new", "video", 420, 276, { file: video("new.mp4") }), node("shot-2", "shot", 0, 600, { prompt: "Ring" }, person),
        ],
        connections: [{ id: "c1", fromNodeId: "bot:boards", toNodeId: "shot-1", kind: "content" }, { id: "c2", fromNodeId: "shot-1", toNodeId: "old", kind: "content" }, { id: "c3", fromNodeId: "shot-1", toNodeId: "new", kind: "content" }],
      },
      history: [],
    }));
  };

  it("is brought forward when it is read: every shot has its creation node, its videos are its takes, the newest selected, and open apps are told once", () => {
    legacy();
    const { service, pipeline, broadcasts, find, links, creationOf } = setup();
    const snapshot = service.snapshot("p1", auth);
    expect(snapshot.revision).toBe(8);
    expect(broadcasts).toEqual([{ kind: "project-canvas", projectId: "p1", revision: 8, reason: "document" }]);
    expect(creationOf("shot-1")).toMatchObject({ createdBy: boards, position: { x: 420, y: 0 } });
    expect(creationOf("shot-2")).toMatchObject({ createdBy: person, position: { x: 420, y: 600 } });
    expect(find("old")).toMatchObject({ position: { x: 840, y: 0 }, metadata: { role: "take", shotId: "shot-1" } });
    expect(find("new")).toMatchObject({ position: { x: 840, y: 276 }, metadata: { role: "take", shotId: "shot-1", selected: true } });
    expect(links("new")).toEqual([`${creationOf("shot-1").id} => new`, "new => bot:editor"]);
    expect(links("shot-1")).toEqual(["bot:boards => shot-1", `shot-1 => ${creationOf("shot-1").id}`]);
    expect(pipeline.shots("p1").map((shot) => [shot.shotId, shot.take?.nodeId ?? null])).toEqual([["shot-1", "new"], ["shot-2", null]]);
    expect(service.snapshot("p1", auth).revision).toBe(8);
    expect(broadcasts).toHaveLength(1);
  });

  it("is left as it is while its project is archived", () => {
    legacy();
    const { service, project, broadcasts } = setup();
    project.archivedAt = 5;
    const snapshot = service.snapshot("p1", auth);
    expect(snapshot.revision).toBe(7);
    expect(snapshot.nodes.filter((node) => node.metadata?.role)).toEqual([]);
    expect(broadcasts).toEqual([]);
  });
});

describe("the production's links on a canvas when who does a job changes", () => {
  it("follow it the next time the canvas is read: a new post bot gets the selected take, and the brief goes to the new script bot", async () => {
    const { service, pipeline, current, links, view, takesOf, addShot, generated } = setup();
    pipeline.setBrief("p1", "lead", [["Episodes", "1"]], { brief: "Brief", plan: "Task split" });
    const brief = view().nodes.find((node) => node.metadata?.role === "brief")!;
    const shotId = addShot("Shot 1", "Veil");
    await generated(shotId);
    const take = takesOf(shotId)[0]!;
    const revision = service.revisionOf("p1")!;
    current.pipeline = { ...DRAMA, stages: { ...DRAMA.stages, faces: ["post", "script"], writer: ["other"] } };
    expect(service.snapshot("p1", auth).revision).toBe(revision + 1);
    expect(links(take.id)).toEqual([expect.stringContaining(` => ${take.id}`), `${take.id} => bot:editor`, `${take.id} => bot:faces`]);
    expect(links(brief.id)).toEqual([`bot:lead => ${brief.id}`, `${brief.id} => bot:faces`]);
    expect(service.snapshot("p1", auth).revision).toBe(revision + 1);
  });
});
