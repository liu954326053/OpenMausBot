import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts resolves DATA_DIR at import time, so point this suite at a scratch dir before any module loads.
process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skill-upload-"));

const library = await import("./skill-library.ts");
const { installUploadedSkills, skillFoldersIn, UPLOAD_MAX_SKILLS } = await import("./skill-upload.ts");

const SKILL = (name: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: Picks comics.\n---\n\n# ${name}\n\n${body}\n`;
const file = (path: string, content: string, executable = false) => ({ path, content: Buffer.from(content), executable });
const freshRoot = () => mkdtempSync(join(tmpdir(), "omb-skill-upload-root-"));
const upload = (files: ReturnType<typeof file>[], root: string, extra: { replace?: string[]; oversize?: string[] } = {}) =>
  installUploadedSkills(files, { source: "upload:pack.zip", root, replace: new Set(extra.replace ?? []), oversize: extra.oversize });

describe("finding the skills in an upload", () => {
  it("takes a skill at the top, or in the one folder an archive wraps it in", () => {
    expect(skillFoldersIn([file("SKILL.md", "a"), file("notes.md", "b")])).toEqual([
      { folder: "", files: [file("SKILL.md", "a"), file("notes.md", "b")] },
    ]);
    expect(skillFoldersIn([file("pick/SKILL.md", "a"), file("pick/scripts/run.py", "b"), file("README.md", "c")])).toEqual([
      { folder: "pick", files: [file("SKILL.md", "a"), file("scripts/run.py", "b")] },
    ]);
  });

  it("takes each skill of a pack, and keeps a SKILL.md inside a skill as that skill's own file", () => {
    const folders = skillFoldersIn([
      file("pack/b/SKILL.md", "b"), file("pack/a/SKILL.md", "a"), file("pack/a/examples/SKILL.md", "inner"), file("pack/readme.txt", "x"),
    ]);
    expect(folders.map((one) => [one.folder, one.files.map((entry) => entry.path)])).toEqual([
      ["pack/a", ["SKILL.md", "examples/SKILL.md"]], ["pack/b", ["SKILL.md"]],
    ]);
    expect(skillFoldersIn([file("readme.txt", "x")])).toEqual([]);
  });
});

describe("putting uploaded skills in the library", () => {
  it("stores the whole folder switched off, and says what came in and what was left out", () => {
    const root = freshRoot();
    const result = upload([
      file("pick/SKILL.md", SKILL("pick")), file("pick/scripts/run.py", "print('run')\n", true), file("pick/notes.md", "# Notes\n"),
      file("pick/.env", "SECRET=1"),
    ], root, { oversize: ["pick/video.mp4", "other/huge.bin"] });
    expect(result).toEqual({
      installed: [{ name: "pick", files: 3, scripts: 1, replaced: false, skippedCount: 2,
        skipped: [{ path: ".env", reason: "hidden" }, { path: "video.mp4", reason: "large" }] }],
      unchanged: [], conflicts: [], errors: [],
    });
    expect(library.listLibrarySkills(root)[0]).toMatchObject({ name: "pick", enabled: false, source: "upload:pack.zip", files: ["notes.md", "scripts/run.py"] });
    expect(readFileSync(join(library.librarySkillDirectory(root, "pick"), "scripts", "run.py"), "utf8")).toBe("print('run')\n");
    expect(existsSync(join(library.librarySkillDirectory(root, "pick"), ".env"))).toBe(false);
  });

  it("leaves a skill alone when the same files come in again", () => {
    const root = freshRoot();
    const files = [file("pick/SKILL.md", SKILL("pick")), file("pick/notes.md", "# Notes\n")];
    upload(files, root);
    library.setLibrarySkillReviewState("pick", "approved", root);
    expect(upload(files, root)).toEqual({ installed: [], unchanged: ["pick"], conflicts: [], errors: [] });
    expect(library.listLibrarySkills(root)[0]).toMatchObject({ enabled: true });
  });

  it("asks before replacing a skill whose files differ; replacing keeps who it is for and switches it off to be read again", () => {
    const root = freshRoot();
    upload([file("pick/SKILL.md", SKILL("pick")), file("pick/notes.md", "# Notes\n")], root);
    library.setLibrarySkillReviewState("pick", "approved", root);
    library.setLibrarySkillEveryBot("pick", true, root);
    const newer = [file("pick/SKILL.md", SKILL("pick")), file("pick/notes.md", "# Newer notes\n")];

    expect(upload(newer, root)).toEqual({ installed: [], unchanged: [], conflicts: ["pick"], errors: [] });
    expect(readFileSync(join(library.librarySkillDirectory(root, "pick"), "notes.md"), "utf8")).toBe("# Notes\n");

    const replaced = upload(newer, root, { replace: ["pick"] });
    expect(replaced.installed).toMatchObject([{ name: "pick", replaced: true }]);
    expect(library.listLibrarySkills(root)).toMatchObject([{ name: "pick", enabled: false, everyBot: true }]);
    expect(readFileSync(join(library.librarySkillDirectory(root, "pick"), "notes.md"), "utf8")).toBe("# Newer notes\n");
    expect(readdirSync(join(root, "archive", "removed")).some((name) => name.startsWith("pick."))).toBe(true);
  });

  it("brings in the good skills of a pack and names the ones it could not read", () => {
    const root = freshRoot();
    const result = upload([
      file("pack/good/SKILL.md", SKILL("good")), file("pack/broken/SKILL.md", "no frontmatter here"),
    ], root);
    expect(result.installed.map((skill) => skill.name)).toEqual(["good"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^pack\/broken: /);
    expect(upload([file("readme.txt", "x")], root)).toEqual({ installed: [], unchanged: [], conflicts: [], errors: ["no SKILL.md found in what was uploaded"] });
  });

  it("reads no more skills from one upload than the limit", () => {
    const root = freshRoot();
    const many = Array.from({ length: UPLOAD_MAX_SKILLS + 2 }, (_, i) => file(`pack/s${i}/SKILL.md`, SKILL(`s${i}`)));
    const result = upload(many, root);
    expect(result.installed).toHaveLength(UPLOAD_MAX_SKILLS);
    expect(result.errors).toEqual([`only the first ${UPLOAD_MAX_SKILLS} skills were read; upload the rest separately`]);
  });
});
