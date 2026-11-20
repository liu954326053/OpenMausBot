import { SKILL_UPLOAD_LIMITS, type SkillUploadResult } from "../../shared/skill-import";
import { api, ApiError } from "@/state/api";
import { activeLocale, t } from "./i18n";
import { skillImportLines } from "./skill-import";

export interface SkillUpload {
  archive?: string;
  files?: Array<{ path: string; content: string }>;
  /** Files of the folder left out for their size, named so the library can say so. */
  oversize?: string[];
  /** The file or folder the person chose. */
  label: string;
}

/** Why what the person chose was not sent. */
export type SkillUploadRefusal = "tooLarge" | "noSkill";

type Picked = Pick<File, "name" | "size" | "arrayBuffer"> & { webkitRelativePath?: string };

const CHUNK = 0x8000;
async function base64Of(file: Picked): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}

const CACHES = new Set(["__pycache__", "node_modules", "venv"]);
/** Hidden entries and the caches a run leaves behind: the library takes neither, so they are not sent. */
const neverTaken = (path: string) => path.split("/").some((part) => part.startsWith(".") || CACHES.has(part.toLowerCase()));
const holdsSkill = (path: string) => path === "SKILL.md" || path.endsWith("/SKILL.md");

export async function archiveUpload(file: Picked): Promise<SkillUpload | SkillUploadRefusal> {
  if (file.size > SKILL_UPLOAD_LIMITS.bytes) return "tooLarge";
  return { archive: await base64Of(file), label: file.name };
}

/** A folder picker lists every file below the chosen folder by a path that starts with that folder's name. */
export async function folderUpload(picked: ArrayLike<Picked>): Promise<SkillUpload | SkillUploadRefusal> {
  const all = Array.from(picked, (file) => ({ file, parts: (file.webkitRelativePath || file.name).split("/") }));
  const label = all.find(({ parts }) => parts.length > 1)?.parts[0] ?? "";
  const inside = all.map(({ file, parts }) => ({ file, path: parts.slice(parts.length > 1 ? 1 : 0).join("/") })).filter(({ path }) => !neverTaken(path));
  if (!inside.some(({ path }) => holdsSkill(path))) return "noSkill";
  const sent = inside.filter(({ file }) => file.size <= SKILL_UPLOAD_LIMITS.fileBytes);
  const oversize = inside.filter(({ file }) => file.size > SKILL_UPLOAD_LIMITS.fileBytes).map(({ path }) => path);
  if (sent.length > SKILL_UPLOAD_LIMITS.files || sent.reduce((total, { file }) => total + file.size, 0) > SKILL_UPLOAD_LIMITS.bytes) return "tooLarge";
  const files: Array<{ path: string; content: string }> = [];
  for (const { file, path } of sent) files.push({ path, content: await base64Of(file) });
  return { files, ...(oversize.length ? { oversize } : {}), label };
}

export const skillUploadRefusalText = (refusal: SkillUploadRefusal): string =>
  refusal === "noSkill" ? t("skills.upload.noSkill") : t("skills.upload.tooLarge", { size: SKILL_UPLOAD_LIMITS.bytes / (1024 * 1024) });

const isResult = (body: unknown): body is SkillUploadResult =>
  ["installed", "unchanged", "conflicts", "errors"].every((key) => Array.isArray((body as Record<string, unknown> | undefined)?.[key]));

/** What the library did with each skill. Skills it already holds under those names with other files come back as
 * `conflicts` and are left alone unless named in `replace`. */
export async function sendSkillUpload(upload: SkillUpload, replace: readonly string[] = []): Promise<SkillUploadResult> {
  try {
    return await api<SkillUploadResult>("/api/skills-library/upload", { method: "POST", body: JSON.stringify({ ...upload, ...(replace.length ? { replace } : {}) }) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && isResult(error.body)) return error.body;
    throw error;
  }
}

export const skillNames = (names: readonly string[]): string =>
  new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format([...names]);

/** What to tell the person about the skills that came in, the ones already there, and the ones that could not be read. */
export function skillUploadLines(result: SkillUploadResult): string[] {
  return [
    ...skillImportLines(result.installed),
    ...(result.installed.length ? [t("skills.import.reviewBelow")] : []),
    ...(result.unchanged.length ? [t("skills.upload.unchanged", { names: skillNames(result.unchanged) })] : []),
    ...(result.errors.length ? [t("skills.upload.problems", { list: result.errors.join("; ") })] : []),
  ];
}
