// Skill packages a person uploads to the skills library: a folder or an archive holding one skill or several. Each
// comes in switched off, as every import does, so the person reads it before any bot can.
import { createHash } from "node:crypto";

import type { SkillUploadResult, SkippedSkillFile } from "../shared/skill-import.ts";
import { prepareSkillFolder, skillFilesDigest, skillImportSummary } from "./skill-folder.ts";
import {
  installLibrarySkill, readSkillLibraryIndex, removeLibrarySkill, restoreLibrarySkill, skillsLibraryRoot,
  type SkillLibraryEntry,
} from "./skill-library.ts";

export const UPLOAD_MAX_SKILLS = 50;

export interface UploadedFile {
  /** "/"-separated, relative to what was uploaded. */
  path: string;
  content: Uint8Array;
  executable?: boolean;
}

const SKILL_FILE = "SKILL.md";
const inside = (folder: string, path: string) => folder === "" || path.startsWith(`${folder}/`);
const relativeTo = (folder: string, path: string) => (folder === "" ? path : path.slice(folder.length + 1));

/** Each folder that holds a SKILL.md and sits in no other such folder, by name, with its files by their path inside it. */
export function skillFoldersIn<T extends { path: string }>(files: readonly T[]): Array<{ folder: string; files: T[] }> {
  const holders = files
    .filter((file) => file.path === SKILL_FILE || file.path.endsWith(`/${SKILL_FILE}`))
    .map((file) => file.path.slice(0, Math.max(0, file.path.length - SKILL_FILE.length - 1)))
    .sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0));
  const folders: string[] = [];
  for (const holder of holders) {
    if (!folders.some((folder) => folder === holder || inside(folder, holder))) folders.push(holder);
  }
  return folders.sort().map((folder) => ({
    folder,
    files: files.filter((file) => inside(folder, file.path)).map((file) => ({ ...file, path: relativeTo(folder, file.path) })),
  }));
}

function sameAsStored(entry: SkillLibraryEntry, skillMd: string, files: ReadonlyArray<{ path: string; content: Uint8Array; executable?: boolean }>): boolean {
  if (entry.sha256 !== createHash("sha256").update(skillMd).digest("hex")) return false;
  return files.length ? entry.filesSha256 === skillFilesDigest(files) : !entry.filesSha256;
}

/** `oversize`: paths in the upload that were too large to read, reported with the skill they belong to. */
export function installUploadedSkills(
  files: readonly UploadedFile[],
  options: { source: string; replace?: ReadonlySet<string>; oversize?: readonly string[]; root?: string },
): SkillUploadResult {
  const root = options.root ?? skillsLibraryRoot();
  const result: SkillUploadResult = { installed: [], unchanged: [], conflicts: [], errors: [] };
  const folders = skillFoldersIn(files);
  if (!folders.length) return { ...result, errors: ["no SKILL.md found in what was uploaded"] };
  if (folders.length > UPLOAD_MAX_SKILLS) result.errors.push(`only the first ${UPLOAD_MAX_SKILLS} skills were read; upload the rest separately`);
  for (const { folder, files: own } of folders.slice(0, UPLOAD_MAX_SKILLS)) {
    const prepared = prepareSkillFolder(own);
    if ("error" in prepared) {
      result.errors.push(`${folder || SKILL_FILE}: ${prepared.error}`);
      continue;
    }
    const name = prepared.parsed.name;
    const existing = readSkillLibraryIndex(root)[name];
    if (existing && sameAsStored(existing, prepared.skillMd, prepared.files)) {
      result.unchanged.push(name);
      continue;
    }
    if (existing && !options.replace?.has(name)) {
      result.conflicts.push(name);
      continue;
    }
    const removed = existing ? removeLibrarySkill(name, root) : undefined;
    if (removed && "error" in removed) {
      result.errors.push(`${name}: ${removed.error}`);
      continue;
    }
    const tooLarge: SkippedSkillFile[] = (options.oversize ?? []).filter((path) => inside(folder, path))
      .map((path) => ({ path: relativeTo(folder, path), reason: "large" }));
    const skipped = [...prepared.skipped, ...tooLarge];
    const installed = installLibrarySkill({
      name,
      instructions: prepared.skillMd,
      source: options.source,
      license: prepared.parsed.license,
      compatibility: prepared.parsed.compatibility,
      warnings: prepared.warnings,
      files: prepared.files,
      skippedFiles: skipped.map((file) => file.path),
      reviewState: "disabled",
      root,
    });
    if ("error" in installed) {
      if (removed) restoreLibrarySkill(removed.undo, root);
      result.errors.push(`${name}: ${installed.error}`);
      continue;
    }
    result.installed.push({ ...skillImportSummary(name, [{ path: SKILL_FILE }, ...prepared.files], skipped), replaced: Boolean(existing) });
  }
  return result;
}
