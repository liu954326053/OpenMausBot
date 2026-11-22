// The one place that knows what a JianYing draft looks like. The format is not published: each entry of DRAFT_FORMATS
// is a shape one JianYing version was seen to list, and a version without an entry is not written for.
import blank118 from "./jianying-11.8/draft_info.json" with { type: "json" };
import meta118 from "./jianying-11.8/draft_meta_info.json" with { type: "json" };

type Json = Record<string, unknown>;

export interface DraftFormat {
  /** The JianYing versions it is written for, each as `major.minor`. */
  versions: readonly string[];
  /** JianYing's own timeline of a draft with nothing in it: every top-level key it expects. */
  blank: Json;
  meta: Json;
}

const DRAFT_FORMATS: readonly DraftFormat[] = [{ versions: ["11.8"], blank: blank118, meta: meta118 }];

export const WRITABLE_JIANYING_VERSIONS: readonly string[] = DRAFT_FORMATS.flatMap((format) => format.versions);

/** Null for a version the writer was never tried against. */
export function draftFormatFor(version: string): DraftFormat | null {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  if (!match) return null;
  return DRAFT_FORMATS.find((format) => format.versions.includes(`${match[1]}.${match[2]}`)) ?? null;
}

export interface DraftClip {
  /** Absolute. */
  path: string;
  name: string;
  bytes: number;
  /** Microseconds. */
  durationUs: number;
  width: number;
  height: number;
}

export interface DraftPlan {
  /** As JianYing lists it; also the folder's name. */
  name: string;
  /** JianYing's draft folder. */
  root: string;
  /** The draft's own folder inside `root`. */
  folder: string;
  clips: readonly DraftClip[];
  /** The first clip's frames a second, when its file says. */
  fps?: number;
  draftId: string;
  /** Microseconds since 1970. */
  createdUs: number;
  modifiedUs: number;
}

/** The project frame rates JianYing 11.8 offers. */
const FRAME_RATES = [24, 25, 30, 50, 60];
const DEFAULT_FRAME_RATE = 30;

function frameRate(fps: number | undefined): number {
  if (fps === undefined) return DEFAULT_FRAME_RATE;
  return FRAME_RATES.reduce((best, rate) => (Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best));
}

// JianYing writes these as JSON numbers with a decimal point ("fps":30.0) and the rest without; the draft it listed
// kept to that, so the writer does too.
const FLOAT_KEYS: ReadonlySet<string> = new Set([
  "fps", "auto_adjust_fixed_value", "color_correction_fixed_value", "crop_scale", "speed", "volume", "last_nonzero_volume", "alpha", "rotation",
  "x", "y", "value", "intensity", "upper_left_x", "upper_left_y", "upper_right_x", "upper_right_y", "lower_left_x", "lower_left_y", "lower_right_x", "lower_right_y",
]);

function write(value: unknown, key: string): string {
  if (typeof value === "number") return FLOAT_KEYS.has(key) && Number.isInteger(value) ? `${value}.0` : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((one) => write(one, key)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([name, one]) => `${JSON.stringify(name)}:${write(one, name)}`).join(",")}}`;
  return JSON.stringify(value);
}

const videoMaterial = (id: string, clip: DraftClip, path: string): Json => ({
  audio_fade: null, category_id: "", category_name: "local", check_flag: 63487,
  crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
  crop_ratio: "free", crop_scale: 1, duration: clip.durationUs, height: clip.height, id, local_material_id: "", material_id: id,
  material_name: clip.name, media_path: "", path, type: "video", width: clip.width,
});

const speedMaterial = (id: string): Json => ({ curve_speed: null, id, mode: 0, speed: 1, type: "speed" });

const segment = (id: string, materialId: string, speedId: string, start: number, duration: number): Json => ({
  enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false, enable_color_wheels: true,
  enable_lut: true, enable_smart_color_adjust: false, last_nonzero_volume: 1, reverse: false, track_attribute: 0, track_render_index: 0, visible: true,
  id, material_id: materialId, target_timerange: { start, duration }, common_keyframes: [], keyframe_refs: [], source_timerange: { start: 0, duration },
  speed: 1, volume: 1, extra_material_refs: [speedId], is_tone_modify: false,
  clip: { alpha: 1, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
  uniform_scale: { on: true, value: 1 }, hdr_settings: { intensity: 1, mode: 1, nits: 1000 }, render_index: 0,
});

/**
 * The two files of a draft: the timeline and the draft's entry in JianYing's list. One video track holds the clips
 * end to end, each whole and at speed 1; the canvas takes the first clip's size. Nothing is copied: each material
 * points at its file by absolute path. `newId` gives a fresh id on every call.
 */
export function buildDraft(format: DraftFormat, plan: DraftPlan, newId: () => string, platform: NodeJS.Platform = process.platform): { timeline: string; meta: string } {
  const shown = (path: string) => (platform === "win32" ? path.replaceAll("\\", "/") : path);
  const timeline = structuredClone(format.blank);
  const materials = timeline.materials as Record<string, Json[]>;
  const segments: Json[] = [];
  let at = 0;
  for (const clip of plan.clips) {
    const materialId = newId();
    const speedId = newId();
    materials.videos!.push(videoMaterial(materialId, clip, shown(clip.path)));
    materials.speeds!.push(speedMaterial(speedId));
    segments.push(segment(newId(), materialId, speedId, at, clip.durationUs));
    at += clip.durationUs;
  }
  const first = plan.clips[0];
  Object.assign(timeline.canvas_config as Json, { width: first?.width ?? 0, height: first?.height ?? 0 });
  timeline.duration = at;
  timeline.fps = frameRate(plan.fps);
  timeline.tracks = [{ attribute: 0, flag: 0, id: newId(), is_default_name: true, name: "", segments, type: "video" }];
  timeline.id = newId();
  const meta: Json = {
    ...structuredClone(format.meta),
    draft_fold_path: shown(plan.folder), draft_id: plan.draftId, draft_name: plan.name, draft_root_path: shown(plan.root),
    draft_timeline_materials_size_: plan.clips.reduce((sum, clip) => sum + clip.bytes, 0),
    tm_draft_create: plan.createdUs, tm_draft_modified: plan.modifiedUs, tm_duration: at,
  };
  return { timeline: write(timeline, ""), meta: write(meta, "") };
}

const NAME_MAX_CHARS = 80;
const FALLBACK_NAME = "MagicBot";
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/** Security: one folder's name and nothing more: no separator, drive, control or reserved character, no leading dot,
 * so joined to the draft folder it names a folder directly inside it. */
export function draftFolderName(projectName: string): string {
  const cleaned = projectName.normalize("NFC").replace(/[\p{Cc}\u2028\u2029/\\:*?"<>|]/gu, "").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  const name = [...cleaned].slice(0, NAME_MAX_CHARS).join("").trim().replace(/[.\s]+$/, "") || FALLBACK_NAME;
  return WINDOWS_DEVICE.test(name) ? `_${name}` : name;
}

export const numberedDraftName = (name: string, number: number): string => (number <= 1 ? name : `${name} ${number}`);
