import type { GenerationKind, GenerationModel, GenerationTools, ImageSettings, VideoSettings } from "../../shared/project-generation.ts";
import { refused } from "./failure.ts";
import type { GenerationMcp, McpCaller } from "./mcp-access.ts";
import type { ReferenceFile, ResultSource } from "./project-files.ts";

export interface GenerationRequest {
  prompt: string;
  references: { images: ReferenceFile[]; audio: ReferenceFile[] };
}

export type TaskState =
  | { status: "queued" | "running"; progress?: number; pollAfterMs?: number }
  | { status: "succeeded"; files: ResultSource[] }
  | { status: "failed"; reason: string }
  | { status: "cancelled" };

export type Submitted = { files: ResultSource[] } | { taskId: string };

const MODELS_MAX = 200;
const LIST_MAX = 50;
const FILES_MAX = 10;
const TEXT_MAX = 200;
const NO_REASON = "the server gave no reason";

const STATUS: Readonly<Record<string, TaskState["status"]>> = {
  queued: "queued", pending: "queued", submitted: "queued", waiting: "queued",
  running: "running", processing: "running", in_progress: "running", generating: "running", started: "running",
  succeeded: "succeeded", success: "succeeded", completed: "succeeded", complete: "succeeded", done: "succeeded", finished: "succeeded",
  failed: "failed", failure: "failed", error: "failed",
  cancelled: "cancelled", canceled: "cancelled",
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() && value.length <= TEXT_MAX ? value : undefined);
const texts = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.slice(0, LIST_MAX).map(text).filter((item): item is string => item !== undefined) : undefined);
const positives = (value: unknown): number[] | undefined =>
  (Array.isArray(value) ? value.slice(0, LIST_MAX).filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item > 0) : undefined);

