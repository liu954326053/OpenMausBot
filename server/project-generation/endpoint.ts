// What a project's generation needs of whoever makes it: the MCP server convention (docs/project-generation-mcp.md) and an
// installed plugin answer the same four questions, so a job does not care which one it is.

import type { GenerationKind, GenerationModel } from "../../shared/project-generation.ts";
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

export interface GenerationEndpoint {
  /** The plugin's or server's name, for a refusal a person reads. */
  readonly label: string;
  listModels(signal: AbortSignal): Promise<GenerationModel[]>;
  generate(kind: GenerationKind, settings: unknown, request: GenerationRequest, signal: AbortSignal): Promise<Submitted>;
  /** Throws when the endpoint could not say; only a task it says failed is `failed`. */
  status(taskId: string, signal: AbortSignal): Promise<TaskState>;
  /** False when there is nothing to cancel. */
  cancel(taskId: string, signal: AbortSignal): Promise<boolean>;
  /** The endpoint's own address, from which its results may be fetched; null when it has none. */
  resultOrigin(): string | null;
}

const STATUS: Readonly<Record<string, TaskState["status"]>> = {
  queued: "queued", pending: "queued", submitted: "queued", waiting: "queued",
  running: "running", processing: "running", in_progress: "running", generating: "running", started: "running",
  succeeded: "succeeded", success: "succeeded", completed: "succeeded", complete: "succeeded", done: "succeeded", finished: "succeeded",
  failed: "failed", failure: "failed", error: "failed",
  cancelled: "cancelled", canceled: "cancelled",
};

/** The five states MagicBot knows, from a status word in any case; undefined for a word it does not know. */
export function normalizeStatus(value: unknown, map?: Readonly<Record<TaskState["status"], readonly string[]>>): TaskState["status"] | undefined {
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase();
  if (map) {
    for (const status of ["queued", "running", "succeeded", "failed", "cancelled"] as const) {
      if (map[status]?.includes(word)) return status;
    }
  }
  return STATUS[word];
}
