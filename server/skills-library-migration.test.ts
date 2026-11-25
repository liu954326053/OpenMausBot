import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// config.ts resolves DATA_DIR at import time; isolate before importing.
process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skills-migration-"));

const library = await import("./skill-library.ts");
const skills = await import("./skills.ts");
const { renderSkillsIndex } = await import("./skills-index.ts");
const migration = await import("./skills-library-migration.ts");
const { workspaceDir } = await import("./workspace.ts");

const SKILL = (name: string, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: Reviews a PR the way this team reviews PRs.\n---\n\n# ${name}\n\n${body}\n`;

let botA: string;
let botB: string;
beforeEach(() => {
  botA = `mig-a-${Math.random().toString(36).slice(2, 10)}`;
  botB = `mig-b-${Math.random().toString(36).slice(2, 10)}`;
});

describe("skills library migration", () => {
  it("rejects missing --data-dir values before importing or migrating", () => {
    const directory = mkdtempSync(join(tmpdir(), "omb-migration-args-"));
    try {
      for (const args of [["--data-dir"], ["--data-dir", "--other-option"]]) {
        const result = spawnSync(process.execPath, ["--experimental-strip-types",
          fileURLToPath(new URL("../scripts/migrate-skills-library.ts", import.meta.url)), ...args], {
          cwd: directory, env: { ...process.env, HOME: directory, USERPROFILE: directory, OMB_DATA_DIR: directory }, encoding: "utf8",
        });
        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(/usage:.*--data-dir/i);
        expect(readdirSync(directory)).toEqual([]);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps multi-file skills private so scripts and references remain usable", () => {
    const name = "auxiliary-files";
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content: SKILL(name, "Run scripts/probe.js and read references/notes.md.") }]);
    // Imports skip supporting files, but an owner's file tools can still add them to an existing workspace.
    const directory = join(workspaceDir(botA), "skills", name);
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "references"));
    writeFileSync(join(directory, "scripts", "probe.js"), "console.log('fixture');");
    writeFileSync(join(directory, "references", "notes.md"), "Fixture reference.");
    skills.setSkillEnabled(botA, name, true);
    const outcomes = migration.migrateBotSkillsToLibrary(botA);
    expect(outcomes).toEqual([expect.objectContaining({ outcome: "skipped", detail: expect.stringContaining("auxiliary") })]);
    expect(readFileSync(join(workspaceDir(botA), "skills", name, "scripts", "probe.js"), "utf8")).toContain("fixture");
    expect(skills.listSkills(botA).find((skill) => skill.name === name)?.enabled).toBe(true);
    expect(library.readSkillLibraryIndex()[name]).toBeUndefined();
  });

  it("deduplicates identical per-bot copies by sha256, and every bot reads the one entry", () => {
    const content = SKILL("shared-review", "Identical bytes.");
    for (const bot of [botA, botB]) {
      skills.installSkill(bot, "private:test", [{ path: "SKILL.md", content }]);
      skills.setSkillEnabled(bot, "shared-review", true);
    }
    expect(migration.migrateBotSkillsToLibrary(botA)).toEqual([expect.objectContaining({ botId: botA, name: "shared-review", outcome: "migrated" })]);
    expect(migration.migrateBotSkillsToLibrary(botB)).toEqual([expect.objectContaining({ botId: botB, name: "shared-review", outcome: "deduplicated" })]);

    const index = library.readSkillLibraryIndex();
    expect(Object.keys(index)).toEqual(["shared-review"]);
    for (const bot of [botA, botB]) {
      expect(skills.resolveBotSkills(bot, true).map((skill) => skill.sha256)).toEqual([index["shared-review"]!.sha256]);
      expect(skills.listSkills(bot)).toEqual([]);
    }
  });

  it("migrates by each bot's own copy state, so identical bytes are order-independent", () => {
    for (const order of [["enabled", "disabled"], ["disabled", "enabled"]] as const) {
      const name = `order-${order[0]}-${order[1]}`;
      const content = SKILL(name);
      const ids = { enabled: `${botA}-${order[0]}`, disabled: `${botB}-${order[0]}` };
      const outcomes: Partial<Record<"enabled" | "disabled", ReturnType<typeof migration.migrateBotSkillsToLibrary>>> = {};
      for (const state of order) {
        skills.installSkill(ids[state], "private:test", [{ path: "SKILL.md", content }]);
        skills.setSkillEnabled(ids[state], name, state === "enabled");
        outcomes[state] = migration.migrateBotSkillsToLibrary(ids[state]);
      }

      if (order[0] === "enabled") {
        expect(outcomes.enabled).toEqual([expect.objectContaining({ outcome: "migrated" })]);
        expect(outcomes.disabled).toEqual([expect.objectContaining({ outcome: "skipped" })]);
        expect(skills.listSkills(ids.disabled).map((skill) => [skill.name, skill.enabled])).toEqual([[name, false]]);
        expect(library.readSkillLibraryIndex()[name]!.reviewState).toBe("approved");
      } else {
        expect(outcomes.disabled).toEqual([expect.objectContaining({ outcome: "migrated" })]);
        expect(outcomes.enabled).toEqual([expect.objectContaining({ outcome: "skipped", detail: expect.stringContaining("disabled") })]);
        expect(library.readSkillLibraryIndex()[name]!.reviewState).toBe("disabled");
        expect(existsSync(join(workspaceDir(ids.enabled), "skills", name, "SKILL.md"))).toBe(true);
        expect(skills.listSkills(ids.enabled).map((skill) => [skill.name, skill.enabled])).toEqual([[name, true]]);
      }
    }
  });

  it("archives originals instead of deleting them and clears the per-bot manifest", () => {
    const content = SKILL("archive-me", "Precious bytes.");
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content }]);
    skills.setSkillEnabled(botA, "archive-me", true);
    migration.migrateBotSkillsToLibrary(botA);

    const archive = join(library.skillsLibraryRoot(), "archive", botA, "archive-me", "SKILL.md");
    expect(existsSync(archive)).toBe(true);
    expect(readFileSync(archive, "utf8")).toBe(content);
    expect(existsSync(join(workspaceDir(botA), "skills", "archive-me"))).toBe(false);
    expect(skills.listSkills(botA)).toEqual([]);
  });

  it("gives a same-name, same-hash reinstall its own archive slot", () => {
    const content = SKILL("re-hash", "Same bytes twice.");
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content }]);
    skills.setSkillEnabled(botA, "re-hash", true);
    expect(migration.migrateBotSkillsToLibrary(botA)).toEqual([expect.objectContaining({ botId: botA, name: "re-hash", outcome: "migrated" })]);
    const sha = library.readSkillLibraryIndex()["re-hash"]!.sha256;

    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content }]);
    skills.setSkillEnabled(botA, "re-hash", true);
    expect(migration.migrateBotSkillsToLibrary(botA)).toEqual([expect.objectContaining({ botId: botA, name: "re-hash", outcome: "deduplicated" })]);

    const archiveRoot = join(library.skillsLibraryRoot(), "archive", botA);
    expect(readFileSync(join(archiveRoot, "re-hash", "SKILL.md"), "utf8")).toBe(content);
    expect(readFileSync(join(archiveRoot, `re-hash.${sha}`, "SKILL.md"), "utf8")).toBe(content);
    expect(existsSync(join(workspaceDir(botA), "skills", "re-hash"))).toBe(false);
    expect(skills.listSkills(botA)).toEqual([]);
  });

  it("keeps a conflicting per-bot copy in place when the library name is taken", () => {
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content: SKILL("conflict", "First copy.") }]);
    skills.installSkill(botB, "private:test", [{ path: "SKILL.md", content: SKILL("conflict", "Second, different copy.") }]);
    migration.migrateBotSkillsToLibrary(botA);
    expect(migration.migrateBotSkillsToLibrary(botB)).toEqual([expect.objectContaining({ botId: botB, outcome: "skipped" })]);
    expect(existsSync(join(workspaceDir(botB), "skills", "conflict", "SKILL.md"))).toBe(true);
    expect(skills.listSkills(botB).map((skill) => skill.name)).toEqual(["conflict"]);
  });

  it("maps organization stamps onto library entries so org installs become a source", () => {
    const content = SKILL("org-playbook");
    const stamp = { installId: "a".repeat(32), key: "org-playbook", release: "2.0.1", r: "b".repeat(64), w: "c".repeat(64) };
    skills.installOrgSkill(botA, "org:acme/sales-skills@2.0.1", content, stamp);
    migration.migrateBotSkillsToLibrary(botA);

    const entry = library.readSkillLibraryIndex()["org-playbook"]!;
    expect(entry.source).toBe("org:acme/sales-skills@2.0.1");
    expect(entry.package).toEqual(stamp);
    expect(entry.reviewState).toBe("approved");
  });

  it("keeps a deduplicated copy whose on/off differs from the library entry", () => {
    const content = SKILL("toggle-review", "Identical bytes.");
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content }]);
    skills.setSkillEnabled(botA, "toggle-review", true);
    expect(migration.migrateBotSkillsToLibrary(botA)).toEqual([expect.objectContaining({ outcome: "migrated" })]);
    skills.installSkill(botB, "private:test", [{ path: "SKILL.md", content }]);
    expect(migration.migrateBotSkillsToLibrary(botB)).toEqual([expect.objectContaining({
      botId: botB,
      name: "toggle-review",
      outcome: "skipped",
      detail: expect.stringContaining("align them before migrating"),
    })]);
    expect(skills.listSkills(botB).map((skill) => skill.name)).toEqual(["toggle-review"]);
    expect(skills.listSkills(botB)[0]!.enabled).toBe(false);
    expect(existsSync(join(workspaceDir(botB), "skills", "toggle-review", "SKILL.md"))).toBe(true);
  });

  it("with the library off, a populated library changes no bot surface", () => {
    const content = SKILL("flag-off-skill");
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content: SKILL("own-skill") }]);
    skills.setSkillEnabled(botA, "own-skill", true);

    const listingBefore = skills.listSkills(botA);
    const promptBefore = renderSkillsIndex(listingBefore.filter((skill) => skill.enabled).map((skill) => ({ name: skill.name, description: skill.description, source: "own" as const })));

    library.installLibrarySkill({ name: "flag-off-skill", instructions: content, source: "lib", reviewState: "approved" });
    library.installLibrarySkill({ name: "own-skill", instructions: SKILL("own-skill", "Library impostor."), source: "lib", reviewState: "approved" });

    expect(skills.listSkills(botA)).toEqual(listingBefore);
    expect(renderSkillsIndex(listingBefore.filter((skill) => skill.enabled).map((skill) => ({ name: skill.name, description: skill.description, source: "own" as const })))).toBe(promptBefore);
    expect(skills.resolveBotSkills(botA, false)).toEqual(listingBefore);
    // On, every bot reads the library's skills, and the bot's own copy still wins the shared name.
    const on = skills.resolveBotSkills(botA, true);
    expect(on.map((skill) => skill.name)).toEqual(expect.arrayContaining(["own-skill", "flag-off-skill"]));
    expect(on.filter((skill) => skill.name === "own-skill").map((skill) => skill.source)).toEqual(["private:test"]);
  });
});

describe("skills library boot sweep", () => {
  it("migrates nothing when it only finishes shares", () => {
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content: SKILL("stays-private") }]);
    skills.setSkillEnabled(botA, "stays-private", true);
    expect(migration.runSkillsLibraryBootSweep({ bots: [{ id: botA }], migrate: false }).outcomes).toEqual([]);
    expect(skills.listSkills(botA).map((skill) => skill.name)).toEqual(["stays-private"]);
    expect(library.readSkillLibraryIndex()["stays-private"]).toBeUndefined();
  });

  it("moves every bot's own copies into the library on a migrating boot", () => {
    skills.installSkill(botA, "private:test", [{ path: "SKILL.md", content: SKILL("boot-move") }]);
    skills.setSkillEnabled(botA, "boot-move", true);
    expect(migration.runSkillsLibraryBootSweep({ bots: [{ id: botA }] }).outcomes).toEqual([expect.objectContaining({ outcome: "migrated" })]);
    expect(skills.listSkills(botA)).toEqual([]);
    expect(library.readSkillLibraryIndex()["boot-move"]).toBeDefined();
  });
});