function contentText(result: Record<string, unknown>): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks.filter((block): block is { type: "text"; text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n").trim();
}

/** The answer's JSON: its structured content, or else the JSON of its text. */
function answerOf(result: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  try {
    const parsed: unknown = JSON.parse(contentText(result));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseModels(answer: Record<string, unknown>): GenerationModel[] | null {
  if (!Array.isArray(answer.models)) return null;
  const models: GenerationModel[] = [];
  const seen = new Set<string>();
  for (const raw of answer.models.slice(0, MODELS_MAX)) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    const kind = raw.kind === "image" || raw.kind === "video" ? raw.kind : undefined;
    if (!id || !kind || seen.has(`${kind}\u0000${id}`)) continue;
    seen.add(`${kind}\u0000${id}`);
    const maxCount = typeof raw.maxCount === "number" && Number.isInteger(raw.maxCount) && raw.maxCount > 0 ? raw.maxCount : undefined;
    const lists = {
      resolutions: kind === "video" ? texts(raw.resolutions) : undefined,
      aspects: texts(raw.aspects),
      durations: kind === "video" ? positives(raw.durations) : undefined,
      qualities: kind === "image" ? texts(raw.qualities) : undefined,
    };
    models.push({
      id, name: text(raw.name) ?? id, kind,
      ...Object.fromEntries(Object.entries(lists).filter(([, list]) => list?.length)),
      ...(kind === "image" && maxCount ? { maxCount } : {}),
      referenceImages: raw.referenceImages === true,
      referenceAudio: kind === "video" && raw.referenceAudio === true,
    });
  }
  return models;
}

function parseFiles(answer: Record<string, unknown>, result: Record<string, unknown>): ResultSource[] | null {
  const name = (raw: Record<string, unknown>) => (text(raw.name) ? { name: text(raw.name)! } : {});
  if (Array.isArray(answer.files)) {
    const files: ResultSource[] = [];
    for (const raw of answer.files.slice(0, FILES_MAX)) {
      if (!isRecord(raw)) return null;
      if (typeof raw.url === "string" && raw.url) files.push({ url: raw.url, ...name(raw) });
      else if (typeof raw.data === "string" && raw.data) files.push({ data: raw.data, ...name(raw) });
      else return null;
    }
    return files.length ? files : null;
  }
  const blocks = Array.isArray(result.content) ? result.content.filter((block) => isRecord(block) && block.type === "image" && typeof block.data === "string") : [];
  return blocks.length ? blocks.slice(0, FILES_MAX).map((block) => ({ data: (block as { data: string }).data })) : null;
}

/** The task's state, or what made the answer unreadable. */
function parseState(answer: Record<string, unknown>, result: Record<string, unknown>, mask: (text: string) => string): TaskState | string {
  const status = typeof answer.status === "string" ? STATUS[answer.status.toLowerCase()] : undefined;
  if (!status) return "it gave no status MagicBot knows";
  if (status === "succeeded") {
    const files = parseFiles(answer, result);
    return files ? { status, files } : "it said the task succeeded but gave no files";
  }
  if (status === "failed") {
    const said = [answer.error, answer.reason, answer.message].find((value): value is string => typeof value === "string" && value.trim() !== "");
    return { status, reason: said ? mask(said) || NO_REASON : NO_REASON };
  }
  if (status === "cancelled") return { status };
  const progress = typeof answer.progress === "number" && Number.isFinite(answer.progress) ? Math.min(1, Math.max(0, answer.progress > 1 ? answer.progress / 100 : answer.progress)) : undefined;
  const pollAfterMs = typeof answer.pollAfterMs === "number" && Number.isFinite(answer.pollAfterMs) ? answer.pollAfterMs : undefined;
  return { status, ...(progress === undefined ? {} : { progress }), ...(pollAfterMs === undefined ? {} : { pollAfterMs }) };
}

function generateArguments(kind: GenerationKind, settings: ImageSettings | VideoSettings, request: GenerationRequest): Record<string, unknown> {
  if (kind === "image") {
    const image = settings as ImageSettings;
    return { model: image.model, prompt: request.prompt, referenceImages: request.references.images, aspect: image.aspect, quality: image.quality, count: image.count };
  }
  const video = settings as VideoSettings;
  return {
    model: video.model, prompt: request.prompt, referenceImages: request.references.images, referenceAudio: request.references.audio,
    resolution: video.resolution, aspect: video.aspect, seconds: video.seconds,
  };
}

/** One project's MCP server, spoken to through the convention, with its tools under the names the settings give. */
export function conventionServer(mcp: GenerationMcp, server: string, tools: GenerationTools, as: McpCaller) {
  const call = async (tool: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const listed = await mcp.toolNames(server, as, signal);
    if (!listed.has(tool)) throw refused("tool_missing", "toolMissing", { server, tool });
    return mcp.call(server, tool, args, as, signal);
  };
  const unreadable = (tool: string, detail: string) => refused("bad_answer", "badAnswer", { server, tool, detail });
  const taskFailed = (reason: string) => refused("task_failed", "taskFailed", { server, reason }, { reason });

  return {
    async listModels(signal: AbortSignal): Promise<GenerationModel[]> {
      const answered = await call(tools.listModels, {}, signal);
      if (!answered.ok) throw unreadable(tools.listModels, answered.error);
      if (answered.result.isError === true) throw unreadable(tools.listModels, answered.mask(contentText(answered.result)) || "it failed");
      const models = parseModels(answerOf(answered.result) ?? {});
      if (!models) throw unreadable(tools.listModels, "it gave no list of models");
      return models;
    },

    async generate(kind: GenerationKind, settings: ImageSettings | VideoSettings, request: GenerationRequest, signal: AbortSignal): Promise<Submitted> {
      const tool = tools.generate;
      const answered = await call(tool, generateArguments(kind, settings, request), signal);
      if (!answered.ok) throw taskFailed(answered.error);
      if (answered.result.isError === true) throw taskFailed(answered.mask(contentText(answered.result)) || NO_REASON);
      const answer = answerOf(answered.result) ?? {};
      const taskId = text(answer.taskId) ?? text(answer.task_id);
      if (taskId) return { taskId };
      const files = parseFiles(answer, answered.result);
      if (files) return { files };
      throw unreadable(tool, "it gave neither files nor a task id");
    },

    /** Throws when the server could not say; only a task the server says failed is `failed`. */
    async status(taskId: string, signal: AbortSignal): Promise<TaskState> {
      const answered = await call(tools.taskStatus, { taskId }, signal);
      if (!answered.ok) throw taskFailed(answered.error);
      if (answered.result.isError === true) throw taskFailed(answered.mask(contentText(answered.result)) || NO_REASON);
      const state = parseState(answerOf(answered.result) ?? {}, answered.result, answered.mask);
      if (typeof state === "string") throw unreadable(tools.taskStatus, state);
      return state;
    },

    /** False when the server has no tool to cancel with. */
    async cancel(taskId: string, signal: AbortSignal): Promise<boolean> {
      if (!(await mcp.toolNames(server, as, signal)).has(tools.cancelTask)) return false;
      await mcp.call(server, tools.cancelTask, { taskId }, as, signal);
      return true;
    },
  };
}

export type ConventionServer = ReturnType<typeof conventionServer>;
