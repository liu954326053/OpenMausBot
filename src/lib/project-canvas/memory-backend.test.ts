import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRunWire } from "../../../shared/pipeline-run";
import { botNodeId, CANVAS_NODE_SIZE, type CanvasSnapshot } from "../../../shared/project-canvas";
import type { ProjectDraftWire } from "../../../shared/project-draft";
import type { StartGenerationInput } from "../../../shared/project-generation";
import { SAMPLE_IMAGE_PATH, SAMPLE_PROJECT_ID, sampleCanvasBackend, sampleCanvasSnapshot } from "../../testing/project-canvas-sample";
import { OUTPUT_GAP_Y, OUTPUT_OFFSET_X } from "./generation";
import type { MemoryCanvasBackend } from "./memory-backend";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const node = (backend: MemoryCanvasBackend, id: string) => backend.current().nodes.find((one) => one.id === id)!;
const RUN: PipelineRunWire = {
  id: "run-1",
  startedAt: 1,
  stages: [{ stage: "script", botIds: ["kai"], status: "done" }, { stage: "storyboard", botIds: ["lena"], status: "done" }, { stage: "post", botIds: ["otto"], status: "waiting" }],
  videos: { status: "confirm", shots: 3, ready: 1, failed: 0 },
};
const DRAFT: ProjectDraftWire = { state: "written", name: "Rain City", writtenAt: 2, exportFolder: "/dramas/Rain City/产出" };
const withPipeline = (extra: Partial<CanvasSnapshot>, options: Parameters<typeof sampleCanvasBackend>[0] = {}) => sampleCanvasBackend({ ...options, snapshot: { ...sampleCanvasSnapshot(), ...extra } });

