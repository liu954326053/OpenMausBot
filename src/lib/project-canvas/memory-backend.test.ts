import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botNodeId } from "../../../shared/project-canvas";
import type { StartGenerationInput } from "../../../shared/project-generation";
import { SAMPLE_IMAGE_PATH, SAMPLE_PROJECT_ID, sampleCanvasBackend } from "../../testing/project-canvas-sample";
import { OUTPUT_GAP_Y, OUTPUT_OFFSET_X } from "./generation";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

  it("lets a bot answer a task, filling the text node that asked, and shows the bot writing into it until then", async () => {
    const backend = sampleCanvasBackend({ delayMs: 100, reply: (task) => `Wrote: ${task.text}` });
    const response = await backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "a tagline", targetNodeId: "logline" });
    expect(response).toMatchObject({ threadId: "thread-kai", references: 0 });
    expect(backend.current().bots.kai).toMatchObject({ status: "working", writingInto: ["logline"] });
    await vi.advanceTimersByTimeAsync(100);
    const after = backend.current();
    expect(after.bots.kai).toMatchObject({ status: "idle", output: { text: "Wrote: a tagline" } });
    expect(after.bots.kai!.writingInto).toBeUndefined();
    expect(after.nodes.find((node) => node.id === "logline")!.metadata!.content).toBe("Wrote: a tagline");
    expect((await backend.readExchange(SAMPLE_PROJECT_ID, "kai")).map((message) => message.role)).toEqual(["person", "bot"]);
    await expect(backend.sendTask(SAMPLE_PROJECT_ID, { botId: "kai", text: "a tagline", targetNodeId: "bot:kai" })).rejects.toThrow("text node");
  });

  it("generates a shot from its saved prompt and settings, under the take before, and refuses what the model doesn't offer", async () => {
    const backend = sampleCanvasBackend({ delayMs: 50 });
    const setShot = (settings: Record<string, unknown>) => backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "update_node", id: "shot-1", metadata: { prompt: "rain", settings } }] });
    await setShot({ resolution: "4k" });
    expect(await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1" })).toMatchObject({ refused: { code: "setting_refused" } });
    await setShot({ seconds: 10 });
    const started = await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1" });
    expect(started).toEqual({ jobId: expect.any(String) });
    expect(backend.current().nodes.find((node) => node.id === "shot-1")!.metadata).toMatchObject({ status: "loading", jobId: "jobId" in started ? started.jobId : null });
    await expect(backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1" })).rejects.toThrow("being generated already");
    await vi.advanceTimersByTimeAsync(100);
    const snapshot = backend.current();
    const shot = snapshot.nodes.find((node) => node.id === "shot-1")!;
    const firstTake = snapshot.nodes.find((node) => node.id === "shot-1-take-1")!;
    const takes = snapshot.connections.filter((connection) => connection.fromNodeId === "shot-1").map((connection) => snapshot.nodes.find((node) => node.id === connection.toNodeId)!);
    expect(shot.metadata).toMatchObject({ status: "success" });
    expect(takes).toHaveLength(2);
    expect(takes[1]!.position).toEqual({ x: shot.position.x + shot.width + OUTPUT_OFFSET_X, y: firstTake.position.y + firstTake.height + OUTPUT_GAP_Y });
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
      { type: "add_node", id: "look", nodeType: "config", position: { x: 2000, y: 0 }, metadata: { generationMode: "image", prompt: "Image 1 at dawn" } },
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
});
