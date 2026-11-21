import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { CanvasConflict, CanvasDocument } from "../../shared/project-canvas.ts";
import { writeFileAtomic } from "../atomic.ts";
import { userError } from "../user-errors.ts";
import type { CanvasChangeSet, OpsResult } from "./ops.ts";

/** How many revisions back a change can still be merged. */
export const CANVAS_HISTORY = 200;

const SAFE_ID = /^[\w-]{1,128}$/;
const point = z.object({ x: z.number(), y: z.number() });
const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["bot", "shot", "text", "image", "video", "audio", "file", "config", "group"]),
  title: z.string(),
  position: point,
  width: z.number(),
  height: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdBy: z.union([z.object({ kind: z.literal("person") }), z.object({ kind: z.literal("bot"), botId: z.string().min(1) })]).optional(),
  groupId: z.string().optional(),
});
const connectionSchema = z.object({ id: z.string().min(1), fromNodeId: z.string().min(1), toNodeId: z.string().min(1), kind: z.literal("content") });
const changeSchema = z.object({
  revision: z.number().int().min(1), nodes: z.array(z.string()), connections: z.array(z.string()), viewport: z.literal(true).optional(), backgroundMode: z.literal(true).optional(),
});
const fileSchema = z.object({
  version: z.literal(1),
  document: z.object({
    projectId: z.string(),
    revision: z.number().int().min(0),
    nodes: z.array(nodeSchema),
    connections: z.array(connectionSchema),
    viewport: z.object({ x: z.number(), y: z.number(), k: z.number() }),
    backgroundMode: z.enum(["lines", "dots", "blank"]),
  }),
  history: z.array(changeSchema),
});

type Stored = { document: CanvasDocument; history: Array<CanvasChangeSet & { revision: number }> };
type FileRead = { state: "ok"; data: Stored } | { state: "unreadable"; reason: string };

const empty = (projectId: string): Stored => ({
  document: { projectId, revision: 0, nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" },
  history: [],
});

function readCanvasFile(file: string, projectId: string): FileRead {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { state: "ok", data: empty(projectId) } : { state: "unreadable", reason: code ?? "read failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "unreadable", reason: "not JSON" };
  }
  const checked = fileSchema.safeParse(parsed);
  if (!checked.success || checked.data.document.projectId !== projectId) return { state: "unreadable", reason: "not a canvas" };
  return { state: "ok", data: { document: checked.data.document as CanvasDocument, history: checked.data.history } };
}

export class CanvasUnreadableError extends Error {
  readonly status = 500;
  readonly body = userError("serverError.projectCanvas.unreadable");
  constructor() {
    super(userError("serverError.projectCanvas.unreadable").error);
  }
}

export class CanvasConflictError extends Error {
  readonly status = 409;
  constructor(readonly body: CanvasConflict) {
    super(body.error);
  }
}

export class CanvasRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface CanvasChangeRequest {
  baseRevision?: number;
  /** What the change touches, compared with what changed since `baseRevision`. */
  targets: CanvasChangeSet;
  apply(document: CanvasDocument): OpsResult;
}

export interface CanvasChangeOutcome {
  document: CanvasDocument;
  revision: number;
  changed: CanvasChangeSet;
  nodeIds: string[];
  connectionIds: string[];
}

const isEmpty = (set: CanvasChangeSet) => !set.nodes.length && !set.connections.length && !set.viewport && !set.backgroundMode;

/**
 * `<data dir>/project-canvases/<project id>.json`: one project's canvas, and what each of its last changes touched. Only
 * this process writes it, and every change is read, applied and written without yielding.
 *
 * A file that is there but cannot be read is never taken for an empty canvas: reading and changing it are refused, and it
 * stays as it is until it reads again.
 */
export class CanvasDocuments {
  private readonly kept = new Map<string, Stored>();
  private readonly unreadable = new Map<string, string>();

  constructor(private readonly dir: string, private readonly log: (line: string) => void = (line) => console.error(line)) {}

  private file(projectId: string): string {
    return join(this.dir, `${projectId}.json`);
  }

  private load(projectId: string): Stored {
    if (!SAFE_ID.test(projectId)) throw new CanvasRequestError(404, userError("serverError.teamProject.notFound").error);
    const kept = this.kept.get(projectId);
    if (kept) return kept;
    const read = readCanvasFile(this.file(projectId), projectId);
    if (read.state === "unreadable") {
      if (this.unreadable.get(projectId) !== read.reason) {
        this.unreadable.set(projectId, read.reason);
        this.log(`[project-canvas] ${projectId}: the canvas file could not be read (${read.reason}); it is left as it is`);
      }
      throw new CanvasUnreadableError();
    }
    this.unreadable.delete(projectId);
    this.kept.set(projectId, read.data);
    return read.data;
  }

  /** A copy: changing it changes nothing stored. */
  read(projectId: string): CanvasDocument {
    return structuredClone(this.load(projectId).document);
  }

  change(projectId: string, request: CanvasChangeRequest): CanvasChangeOutcome {
    const stored = this.load(projectId);
    const current = stored.document;
    const base = request.baseRevision;
    if (base !== undefined) {
      if (!Number.isInteger(base) || base < 0 || base > current.revision) throw new CanvasRequestError(400, `baseRevision must be a revision this canvas had (it is at ${current.revision})`);
      if (base < current.revision) this.checkSince(stored, base, request.targets);
    }
    const result = request.apply(structuredClone(current));
    if (isEmpty(result.changed)) return { document: structuredClone(current), revision: current.revision, changed: result.changed, nodeIds: result.nodeIds, connectionIds: result.connectionIds };
    const revision = current.revision + 1;
    const next: Stored = {
      document: { ...result.document, projectId, revision },
      history: [...stored.history, { revision, ...result.changed }].slice(-CANVAS_HISTORY),
    };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file(projectId), `${JSON.stringify({ version: 1, ...next })}\n`, { mode: 0o600 });
    this.kept.set(projectId, next);
    return { document: structuredClone(next.document), revision, changed: result.changed, nodeIds: result.nodeIds, connectionIds: result.connectionIds };
  }

  private checkSince(stored: Stored, base: number, targets: CanvasChangeSet): void {
    const revision = stored.document.revision;
    const since = stored.history.filter((entry) => entry.revision > base);
    if ((since[0]?.revision ?? Number.POSITIVE_INFINITY) !== base + 1) {
      const stale = userError("serverError.projectCanvas.stale");
      throw new CanvasConflictError({ code: "canvas_stale", ...stale, revision, changed: { nodes: [], connections: [] } });
    }
    const nodes = new Set(since.flatMap((entry) => entry.nodes));
    const connections = new Set(since.flatMap((entry) => entry.connections));
    const changed: CanvasChangeSet = {
      nodes: targets.nodes.filter((id) => nodes.has(id)),
      connections: targets.connections.filter((id) => connections.has(id)),
      ...(targets.viewport && since.some((entry) => entry.viewport) ? { viewport: true } : {}),
      ...(targets.backgroundMode && since.some((entry) => entry.backgroundMode) ? { backgroundMode: true } : {}),
    };
    if (isEmpty(changed)) return;
    throw new CanvasConflictError({ code: "canvas_conflict", ...userError("serverError.projectCanvas.conflict"), revision, changed });
  }
}
