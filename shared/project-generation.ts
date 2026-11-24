// A project's images and videos are made by an MCP server the person set up, never by a model rewriting the request on
// the way. These are the project's generation settings, what a canvas node inherits of them, what a model offers, a
// generation job, the wire of `/api/team-projects/:id/generation/*`, and the server's own API for whoever starts a job.

import { DEFAULT_PRODUCTION_CONCURRENCY, type ProductionConcurrency } from "./production.ts";

export type GenerationKind = "image" | "video";

/** One image generation: `count` pictures, each of `aspect` (such as "16:9") at `quality`, made by `model`. */
export interface ImageSettings {
  /** A model id from the server's list-models tool; "" when none is chosen yet. */
  model: string;
  aspect: string;
  quality: string;
  count: number;
}

/** One video generation: a clip of `seconds` seconds at `resolution` (such as "1080p") and `aspect`, made by `model`. */
export interface VideoSettings {
  /** A model id from the server's list-models tool; "" when none is chosen yet. */
  model: string;
  resolution: string;
  aspect: string;
  seconds: number;
}

export type SettingsOf<K extends GenerationKind> = K extends "image" ? ImageSettings : VideoSettings;

/**
 * What a canvas node changes of its project's settings: the node's `metadata.settings`. A key that is absent follows the
 * project, so a change to the project reaches it; "restore default" removes the key.
 */
export type ImageOverrides = Partial<ImageSettings>;
export type VideoOverrides = Partial<VideoSettings>;

/** The real names, on the chosen MCP server, of the tools that serve each purpose (docs/project-generation-mcp.md). */
export interface GenerationTools {
  listModels: string;
  generate: string;
  taskStatus: string;
  /** Optional on the server: when it lists a tool of this name, a cancelled job's task is cancelled there too. */
  cancelTask: string;
}

export interface GenerationKindSettings<S> {
  /** The MCP server's name, as in Apps → MCP servers. Null: none chosen, and generation is refused until one is. */
  server: string | null;
  tools: GenerationTools;
  /** What a node that overrides nothing generates with. */
  defaults: S;
}

/** A project's own generation settings, kept on the server. A new project starts from the ones the person saved last. */
export interface ProjectGenerationSettings {
  image: GenerationKindSettings<ImageSettings>;
  video: GenerationKindSettings<VideoSettings>;
  /** How many episodes, videos and pictures the project's production runs at once. */
  concurrency: ProductionConcurrency;
}

