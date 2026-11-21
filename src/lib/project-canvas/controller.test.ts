import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botNodeId, type CanvasGenerateRequest, type CanvasOpsRequest, type CanvasTaskRequest } from "../../../shared/project-canvas";
import { SAMPLE_LOOKS, SAMPLE_PROJECT_ID, sampleCanvasBackend } from "../../testing/project-canvas-sample";
import { loadLocale, setLocale, t } from "../i18n";
import { CanvasBackendError } from "./backend";
import { CanvasController, VIEWPORT_SAVE_DELAY_MS } from "./controller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function started(options: Parameters<typeof sampleCanvasBackend>[0] = {}) {
  const backend = sampleCanvasBackend(options);
  const sent: CanvasOpsRequest[] = [];
  const applyOps = backend.applyOps.bind(backend);
  backend.applyOps = (projectId, request) => {
    sent.push(request);
    return applyOps(projectId, request);
  };
  const controller = new CanvasController(backend, SAMPLE_PROJECT_ID);
  await controller.start();
  await vi.advanceTimersByTimeAsync(0);
  return { backend, controller, sent };
}

const node = (controller: CanvasController, id: string) => controller.getState().snapshot!.nodes.find((candidate) => candidate.id === id);

describe("the canvas controller", () => {
  it("loads the snapshot, the bots' looks, the settings and the models", async () => {
    const { controller } = await started();
    const state = controller.getState();
    expect(state.phase).toBe("ready");
    expect(state.looks.mira).toEqual({ color: "purple" });
    expect(state.generation?.settings.video.server).toBe("studio-video");
    expect(state.models.video?.map((model) => model.id)).toEqual(["kling-2", "veo-lite"]);
  });

  it("shows a change at once, sends changes in order, and keeps them over a newer snapshot", async () => {
    const { backend, controller, sent } = await started();
    controller.apply([{ type: "update_node", id: "logline", patch: { title: "Logline v2" } }]);
    controller.apply([{ type: "add_node", nodeType: "text", title: "Note", position: { x: 10, y: 10 } }]);
    expect(node(controller, "logline")!.title).toBe("Logline v2");
    expect(controller.getState().snapshot!.nodes.some((candidate) => candidate.title === "Note")).toBe(true);
    await controller.settled();
    await controller.refresh();
    expect(sent.map((request) => request.ops.map((op) => op.type))).toEqual([["update_node"], ["update_node", "update_node", "update_node", "update_node"], ["add_node"]]);
    expect(sent[2]!.ops[0]).toMatchObject({ id: expect.any(String) });
    expect(backend.current().nodes.find((candidate) => candidate.id === "logline")!.title).toBe("Logline v2");
    expect(controller.getState().snapshot!.revision).toBe(backend.current().revision);
  });

  it("sends a change with the revision it was made on, never one older than its own last change, and arranging without one", async () => {
    const { backend, controller, sent } = await started();
    const start = backend.current().revision;
    controller.apply([{ type: "update_node", id: "logline", patch: { title: "Logline v2" } }]);
    controller.apply([{ type: "add_node", nodeType: "text", title: "Note", position: { x: 10, y: 10 } }]);
    controller.apply([{ type: "update_node", id: "logline", patch: { position: { x: 5, y: 5 }, width: 300 } }]);
    controller.setBackground("dots");
    await controller.settled();
    expect(sent.map((request) => request.baseRevision)).toEqual([start, undefined, start + 2, undefined, undefined]);
  });

  it("stores where each bot the server still lays out is before the first node is added, as its own change and out of undo", async () => {
    const { backend, controller, sent } = await started();
    const before = backend.current().nodes.filter((candidate) => candidate.type === "bot");
    controller.apply([{ type: "add_node", nodeType: "text", title: "Note", position: { x: 10, y: 10 } }]);
    controller.apply([{ type: "add_node", nodeType: "text", title: "Another", position: { x: 10, y: 400 } }]);
    await controller.settled();
    await controller.refresh();
    expect(sent.map((request) => request.ops.map((op) => op.type))).toEqual([before.map(() => "update_node"), ["add_node"], ["add_node"]]);
    expect(sent[0]).toEqual({ ops: before.map((bot) => ({ type: "update_node", id: bot.id, patch: { position: bot.position } })) });
    expect(Object.values(backend.current().bots).map((bot) => bot.placed)).toEqual(before.map(() => true));
    controller.undo();
    controller.undo();
    expect(controller.getState().canUndo).toBe(false);
    await controller.upload(new File(["x"], "still.png", { type: "image/png" }), { x: 5, y: 900 });
    expect(sent).toHaveLength(5);
  });

  it("stores those places before an upload too", async () => {
    const { controller, sent } = await started();
    const { nodeId } = await controller.upload(new File(["x"], "still.png", { type: "image/png" }), { x: 5, y: 6 });
    expect(sent.map((request) => request.ops.map((op) => op.type))).toEqual([["update_node", "update_node", "update_node", "update_node"]]);
    expect(node(controller, nodeId)).toBeDefined();
  });

  it("shows a view without storing it when asked to", async () => {
    const { backend, controller } = await started();
    controller.setViewport({ x: 40, y: 50, k: 0.5 }, { save: false });
    await vi.advanceTimersByTimeAsync(VIEWPORT_SAVE_DELAY_MS * 2);
    await controller.settled();
    expect(controller.getState().viewport).toEqual({ x: 40, y: 50, k: 0.5 });
    expect(backend.current().viewport).toEqual({ x: 0, y: 0, k: 1 });
  });

  it("reads the canvas and the bots' looks again whenever the backend says something changed", async () => {
    const { backend, controller } = await started();
    backend.readBotLooks = async () => ({ ...SAMPLE_LOOKS, mira: { color: "green" } });
    backend.updateBots((snapshot) => {
      snapshot.bots.mira!.status = "working";
    });
    await vi.advanceTimersByTimeAsync(0);
    await controller.refresh();
    expect(controller.getState().snapshot!.bots.mira!.status).toBe("working");
    expect(controller.getState().looks.mira).toEqual({ color: "green" });
  });

  it("undoes and redoes a deletion with its connections, and drops redo after a new change", async () => {
    const { backend, controller } = await started();
    controller.apply([{ type: "delete_node", id: "city-night" }]);
    expect(node(controller, "city-night")).toBeUndefined();
    controller.undo();
    expect(node(controller, "city-night")).toBeDefined();
    expect(controller.getState().snapshot!.connections.some((connection) => connection.id === "c-city-shot")).toBe(true);
    expect(controller.getState().canRedo).toBe(true);
    controller.redo();
    expect(node(controller, "city-night")).toBeUndefined();
    controller.undo();
    controller.apply([{ type: "update_node", id: "logline", patch: { title: "x" } }]);
    expect(controller.getState().canRedo).toBe(false);
    await controller.settled();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.current().nodes.some((candidate) => candidate.id === "city-night")).toBe(true);
  });

  it("keeps a failed change off the canvas and says why", async () => {
    const { backend, controller } = await started();
    backend.applyOps = () => Promise.reject(new Error("Disk full"));
    controller.apply([{ type: "update_node", id: "logline", patch: { title: "Lost" } }]);
    await controller.settled();
    await vi.advanceTimersByTimeAsync(0);
    expect(node(controller, "logline")!.title).toBe("Logline");
    expect(controller.getState().writeError).toBe("Disk full");
    backend.applyOps = () => Promise.reject(new CanvasBackendError("Archived.", { code: "canvas_read_only", error: "Archived.", errorKey: "serverError.projectCanvas.archived", reason: "archived" }));
    controller.apply([{ type: "update_node", id: "logline", patch: { title: "Lost again" } }]);
    await controller.settled();
    expect(controller.getState().writeError).toBe(t("serverError.projectCanvas.archived"));
  });

  it("stores the view once it rests, without moving it on a newer snapshot or adding it to undo", async () => {
    const { backend, controller } = await started();
    controller.setViewport({ x: 40, y: 50, k: 2 });
    controller.setViewport({ x: 80, y: 90, k: 2 });
    await vi.advanceTimersByTimeAsync(VIEWPORT_SAVE_DELAY_MS);
    await controller.settled();
    expect(backend.current().viewport).toEqual({ x: 80, y: 90, k: 2 });
    backend.updateBots((snapshot) => {
      snapshot.viewport = { x: 0, y: 0, k: 1 };
    });
    await vi.advanceTimersByTimeAsync(0);
    await controller.refresh();
    expect(controller.getState().viewport).toEqual({ x: 80, y: 90, k: 2 });
    expect(controller.getState().canUndo).toBe(false);
  });

  it("tidies the bots into their tree as one undoable change", async () => {
    const { controller } = await started();
    controller.apply([{ type: "update_node", id: botNodeId("otto"), patch: { position: { x: 2000, y: 2000 } } }], { record: false });
    controller.tidy();
    expect(node(controller, botNodeId("otto"))!.position).not.toEqual({ x: 2000, y: 2000 });
    controller.undo();
    expect(node(controller, botNodeId("otto"))!.position).toEqual({ x: 2000, y: 2000 });
  });

  it("stores a changed prompt before generating, and hands back a refusal", async () => {
    const { backend, controller } = await started({ delayMs: 50 });
    const refusal = await controller.generate("shot-1", "Night rain, close-up");
    expect(refusal).toBeNull();
    expect(backend.current().nodes.find((candidate) => candidate.id === "shot-1")!.metadata).toMatchObject({ prompt: "Night rain, close-up", status: "loading" });
    await vi.advanceTimersByTimeAsync(100);
    await controller.saveGeneration({ ...controller.getState().generation!.settings, video: { ...controller.getState().generation!.settings.video, server: null } });
    expect(await controller.generate("shot-1", "Night rain, close-up")).toMatchObject({ code: "no_server" });
  });

  it("sends a task and a generation with the page's language, which names the references they mention", async () => {
    const { backend, controller } = await started({ delayMs: 50 });
    const tasks: CanvasTaskRequest[] = [];
    const generations: CanvasGenerateRequest[] = [];
    const sendTask = backend.sendTask.bind(backend);
    const startGeneration = backend.startGeneration.bind(backend);
    backend.sendTask = (projectId, task) => {
      tasks.push(task);
      return sendTask(projectId, task);
    };
    backend.startGeneration = (projectId, request) => {
      generations.push(request);
      return startGeneration(projectId, request);
    };
    await loadLocale("zh");
    try {
      await controller.sendTask({ botId: "otto", text: "a tagline" });
      await controller.generate("shot-1", "Night rain");
    } finally {
      setLocale("en");
    }
    expect(tasks).toEqual([{ botId: "otto", text: "a tagline", language: "zh" }]);
    expect(generations).toEqual([{ nodeId: "shot-1", language: "zh" }]);
  });

  it("keeps the node a bot's reply beside a text node becomes, with the bot, as the backend has it, until the reply takes its place", async () => {
    const { controller } = await started({ delayMs: 100, reply: () => "Rain never stops in this city." });
    const text = node(controller, "logline")!.metadata!.content;
    await controller.sendTask({ botId: "otto", text: "a tagline", targetNodeId: "logline" });
    await vi.advanceTimersByTimeAsync(0);
    const [placeholder] = controller.getState().replies;
    expect(controller.getState().replies).toEqual([expect.objectContaining({ nodeId: "logline", botId: "otto" })]);
    expect(controller.getState().writing.logline).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    await controller.refresh();
    expect(controller.getState().replies).toEqual([]);
    expect(node(controller, "logline")!.metadata!.content).toBe(text);
    const beside = controller.getState().snapshot!.connections.filter((connection) => connection.fromNodeId === "logline" && connection.kind === "content").map((connection) => node(controller, connection.toNodeId));
    expect(beside).toEqual([expect.objectContaining({
      id: placeholder!.id, type: "text", position: placeholder!.position, width: placeholder!.width, height: placeholder!.height,
      createdBy: { kind: "bot", botId: "otto" }, metadata: { content: "Rain never stops in this city." },
    })]);
  });

  it("marks an empty text node a bot's task was written in until the reply fills it, and keeps no placeholder for a node deleted meanwhile", async () => {
    const { controller } = await started({ delayMs: 100, reply: () => "Rain never stops in this city." });
    controller.apply([{ type: "add_node", id: "blank", nodeType: "text", position: { x: 3000, y: 0 } }]);
    await vi.advanceTimersByTimeAsync(0);
    await controller.sendTask({ botId: "otto", text: "a tagline", targetNodeId: "blank" });
    await controller.sendTask({ botId: "kai", text: "a tagline", targetNodeId: "logline" });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().writing.blank).toEqual({ botId: "otto" });
    expect(controller.getState().replies).toHaveLength(1);
    controller.apply([{ type: "delete_node", id: "logline" }]);
    expect(controller.getState().replies).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    await controller.refresh();
    expect(controller.getState().writing.blank).toBeUndefined();
    expect(node(controller, "blank")!.metadata!.content).toBe("Rain never stops in this city.");
  });

  it("records an upload so undo removes the node", async () => {
    const { controller } = await started();
    const { nodeId } = await controller.upload(new File(["x"], "still.png", { type: "image/png" }), { x: 5, y: 6 });
    expect(node(controller, nodeId)).toMatchObject({ type: "image", position: { x: 5, y: 6 } });
    controller.undo();
    expect(node(controller, nodeId)).toBeUndefined();
  });
});
