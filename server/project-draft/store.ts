import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { refuse } from "./refusal.ts";

/** The draft this app last wrote for a project, and what tells whether JianYing saved over it since. */
export interface WrittenDraft {
  /** The draft's name in JianYing's list, which is its folder's name. */
  name: string;
  /** 1 for the project's first draft; a later one's name ends in its number. */
  number: number;
  /** Absolute. */
  folder: string;
  draftId: string;
  /** Microseconds since 1970. */
  createdUs: number;
  writtenAt: number;
  /** When this app wrote the project's first draft: a film exported before then is not this draft's. */
  firstWrittenAt: number;
  /** SHA-256 of the timeline file as it was written. */
  fileHash: string;
  /** SHA-256 of the clips it was built from. */
  clipsHash: string;
  /** The older draft JianYing saved over, which was left as it is. */
  kept?: string;
}

/** What is stored for a project: the shots in the order someone set, the shots someone left out, and the draft. */
export interface StoredTimeline {
  order: string[];
  leftOut: string[];
  draft?: WrittenDraft;
}

const SAFE_ID = /^[\w-]{1,128}$/;
const draftSchema = z.object({
  name: z.string().min(1), number: z.number().int().min(1), folder: z.string().min(1), draftId: z.string().min(1), createdUs: z.number(),
  writtenAt: z.number(), firstWrittenAt: z.number(), fileHash: z.string().min(1), clipsHash: z.string().min(1), kept: z.string().min(1).optional(),
});
const fileSchema = z.object({
  version: z.literal(1), projectId: z.string(), order: z.array(z.string()), leftOut: z.array(z.string()), draft: draftSchema.optional(),
});

/** Each project's timeline in `<dir>/<project id>.json`, beside the canvases and never in the project folder. */
export class ProjectTimelines {
  private readonly dir: string;
  private readonly log: (line: string) => void;

  constructor(dir: string, log: (line: string) => void) {
    this.dir = dir;
    this.log = log;
  }

  /** A file that is there and cannot be read is never replaced: reading and writing are both refused until it is restored. */
  read(projectId: string): StoredTimeline {
    if (!SAFE_ID.test(projectId)) throw refuse(404, "serverError.teamProject.notFound");
    let text: string;
    try {
      text = readFileSync(this.file(projectId), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { order: [], leftOut: [] };
      throw this.unreadable(projectId, code ?? "read failed");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.unreadable(projectId, "not JSON");
    }
    const checked = fileSchema.safeParse(parsed);
    if (!checked.success || checked.data.projectId !== projectId) throw this.unreadable(projectId, "not a timeline");
    const { order, leftOut, draft } = checked.data;
    return { order, leftOut, ...(draft ? { draft } : {}) };
  }

  write(projectId: string, next: StoredTimeline): void {
    this.read(projectId);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file(projectId), `${JSON.stringify({ version: 1, projectId, ...next }, null, 2)}\n`, { mode: 0o600 });
  }

  private file(projectId: string): string {
    return join(this.dir, `${projectId}.json`);
  }

  private unreadable(projectId: string, reason: string): Error {
    this.log(`[project-draft] the timeline of project ${projectId} cannot be read (${reason}); it is left as it is`);
    return refuse(500, "serverError.projectDraft.unreadable");
  }
}
