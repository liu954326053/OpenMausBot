import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts resolves DATA_DIR at import time; isolate before importing.
process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skill-share-"));

const library = await import("./skill-library.ts");
const skills = await import("./skills.ts");
const share = await import("./skill-share.ts");
const { learnSource } = await import("./skill-learn.ts");

const SKILL = (name: string, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: Cuts a rough edit the way this team does.\n---\n\n# ${name}\n\n${body}\n`;

interface Bot { id: string; name: string; section?: string; visibility?: unknown }

let author: Bot;
let mate: Bot;
let root: string;
const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

function learn(botId: string, name: string, body?: string) {
  const staged = skills.stageSkillWrite(botId, { action: "create", files: [{ path: "SKILL.md", content: SKILL(name, body) }], source: learnSource("conversation") });
  if ("error" in staged) throw new Error(staged.error);
  const applied = skills.applyStagedSkillWrite(botId, staged.id, { expectedSha256: staged.sha256 });
  if ("error" in applied) throw new Error(applied.error);
  return staged;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omb-skill-share-lib-"));
  author = { id: id("author"), name: "Cutter", section: "Editing" };
  mate = { id: id("mate"), name: "Colorist", section: " Editing " };
});

describe("sharing a learned skill", () => {
  it("moves it into the library, where every bot has it with no assignment", () => {
    const staged = learn(author.id, "rough-cut");
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root, now: 1000 });
    if ("error" in result) throw new Error(result.error);
    expect(result).toMatchObject({ library: "installed", sha256: staged.sha256, sharedAt: 1000 });
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut"));
    expect(library.listLibrarySkills(root)[0]).toMatchObject({ name: "rough-cut", enabled: true });
    expect(skills.listSkills(author.id).map((skill) => skill.name)).not.toContain("rough-cut");
    expect(readFileSync(join(library.libraryArchiveDirectory(root, author.id, "rough-cut"), "SKILL.md"), "utf8")).toBe(SKILL("rough-cut"));
    // The share assigns nothing: the library's switch is the only gate, so the skill is simply there for everyone.
    expect(share.librarySkillNames(root)).toEqual(["rough-cut"]);
  });

  it("refuses when the library holds different bytes under that name and leaves the private skill alone", () => {
    library.installLibrarySkill({ name: "rough-cut", instructions: SKILL("rough-cut", "Someone else's."), source: "local-import", root });
    learn(author.id, "rough-cut");
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root });
    expect(result).toEqual({ error: 'the library already has a different skill named "rough-cut"' });
    expect(skills.listSkills(author.id).find((skill) => skill.name === "rough-cut")?.enabled).toBe(true);
  });

  it("Undo of a shared create takes it out of the library, so no bot has it any more", () => {
    learn(author.id, "rough-cut");
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root });
    if ("error" in result) throw new Error(result.error);
    const undone = share.undoSharedLearnedSkill({ name: "rough-cut", action: "create", share: result, root });
    expect(undone).toEqual({ undone: true });
    expect(library.readSkillLibraryIndex(root)["rough-cut"]).toBeUndefined();
    expect(readdirSync(join(root, "archive", "retired"))).toHaveLength(1);
  });

  it("updates the library copy, refuses a stale read, and Undo restores the previous version", () => {
    learn(author.id, "rough-cut");
    const first = share.shareLearnedSkill({ author, name: "rough-cut", root });
    if ("error" in first) throw new Error(first.error);
    const stale = share.updateSharedLearnedSkill({ bot: mate, name: "rough-cut", skillMd: SKILL("rough-cut", "v2"), expectSha256: "0".repeat(64), root });
    expect(stale).toEqual({ error: 'skill "rough-cut" changed since it was read — read it again first' });
    const updated = share.updateSharedLearnedSkill({ bot: mate, name: "rough-cut", skillMd: SKILL("rough-cut", "v2"), expectSha256: first.sha256, root });
    if ("error" in updated) throw new Error(updated.error);
    expect(updated.previous.skillMd).toBe(SKILL("rough-cut"));
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut", "v2"));
    expect(share.sharedSkillEditable("rough-cut", root)).toBe(true);
    const undone = share.undoSharedLearnedSkill({ name: "rough-cut", action: "update", share: { library: "updated", sha256: updated.sha256, sharedAt: 0, assigned: [], skipped: [] }, previous: updated.previous, root });
    expect(undone).toEqual({ undone: true });
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut"));
    expect(share.undoSharedLearnedSkill({ name: "rough-cut", action: "update", share: { library: "updated", sha256: updated.sha256, sharedAt: 0, assigned: [], skipped: [] }, previous: updated.previous, root })).toEqual({ stale: true });
  });

  it("refuses the second of two writers that read the same version, so neither update is lost", () => {
    learn(author.id, "rough-cut");
    const first = share.shareLearnedSkill({ author, name: "rough-cut", root });
    if ("error" in first) throw new Error(first.error);
    const read = first.sha256.slice(0, share.SHARED_REVISION_CHARS);
    const fromAuthor = share.updateSharedLearnedSkill({ bot: author, name: "rough-cut", skillMd: SKILL("rough-cut", "author's v2"), expectSha256: read, root });
    if ("error" in fromAuthor) throw new Error(fromAuthor.error);
    const fromMate = share.updateSharedLearnedSkill({ bot: mate, name: "rough-cut", skillMd: SKILL("rough-cut", "mate's v2 from v1"), expectSha256: read, root });
    expect(fromMate).toEqual({ error: 'skill "rough-cut" changed since it was read — read it again first' });
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut", "author's v2"));
    const loose = share.updateSharedLearnedSkill({ bot: mate, name: "rough-cut", skillMd: SKILL("rough-cut", "v3"), expectSha256: fromAuthor.sha256.slice(0, 4), root });
    expect(loose).toEqual({ error: 'skill "rough-cut" changed since it was read — read it again first' });
    const reread = share.updateSharedLearnedSkill({ bot: mate, name: "rough-cut", skillMd: SKILL("rough-cut", "mate's v3"), expectSha256: fromAuthor.sha256.slice(0, share.SHARED_REVISION_CHARS), root });
    if ("error" in reread) throw new Error(reread.error);
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut", "mate's v3"));
  });

  it("asks by default and is off while the skills library is off", () => {
    expect(share.shareLearnedSkillsMode({ features: { skillsLibrary: false } })).toBe("off");
    expect(share.shareLearnedSkillsMode({ features: { skillsLibrary: false, shareLearnedSkills: "auto" } })).toBe("off");
    expect(share.shareLearnedSkillsMode({})).toBe("ask");
    expect(share.shareLearnedSkillsMode({ features: { shareLearnedSkills: "auto" } })).toBe("auto");
  });

  it("does not share from a receipt whose skill changed since it applied", () => {
    const staged = learn(author.id, "rough-cut");
    const stale = share.shareLearnedSkill({ author, name: "rough-cut", root, expectSha256: "f".repeat(64) });
    expect(stale).toMatchObject({ stale: true });
    expect(skills.listSkills(author.id).map((skill) => skill.name)).toContain("rough-cut");
    const shared = share.shareLearnedSkill({ author, name: "rough-cut", root, expectSha256: staged.sha256 });
    expect("error" in shared).toBe(false);
  });

  it("offers a shared skill for update only while its library bytes verify", () => {
    learn(author.id, "rough-cut");
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root });
    if ("error" in result) throw new Error(result.error);
    expect(share.sharedSkillEditable("rough-cut", root)).toBe(true);
    writeFileSync(library.librarySkillFilePath("rough-cut", root), SKILL("rough-cut", "tampered"));
    expect(share.sharedSkillEditable("rough-cut", root)).toBe(false);
  });

  it("an Undo whose archive move fails changes nothing and says so", () => {
    learn(author.id, "rough-cut");
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root });
    if ("error" in result) throw new Error(result.error);
    // a file where the archive folder belongs: the move cannot happen
    writeFileSync(join(root, "archive", "retired"), "");
    const undone = share.undoSharedLearnedSkill({ name: "rough-cut", action: "create", share: result, root });
    expect(undone).toEqual({ error: expect.stringContaining("could not archive the library copy") });
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut"));
  });

  it("shares an already-library learned skill without touching it", () => {
    library.installLibrarySkill({ name: "rough-cut", instructions: SKILL("rough-cut"), source: learnSource("conversation"), reviewState: "approved", root });
    const result = share.shareLearnedSkill({ author, name: "rough-cut", root });
    if ("error" in result) throw new Error(result.error);
    expect(result.library).toBe("assigned");
    expect(library.readLibrarySkillFile("rough-cut", root)).toBe(SKILL("rough-cut"));
  });

  it("refuses a skill the library has switched off", () => {
    library.installLibrarySkill({ name: "rough-cut", instructions: SKILL("rough-cut"), source: learnSource("conversation"), reviewState: "disabled", root });
    expect(share.shareLearnedSkill({ author, name: "rough-cut", root })).toEqual({ error: 'the library\'s "rough-cut" is switched off' });
    expect(share.updateSharedLearnedSkill({ bot: author, name: "rough-cut", skillMd: SKILL("rough-cut", "v2"), expectSha256: "a".repeat(64), root }))
      .toEqual({ error: 'the library\'s "rough-cut" is switched off' });
  });

  it("refuses to rewrite an imported library skill, or update one that is not there", () => {
    library.installLibrarySkill({ name: "imported-one", instructions: SKILL("imported-one"), source: "upload:pack.zip", reviewState: "approved", root });
    expect(share.updateSharedLearnedSkill({ bot: author, name: "imported-one", skillMd: SKILL("imported-one", "v2"), expectSha256: library.readSkillLibraryIndex(root)["imported-one"]!.sha256, root }))
      .toEqual({ error: 'skill "imported-one" was imported — it cannot be rewritten' });
    expect(share.updateSharedLearnedSkill({ bot: author, name: "absent", skillMd: SKILL("absent"), expectSha256: "a".repeat(64), root }))
      .toEqual({ error: 'no library skill named "absent"' });
  });
});
