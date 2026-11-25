import { createHash } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./config.ts";

// config.ts resolves DATA_DIR at import time, so point this suite at a scratch dir before any module loads.
process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skills-library-"));

const library = await import("./skill-library.ts");
const skills = await import("./skills.ts");
const { renderSkillsIndex } = await import("./skills-index.ts");
const config = await import("./config.ts");

const SKILL = (name: string, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: Reviews a PR the way this team reviews PRs.\n---\n\n# ${name}\n\n${body}\n`;
const TAGGED = (name: string, tags: string) =>
  `---\nname: ${name}\ndescription: Browsing tags on chip rows.\ntags: ${tags}\n---\n\n# ${name}\n\nDo the thing.\n`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let bot: string;
beforeEach(() => {
  bot = `lib-bot-${Math.random().toString(36).slice(2, 10)}`;
});

describe("skills library store", () => {
  it("installs a skill: bytes on disk, entry in the index, listing, invalidation event", () => {
    const events: Array<{ kind: string; name: string }> = [];
    library.skillLibraryEvents.on("invalidate", (event) => events.push(event));
    const listing = library.installLibrarySkill({
      name: "code-review",
      instructions: SKILL("code-review"),
      source: "https://example.com/skills",
      reviewState: "approved",
    });
    expect("error" in listing).toBe(false);
    if ("error" in listing) return;
    expect(listing).toMatchObject({ name: "code-review", enabled: true, editable: false, source: "https://example.com/skills" });
    expect(existsSync(join(library.skillsLibraryRoot(), "skills", "code-review", "SKILL.md"))).toBe(true);
    const index = library.readSkillLibraryIndex();
    expect(index["code-review"]).toMatchObject({ sha256: sha256(SKILL("code-review")), reviewState: "approved" });
    expect(events).toContainEqual({ kind: "install", name: "code-review" });
    expect(library.readLibrarySkillFile("code-review")).toBe(SKILL("code-review"));
  });

  it("is idempotent for identical bytes and refuses a different skill under the same name", () => {
    // Fresh root: this suite shares one scratch DATA_DIR, and this test asserts the exact index contents.
    const root = mkdtempSync(join(tmpdir(), "omb-skills-library-"));
    const first = library.installLibrarySkill({ name: "deploy", instructions: SKILL("deploy"), source: "a", root });
    expect("error" in first).toBe(false);
    const again = library.installLibrarySkill({ name: "deploy", instructions: SKILL("deploy"), source: "b", root });
    expect("error" in again).toBe(false);
    if ("error" in again) return;
    expect(again.source).toBe("a");
    const clash = library.installLibrarySkill({ name: "deploy", instructions: SKILL("deploy", "Different body."), source: "c", root });
    expect(clash).toEqual({ error: 'a skill named "deploy" is already in the library — choose a different name' });
    expect(Object.keys(library.readSkillLibraryIndex(root))).toEqual(["deploy"]);
  });

  it("refuses to install over an unreadable or invalid index instead of resetting it", () => {
    const root = mkdtempSync(join(tmpdir(), "omb-skills-library-"));
    writeFileSync(join(root, "index.json"), "{not json");
    const unreadable = library.installLibrarySkill({ name: "deploy", instructions: SKILL("deploy"), source: "a", root });
    expect(unreadable).toEqual({ error: "the skills library index could not be read" });
    expect(readFileSync(join(root, "index.json"), "utf8")).toBe("{not json");
    expect(existsSync(join(root, "skills", "deploy"))).toBe(false);

    writeFileSync(join(root, "index.json"), JSON.stringify({ deploy: { not: "an entry" } }));
    const invalid = library.installLibrarySkill({ name: "deploy", instructions: SKILL("deploy"), source: "a", root });
    expect(invalid).toEqual({ error: "the skills library index is invalid" });
    expect(JSON.parse(readFileSync(join(root, "index.json"), "utf8"))).toEqual({ deploy: { not: "an entry" } });
  });

  it("stores frontmatter tags when the caller passes none, and prefers explicit tags", () => {
    const root = mkdtempSync(join(tmpdir(), "omb-skills-library-"));
    const parsed = library.installLibrarySkill({ name: "tag-me", instructions: TAGGED("tag-me", "deploy, ops"), source: "a", root });
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.tags).toEqual(["deploy", "ops"]);
    expect(library.readSkillLibraryIndex(root)["tag-me"]?.tags).toEqual(["deploy", "ops"]);

    const explicit = library.installLibrarySkill({ name: "tag-override", instructions: TAGGED("tag-override", "deploy"), source: "a", root, tags: ["custom"] });
    expect("error" in explicit).toBe(false);
    if ("error" in explicit) return;
    expect(explicit.tags).toEqual(["custom"]);
  });

  it("fails closed on tampered bytes: listing disabled with a warning, reads return null", () => {
    library.installLibrarySkill({ name: "audit", instructions: SKILL("audit"), source: "a", reviewState: "approved" });
    writeFileSync(join(library.skillsLibraryRoot(), "skills", "audit", "SKILL.md"), SKILL("audit", "Tampered."), { mode: 0o600 });
    const [listing] = library.listLibrarySkills().filter((skill) => skill.name === "audit");
    expect(listing.enabled).toBe(false);
    expect(listing.warnings).toContain("stored skill files changed after review — enablement is blocked");
    expect(library.readLibrarySkillFile("audit")).toBeNull();
    const approve = library.setLibrarySkillReviewState("audit", "approved");
    expect(approve).toEqual({ error: "stored skill files changed after review — the library entry cannot be approved" });
  });

  it("stores a whole skill folder, records its GitHub origin and blocks it once a file beside SKILL.md changes", () => {
    const root = mkdtempSync(join(tmpdir(), "omb-skills-library-"));
    const github = { owner: "x", repo: "y", ref: "HEAD", commit: "b".repeat(40), path: "skills/folder-skill" };
    mkdirSync(join(root, "skills", "folder-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "folder-skill", "left-by-a-crash.md"), "unreferenced");
    const listing = library.installLibrarySkill({
      name: "folder-skill",
      instructions: SKILL("folder-skill"),
      source: "github.com/x/y/skills/folder-skill",
      reviewState: "approved",
      files: [
        { path: "references/guide.md", content: "# Guide\n" },
        { path: "scripts/run.sh", content: "#!/bin/sh\necho run\n", executable: true },
      ],
      skippedFiles: ["video.mp4"],
      github,
      root,
    });
    expect(listing).toMatchObject({ name: "folder-skill", enabled: true, skippedFiles: ["video.mp4"], github, warnings: [] });
    const folder = join(root, "skills", "folder-skill");
    expect(readFileSync(join(folder, "references", "guide.md"), "utf8")).toBe("# Guide\n");
    expect(existsSync(join(folder, "left-by-a-crash.md"))).toBe(false);
    expect(library.readSkillLibraryIndex(root)["folder-skill"]).toMatchObject({ filesSha256: expect.stringMatching(/^[a-f0-9]{64}$/), github });

    writeFileSync(join(folder, "scripts", "run.sh"), "#!/bin/sh\necho changed\n");
    const [changed] = library.listLibrarySkills(root);
    expect(changed).toMatchObject({ enabled: false, warnings: ["stored skill files changed after review — enablement is blocked"] });
    expect(library.installLibrarySkill({ name: "escapes", instructions: SKILL("escapes"), source: "a", files: [{ path: "../x.md", content: "x" }], root }))
      .toEqual({ error: expect.stringContaining("outside the skill folder") });
    expect(existsSync(join(root, "skills", "x.md"))).toBe(false);
    expect(library.readSkillLibraryIndex(root)["escapes"]).toBeUndefined();
  });

  it("toggles review state at library scope and emits an invalidation event", () => {
    library.installLibrarySkill({ name: "triage", instructions: SKILL("triage"), source: "a", reviewState: "approved" });
    const events: Array<{ kind: string; name: string }> = [];
    library.skillLibraryEvents.on("invalidate", (event) => events.push(event));
    const disabled = library.setLibrarySkillReviewState("triage", "disabled");
    expect("error" in disabled).toBe(false);
    if (!("error" in disabled)) expect(disabled.enabled).toBe(false);
    expect(library.readSkillLibraryIndex()["triage"]?.reviewState).toBe("disabled");
    expect(events).toContainEqual({ kind: "review-state", name: "triage" });
  });

  it("makes a reviewed library skill available to every bot, switched on", () => {
    const name = `universal-${Math.random().toString(36).slice(2, 10)}`;
    const universal = library.installLibrarySkill({ name, instructions: SKILL(name), source: "lib", reviewState: "approved" });
    expect("error" in universal).toBe(false);
    expect(skills.resolveBotSkills(`universal-${Math.random()}`, true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name, enabled: true }),
    ]));
    // Library off: no library skill either.
    expect(skills.resolveBotSkills(`universal-${Math.random()}`, false).map((skill) => skill.name)).not.toContain(name);
    // The bot's Skills page lists it as a library skill.
    const page = skills.listBotSkillsWithOrigin(`universal-${Math.random()}`);
    expect(page.find((skill) => skill.name === name)?.origin).toBe("library");
    // Switched off, no bot reads it.
    expect("error" in library.setLibrarySkillReviewState(name, "disabled")).toBe(false);
    expect(skills.resolveBotSkills(`universal-${Math.random()}`, true).map((skill) => skill.name)).not.toContain(name);
    expect("error" in library.setLibrarySkillReviewState(name, "approved")).toBe(false);
  });

  it("lists a switched-on library skill in the turn index of any bot, only while the library is on", async () => {
    const { createSkillsLibraryHost } = await import("./host/skills-library.ts");
    const name = `everyone-${Math.random().toString(36).slice(2, 10)}`;
    library.installLibrarySkill({ name, instructions: SKILL(name), source: "lib", reviewState: "approved" });
    try {
      const record = { id: bot, threadId: "main" } as import("./store.ts").BotRecord;
      const hostWith = (cfg: AppConfig) => createSkillsLibraryHost({
        store: { bot: () => record, messagesFor: () => [], taskByThread: () => undefined } as unknown as import("./store.ts").Store,
        cfg,
        appendSkillRequestCard: () => ({ requestId: "", summary: "" }),
      });
      const on = hostWith({ features: { skillsLibrary: true } } as AppConfig);
      expect(on.skillsIndex(record, "main")).toContain(`- ${name} (the skills library):`);
      expect(on.skillsIndex(record, undefined)).toContain(name);
      expect(on.readSkill(record, name)).toContain(`# ${name}`);
      expect(on.expandSkillCommand(record, "main", `/${name}`, undefined, [], true)).toContain(`ran your ${name} skill`);
      const off = hostWith({ features: { skillsLibrary: false } } as AppConfig);
      expect(off.skillsIndex(record, "main")).not.toContain(name);
      expect(off.readSkill(record, name)).toBeNull();
      expect(off.expandSkillCommand(record, "main", `/${name}`, undefined, [], true)).toBe(`/${name}`);
    } finally {
      library.setLibrarySkillReviewState(name, "disabled");
    }
  });

  it("defaults the feature flag on and switches off only via features.skillsLibrary", () => {
    expect(library.skillsLibraryEnabled({} as AppConfig)).toBe(true);
    expect(library.skillsLibraryEnabled({ features: {} } as AppConfig)).toBe(true);
    expect(library.skillsLibraryEnabled({ features: { skillsLibrary: false } } as AppConfig)).toBe(false);
  });

  it("parseStoredConfig keeps features.skillsLibrary while stripping genuinely unknown keys", () => {
    const stored = config.parseStoredConfig({ features: { skillsLibrary: true, browser: true } });
    expect(stored).toEqual({ features: { skillsLibrary: true, browser: true } });
    expect(library.skillsLibraryEnabled(stored)).toBe(true);
    expect(library.skillsLibraryEnabled(config.parseStoredConfig({ features: { browser: true } }))).toBe(true);
    expect(library.skillsLibraryEnabled(config.parseStoredConfig({ features: { skillsLibrary: false } }))).toBe(false);
    expect(config.parseStoredConfig({ features: { skillsLibrary: true, teleport: true } })).toEqual({
      features: { skillsLibrary: true },
    });
  });
});