/** What a model offers when the server gives no list (or an empty one) for it. */
export const COMMON_CHOICES = {
  image: { aspects: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"], qualities: ["auto", "low", "medium", "high"], maxCount: 4 },
  video: { resolutions: ["480p", "720p", "1080p"], aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: [5, 10] },
} as const;

/** The most pictures one image generation may ask for, whatever a model claims. */
export const IMAGE_COUNT_MAX = 10;

function frozen<T>(value: T): T {
  if (value && typeof value === "object") for (const inner of Object.values(value)) frozen(inner);
  return Object.freeze(value);
}

/** The settings of a project that has none of its own and nothing saved before. Frozen: copy it to change it. */
export const DEFAULT_GENERATION_SETTINGS: ProjectGenerationSettings = frozen({
  image: {
    server: null,
    tools: { listModels: "list_models", generate: "generate_image", taskStatus: "task_status", cancelTask: "cancel_task" },
    defaults: { model: "", aspect: "1:1", quality: "auto", count: 1 },
  },
  video: {
    server: null,
    tools: { listModels: "list_models", generate: "generate_video", taskStatus: "task_status", cancelTask: "cancel_task" },
    defaults: { model: "", resolution: "720p", aspect: "16:9", seconds: 5 },
  },
  concurrency: { ...DEFAULT_PRODUCTION_CONCURRENCY },
});

/**
 * A model as the server's list-models tool describes it. A list that is absent or empty means the server gave none, and
 * `modelOffers` puts the common choices in its place.
 */
export interface GenerationModel {
  id: string;
  name: string;
  kind: GenerationKind;
  /** Video: the resolutions it makes, such as "720p". */
  resolutions?: string[];
  aspects?: string[];
  /** Video: the lengths it makes, in seconds. */
  durations?: number[];
  /** Image: the qualities it makes. */
  qualities?: string[];
  /** Image: the most pictures one generation makes. */
  maxCount?: number;
  /** Whether it takes reference images. */
  referenceImages: boolean;
  /** Whether it takes reference audio. Never for an image model. */
  referenceAudio: boolean;
}

/** What can be chosen for one model: the server's lists, or the common choices where it gave none. */
export type ModelOffers =
  | { kind: "image"; aspects: string[]; qualities: string[]; counts: number[]; referenceImages: boolean; referenceAudio: false }
  | { kind: "video"; resolutions: string[]; aspects: string[]; durations: number[]; referenceImages: boolean; referenceAudio: boolean };

const listOr = <T,>(list: readonly T[] | undefined, fallback: readonly T[]): T[] => (list?.length ? [...list] : [...fallback]);

export function modelOffers(model: GenerationModel): ModelOffers {
  if (model.kind === "image") {
    const most = typeof model.maxCount === "number" && model.maxCount >= 1 ? Math.min(Math.floor(model.maxCount), IMAGE_COUNT_MAX) : COMMON_CHOICES.image.maxCount;
    return {
      kind: "image",
      aspects: listOr(model.aspects, COMMON_CHOICES.image.aspects),
      qualities: listOr(model.qualities, COMMON_CHOICES.image.qualities),
      counts: Array.from({ length: most }, (_, index) => index + 1),
      referenceImages: model.referenceImages,
      referenceAudio: false,
    };
  }
  return {
    kind: "video",
    resolutions: listOr(model.resolutions, COMMON_CHOICES.video.resolutions),
    aspects: listOr(model.aspects, COMMON_CHOICES.video.aspects),
    durations: listOr(model.durations, COMMON_CHOICES.video.durations),
    referenceImages: model.referenceImages,
    referenceAudio: model.referenceAudio,
  };
}

type Rule = "text" | "count" | "length";
const RULES: { image: Record<keyof ImageSettings, Rule>; video: Record<keyof VideoSettings, Rule> } = {
  image: { model: "text", aspect: "text", quality: "text", count: "count" },
  video: { model: "text", resolution: "text", aspect: "text", seconds: "length" },
};

function fits(rule: Rule, value: unknown): boolean {
  if (rule === "text") return typeof value === "string" && value.trim() !== "";
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
  return rule === "length" || Number.isInteger(value);
}

/**
 * A node's settings: each key the node overrides wins, every other key is its project's. An override of the wrong type,
 * a blank one and a key no setting has are left out, so they follow the project.
 */
export function resolveSettings(kind: "image", project: ImageSettings, node?: ImageOverrides | null): ImageSettings;
export function resolveSettings(kind: "video", project: VideoSettings, node?: VideoOverrides | null): VideoSettings;
export function resolveSettings(kind: GenerationKind, project: ImageSettings | VideoSettings, node?: ImageOverrides | VideoOverrides | null): ImageSettings | VideoSettings;
export function resolveSettings(kind: GenerationKind, project: ImageSettings | VideoSettings, node?: ImageOverrides | VideoOverrides | null): ImageSettings | VideoSettings {
  const own = (node ?? {}) as Record<string, unknown>;
  const base = project as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(RULES[kind])) out[key] = fits(rule, own[key]) ? own[key] : base[key];
  return out as unknown as ImageSettings | VideoSettings;
}

/** One setting a model does not offer, with what it does offer. For `model`, `offered` is the ids the server lists. */
export interface SettingProblem {
  key: "model" | "aspect" | "quality" | "count" | "resolution" | "seconds" | "referenceImages" | "referenceAudio";
  value: string | number;
  offered: Array<string | number>;
}

