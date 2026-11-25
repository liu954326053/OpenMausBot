// Per-bot skill copies move into the shared library, which every bot reads. A copy that moved on disk since its review
// stays where it is: the manifest is the only record that can still be verified.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  installLibrarySkill,
  libraryArchiveDirectory,
  readSkillLibraryIndex,
  skillsLibraryRoot,
} from "./skill-library.ts";
import { listMigratableSkills, removeManifestEntry } from "./skills.ts";

export interface SkillMigrationOutcome {
  botId: string;
  name: string;
  outcome: "migrated" | "deduplicated" | "skipped";
  detail?: string;
}

export interface SkillsMigrationReport {
  ranAt: string;
  outcomes: SkillMigrationOutcome[];
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function archiveSkillDirectory(source: string, archive: string, expectSha256: string): void {
  mkdirSync(dirname(archive), { recursive: true, mode: 0o700 });
  let destination = archive;
  if (existsSync(destination)) {
    const stem = `${archive}.${expectSha256}`;
    destination = stem;
    let suffix = 1;
    while (existsSync(destination)) destination = `${stem}.${suffix++}`;
  }
  try {
    renameSync(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
  }
  const archived = readFileSync(join(destination, "SKILL.md"), "utf8");
  if (sha256Hex(archived) !== expectSha256) {
    throw new Error("the archived copy does not match the reviewed sha256");
  }
}

export function migrateBotSkillsToLibrary(botId: string, root: string = skillsLibraryRoot()): SkillMigrationOutcome[] {
  const outcomes: SkillMigrationOutcome[] = [];
  for (const copy of listMigratableSkills(botId)) {
    if (!copy.intact || !copy.directory) {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: "stored SKILL.md is missing or changed after review" });
      continue;
    }
    try {
      if (readdirSync(copy.directory).some((name) => name !== "SKILL.md")) {
        outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: "skill has auxiliary files — keeping its complete private directory" });
        continue;
      }
    } catch {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: "could not inspect the private skill directory" });
      continue;
    }
    let instructions: string;
    try {
      instructions = readFileSync(join(copy.directory, "SKILL.md"), "utf8");
    } catch (error) {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: `could not read the stored SKILL.md: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (sha256Hex(instructions) !== copy.sha256) {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: "stored SKILL.md changed after review" });
      continue;
    }
    const existing = readSkillLibraryIndex(root)[copy.name];
    if (existing && existing.sha256 !== copy.sha256) {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: `the library already has a different "${copy.name}" — rename one of them` });
      continue;
    }
    // The entry's review state is the library's one switch, so deduplicating a copy whose on/off differs would flip it
    // for every bot.
    if (existing && (existing.reviewState === "approved") !== copy.enabled) {
      outcomes.push({
        botId,
        name: copy.name,
        outcome: "skipped",
        detail: `the library "${copy.name}" is ${existing.reviewState === "approved" ? "enabled" : "disabled"} while this bot had it ${copy.enabled ? "enabled" : "disabled"} — align them before migrating`,
      });
      continue;
    }
    if (!existing) {
      const installed = installLibrarySkill({
        name: copy.name,
        description: copy.description,
        instructions,
        source: copy.source,
        license: copy.license,
        compatibility: copy.compatibility,
        reviewState: copy.enabled ? "approved" : "disabled",
        package: copy.package,
        root,
      });
      if ("error" in installed) {
        outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: installed.error });
        continue;
      }
      outcomes.push({ botId, name: copy.name, outcome: "migrated" });
    } else {
      outcomes.push({ botId, name: copy.name, outcome: "deduplicated", detail: "identical sha256 already in the library" });
    }
    try {
      archiveSkillDirectory(copy.directory, libraryArchiveDirectory(root, botId, copy.name), copy.sha256);
    } catch (error) {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: `archiving failed: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const removed = removeManifestEntry(botId, copy.name, copy.sha256);
    if ("error" in removed) {
      outcomes.push({ botId, name: copy.name, outcome: "skipped", detail: removed.error });
    }
  }
  return outcomes;
}

export function botIdsWithSkillState(dataDir: string): string[] {
  try {
    return readdirSync(join(dataDir, "skill-state"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Boot sweep: finishes moving private copies a share left behind. `migrate: false` keeps each bot's own skills where
 * they are and only revisits copies already moved. */
export function runSkillsLibraryBootSweep(options: {
  bots: readonly { id: string }[];
  root?: string;
  migrate?: boolean;
}): SkillsMigrationReport {
  const root = options.root ?? skillsLibraryRoot();
  const outcomes: SkillMigrationOutcome[] = [];
  if (options.migrate !== false) {
    for (const bot of options.bots) outcomes.push(...migrateBotSkillsToLibrary(bot.id, root));
  }
  return { ranAt: new Date().toISOString(), outcomes };
}
