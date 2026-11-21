import {
  DEFAULT_GENERATION_SETTINGS, IMAGE_COUNT_MAX, type GenerationFailure, type GenerationKind, type GenerationModel, type GenerationTools,
  type ProjectGenerationSettings, type SettingProblem,
} from "../../shared/project-generation.ts";
import { failure, type GenerationErrorName } from "./failure.ts";

const TOOL_NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;
const NAME_MAX = 200;
const CHOICE_MAX = 40;
const SECONDS_MAX = 600;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

type Field = { ok: true; value: unknown } | { ok: false; problem: string };
const accept = (value: unknown): Field => ({ ok: true, value });
const reject = (problem: string): Field => ({ ok: false, problem });

const choice = (label: string) => (value: unknown): Field =>
  (typeof value === "string" && value.trim() !== "" && value.length <= CHOICE_MAX ? accept(value) : reject(`${label} must be a choice of up to ${CHOICE_MAX} characters`));

const FIELDS: Record<GenerationKind, Record<string, (value: unknown) => Field>> = {
  image: {
    model: (value) => (typeof value === "string" && value.length <= NAME_MAX ? accept(value) : reject("image.defaults.model must be a model id")),
    aspect: choice("image.defaults.aspect"),
    quality: choice("image.defaults.quality"),
    count: (value) => (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= IMAGE_COUNT_MAX ? accept(value) : reject(`image.defaults.count must be a whole number from 1 to ${IMAGE_COUNT_MAX}`)),
  },
  video: {
    model: (value) => (typeof value === "string" && value.length <= NAME_MAX ? accept(value) : reject("video.defaults.model must be a model id")),
    resolution: choice("video.defaults.resolution"),
    aspect: choice("video.defaults.aspect"),
    seconds: (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= SECONDS_MAX ? accept(value) : reject(`video.defaults.seconds must be a length from 0 to ${SECONDS_MAX}`)),
  },
};

/**
 * `current` with what `patch` changes, every changed value checked; the reason when one is not a setting. Keys a setting
 * does not have are left out.
 */
export function mergeSettings(current: ProjectGenerationSettings, patch: unknown): ProjectGenerationSettings | string {
  if (!isRecord(patch)) return "send the settings as an object";
  const merged = structuredClone(current);
  for (const kind of ["image", "video"] as const) {
    const part = patch[kind];
    if (part === undefined) continue;
    if (!isRecord(part)) return `${kind} must be an object`;
    if (part.server !== undefined) {
      const server = part.server;
      if (server !== null && !(typeof server === "string" && server.trim() !== "" && server.length <= NAME_MAX)) return `${kind}.server must be an MCP server's name, or null`;
      merged[kind].server = server;
    }
    if (part.tools !== undefined) {
      if (!isRecord(part.tools)) return `${kind}.tools must be an object`;
      for (const key of Object.keys(merged[kind].tools) as Array<keyof GenerationTools>) {
        const name = part.tools[key];
        if (name === undefined) continue;
        if (typeof name !== "string" || !TOOL_NAME.test(name)) return `${kind}.tools.${key} must be a tool's name`;
        merged[kind].tools[key] = name;
      }
    }
    if (part.defaults !== undefined) {
      if (!isRecord(part.defaults)) return `${kind}.defaults must be an object`;
      const defaults = merged[kind].defaults as unknown as Record<string, unknown>;
      for (const [key, check] of Object.entries(FIELDS[kind])) {
        if (part.defaults[key] === undefined) continue;
        const field = check(part.defaults[key]);
        if (!field.ok) return field.problem;
        defaults[key] = field.value;
      }
    }
  }
  return merged;
}

/** Settings read back from disk: what can't be read is the default. */
export function storedSettings(raw: unknown): ProjectGenerationSettings | null {
  if (raw === undefined) return null;
  const merged = mergeSettings(structuredClone(DEFAULT_GENERATION_SETTINGS), raw);
  return typeof merged === "string" ? structuredClone(DEFAULT_GENERATION_SETTINGS) : merged;
}

const REFUSED: Record<Exclude<SettingProblem["key"], "model">, GenerationErrorName> = {
  aspect: "aspectRefused", quality: "qualityRefused", count: "countRefused", resolution: "resolutionRefused", seconds: "secondsRefused",
  referenceImages: "referenceImagesRefused", referenceAudio: "referenceAudioRefused",
};

/** The first problem in words, every problem beside it. */
export function problemFailure(server: string, model: string, models: readonly GenerationModel[], problems: SettingProblem[]): GenerationFailure {
  const first = problems[0]!;
  if (first.key === "model") return failure("model_unknown", "modelUnknown", { server, model }, { problems });
  const name = models.find((candidate) => candidate.id === model)?.name ?? model;
  return failure("setting_refused", REFUSED[first.key], { model: name, value: first.value, offered: first.offered.join(", ") }, { problems });
}
