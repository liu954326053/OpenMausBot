import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skill-share-manifest-"));

vi.mock("./skills.ts", async (original) => ({
  ...await original<typeof import("./skills.ts")>(),
  removeManifestEntry: () => ({ error: 'skill "rough-cut" changed since it was read — leaving it in place' }),
}));

const skills = await import("./skills.ts");
const share = await import("./skill-share.ts");
const library = await import("./skill-library.ts");
const { learnSource } = await import("./skill-learn.ts");

const SKILL = "---\nname: rough-cut\ndescription: Cuts a rough edit.\n---\n\n# rough-cut\n";

describe("sharing when the private manifest changed meanwhile", () => {
  it("completes the share into the library, which every bot reads", () => {
    const root = mkdtempSync(join(tmpdir(), "omb-skill-share-manifest-lib-"));
    const author = { id: "author-m", name: "Cutter", section: "Editing" };
    const staged = skills.stageSkillWrite(author.id, { action: "create", files: [{ path: "SKILL.md", content: SKILL }], source: learnSource("conversation") });
    if ("error" in staged) throw new Error(staged.error);
    const applied = skills.applyStagedSkillWrite(author.id, staged.id, { expectedSha256: staged.sha256 });
    if ("error" in applied) throw new Error(applied.error);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root });
    expect(result).toMatchObject({ library: "installed" });
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL);
    expect(share.librarySkillNames(root)).toEqual(["rough-cut"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("changed since it was read"));
    warn.mockRestore();
  });
});
