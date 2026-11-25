// A learned skill becomes a library skill: one shelf every bot reads. Nothing is assigned — the library's switch is the
// only gate, so a share never has to decide which teammates get it.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { AppConfig } from "./config.ts";
import { redactSecretsInText } from "./redact.ts";
import { LEARN_SOURCE_PREFIX } from "./skill-learn.ts";
import { installLibrarySkill, libraryArchiveDirectory, listLibrarySkills, readLibrarySkillFile, readSkillLibraryIndex, retireLibrarySkill, skillLibraryEvents, skillsLibraryEnabled, skillsLibraryRoot, updateLibrarySkill } from "./skill-library.ts";
import { archiveSkillDirectory } from "./skills-library-migration.ts";
import { listMigratableSkills, preparedLearnedSkill, removeManifestEntry, STAGED_SKILL_FILE_MAX_BYTES } from "./skills.ts";
import type { SkillShareRecord } from "../shared/skill-request.ts";

export type ShareLearnedSkillsMode = "off" | "ask" | "auto";

export function shareLearnedSkillsMode(cfg: AppConfig): ShareLearnedSkillsMode {
  if (!skillsLibraryEnabled(cfg)) return "off";
  return cfg.features?.shareLearnedSkills ?? "ask";
}

export interface ShareBot {
  id: string;
  name: string;
  section?: string;
  /** Absent: everyone may see the bot. */
  visibility?: unknown;
}