/** How many references a generation hands over, when it is about to run. */
export interface ReferenceCounts {
  images: number;
  audio: number;
}

/**
 * The settings `models` does not offer for this generation, in the order a form shows them; none when it may run. A model
 * the server does not list (or lists for the other kind) is the only problem named, since nothing else can be judged.
 */
export function settingProblems(kind: GenerationKind, settings: ImageSettings | VideoSettings, models: readonly GenerationModel[], references?: ReferenceCounts): SettingProblem[] {
  const model = models.find((candidate) => candidate.kind === kind && candidate.id === settings.model);
  if (!model) return [{ key: "model", value: settings.model, offered: models.filter((candidate) => candidate.kind === kind).map((candidate) => candidate.id) }];
  const offers = modelOffers(model);
  const problems: SettingProblem[] = [];
  const check = (key: SettingProblem["key"], value: string | number, offered: Array<string | number>) => {
    if (!offered.includes(value)) problems.push({ key, value, offered });
  };
  if (offers.kind === "image") {
    const image = settings as ImageSettings;
    check("aspect", image.aspect, offers.aspects);
    check("quality", image.quality, offers.qualities);
    check("count", image.count, offers.counts);
  } else {
    const video = settings as VideoSettings;
    check("resolution", video.resolution, offers.resolutions);
    check("aspect", video.aspect, offers.aspects);
    check("seconds", video.seconds, offers.durations);
  }
  if (references?.images && !offers.referenceImages) problems.push({ key: "referenceImages", value: references.images, offered: [] });
  if (references?.audio && !offers.referenceAudio) problems.push({ key: "referenceAudio", value: references.audio, offered: [] });
  return problems;
}

const firstUnless = <T>(value: T, offered: readonly T[]): T => (offered.includes(value) ? value : offered[0]!);
const nearest = (value: number, offered: readonly number[]): number =>
  offered.reduce((best, choice) => (Math.abs(choice - value) < Math.abs(best - value) ? choice : best));

/**
 * `settings` with each value `model` does not offer replaced by one it does: the nearest count or length, otherwise its
 * first choice. A form that shows these once a model is chosen can always save what it shows.
 */
export function fitSettings(kind: "image", settings: ImageSettings, model: GenerationModel): ImageSettings;
export function fitSettings(kind: "video", settings: VideoSettings, model: GenerationModel): VideoSettings;
export function fitSettings(kind: GenerationKind, settings: ImageSettings | VideoSettings, model: GenerationModel): ImageSettings | VideoSettings;
export function fitSettings(kind: GenerationKind, settings: ImageSettings | VideoSettings, model: GenerationModel): ImageSettings | VideoSettings {
  const offers = modelOffers(model);
  if (offers.kind !== kind) return settings;
  if (offers.kind === "image") {
    const image = settings as ImageSettings;
    return { ...image, aspect: firstUnless(image.aspect, offers.aspects), quality: firstUnless(image.quality, offers.qualities), count: nearest(image.count, offers.counts) };
  }
  const video = settings as VideoSettings;
  return { ...video, resolution: firstUnless(video.resolution, offers.resolutions), aspect: firstUnless(video.aspect, offers.aspects), seconds: nearest(video.seconds, offers.durations) };
}

/** Where results are saved, as folders under the project folder. */
export const GENERATION_OUTPUT_FOLDERS: Readonly<Record<GenerationKind, readonly [string, string]>> = frozen({ image: ["产出", "图片"], video: ["产出", "视频"] });

/** The most references one generation hands over, and how large each may be. */
export const REFERENCE_LIMITS = frozen({ images: 8, audio: 2, imageBytes: 10 * 1024 * 1024, audioBytes: 20 * 1024 * 1024, totalBytes: 40 * 1024 * 1024 });

/** Files in the project folder a generation takes as references, by their path relative to it, as on canvas nodes. */
export interface GenerationReferences {
  images: string[];
  audio: string[];
}

/** Who asked. A bot's request the person confirmed on a card is `confirmed`, and its ceiling does not count it. */
export type GenerationRequester = { kind: "person" } | { kind: "bot"; botId: string; confirmed?: true };