describe("assignment resolution", () => {
  it("adds switched-on library skills beside private ones, private winning name collisions", () => {
    skills.installSkill(bot, "private:test", [{ path: "SKILL.md", content: SKILL("shared-name", "Private copy.") }]);
    skills.setSkillEnabled(bot, "shared-name", true);
    library.installLibrarySkill({ name: "shared-name", instructions: SKILL("shared-name", "Library copy."), source: "lib", reviewState: "approved" });
    library.installLibrarySkill({ name: "library-only", instructions: SKILL("library-only"), source: "lib", reviewState: "approved" });

    const resolved = skills.resolveBotSkills(bot, true);
    expect(resolved.map((skill) => skill.name)).toEqual(expect.arrayContaining(["library-only", "shared-name"]));
    const shared = resolved.find((skill) => skill.name === "shared-name")!;
    expect(shared.source).toBe("private:test");
    const only = resolved.find((skill) => skill.name === "library-only")!;
    expect(only.source).toBe("lib");
    expect(only.editable).toBe(false);
  });

  it("leaves the library's own bytes alone when a bot pools the skill", () => {
    const name = `shared-${Math.random().toString(36).slice(2, 10)}`;
    const other = `lib-bot-${Math.random().toString(36).slice(2, 10)}`;
    const instructions = SKILL(name, "Shared steps.");
    expect("error" in library.installLibrarySkill({ name, instructions, source: "lib", reviewState: "approved" })).toBe(false);
    for (const id of [bot, other]) expect(skills.resolveBotSkills(id, true).map((skill) => skill.name)).toContain(name);
    expect(library.readLibrarySkillFile(name)).toBe(instructions);
    // Switching it off at the library takes it from every bot at once.
    expect("error" in library.setLibrarySkillReviewState(name, "disabled")).toBe(false);
    for (const id of [bot, other]) expect(skills.resolveBotSkills(id, true).map((skill) => skill.name)).not.toContain(name);
    expect("error" in library.setLibrarySkillReviewState(name, "approved")).toBe(false);
  });

  it("with the library off, resolution is exactly listSkills", () => {
    skills.installSkill(bot, "private:test", [{ path: "SKILL.md", content: SKILL("solo") }]);
    library.installLibrarySkill({ name: "library-only", instructions: SKILL("library-only"), source: "lib", reviewState: "approved" });
    expect(skills.resolveBotSkills(bot, false)).toEqual(skills.listSkills(bot));
  });

  it("renders a switched-on library skill into the prompt index, and nothing while the library is off", () => {
    skills.installSkill(bot, "private:test", [{ path: "SKILL.md", content: SKILL("own-skill") }]);
    skills.setSkillEnabled(bot, "own-skill", true);
    library.installLibrarySkill({ name: "library-skill", instructions: SKILL("library-skill"), source: "lib", reviewState: "approved" });

    expect(skills.resolveBotSkills(bot, false).map((skill) => skill.name)).not.toContain("library-skill");
    const on = skills.listBotSkillsWithOrigin(bot);
    expect(on.find((skill) => skill.name === "library-skill")?.origin).toBe("library");
    // The index is a catalogue; the reviewed bytes are read with the skill tool, never pasted into the prompt.
    const text = renderSkillsIndex(on.filter((skill) => skill.enabled).map((skill) => ({ name: skill.name, description: skill.description, source: skill.origin === "library" ? "library" as const : "own" as const })));
    expect(text).toContain("- library-skill (the skills library):");
    expect(text).not.toContain("Do the thing.");
    expect(text).not.toContain(JSON.stringify(join(library.skillsLibraryRoot(), "skills", "library-skill", "SKILL.md")));
    expect(text).toContain("own-skill");
  });
});