describe("the in-memory canvas backend", () => {
  it("applies a person's operations with a new revision, makes missing ids and tells listeners", async () => {
    const backend = sampleCanvasBackend();
    let told = 0;
    backend.subscribe(SAMPLE_PROJECT_ID, () => {
      told += 1;
    });
    const response = await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", nodeType: "text", title: "Note" }, { type: "connect_nodes", fromNodeId: "logline", toNodeId: "shot-1" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(response.revision).toBe(2);
    expect(response.nodeIds).toHaveLength(1);
    expect(response.connectionIds).toHaveLength(1);
    expect(backend.current().nodes.find((node) => node.id === response.nodeIds[0])).toMatchObject({ title: "Note", createdBy: { kind: "person" } });
    expect(told).toBe(1);
  });

  it("refuses a bot node's deletion, a reused live id, and every change once archived", async () => {
    const backend = sampleCanvasBackend();
    await expect(backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "delete_node", id: botNodeId("kai") }] })).rejects.toThrow();
    await expect(backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "logline", nodeType: "text" }] })).rejects.toThrow();
    backend.updateBots((snapshot) => {
      snapshot.readOnly = "archived";
    });
    await expect(backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "set_background", backgroundMode: "blank" }] })).rejects.toMatchObject({ body: { code: "canvas_read_only" } });
  });

  it("lets a bot answer a task written in a text node: in the node shown beside a node with text from the moment it is sent, or into an empty one, which shows the bot writing", async () => {
    const backend = sampleCanvasBackend({ delayMs: 100, reply: (task) => `Wrote: ${task.text}` });
    const logline = backend.current().nodes.find((node) => node.id === "logline")!;
    const inTheWay = backend.current().nodes.find((node) => node.id === botNodeId("lena"))!;
    const response = await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "a tagline", targetNodeId: "logline" });
    expect(response).toMatchObject({ threadId: "thread-kai", references: 0 });
    const [placeholder] = backend.current().bots.kai!.writingBeside!;
    expect(backend.current().bots.kai).toMatchObject({
      status: "working",
      writingBeside: [{ id: expect.any(String), nodeId: "logline", position: { x: logline.position.x + logline.width + OUTPUT_OFFSET_X, y: inTheWay.position.y + inTheWay.height + OUTPUT_GAP_Y }, ...CANVAS_NODE_SIZE.text }],
    });
    expect(backend.current().bots.kai!.writingInto).toBeUndefined();
    expect(backend.current().nodes.map((node) => node.id)).not.toContain(placeholder!.id);
    await vi.advanceTimersByTimeAsync(100);
    const after = backend.current();
    expect(after.bots.kai).toMatchObject({ status: "idle", output: { text: "Wrote: a tagline" } });
    expect(after.bots.kai!.writingBeside).toBeUndefined();
    expect(after.nodes.find((node) => node.id === "logline")!.metadata).toEqual(logline.metadata);
    const replies = after.connections.filter((connection) => connection.fromNodeId === "logline" && connection.kind === "content").map((connection) => after.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(replies).toEqual([expect.objectContaining({
      id: placeholder!.id, type: "text", title: "a tagline", position: placeholder!.position, width: placeholder!.width, height: placeholder!.height,
      createdBy: { kind: "bot", botId: "kai" }, metadata: { content: "Wrote: a tagline" },
    })]);
    expect((await backend.readExchange(SAMPLE_PROJECT_ID, "kai")).map((message) => message.role)).toEqual(["person", "bot"]);

    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "tagline", nodeType: "text", title: "Tagline" }, { type: "connect_nodes", fromNodeId: "city-night", toNodeId: "tagline" }] });
    expect(await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "a tagline from @Image 1", targetNodeId: "tagline" })).toMatchObject({ references: 1 });
    expect(backend.current().bots.kai).toMatchObject({ status: "working", writingInto: ["tagline"] });
    expect(backend.current().bots.kai!.writingBeside).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    const filled = backend.current();
    expect(filled.nodes.find((node) => node.id === "tagline")!.metadata).toEqual({ content: "Wrote: a tagline from @Image 1" });
    expect(filled.connections.filter((connection) => connection.fromNodeId === "tagline")).toEqual([]);
    await expect(backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "a tagline", targetNodeId: "bot:kai" })).rejects.toThrow("text node");
  });

  it("queues a bot's tasks, giving two revisions of a node two placeholders that overlap neither each other nor a node, each taken by its own reply", async () => {
    const backend = sampleCanvasBackend({ delayMs: 100, reply: (task) => `Wrote: ${task.text}` });
    const inTheWay = backend.current().nodes.find((node) => node.id === botNodeId("lena"))!;
    await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "shorter", targetNodeId: "logline" });
    await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "darker", targetNodeId: "logline" });
    const [first, second] = backend.current().bots.kai!.writingBeside!;
    expect(first!.position.y).toBe(inTheWay.position.y + inTheWay.height + OUTPUT_GAP_Y);
    expect(second!.position).toEqual({ x: first!.position.x, y: first!.position.y + first!.height + OUTPUT_GAP_Y });
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.current().bots.kai).toMatchObject({ status: "working", writingBeside: [second] });
    await vi.advanceTimersByTimeAsync(100);
    const after = backend.current();
    expect(after.bots.kai).toMatchObject({ status: "idle" });
    expect(after.bots.kai!.writingBeside).toBeUndefined();
    const replies = after.connections.filter((connection) => connection.fromNodeId === "logline").map((connection) => after.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(replies).toEqual([
      expect.objectContaining({ id: first!.id, position: first!.position, metadata: { content: "Wrote: shorter" } }),
      expect.objectContaining({ id: second!.id, position: second!.position, metadata: { content: "Wrote: darker" } }),
    ]);
  });

  it("ends only the running task on Stop, adding nothing and leaving the node as it was, and then runs what waits in the queue", async () => {
    const backend = sampleCanvasBackend({ delayMs: 100 });
    const before = backend.current();
    await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "shorter", targetNodeId: "logline" });
    await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "darker", targetNodeId: "logline" });
    const [, waiting] = backend.current().bots.kai!.writingBeside!;
    await backend.stopBot(SAMPLE_PROJECT_ID, "kai");
    expect(backend.current().bots.kai).toMatchObject({ status: "working", writingBeside: [waiting] });
    await backend.stopBot(SAMPLE_PROJECT_ID, "kai");
    expect(backend.current().bots.kai).toMatchObject({ status: "idle" });
    expect(backend.current().bots.kai!.writingBeside).toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.current().nodes).toEqual(before.nodes);
    expect(backend.current().connections).toEqual(before.connections);
  });

  it("keeps a bot's reply unread until its conversation is read, and tells listeners once it is", async () => {
    const backend = sampleCanvasBackend({ delayMs: 100 });
    await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "otto", text: "Cut the teaser" });
    expect((await backend.readBotLooks(SAMPLE_PROJECT_ID)).otto).toEqual({ color: "teal" });
    await vi.advanceTimersByTimeAsync(100);
    expect((await backend.readBotLooks(SAMPLE_PROJECT_ID)).otto).toEqual({ color: "teal", unread: true });
    let told = 0;
    backend.subscribe(SAMPLE_PROJECT_ID, () => {
      told += 1;
    });
    backend.readConversation(SAMPLE_PROJECT_ID, "otto", "thread-otto");
    backend.readConversation(SAMPLE_PROJECT_ID, "otto", "thread-otto");
    await vi.advanceTimersByTimeAsync(0);
    expect((await backend.readBotLooks(SAMPLE_PROJECT_ID)).otto).toEqual({ color: "teal" });
    expect(told).toBe(1);
    expect(backend.readConversations).toEqual([{ botId: "otto", threadId: "thread-otto" }, { botId: "otto", threadId: "thread-otto" }]);
  });

  it("decides when a task is sent whether its reply fills the node, so what the person types meanwhile stays", async () => {
    const backend = sampleCanvasBackend({ delayMs: 100, reply: () => "The bot's line" });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "blank", nodeType: "text", position: { x: 3000, y: 0 } }] });
    await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "fill it", targetNodeId: "blank" });
    expect(backend.current().bots.kai).toMatchObject({ writingInto: ["blank"] });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "blank", metadata: { content: "Typed meanwhile" } }] });
    await vi.advanceTimersByTimeAsync(100);
    const after = backend.current();
    expect(after.nodes.find((node) => node.id === "blank")!.metadata).toEqual({ content: "Typed meanwhile" });
    const made = after.connections.filter((connection) => connection.fromNodeId === "blank").map((connection) => after.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(made).toEqual([expect.objectContaining({ type: "text", position: { x: 3000 + CANVAS_NODE_SIZE.text.width + OUTPUT_OFFSET_X, y: 0 }, metadata: { content: "The bot's line" } })]);
  });

  it("fills an empty image node with the first picture it generates and puts the rest to its right", async () => {
    const backend = sampleCanvasBackend({ delayMs: 50 });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "poster", nodeType: "image", position: { x: 3000, y: 0 }, metadata: { prompt: "A poster", settings: { count: 2 } } }] });
    expect(await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "poster" })).toEqual({ jobId: expect.any(String) });
    await vi.advanceTimersByTimeAsync(100);
    const snapshot = backend.current();
    const poster = snapshot.nodes.find((node) => node.id === "poster")!;
    const rest = snapshot.connections.filter((connection) => connection.fromNodeId === "poster").map((connection) => snapshot.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(poster.metadata).toMatchObject({ status: "success", file: { mime: "image/png" } });
    expect(rest).toEqual([expect.objectContaining({ type: "image", position: { x: poster.position.x + poster.width + OUTPUT_OFFSET_X, y: poster.position.y } })]);
    expect(rest[0]!.metadata!.file!.path).not.toBe(poster.metadata!.file!.path);
  });

  it("generates a shot's creation node from the shot's prompt and its own settings: the clip is a take of the shot, under the take before and selected in its place", async () => {
    const inputs: StartGenerationInput[] = [];
    const backend = sampleCanvasBackend({ delayMs: 50, fail: (input) => { inputs.push(input); } });
    const set = (settings: Record<string, unknown>) => backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "shot-1-creation", metadata: { settings } }] });
    await set({ resolution: "4k" });
    expect(await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1-creation" })).toMatchObject({ refused: { code: "setting_refused" } });
    await set({ seconds: 10 });
    const started = await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1-creation" });
    expect(started).toEqual({ jobId: expect.any(String) });
    expect(node(backend, "shot-1-creation").metadata).toMatchObject({ status: "loading", jobId: "jobId" in started ? started.jobId : null });
    await expect(backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1-creation" })).rejects.toThrow("being generated already");
    await vi.advanceTimersByTimeAsync(100);

    const snapshot = backend.current();
    const creation = node(backend, "shot-1-creation");
    const firstTake = node(backend, "shot-1-take-1");
    const made = snapshot.connections.filter((connection) => connection.fromNodeId === "shot-1-creation");
    const takes = made.map((connection) => snapshot.nodes.find((one) => one.id === connection.toNodeId)!);
    expect(inputs).toMatchObject([{ kind: "video", nodeId: "shot-1-creation", prompt: node(backend, "shot-1").metadata!.prompt, overrides: { seconds: 10 }, references: { images: [SAMPLE_IMAGE_PATH] } }]);
    expect(creation.metadata).toMatchObject({ status: "success" });
    expect(made.map((connection) => connection.pipeline)).toEqual([true, true]);
    expect(takes).toHaveLength(2);
    expect(takes[1]).toMatchObject({ type: "video", position: { x: creation.position.x + creation.width + OUTPUT_OFFSET_X, y: firstTake.position.y + firstTake.height + OUTPUT_GAP_Y }, metadata: { role: "take", shotId: "shot-1", selected: true } });
    expect(firstTake.metadata!.selected).toBeUndefined();
    expect(snapshot.connections.filter((connection) => connection.toNodeId === botNodeId("otto") && connection.kind === "content").map((connection) => connection.fromNodeId)).toEqual([takes[1]!.id]);
  });

  it("still generates a shot itself, as the server does for a bot, and a creation node whose shot has no prompt has none", async () => {
    const backend = sampleCanvasBackend({ delayMs: 50 });
    expect(await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1" })).toEqual({ jobId: expect.any(String) });
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.current().connections.filter((connection) => connection.fromNodeId === "shot-1")).toHaveLength(2);
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "shot-1", metadata: { prompt: " " } }] });
    await expect(backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1-creation" })).rejects.toThrow("has no prompt");
  });

  it("generates a config node from its prompt and inputs, its results to its right and connected from it, and keeps a failure's key", async () => {
    const inputs: StartGenerationInput[] = [];
    const backend = sampleCanvasBackend({
      delayMs: 50,
      fail: (input) => {
        inputs.push(input);
        return input.prompt.startsWith("[fail]") ? "no faces" : undefined;
      },
    });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [
      { type: "add_node", id: "look", nodeType: "config", position: { x: 2000, y: -2000 }, metadata: { generationMode: "image", prompt: "Image 1 at dawn" } },
      { type: "connect_nodes", fromNodeId: "city-night", toNodeId: "look" },
    ] });
    expect(await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "look", language: "zh" })).toEqual({ jobId: expect.any(String) });
    await vi.advanceTimersByTimeAsync(100);
    const snapshot = backend.current();
    const look = snapshot.nodes.find((node) => node.id === "look")!;
    const made = snapshot.connections.filter((connection) => connection.fromNodeId === "look").map((connection) => snapshot.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(look.metadata).toMatchObject({ status: "success" });
    expect(made).toEqual([expect.objectContaining({ type: "image", position: { x: look.position.x + look.width + OUTPUT_OFFSET_X, y: look.position.y } })]);
    expect(inputs[0]).toMatchObject({ kind: "image", nodeId: "look", prompt: "Image 1 at dawn", references: { images: [SAMPLE_IMAGE_PATH], audio: [] } });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "look", metadata: { prompt: "[fail] Image 1 at dawn" } }] });
    await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "look" });
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.current().nodes.find((node) => node.id === "look")!.metadata).toMatchObject({
      status: "error",
      errorDetails: "studio-images couldn't make it: no faces",
      errorKey: "serverError.projectGeneration.taskFailed",
      errorParams: { server: "studio-images", reason: "no faces" },
    });
  });

  it("fills an empty image node with its first picture, then puts the next to its right and hands over the node's own picture", async () => {
    const inputs: StartGenerationInput[] = [];
    const backend = sampleCanvasBackend({
      delayMs: 50,
      fail: (input) => {
        inputs.push(input);
      },
    });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "blank", nodeType: "image", position: { x: 2000, y: -2000 }, metadata: { prompt: "A bride at dawn" } }] });
    await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "blank" });
    await vi.advanceTimersByTimeAsync(100);
    const filled = backend.current().nodes.find((node) => node.id === "blank")!;
    expect(filled.metadata).toMatchObject({ status: "success", file: { mime: "image/png" } });
    expect(backend.current().connections.filter((connection) => connection.fromNodeId === "blank")).toEqual([]);

    await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "blank" });
    await vi.advanceTimersByTimeAsync(100);
    const snapshot = backend.current();
    const made = snapshot.connections.filter((connection) => connection.fromNodeId === "blank").map((connection) => snapshot.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(made).toEqual([expect.objectContaining({ type: "image", position: { x: filled.position.x + filled.width + OUTPUT_OFFSET_X, y: filled.position.y } })]);
    expect(snapshot.nodes.find((node) => node.id === "blank")!.metadata!.file).toEqual(filled.metadata!.file);
    expect(inputs.map((input) => input.references?.images)).toEqual([[], [filled.metadata!.file!.path]]);
  });

  it("refuses to generate a node without a prompt, or one that is not a shot, image, video or config", async () => {
    const backend = sampleCanvasBackend();
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "shot-1", metadata: { prompt: "  " } }] });
    await expect(backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1" })).rejects.toThrow("has no prompt");
    await expect(backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "logline" })).rejects.toThrow("Only shot, image, video and config nodes");
  });

  it("stores project settings only when the model offers them, and lists a server's models before it is saved", async () => {
    const backend = sampleCanvasBackend();
    const { settings } = await backend.readGenerationSettings(SAMPLE_PROJECT_ID);
    const refused = await backend.saveGenerationSettings(SAMPLE_PROJECT_ID, { ...settings, video: { ...settings.video, defaults: { ...settings.video.defaults, model: "veo-lite", seconds: 10 } } });
    expect(refused).toMatchObject({ refused: { code: "setting_refused", problems: [{ key: "seconds", value: 10, offered: [5] }] } });
    expect(await backend.listModels(SAMPLE_PROJECT_ID, "image", { server: "local-comfy" })).toMatchObject({ refused: { code: "server_unusable" } });
    expect(await backend.listModels(SAMPLE_PROJECT_ID, "video")).toMatchObject({ models: [{ id: "kling-2" }, { id: "veo-lite" }] });
  });

  it("gives a shot that is added its creation node, to its right and linked from it, once", async () => {
    const backend = sampleCanvasBackend();
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "add_node", id: "shot-2", nodeType: "shot", title: "Shot 2", position: { x: 0, y: 3000 } }] });
    await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "shot-2", metadata: { prompt: "A door opens." } }] });
    const creations = backend.current().nodes.filter((one) => one.metadata?.role === "creation" && one.metadata.shotId === "shot-2");
    expect(creations).toMatchObject([{ type: "config", title: "Shot 2", position: { x: 340 + OUTPUT_OFFSET_X, y: 3000 }, metadata: { generationMode: "video" } }]);
    expect(backend.current().connections.filter((connection) => connection.toNodeId === creations[0]!.id)).toMatchObject([{ fromNodeId: "shot-2", kind: "content", pipeline: true }]);
    expect(backend.current().nodes.filter((one) => one.metadata?.role === "creation")).toHaveLength(2);
  });

  it("makes the take the person picks its shot's selected one, alone, with the line to the post bot, and refuses a node that is no take", async () => {
    const backend = sampleCanvasBackend({ delayMs: 50 });
    await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1-creation" });
    await vi.advanceTimersByTimeAsync(100);
    const second = backend.current().nodes.find((one) => one.metadata?.role === "take" && one.id !== "shot-1-take-1")!;
    const before = backend.current().revision;
    const heard = vi.fn();
    backend.subscribe(SAMPLE_PROJECT_ID, heard);

    expect(await backend.selectTake(SAMPLE_PROJECT_ID, "shot-1-take-1")).toEqual({ revision: before + 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toHaveBeenCalled();
    expect(node(backend, "shot-1-take-1").metadata!.selected).toBe(true);
    expect(node(backend, second.id).metadata!.selected).toBeUndefined();
    expect(backend.current().connections.filter((connection) => connection.toNodeId === botNodeId("otto") && connection.kind === "content")).toMatchObject([{ fromNodeId: "shot-1-take-1", pipeline: true }]);

    await expect(backend.selectTake(SAMPLE_PROJECT_ID, "shot-1")).rejects.toThrow("not a take");
    await expect(backend.selectTake(SAMPLE_PROJECT_ID, "nowhere")).rejects.toThrow("not a take");
    backend.updateBots((snapshot) => { snapshot.readOnly = "archived"; });
    await expect(backend.selectTake(SAMPLE_PROJECT_ID, second.id)).rejects.toMatchObject({ body: { code: "canvas_read_only" } });
  });

  it("takes the person's answer to the run: start and retry set the videos going, skip goes on without them, and an answer the run isn't waiting for is refused", async () => {
    const backend = withPipeline({ run: RUN });
    await expect(backend.answerVideos(SAMPLE_PROJECT_ID, { action: "retry" })).rejects.toThrow("isn't waiting");
    await backend.answerVideos(SAMPLE_PROJECT_ID, { action: "start" });
    expect(backend.current().run!.videos).toEqual({ status: "working", shots: 3, ready: 1, failed: 0 });
    await expect(backend.answerVideos(SAMPLE_PROJECT_ID, { action: "start" })).rejects.toThrow("isn't waiting");

    backend.updateBots((snapshot) => { snapshot.run!.videos = { status: "failed", shots: 3, ready: 2, failed: 1 }; });
    await backend.answerVideos(SAMPLE_PROJECT_ID, { action: "retry" });
    expect(backend.current().run!.videos).toEqual({ status: "working", shots: 3, ready: 2, failed: 0 });
    backend.updateBots((snapshot) => { snapshot.run!.videos = { status: "failed", shots: 3, ready: 2, failed: 1 }; });
    await backend.answerVideos(SAMPLE_PROJECT_ID, { action: "skip" });
    expect(backend.current().run!.videos).toEqual({ status: "done", shots: 3, ready: 2, failed: 1 });
    expect(backend.videoAnswers).toEqual(["start", "retry", "skip"]);
    await expect(sampleCanvasBackend().answerVideos(SAMPLE_PROJECT_ID, { action: "start" })).rejects.toThrow("no run");
  });

  it("opens the draft there is, as the draft or only the app, and has none to open before one is written", async () => {
    expect(await withPipeline({ draft: DRAFT }).openDraft(SAMPLE_PROJECT_ID)).toEqual({ opened: "draft" });
    expect(await withPipeline({ draft: { ...DRAFT, state: "kept" } }, { draftOpens: "app" }).openDraft(SAMPLE_PROJECT_ID)).toEqual({ opened: "app" });
    await expect(withPipeline({ draft: { state: "none", exportFolder: DRAFT.exportFolder } }).openDraft(SAMPLE_PROJECT_ID)).rejects.toThrow("no draft");
    await expect(sampleCanvasBackend().openDraft(SAMPLE_PROJECT_ID)).rejects.toThrow("no draft");
  });

  it("makes a file of the project folder the finished film: a node beside the post bot, linked from it, which a later choice replaces", async () => {
    const backend = sampleCanvasBackend();
    await backend.setFinalFilm(SAMPLE_PROJECT_ID, { path: "产出/Rain City.mp4" });
    const film = backend.current().nodes.filter((one) => one.metadata?.role === "final");
    const otto = node(backend, botNodeId("otto"));
    expect(film).toMatchObject([{ type: "video", title: "Rain City.mp4", position: { x: otto.position.x + otto.width + OUTPUT_OFFSET_X, y: otto.position.y }, metadata: { file: { path: "产出/Rain City.mp4", mime: "video/mp4", name: "Rain City.mp4" } } }]);
    expect(backend.current().connections.filter((connection) => connection.toNodeId === film[0]!.id)).toMatchObject([{ fromNodeId: botNodeId("otto"), kind: "content", pipeline: true }]);

    await backend.setFinalFilm(SAMPLE_PROJECT_ID, { path: "产出/Rain City v2.mov" });
    expect(backend.current().nodes.filter((one) => one.metadata?.role === "final")).toMatchObject([{ id: film[0]!.id, title: "Rain City v2.mov", metadata: { file: { path: "产出/Rain City v2.mov", mime: "video/quicktime" } } }]);
    await expect(backend.setFinalFilm(SAMPLE_PROJECT_ID, { path: "../elsewhere.mp4" })).rejects.toThrow("project folder");
    await expect(backend.setFinalFilm(SAMPLE_PROJECT_ID, { path: "产出/notes.txt" })).rejects.toThrow("not a video");
  });

  it("knows a picked file's path on this computer only where it is told how", () => {
    const file = new File(["x"], "film.mp4");
    expect(sampleCanvasBackend().localPathOf).toBeUndefined();
    expect(sampleCanvasBackend({ localPathOf: (picked) => `/dramas/${picked.name}` }).localPathOf!(file)).toBe("/dramas/film.mp4");
  });
});
