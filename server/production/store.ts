import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { PRODUCTION_JOBS, type ProductionJob, type ProductionSource } from "../../shared/production.ts";
import { writeFileAtomic } from "../atomic.ts";

/** A task the production gave a bot. */
export interface ProductionTask {
  id: string;
  job: ProductionJob;
  botId: string;
  /** For a storyboard or post task: the episode it is for. */
  episode?: number;
  threadId: string;
  /** The task's line in the conversation; a task waiting in the bot's queue has only `queueId` until it joins. */
  requestId?: string;
  queueId?: string;
  /** When the task's line joined the conversation. */
  at?: number;
  outcome?: "ok" | "failed";
  endedAt?: number;
  /** The bot's last reply, when its turn ended well. */
  reply?: string;
  /** The lead was told it failed. */
  told?: true;
}

export interface StoredEpisode {
  /** It was opened in a project that has no storyboard bot: its shots are whoever adds them. */
  opened?: true;
  storyboardBotId?: string;
  postBotId?: string;
  /** Its film's draft is written, or it has no post bot and its videos are ready. */
  done?: true;
  /** Why it stopped; cleared when it is tried again. */
  failed?: "storyboard" | "noShots" | "videos" | "post" | "bot";
}

export interface StoredProduction {
  startedAt: number;
  endedAt?: number;
  plan: { assignments: Partial<Record<ProductionJob, string>>; episodes?: number; source?: ProductionSource; plannedAt: number };
  tasks: ProductionTask[];
  /** By episode number. */
  episodes: Record<string, StoredEpisode>;
  /** The script bot's task ended well and left no episode. */
  noEpisodes?: true;
}

const SAFE_ID = /^[\w-]{1,128}$/;
const job = z.enum(PRODUCTION_JOBS);

const taskSchema = z.object({
  id: z.string().min(1), job, botId: z.string().min(1), episode: z.number().int().min(1).optional(), threadId: z.string().min(1),
  requestId: z.string().min(1).optional(), queueId: z.string().min(1).optional(), at: z.number().optional(),
  outcome: z.enum(["ok", "failed"]).optional(), endedAt: z.number().optional(), reply: z.string().optional(), told: z.literal(true).optional(),
});
const productionSchema = z.object({
  startedAt: z.number(), endedAt: z.number().optional(),
  plan: z.object({
    assignments: z.partialRecord(job, z.string().min(1)), episodes: z.number().int().min(1).optional(),
    source: z.object({
      title: z.string().min(1), author: z.string().optional(), tags: z.array(z.string()).optional(), quote: z.string().optional(), from: z.string().optional(),
      cover: z.object({ path: z.string(), mime: z.string(), bytes: z.number(), name: z.string() }).optional(),
    }).optional(),
    plannedAt: z.number(),
  }),
  tasks: z.array(taskSchema),
  episodes: z.record(z.string().regex(/^\d{1,5}$/), z.object({
    opened: z.literal(true).optional(), storyboardBotId: z.string().min(1).optional(), postBotId: z.string().min(1).optional(), done: z.literal(true).optional(),
    failed: z.enum(["storyboard", "noShots", "videos", "post", "bot"]).optional(),
  })),
  noEpisodes: z.literal(true).optional(),
});
const fileSchema = z.object({ version: z.literal(1), projectId: z.string(), production: productionSchema });

/** Each project's production in `<dir>/<project id>.json`, beside the canvases and never in the project folder. */
export class ProductionFiles {
  private readonly dir: string;
  private readonly log: (line: string) => void;

  constructor(dir: string, log: (line: string) => void) {
    this.dir = dir;
    this.log = log;
  }

  /** Null for a project nobody planned, and for one whose file cannot be read, which is left as it is. */
  read(projectId: string): StoredProduction | null {
    if (!SAFE_ID.test(projectId)) return null;
    let text: string;
    try {
      text = readFileSync(this.file(projectId), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") this.log(`[production] the production of project ${projectId} cannot be read (${code ?? "read failed"})`);
      return null;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const checked = fileSchema.safeParse(parsed);
    if (checked.success && checked.data.projectId === projectId) return checked.data.production as StoredProduction;
    this.log(`[production] the production of project ${projectId} is not a production; it is left as it is`);
    return null;
  }

  write(projectId: string, production: StoredProduction): void {
    if (!SAFE_ID.test(projectId)) throw new Error("not a project id");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file(projectId), `${JSON.stringify({ version: 1, projectId, production }, null, 2)}\n`, { mode: 0o600 });
  }

  private file(projectId: string): string {
    return join(this.dir, `${projectId}.json`);
  }
}
