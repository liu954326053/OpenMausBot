import type { CanvasNode, CanvasNodeSettings } from "../../../shared/project-canvas";
import {
  COMMON_CHOICES,
  modelOffers,
  resolveSettings,
  settingProblems,
  type GenerationKind,
  type GenerationModel,
  type ImageSettings,
  type ProjectGenerationSettings,
  type ReferenceCounts,
  type SettingProblem,
  type VideoSettings,
} from "../../../shared/project-generation";

export const SETTING_KEYS = {
  image: ["model", "aspect", "quality", "count"],
  video: ["model", "resolution", "aspect", "seconds"],
} as const;

export type ImageSettingKey = (typeof SETTING_KEYS.image)[number];
export type VideoSettingKey = (typeof SETTING_KEYS.video)[number];
export type SettingKey = ImageSettingKey | VideoSettingKey;
export type SettingValue = string | number;

/** The generation a node runs, if any. */
export function generationKindOf(node: CanvasNode): GenerationKind | null {
  if (node.type === "image") return "image";
  if (node.type === "video" || node.type === "shot") return "video";
  if (node.type === "config") return node.metadata?.generationMode ?? "image";
  return null;
}

/** The node's overrides that belong to `kind`; a config switched to the other kind ignores the rest. */
export function nodeOverrides(kind: GenerationKind, node: CanvasNode): CanvasNodeSettings {
  const own = node.metadata?.settings ?? {};
  const keys: readonly string[] = SETTING_KEYS[kind];
  return Object.fromEntries(Object.entries(own).filter(([key, value]) => keys.includes(key) && value !== undefined)) as CanvasNodeSettings;
}

export function nodeSettings(kind: "image", project: ProjectGenerationSettings, node: CanvasNode): ImageSettings;
export function nodeSettings(kind: "video", project: ProjectGenerationSettings, node: CanvasNode): VideoSettings;
export function nodeSettings(kind: GenerationKind, project: ProjectGenerationSettings, node: CanvasNode): ImageSettings | VideoSettings;
export function nodeSettings(kind: GenerationKind, project: ProjectGenerationSettings, node: CanvasNode): ImageSettings | VideoSettings {
  return resolveSettings(kind, project[kind].defaults, nodeOverrides(kind, node));
}

export interface SettingRow {
  key: SettingKey;
  value: SettingValue;
  /** The node sets this one itself; otherwise it follows the project. */
  overridden: boolean;
  /** The project's value, which "restore default" goes back to. */
  inherited: SettingValue;
  choices: SettingValue[];
  /** The model does not offer the value. */
  problem?: SettingProblem;
}

function choicesFor(kind: GenerationKind, key: SettingKey, models: readonly GenerationModel[], model: string): SettingValue[] {
  if (key === "model") return models.filter((candidate) => candidate.kind === kind).map((candidate) => candidate.id);
  const found = models.find((candidate) => candidate.kind === kind && candidate.id === model);
  const offers = found ? modelOffers(found) : null;
  if (offers?.kind === "image") return key === "aspect" ? offers.aspects : key === "quality" ? offers.qualities : key === "count" ? offers.counts : [];
  if (offers?.kind === "video") return key === "resolution" ? offers.resolutions : key === "aspect" ? offers.aspects : key === "seconds" ? offers.durations : [];
  if (kind === "image") return key === "aspect" ? [...COMMON_CHOICES.image.aspects] : key === "quality" ? [...COMMON_CHOICES.image.qualities] : key === "count" ? Array.from({ length: COMMON_CHOICES.image.maxCount }, (_, index) => index + 1) : [];
  return key === "resolution" ? [...COMMON_CHOICES.video.resolutions] : key === "aspect" ? [...COMMON_CHOICES.video.aspects] : key === "seconds" ? [...COMMON_CHOICES.video.durations] : [];
}

/**
 * Each setting the node generates with: its value, whether the node overrides it or follows the project, what the
 * model offers, and whether the model refuses it.
 */
export function settingRows(kind: GenerationKind, project: ProjectGenerationSettings, node: CanvasNode, models: readonly GenerationModel[], references?: ReferenceCounts): SettingRow[] {
  const overrides = nodeOverrides(kind, node);
  const settings = nodeSettings(kind, project, node);
  const defaults = project[kind].defaults as unknown as Record<string, SettingValue>;
  const resolved = settings as unknown as Record<string, SettingValue>;
  const own = resolveSettings(kind, project[kind].defaults, overrides) as unknown as Record<string, SettingValue>;
  const problems = models.length ? settingProblems(kind, settings, models, references) : [];
  return SETTING_KEYS[kind].map((key): SettingRow => {
    const overridden = key in overrides && own[key] === (overrides as Record<string, SettingValue>)[key];
    const problem = problems.find((item) => item.key === key);
    return { key, value: resolved[key]!, overridden, inherited: defaults[key]!, choices: choicesFor(kind, key, models, settings.model), ...(problem ? { problem } : {}) };
  });
}

/** Problems with the references rather than a setting. */
export function referenceProblems(kind: GenerationKind, project: ProjectGenerationSettings, node: CanvasNode, models: readonly GenerationModel[], references: ReferenceCounts): SettingProblem[] {
  if (!models.length) return [];
  return settingProblems(kind, nodeSettings(kind, project, node), models, references).filter((problem) => problem.key === "referenceImages" || problem.key === "referenceAudio");
}

/** The node's settings with `key` set to `value`. */
export function overrideSetting(node: CanvasNode, key: SettingKey, value: SettingValue): CanvasNodeSettings {
  return { ...node.metadata?.settings, [key]: value };
}

/** The node's settings with `key` following the project again; null when none are left. */
export function restoreSetting(node: CanvasNode, key: SettingKey): CanvasNodeSettings | null {
  const { [key]: _removed, ...rest } = node.metadata?.settings ?? {};
  return Object.keys(rest).length ? rest : null;
}