/** The checks stageSkillWrite applies, for a library write that is never staged. */
export function prepareLearnedSkillMd(content: string):
  | { content: string; name: string; description: string; sha256: string; warnings: string[] }
  | { error: string } {
  const redacted = redactSecretsInText(content);
  if (Buffer.byteLength(redacted, "utf8") > STAGED_SKILL_FILE_MAX_BYTES) {
    return { error: `learned SKILL.md files must be at most ${STAGED_SKILL_FILE_MAX_BYTES / 1024}KB` };
  }
  const prepared = preparedLearnedSkill([{ path: "SKILL.md", content: redacted }]);
  if ("error" in prepared) return prepared;
  const text = prepared.files[0]?.content ?? "";
  return { content: text, name: prepared.parsed.name, description: prepared.parsed.description, sha256: sha256Hex(text), warnings: prepared.warnings };
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Every refusal returns `{ error }` and leaves the skill where it was. */
export function shareLearnedSkill(args: {
  author: ShareBot;
  name: string;
  /** The SKILL.md sha256 the receipt applied; any other version is `stale`. */
  expectSha256?: string;
  now?: number;
  root?: string;
}): SkillShareRecord | { error: string; stale?: true } {
  const root = args.root ?? skillsLibraryRoot();
  const at = args.now ?? Date.now();
  const { author, name } = args;
  const copy = listMigratableSkills(author.id).find((skill) => skill.name === name);
  const changed = { error: `"${name}" changed since this receipt — share it from its latest receipt`, stale: true as const };
  let library: SkillShareRecord["library"];
  if (copy) {
    if (args.expectSha256 !== undefined && copy.sha256 !== args.expectSha256) return changed;
    if (!copy.source.startsWith(LEARN_SOURCE_PREFIX)) return { error: `"${name}" was imported, not learned — only learned skills are shared` };
    if (!copy.intact || !copy.directory) return { error: "the stored SKILL.md is missing or changed after review" };
    if (!copy.enabled) return { error: `"${name}" is switched off` };
    let instructions: string;
    try {
      if (readdirSync(copy.directory).some((entry) => entry !== "SKILL.md")) {
        return { error: "the skill has supporting files — the library stores SKILL.md only" };
      }
      instructions = readFileSync(join(copy.directory, "SKILL.md"), "utf8");
    } catch {
      return { error: "could not read the stored SKILL.md" };
    }
    if (sha256Hex(instructions) !== copy.sha256) return { error: "the stored SKILL.md changed after review" };
    const existing = readSkillLibraryIndex(root)[name];
    if (existing && existing.sha256 !== copy.sha256) {
      return { error: `the library already has a different skill named "${name}"` };
    }
    if (existing && existing.reviewState !== "approved") return { error: `the library's "${name}" is switched off` };
    if (!existing) {
      const installed = installLibrarySkill({
        name,
        description: copy.description,
        instructions,
        source: copy.source,
        reviewState: "approved",
        root,
      });
      if ("error" in installed) return installed;
    }
    library = existing ? "deduplicated" : "installed";
    // The library owns the skill from here, so the private copy goes to the write-once archive before the manifest
    // entry does; a skill that moved on meanwhile stays the author's, and the share still completes.
    try {
      archiveSkillDirectory(copy.directory, libraryArchiveDirectory(root, author.id, name), copy.sha256);
    } catch (error) {
      return { error: `could not move the private copy into the library: ${error instanceof Error ? error.message : String(error)}` };
    }
    try {
      const removed = removeManifestEntry(author.id, name, copy.sha256);
      if ("error" in removed) console.warn(`[skill-share] ${name}: ${removed.error}`);
    } catch (error) {
      console.warn(`[skill-share] ${name}: could not drop the private manifest entry: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    const entry = readSkillLibraryIndex(root)[name];
    if (!entry) return { error: `no learned skill named "${name}"` };
    if (args.expectSha256 !== undefined && entry.sha256 !== args.expectSha256) return changed;
    if (!entry.source.startsWith(LEARN_SOURCE_PREFIX)) return { error: `"${name}" was imported, not learned — only learned skills are shared` };
    if (entry.reviewState !== "approved") return { error: `the library's "${name}" is switched off` };
    library = "assigned";
  }
  const sha256 = readSkillLibraryIndex(root)[name]?.sha256 ?? "";
  skillLibraryEvents.emit("invalidate", { kind: "share", name });
  return { library, sha256, sharedAt: at, assigned: [], skipped: [] };
}

export const SHARED_REVISION_CHARS = 12;

/** Applies only while the library holds the version the writer read (`expectSha256`: full hash or revision prefix). */
export function updateSharedLearnedSkill(args: {
  bot: ShareBot;
  name: string;
  skillMd: string;
  expectSha256: string;
  root?: string;
}):
  | { previous: { skillMd: string; source: string }; content: string; sha256: string; warnings: string[]; description: string }
  | { error: string } {
  const root = args.root ?? skillsLibraryRoot();
  const entry = readSkillLibraryIndex(root)[args.name];
  if (!entry) return { error: `no library skill named "${args.name}"` };
  if (!entry.source.startsWith(LEARN_SOURCE_PREFIX)) return { error: `skill "${args.name}" was imported — it cannot be rewritten` };
  if (entry.reviewState !== "approved") return { error: `the library's "${args.name}" is switched off` };
  const prepared = prepareLearnedSkillMd(args.skillMd);
  if ("error" in prepared) return prepared;
  if (prepared.name !== args.name) return { error: `updated SKILL.md name must remain "${args.name}"` };
  const previous = readLibrarySkillFile(args.name, root);
  if (previous === null) return { error: "stored SKILL.md changed after review — restore or remove it before proposing an update" };
  const read = args.expectSha256.trim().toLowerCase();
  if (read.length < SHARED_REVISION_CHARS || !entry.sha256.startsWith(read)) return { error: `skill "${args.name}" changed since it was read — read it again first` };
  if (prepared.sha256 === entry.sha256) return { error: `skill "${args.name}" already matches the proposed SKILL.md` };
  const updated = updateLibrarySkill({ name: args.name, instructions: prepared.content, expectSha256: entry.sha256, root });
  if ("stale" in updated) return { error: `skill "${args.name}" changed since it was read — read it again first` };
  if ("error" in updated) return updated;
  return {
    previous: { skillMd: previous, source: entry.source },
    content: prepared.content,
    sha256: prepared.sha256,
    warnings: prepared.warnings,
    description: prepared.description,
  };
}

/** Only while the library copy is exactly what the share left; otherwise `stale` and nothing changes. */
export function undoSharedLearnedSkill(args: {
  name: string;
  action: "create" | "update";
  share: SkillShareRecord;
  previous?: { skillMd: string; source: string };
  root?: string;
}): { undone: true } | { stale: true } | { error: string } {
  const root = args.root ?? skillsLibraryRoot();
  const entry = readSkillLibraryIndex(root)[args.name];
  if (!entry || entry.sha256 !== args.share.sha256 || readLibrarySkillFile(args.name, root) === null) return { stale: true };
  const { library } = args.share;
  if (library === "installed" && args.action === "create") {
    const retired = retireLibrarySkill(args.name, args.share.sha256, root);
    if (!("retired" in retired)) return retired;
  } else if ((library === "installed" && args.action === "update") || library === "updated") {
    if (!args.previous) return { error: "This change can't be undone here." };
    const restored = updateLibrarySkill({ name: args.name, instructions: args.previous.skillMd, expectSha256: args.share.sha256, source: args.previous.source, root });
    if (!("name" in restored)) return restored;
  } else if (args.action === "update") {
    return { error: "This change can't be undone here." };
  }
  skillLibraryEvents.emit("invalidate", { kind: "unshare", name: args.name });
  return { undone: true };
}

/** A learned skill in the library that this server may rewrite: approved, learned rather than imported, and readable. */
export function sharedSkillEditable(name: string, root: string = skillsLibraryRoot()): boolean {
  const entry = readSkillLibraryIndex(root)[name];
  return Boolean(entry && entry.source.startsWith(LEARN_SOURCE_PREFIX) && entry.reviewState === "approved" && readLibrarySkillFile(name, root) !== null);
}

/** Every switched-on library skill, by name: what every bot may read. */
export const librarySkillNames = (root: string = skillsLibraryRoot()): string[] =>
  listLibrarySkills(root).filter((skill) => skill.enabled).map((skill) => skill.name);
