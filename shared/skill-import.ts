// What a skill brought in from outside carries with it: where it came from, and what came with SKILL.md.

/** The GitHub folder a skill was imported from, at the commit its files were read at. */
export interface GitHubSkillOrigin {
  owner: string;
  repo: string;
  /** The branch, tag or commit the link named; "HEAD" when it named none, which follows the default branch. */
  ref: string;
  /** The 40-hex commit every imported file was read at. */
  commit: string;
  /** The skill's folder inside the repository; "" for the repository root. */
  path: string;
}

/** Why one entry of a skill's folder did not come in. */
export type SkippedSkillFileReason =
  /** A symbolic link. */
  | "link"
  /** Another repository nested inside (a git submodule). */
  | "submodule"
  /** A dot file or dot folder. */
  | "hidden"
  /** A cache a run leaves behind, such as __pycache__ or node_modules. */
  | "generated"
  /** A name some disks cannot hold. */
  | "name"
  /** Differs only in letter case from another entry. */
  | "duplicate"
  /** Deeper than the folder depth limit. */
  | "deep"
  /** Over the size limit for one file. */
  | "large"
  /** Past the folder's file-count or size limit. */
  | "full"
  /** A Git LFS pointer, whose real file GitHub keeps elsewhere. */
  | "lfs"
  /** GitHub would not list the folder, so only SKILL.md came in. */
  | "unlisted";

export interface SkippedSkillFile {
  /** Inside the skill's folder; a folder ends in "/" and stands for everything below it. */
  path: string;
  reason: SkippedSkillFileReason;
}

/** One imported skill, as the import reports it. */
export interface SkillImportSummary {
  name: string;
  /** Every file that came in, SKILL.md included. */
  files: number;
  /** How many of those are scripts. */
  scripts: number;
  /** The first few entries left out; `skippedCount` counts them all. */
  skipped: SkippedSkillFile[];
  skippedCount: number;
}

/** What one upload to the skills library may hold: how many files, their bytes together, and the bytes of one. */
export const SKILL_UPLOAD_LIMITS = { files: 5_000, bytes: 32 * 1024 * 1024, fileBytes: 2 * 1024 * 1024 } as const;

/** One skill an upload put in the library. */
export interface UploadedSkill extends SkillImportSummary {
  /** It took the place of a skill of the same name. */
  replaced: boolean;
}

/** What became of each skill in an uploaded package. */
export interface SkillUploadResult {
  installed: UploadedSkill[];
  /** Already in the library with exactly these files. */
  unchanged: string[];
  /** In the library with other files: left as they are until the person asks to replace them. */
  conflicts: string[];
  errors: string[];
}
