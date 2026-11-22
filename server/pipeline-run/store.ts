import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { PipelineStageStatus, PipelineVideosStatus } from "../../shared/pipeline-run.ts";
import { PIPELINE_STAGES, type PipelineStage } from "../../shared/team-pipeline.ts";
import { writeFileAtomic } from "../atomic.ts";

/** A task of a stage given to one of its bots. */
export interface RunTask {
  botId: string;
  threadId: string;
  /** `handoff`: the lead handed it with coordinate_bots. `relay`: the run sent it. */
  via: "handoff" | "relay";
  /** The task's line in the conversation; a relayed task waiting in the bot's queue has only `queueId` until it joins. */
  requestId?: string;
  queueId?: string;
  /** When the task's line joined the conversation. */
  at?: number;
  outcome?: "ok" | "failed";
  /** The bot's last reply, when its turn ended well. */
  reply?: string;
}

export interface RunStage {
  stage: PipelineStage;
  botIds: string[];
  status: PipelineStageStatus;
  tasks: RunTask[];
  /** The text nodes on the canvas as the stage started, so the ones its bots add are told apart. */
  textNodesBefore?: string[];
}

export interface StoredRun {
  id: string;
  startedAt: number;
  endedAt?: number;
  stages: RunStage[];
  videos: { status: PipelineVideosStatus; skipped?: boolean };
}

const SAFE_ID = /^[\w-]{1,128}$/;
const STAGE_STATUS = ["waiting", "working", "done", "failed"] as const satisfies readonly PipelineStageStatus[];
const VIDEOS_STATUS = ["waiting", "confirm", "working", "done", "failed"] as const satisfies readonly PipelineVideosStatus[];

const taskSchema = z.object({
  botId: z.string().min(1), threadId: z.string().min(1), via: z.enum(["handoff", "relay"]),
  requestId: z.string().min(1).optional(), queueId: z.string().min(1).optional(), at: z.number().optional(),
  outcome: z.enum(["ok", "failed"]).optional(), reply: z.string().optional(),
});
const runSchema = z.object({
  id: z.string().min(1), startedAt: z.number(), endedAt: z.number().optional(),
  stages: z.array(z.object({
    stage: z.enum(PIPELINE_STAGES), botIds: z.array(z.string().min(1)), status: z.enum(STAGE_STATUS), tasks: z.array(taskSchema),
    textNodesBefore: z.array(z.string()).optional(),
  })),
  videos: z.object({ status: z.enum(VIDEOS_STATUS), skipped: z.boolean().optional() }),
});
const fileSchema = z.object({ version: z.literal(1), projectId: z.string(), run: runSchema });

/** Each project's latest run in `<dir>/<project id>.json`, beside the canvases and never in the project folder. */
export class PipelineRunFiles {
  private readonly dir: string;
  private readonly log: (line: string) => void;

  constructor(dir: string, log: (line: string) => void) {
    this.dir = dir;
    this.log = log;
  }

  /** Null for a project that never ran, and for one whose file cannot be read, which is left as it is. */
  read(projectId: string): StoredRun | null {
    if (!SAFE_ID.test(projectId)) return null;
    let text: string;
    try {
      text = readFileSync(this.file(projectId), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") this.log(`[pipeline-run] the run of project ${projectId} cannot be read (${code ?? "read failed"})`);
      return null;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const checked = fileSchema.safeParse(parsed);
    if (checked.success && checked.data.projectId === projectId) return checked.data.run;
    this.log(`[pipeline-run] the run of project ${projectId} is not a run; it is left as it is`);
    return null;
  }

  write(projectId: string, run: StoredRun): void {
    if (!SAFE_ID.test(projectId)) throw new Error("not a project id");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file(projectId), `${JSON.stringify({ version: 1, projectId, run }, null, 2)}\n`, { mode: 0o600 });
  }

  private file(projectId: string): string {
    return join(this.dir, `${projectId}.json`);
  }
}
