import { describe, expect, it } from "vitest";

import { DEFAULT_GENERATION_SETTINGS, type GenerationFailure } from "../../shared/project-generation.ts";
import { conventionServer, parseModels } from "./convention.ts";
import { GenerationRefused } from "./failure.ts";
import type { GenerationMcp, ToolAnswer } from "./mcp-access.ts";

type Answer = Record<string, unknown> | { rpcError: string };

function server(answers: Record<string, (args: Record<string, unknown>) => Answer>, listed: string[] = Object.keys(answers)) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const mcp: GenerationMcp = {
    choosable: () => ["gen"],
    unusable: () => null,
    toolNames: async () => new Set(listed),
    call: async (_server, tool, args): Promise<ToolAnswer> => {
      calls.push({ tool, args });
      const answer = answers[tool]!(args);
      if ("rpcError" in answer) return { ok: false, error: String(answer.rpcError) };
      return { ok: true, result: answer, mask: (text) => text.replaceAll("sk-secret-key-1", "«redacted»") };
    },
    close: () => undefined,
  };
  return { calls, gen: conventionServer(mcp, "gen", DEFAULT_GENERATION_SETTINGS.image.tools, {}) };
}

const signal = () => AbortSignal.timeout(5000);
const json = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

async function failureOf(run: () => Promise<unknown>): Promise<GenerationFailure> {
  try {
    await run();
  } catch (error) {
    if (error instanceof GenerationRefused) return error.failure;
    throw error;
  }
  throw new Error("not refused");
}

const REQUEST = { prompt: "a", references: { images: [], audio: [] } };
const IMAGE = { model: "m", aspect: "1:1", quality: "auto", count: 1 };

describe("the generation convention", () => {
  it("reads models from structured content or the JSON of a text answer, keeping only what each kind can offer", async () => {
    const models = [
      { id: "img", kind: "image", aspects: ["1:1", 3, ""], qualities: ["hd"], resolutions: ["4k"], durations: [5], maxCount: 2.5, referenceImages: true, referenceAudio: true },
      { id: "img", kind: "image", name: "duplicate" },
      { id: "vid", name: "Video", kind: "video", resolutions: ["720p"], durations: [5, -1, "10"], qualities: ["hd"], maxCount: 3, referenceAudio: true },
      { id: "", kind: "image" }, { id: "voice", kind: "audio" }, "junk",
    ];
    expect(parseModels({ models })).toEqual([
      { id: "img", name: "img", kind: "image", aspects: ["1:1"], qualities: ["hd"], referenceImages: true, referenceAudio: false },
      { id: "vid", name: "Video", kind: "video", resolutions: ["720p"], durations: [5], referenceImages: false, referenceAudio: true },
    ]);
    const { gen } = server({ list_models: () => json({ models: models.slice(0, 1) }) });
    expect(await gen.listModels(signal())).toHaveLength(1);
    expect(await failureOf(() => server({ list_models: () => json({ items: [] }) }).gen.listModels(signal()))).toMatchObject({
      code: "bad_answer", error: "gen answered list_models in a way MagicBot can't read: it gave no list of models",
    });
  });

  it("takes files, a task id under either spelling, or MCP image blocks from a generate call", async () => {
    const answers = [
      { structuredContent: { files: [{ url: "https://cdn.example/a.png", name: "a.png" }, { data: "iVBORw0K" }] } },
      json({ task_id: "t-1", status: "queued" }),
      { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0K" }, { type: "text", text: "made one" }] },
    ];
    const seen = [];
    for (const answer of answers) seen.push(await server({ generate_image: () => answer }).gen.generate("image", IMAGE, REQUEST, signal()));
    expect(seen).toEqual([{ files: [{ url: "https://cdn.example/a.png", name: "a.png" }, { data: "iVBORw0K" }] }, { taskId: "t-1" }, { files: [{ data: "iVBORw0K" }] }]);
    expect(await failureOf(() => server({ generate_image: () => json({ ok: true }) }).gen.generate("image", IMAGE, REQUEST, signal()))).toMatchObject({
      code: "bad_answer", error: "gen answered generate_image in a way MagicBot can't read: it gave neither files nor a task id",
    });
  });

  it("gives the server's own reason when it refuses, its words masked", async () => {
    const refusing = server({ generate_image: () => ({ isError: true, content: [{ type: "text", text: "key sk-secret-key-1 has no credit" }] }) });
    expect(await failureOf(() => refusing.gen.generate("image", IMAGE, REQUEST, signal()))).toEqual({
      code: "task_failed", reason: "key «redacted» has no credit", error: "gen couldn't make it: key «redacted» has no credit",
      errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "key «redacted» has no credit" },
    });
    expect(await failureOf(() => server({ generate_image: () => ({ rpcError: "Invalid params: count" }) }).gen.generate("image", IMAGE, REQUEST, signal())))
      .toMatchObject({ code: "task_failed", reason: "Invalid params: count" });
  });

  it("understands a task's status in the words servers use", async () => {
    const states = [
      [{ status: "PROCESSING", progress: 40, pollAfterMs: 2000 }, { status: "running", progress: 0.4, pollAfterMs: 2000 }],
      [{ status: "pending" }, { status: "queued" }],
      [{ status: "completed", files: [{ url: "https://cdn.example/v.mp4" }] }, { status: "succeeded", files: [{ url: "https://cdn.example/v.mp4" }] }],
      [{ status: "error", message: "sk-secret-key-1 is out of credit" }, { status: "failed", reason: "«redacted» is out of credit" }],
      [{ status: "failed" }, { status: "failed", reason: "the server gave no reason" }],
      [{ status: "canceled" }, { status: "cancelled" }],
    ] as const;
    for (const [answer, state] of states) expect(await server({ task_status: () => json(answer) }).gen.status("t-1", signal())).toEqual(state);
    expect(await failureOf(() => server({ task_status: () => json({ status: "dreaming" }) }).gen.status("t-1", signal()))).toMatchObject({
      code: "bad_answer", error: "gen answered task_status in a way MagicBot can't read: it gave no status MagicBot knows",
    });
    expect(await failureOf(() => server({ task_status: () => json({ status: "done" }) }).gen.status("t-1", signal()))).toMatchObject({
      error: "gen answered task_status in a way MagicBot can't read: it said the task succeeded but gave no files",
    });
  });

  it("refuses a tool the server doesn't list by its name, and cancels only with a cancel tool", async () => {
    const without = server({ list_models: () => json({ models: [] }) }, ["list_models"]);
    expect(await failureOf(() => without.gen.generate("image", IMAGE, REQUEST, signal()))).toMatchObject({
      code: "tool_missing", error: "The MCP server gen has no tool called generate_image. Check the tool names in this project's settings.",
    });
    expect(await without.gen.cancel("t-1", signal())).toBe(false);
    const cancelling = server({ cancel_task: () => json({ status: "cancelled" }) });
    expect(await cancelling.gen.cancel("t-1", signal())).toBe(true);
    expect(cancelling.calls).toEqual([{ tool: "cancel_task", args: { taskId: "t-1" } }]);
  });
});
