/**
 * A project is one drama of many episodes, and its production runs by itself once the lead has planned it: the script
 * bot adapts the source into episodes; the character and scene bots design what every episode shares, side by side;
 * then each episode gets a storyboard bot of its own, its shots' videos, and a post bot of its own that cuts its film.
 */

import type { CanvasFileRef } from "./project-canvas.ts";

/** The jobs of a production, in the order work passes through them. */
export const PRODUCTION_JOBS = ["script", "character", "scene", "storyboard", "post"] as const;

export type ProductionJob = (typeof PRODUCTION_JOBS)[number];

/** The jobs one bot does for the whole drama. */
export const DRAMA_JOBS = ["script", "character", "scene"] as const satisfies readonly ProductionJob[];

export type DramaJob = (typeof DRAMA_JOBS)[number];

/** The jobs every episode gets a bot of its own for. */
export const EPISODE_JOBS = ["storyboard", "post"] as const satisfies readonly ProductionJob[];

export type EpisodeJob = (typeof EPISODE_JOBS)[number];

export const isEpisodeJob = (job: ProductionJob): job is EpisodeJob => (EPISODE_JOBS as readonly ProductionJob[]).includes(job);

/** `waiting`: what it needs is not there yet. `working`: its bot has the task. `done`: the bot ended the task's turn
 * well. `failed`: the turn failed or was stopped, or it left nothing of what the task asks for. */
export type ProductionTaskStatus = "waiting" | "working" | "done" | "failed";

/** One task the production gave a bot. */
export interface ProductionTaskWire {
  id: string;
  job: ProductionJob;
  botId: string;
  /** For a storyboard or post task: the episode it is for. */
  episode?: number;
  status: Exclude<ProductionTaskStatus, "waiting">;
  /** When the task's line joined the bot's conversation; absent while it waits in the bot's queue. */
  at?: number;
  endedAt?: number;
}

/** The source the drama is adapted from, as the lead told it when planning. */
export interface ProductionSource {
  title: string;
  author?: string;
  /** Such as the genre, how many chapters and how long it is; four at most. */
  tags?: string[];
  quote?: string;
  /** Where it came from, such as "the TXT you uploaded". */
  from?: string;
  /** Its cover, a picture in the project folder. */
  cover?: CanvasFileRef;
}

/**
 * What the lead planned: who does each job. For `script`, `character` and `scene` the bot does it for the whole drama;
 * for `storyboard` and `post` it is the bot every episode's own bot is a copy of. A job absent here has nobody, and
 * the production passes over it.
 */
export interface ProductionPlanWire {
  assignments: Partial<Record<ProductionJob, string>>;
  /** How many episodes the lead agreed on with the person; the script bot is asked for that many. */
  episodes?: number;
  source?: ProductionSource;
  plannedAt: number;
}

/**
 * `waiting`: not opened yet. `storyboard`: its storyboard bot designs its shots. `videos`: its shots' videos are
 * generated. `post`: its post bot cuts it. `done`: its film's draft is written. `failed`: a task of it failed, or its
 * storyboard left no shot, or a shot's video could not be generated.
 */
export type ProductionEpisodeStatus = "waiting" | "storyboard" | "videos" | "post" | "done" | "failed";

export interface ProductionEpisodeWire {
  /** From 1. */
  episode: number;
  /** The episode's script node. */
  nodeId: string;
  title: string;
  status: ProductionEpisodeStatus;
  storyboardBotId?: string;
  postBotId?: string;
  shots: number;
  /** The shots that have a selected take. */
  ready: number;
  generating: number;
  /** The shots whose last generation failed and that have no take. */
  failed: number;
}

/** A project's production as the app draws it; absent from a canvas until the lead planned one. */
export interface ProductionWire {
  plan: ProductionPlanWire;
  /** The whole-drama jobs that have a bot, in order. */
  jobs: Array<{ job: DramaJob; botId: string; status: ProductionTaskStatus }>;
  /** The storyboard waits for these: every whole-drama job that has a bot is done. */
  ready: boolean;
  /** Every episode the script bot wrote, by number. */
  episodes: ProductionEpisodeWire[];
  /** The newest tasks, oldest first. */
  tasks: ProductionTaskWire[];
  startedAt: number;
  /** Set once every episode is done. */
  endedAt?: number;
}

/** `POST /api/team-projects/:id/production/retry`: a whole-drama job whose task failed, or an episode where it stopped. */
export type ProductionRetryInput = { job: DramaJob } | { episode: number };

/** How many of each the production runs at once in a project. */
export interface ProductionConcurrency {
  /** Episodes in work at the same time. */
  episodes: number;
  /** Videos generating at the same time. */
  videos: number;
  /** Pictures generating at the same time. */
  images: number;
}

export const DEFAULT_PRODUCTION_CONCURRENCY: ProductionConcurrency = { episodes: 3, videos: 2, images: 2 };

export const PRODUCTION_CONCURRENCY_MAX = 50;

/** `production_plan`, the lead's tool: the brief the person agreed to and who does what. */
export interface ProductionPlanInput {
  /** The brief's rows, a label and its value each, as the canvas shows them. */
  brief: Array<[string, string]>;
  episodes?: number;
  /** Bot node ids (`bot:<id>`) or bot ids; a job left out goes to the member whose title names it. */
  assignments?: Partial<Record<ProductionJob, string>>;
  /** The source the drama is adapted from; `cover` is a picture's path in the project folder. */
  source?: Omit<ProductionSource, "cover"> & { cover?: string };
}

/** `EP01` for episode 1. */
export const episodeCode = (episode: number): string => `EP${String(episode).padStart(2, "0")}`;

/** `SH03` for an episode's shot 3. */
export const shotCode = (shot: number): string => `SH${String(shot).padStart(2, "0")}`;
