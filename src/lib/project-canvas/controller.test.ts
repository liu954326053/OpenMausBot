import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasGenerateRequest, CanvasOpsRequest, CanvasTaskRequest } from "../../../shared/project-canvas";
import { BOARD_PROJECT_ID, productionBoardBackend, SAMPLE_FAILED_EPISODE } from "../../testing/production-board-sample";
import { SAMPLE_LOOKS, SAMPLE_PROJECT_ID, sampleCanvasBackend } from "../../testing/project-canvas-sample";
import { loadLocale, setLocale, t } from "../i18n";
import { CanvasBackendError } from "./backend";
import { CanvasController } from "./controller";

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
    expect(sent.map((request) => request.ops.map((op) => op.type))).toEqual([["update_node"], ["add_node"]]);
    expect(sent[1]!.ops[0]).toMatchObject({ id: expect.any(String) });
    expect(backend.current().nodes.find((candidate) => candidate.id === "logline")!.title).toBe("Logline v2");
    expect(controller.getState().snapshot!.revision).toBe(backend.current().revision);
  });

  it("sends a change with the revision it was made on, never one older than its own last change, and a move without one", async () => {
    const { backend, controller, sent } = await started();
    const start = backend.current().revision;
    controller.apply([{ type: "update_node", id: "logline", patch: { title: "Logline v2" } }]);
    controller.apply([{ type: "add_node", nodeType: "text", title: "Note", position: { x: 10, y: 10 } }]);
    controller.apply([{ type: "update_node", id: "logline", patch: { position: { x: 5, y: 5 }, width: 300 } }]);
    await controller.settled();
    expect(sent.map((request) => request.baseRevision)).toEqual([start, start + 1, undefined]);
  });

  it("shows a node the person moved as theirs to place at once, before the server says so", async () => {
    const { controller } = await started();
    controller.apply([{ type: "update_node", id: "logline", patch: { position: { x: 640, y: 80 } } }]);
    expect(node(controller, "logline")).toMatchObject({ position: { x: 640, y: 80 }, arranged: true });
    await controller.settled();
    await controller.refresh();
    expect(node(controller, "logline")).toMatchObject({ position: { x: 640, y: 80 }, arranged: true });
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

  it("reads a bot's conversation where its newest reply on the canvas is, or its main one", async () => {
    const { backend, controller } = await started();
    controller.readConversation("mira");
    controller.readConversation("kai");
    expect(backend.readConversations).toEqual([{ botId: "mira", threadId: "thread-mira" }, { botId: "kai" }]);
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

  it("selects a take after the changes before it, and shows the canvas the backend then has", async () => {
    const { backend, controller } = await started({ delayMs: 50 });
    await controller.generate("shot-1-creation", "");
    await vi.advanceTimersByTimeAsync(100);
    expect(node(controller, "shot-1-take-1")!.metadata!.selected).toBeUndefined();
    controller.apply([{ type: "update_node", id: "shot-1", patch: { title: "Rooftop" } }]);
    await controller.selectTake("shot-1-take-1");
    expect(backend.current().nodes.find((one) => one.id === "shot-1")!.title).toBe("Rooftop");
    expect(node(controller, "shot-1-take-1")!.metadata!.selected).toBe(true);
    expect(controller.getState().snapshot!.nodes.filter((one) => one.metadata?.selected)).toHaveLength(1);
  });

  it("has an episode where it stopped go on, shows where the production then stands, and hands on a refusal", async () => {
    const backend = productionBoardBackend({ episodes: 4 });
    const controller = new CanvasController(backend, BOARD_PROJECT_ID);
    await controller.start();
    await controller.retry({ episode: SAMPLE_FAILED_EPISODE });
    const episode = controller.getState().snapshot!.production!.episodes.find((one) => one.episode === SAMPLE_FAILED_EPISODE)!;
    expect(episode.status).toBe("storyboard");
    expect(backend.retries).toEqual([{ episode: SAMPLE_FAILED_EPISODE }]);
    await expect(controller.retry({ job: "script" })).rejects.toThrow("Nothing stopped there.");
  });
});
