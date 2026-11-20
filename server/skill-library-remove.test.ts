import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts resolves DATA_DIR at import time, so point this suite at a scratch dir before any module loads.
process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skill-remove-"));

const library = await import("./skill-library.ts");

const SKILL = (name: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: Picks comics.\n---\n\n# ${name}\n\n${body}\n`;
const freshRoot = () => mkdtempSync(join(tmpdir(), "omb-skill-remove-root-"));

describe("removing a skill from the library", () => {
  it("takes it out of the list and keeps its files in the archive", () => {
    const root = freshRoot();
    library.installLibrarySkill({ name: "pick", instructions: SKILL("pick"), source: "upload:a.zip", reviewState: "approved", root,
      files: [{ path: "scripts/run.py", content: "print('run')\n", executable: true }] });
    const removed = library.removeLibrarySkill("pick", root);
    expect(removed).toMatchObject({ removed: true });
    if (!("undo" in removed)) return;
    expect(removed.undo).toMatch(/^pick\.[0-9a-f-]{36}$/);
    expect(library.listLibrarySkills(root)).toEqual([]);
    expect(existsSync(library.librarySkillDirectory(root, "pick"))).toBe(false);
    expect(readFileSync(join(root, "archive", "removed", removed.undo, "scripts", "run.py"), "utf8")).toBe("print('run')\n");
  });

  it("puts it back as it was: on, for every bot, with its files", () => {
    const root = freshRoot();
    library.installLibrarySkill({ name: "pick", instructions: SKILL("pick"), source: "upload:a.zip", reviewState: "approved", root,
      files: [{ path: "notes.md", content: "# Notes\n" }] });
    library.setLibrarySkillEveryBot("pick", true, root);
    const removed = library.removeLibrarySkill("pick", root);
    if (!("undo" in removed)) throw new Error("not removed");
    const restored = library.restoreLibrarySkill(removed.undo, root);
    expect(restored).toMatchObject({ name: "pick", enabled: true, everyBot: true, files: ["notes.md"], warnings: [] });
    expect(library.readLibrarySkillFile("pick", root)).toBe(SKILL("pick"));
    expect(library.restoreLibrarySkill(removed.undo, root)).toEqual({ error: "nothing to undo" });
  });

  it("removes a skill whose files changed after review, which can be neither switched on nor replaced otherwise", () => {
    const root = freshRoot();
    library.installLibrarySkill({ name: "pick", instructions: SKILL("pick"), source: "upload:a.zip", reviewState: "approved", root });
    writeFileSync(library.librarySkillFilePath("pick", root), SKILL("pick", "Changed by a bot."));
    expect(library.listLibrarySkills(root)[0]).toMatchObject({ enabled: false });
    expect(library.removeLibrarySkill("pick", root)).toMatchObject({ removed: true });
    expect(library.listLibrarySkills(root)).toEqual([]);
  });

  it("refuses a name the library does not hold, an undo that names nothing, and an undo over a skill added since", () => {
    const root = freshRoot();
    expect(library.removeLibrarySkill("absent", root)).toEqual({ error: 'no library skill named "absent"' });
    for (const undo of ["", "pick", "../../etc/passwd", "pick.00000000-0000-4000-8000-000000000000", "pick/../x.00000000-0000-4000-8000-000000000000"]) {
      expect(library.restoreLibrarySkill(undo, root), undo).toEqual({ error: "nothing to undo" });
    }
    library.installLibrarySkill({ name: "pick", instructions: SKILL("pick"), source: "upload:a.zip", root });
    const removed = library.removeLibrarySkill("pick", root);
    if (!("undo" in removed)) throw new Error("not removed");
    library.installLibrarySkill({ name: "pick", instructions: SKILL("pick", "A newer one."), source: "upload:b.zip", root });
    expect(library.restoreLibrarySkill(removed.undo, root)).toEqual({ error: 'a skill named "pick" is in the library again' });
    expect(library.readLibrarySkillFile("pick", root)).toBe(SKILL("pick", "A newer one."));
  });
});