/** A result file, in the shape of a canvas node's `metadata.file`: `path` is relative to the project folder, with "/". */
export interface GenerationFile {
  path: string;
  mime: string;
  bytes: number;
  name: string;
}

export type GenerationJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/**
 * Why a generation was refused or failed:
 * - `invalid`: the request itself is not one (no prompt, an unknown kind…).
 * - `project_unavailable`: no such project, it is archived, or its folder is not there.
 * - `no_server`: no MCP server is chosen for this kind in the project's settings.
 * - `server_unusable`: the chosen server is gone, off, runs on another computer, is not allowed by the organisation, or
 *   is one bot's own or each person's own.
 * - `sign_in`: the server needs the person to sign in to it.
 * - `keys`: the server refused its keys, or its key in the Vault cannot be read.
 * - `unreachable`: the server could not be reached or started, or did not answer in time.
 * - `tool_missing`: the server has no tool by the name the settings give.
 * - `no_model`: no model is chosen.
 * - `model_unknown`: the server lists no such model of this kind; `problems` names the ones it lists.
 * - `setting_refused`: the model does not offer a setting; `problems` says what it offers.
 * - `reference_refused`: a reference is not a readable image or audio file in the project folder, or too many or too large.
 * - `too_many`: the project has too many generations waiting or running.
 * - `confirmation_needed`: a bot asked past its ceiling; `allowance` says how far. The person confirms on a card.
 * - `bad_answer`: the server's answer does not follow the convention.
 * - `task_failed`: the task failed on the server; `reason` is the server's own words.
 * - `download_failed`: the result could not be downloaded, read or saved.
 * - `timed_out`: no result came in time.
 * - `interrupted`: MagicBot stopped while handing the job over, so whether the server started it is unknown.
 */
export type GenerationFailureCode =
  | "invalid" | "project_unavailable" | "no_server" | "server_unusable" | "sign_in" | "keys" | "unreachable" | "tool_missing"
  | "no_model" | "model_unknown" | "setting_refused" | "reference_refused" | "too_many" | "confirmation_needed"
  | "bad_answer" | "task_failed" | "download_failed" | "timed_out" | "interrupted";

/** Never carries a key: an MCP server's words are masked before they get here. */
export interface GenerationFailure {
  code: GenerationFailureCode;
  /** The reason in English, for a caller that has no words of its own. */
  error: string;
  /** The `serverError.*` key of `error` in the app's language files, and what its placeholders stand for. */
  errorKey: string;
  errorParams?: Record<string, string | number>;
  /** `task_failed`: the server's own reason. */
  reason?: string;
  /** `model_unknown`, `setting_refused`. */
  problems?: SettingProblem[];
  /** `confirmation_needed`: how many of this kind the bot started without the person in the window, its ceiling, and how many it asked for. */
  allowance?: { used: number; ceiling: number; asked: number };
}

interface GenerationJobBase {
  id: string;
  projectId: string;
  status: GenerationJobStatus;
  /** The canvas node the job is for. Opaque here. */
  nodeId: string;
  requester: GenerationRequester;
  /** As handed to the MCP tool. */
  prompt: string;
  references: GenerationReferences;
  /** The MCP server and tool it is handed to. */
  server: string;
  tool: string;
  /** The server's task id, once it gave one. */
  taskId?: string;
  /** From 0 to 1, when the server says. */
  progress?: number;
  /** The results, saved in the project folder. An image job may make several. */
  files: GenerationFile[];
  failure?: GenerationFailure;
  createdAt: number;
  updatedAt: number;
  /** When it was handed to the MCP server. */
  submittedAt?: number;
  finishedAt?: number;
}

/** One generation. Its `settings` are the node's resolved settings, handed to the tool as they are. */
export type GenerationJob =
  | (GenerationJobBase & { kind: "image"; settings: ImageSettings })
  | (GenerationJobBase & { kind: "video"; settings: VideoSettings });

/** The status a canvas node (`metadata.status`) shows while its job is in each state. */
export type GenerationNodeStatus = "idle" | "loading" | "success" | "error";

export function nodeStatusOf(status: GenerationJobStatus): GenerationNodeStatus {
  if (status === "queued" || status === "running") return "loading";
  if (status === "done") return "success";
  return status === "failed" ? "error" : "idle";
}

/** `POST /api/team-projects/:id/generation/jobs`, and the server's `start`. */
export interface StartGenerationInput {
  kind: GenerationKind;
  /** The canvas node the result is for. */
  nodeId: string;
  prompt: string;
  references?: Partial<GenerationReferences>;
  /** Only the settings the node overrides; the rest come from the project's settings when the job starts. */
  overrides?: ImageOverrides | VideoOverrides;
  /** What to call the result files, such as the node's title. Made safe and unique by the server. */
  name?: string;
}

/** A bot may start this many results of each kind in `BOT_GENERATION_WINDOW_MS` without the person; past it, the person confirms. */
export const BOT_GENERATION_CEILING: Readonly<Record<GenerationKind, number>> = frozen({ image: 8, video: 3 });
export const BOT_GENERATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What a bot started without the person in the last `windowMs`, counted in results (a job of four pictures counts four). */
export interface BotGenerationAllowance {
  image: { used: number; ceiling: number };
  video: { used: number; ceiling: number };
  windowMs: number;
}

/** `GET /api/team-projects/:id/generation/settings`, and the answer to `PUT`. */
export interface GenerationSettingsWire {
  settings: ProjectGenerationSettings;
  /** The MCP servers that can be chosen: on, run here, and every bot's. */
  servers: string[];
}

/** `GET /api/team-projects/:id/generation/models?kind=image|video`, optionally `&server=…&tool=…` to look at a server not saved yet. */
export interface GenerationModelsWire {
  models: GenerationModel[];
}

/** `GET …/generation/jobs/:jobId`, the answer to `POST …/generation/jobs` (202) and to `POST …/generation/jobs/:jobId/cancel`. */
export interface GenerationJobWire {
  job: GenerationJob;
}

/** `GET …/generation/jobs`: the project's jobs that have not ended, then the latest that have, newest first. */
export interface GenerationJobsWire {
  jobs: GenerationJob[];
}

export type Refused = { refused: GenerationFailure };

export interface StartGenerationOptions {
  requester: GenerationRequester;
  /** Hears every change to this job, after it is saved. Jobs picked up again after a restart reach `onJobChange` only. */
  onChange?(job: GenerationJob): void;
}

/** What the rest of the server asks of project generation. */
export interface ProjectGenerationApi {
  /** Null: no such project. */
  settings(projectId: string): ProjectGenerationSettings | null;
  /** Refused with what the chosen model offers when it does not offer a default; saved as the person's last settings too. */
  saveSettings(projectId: string, settings: ProjectGenerationSettings): Promise<{ settings: ProjectGenerationSettings } | Refused>;
  /** The models of this kind the project's server lists, or `preview`'s server not saved yet. */
  models(projectId: string, kind: GenerationKind, preview?: { server: string; tool?: string }): Promise<{ models: GenerationModel[] } | Refused>;
  /** The same for the person and for a bot. A bot past its ceiling is refused `confirmation_needed` unless `confirmed`. */
  start(projectId: string, input: StartGenerationInput, options: StartGenerationOptions): Promise<{ job: GenerationJob } | Refused>;
  job(projectId: string, jobId: string): GenerationJob | null;
  jobs(projectId: string): GenerationJob[];
  /** Null: no such job. A job that has ended is returned as it is. */
  cancel(projectId: string, jobId: string): GenerationJob | null;
  /** Every change to every job, also to jobs picked up again after a restart. Returns the way to stop listening. */
  onJobChange(listener: (job: GenerationJob) => void): () => void;
  botAllowance(projectId: string, botId: string): BotGenerationAllowance;
}
