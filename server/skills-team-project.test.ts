import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A rename between the folder named here and anywhere else fails as it does between two volumes.
const otherVolume = vi.hoisted(() => ({ root: "" }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const onIt = (path: unknown) => otherVolume.root !== "" && (String(path) === otherVolume.root || String(path).startsWith(otherVolume.root + sep));
  return {
    ...fs,
    renameSync: ((from: string, to: string) => {
      if (onIt(from) !== onIt(to)) throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${from}' -> '${to}'`), { code: "EXDEV" });
      fs.renameSync(from, to);
    }) as typeof fs.renameSync,
  };
});

import { DATA_DIR } from "./config.ts";
import {
  applySkillWriteWithReceipt, installSkill, listSkills, readSkillFile, readSkillReferences, removeSkill, setSkillEnabled, stageSkillWrite,
  syncSkillLinks,
} from "./skills.ts";
import { renderSkillsIndex } from "./skills-index.ts";
import { ensureWorkspace, privateBotFolder, setTeamProjectLookup, setTeamProjectMemberships, workspaceDir } from "./workspace.ts";

const PROJECT = "project-1";
const NATIVE = [".claude/skills", ".agents/skills", ".grok/skills"];
const SKILL = (name: string, description = "Lays out the beats of an episode.") => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo the thing.\n`;

/** A turn's skills index for one bot: the app's own links re-pointed, then every switched-on skill by name. */
const promptFor = (botId: string): string => {
  syncSkillLinks(botId);
  return renderSkillsIndex(listSkills(botId).filter((skill) => skill.enabled).map((skill) => ({ name: skill.name, description: skill.description, source: "own" as const })));
};

let project: string;
let own: string;
let writer: string;let plain: string;
let joined: boolean;

const links = (root: string, name: string) => NATIVE.filter((dir) => lstatSync(join(root, dir, name), { throwIfNoEntry: false })?.isSymbolicLink());
const managed = (botId: string) => JSON.parse(readFileSync(join(DATA_DIR, "skill-state", botId, "managed-links.json"), "utf8")) as string[];
const learn = (botId: string, action: "create" | "update", description: string, files: Array<{ path: string; content: string }> = [], name = "file-expense") => {
  const staged = stageSkillWrite(botId, {
    action, ...(action === "update" ? { targetName: name } : {}), files: [{ path: "SKILL.md", content: SKILL(name, description) }, ...files],
  });
  if ("error" in staged) return staged;
  const applied = applySkillWriteWithReceipt(botId, staged, () => {});
  return "error" in applied ? applied : applied.result;
};

beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-skills-")));
  own = join(project, ".magic-team", "bots", "writer");
  const suffix = Math.random().toString(36).slice(2, 10);
  writer = `writer-${suffix}`;
  plain = `plain-${suffix}`;
  joined = true;
  setTeamProjectMemberships((botId) => (joined && botId === writer ? { id: PROJECT, role: "writer" } : undefined));
  setTeamProjectLookup((id) => (id === PROJECT ? { folder: project } : undefined));
});

afterEach(() => {
  otherVolume.root = "";
  setTeamProjectMemberships(() => undefined);
  setTeamProjectLookup(() => undefined);
  rmSync(project, { recursive: true, force: true });
  for (const botId of [writer, plain]) {
    rmSync(privateBotFolder(botId), { recursive: true, force: true });
    rmSync(join(DATA_DIR, "skill-state", botId), { recursive: true, force: true });
  }
});

describe("a project bot's own skills, in a project folder on another volume", () => {
  beforeEach(() => { otherVolume.root = project; });

  it("are installed, read, switched on and off and removed there", () => {
    expect(installSkill(writer, "src", [{ path: "SKILL.md", content: SKILL("beat-sheet") }, { path: "notes/outline.md", content: "Cold open first.\n" }]))
      .toMatchObject({ name: "beat-sheet", enabled: false });
    expect(readFileSync(join(own, "skills", "beat-sheet", "SKILL.md"), "utf8")).toBe(SKILL("beat-sheet"));
    expect(readFileSync(join(own, "skills", "beat-sheet", "notes", "outline.md"), "utf8")).toBe("Cold open first.\n");
    expect(readdirSync(privateBotFolder(writer)), "nothing of it is in the data folder").toEqual([]);
    expect(readSkillFile(writer, "beat-sheet")).toBe(SKILL("beat-sheet"));

    expect(setSkillEnabled(writer, "beat-sheet", true)).toMatchObject({ enabled: true });
    expect(links(own, "beat-sheet")).toEqual(NATIVE);
    expect(realpathSync(join(own, ".claude", "skills", "beat-sheet"))).toBe(join(own, "skills", "beat-sheet"));
    expect(promptFor(writer)).toContain("- beat-sheet (your own):");

    expect(setSkillEnabled(writer, "beat-sheet", false)).toMatchObject({ enabled: false });
    expect(links(own, "beat-sheet"), "a link no rename can take away is unlinked where it is").toEqual([]);
    expect(managed(writer)).toEqual([]);

    expect(removeSkill(writer, "beat-sheet")).toEqual({ removed: true });
    expect(existsSync(join(own, "skills", "beat-sheet"))).toBe(false);
    expect(listSkills(writer)).toEqual([]);
  });

  it("take a learned skill and its reviewed update, published beside where they stay", () => {
    expect(learn(writer, "create", "Files an expense.", [{ path: "references/edge-cases.md", content: "# Edge cases\n\nNone yet.\n" }])).toMatchObject({ name: "file-expense", enabled: true });
    expect(readFileSync(join(own, "skills", "file-expense", "SKILL.md"), "utf8")).toBe(SKILL("file-expense", "Files an expense."));

    expect(learn(writer, "update", "Files an expense, with a receipt.", [{ path: "references/edge-cases.md", content: "# Edge cases\n\nLost receipts.\n" }]))
      .toMatchObject({ name: "file-expense", description: "Files an expense, with a receipt.", enabled: true });
    expect(readSkillFile(writer, "file-expense")).toBe(SKILL("file-expense", "Files an expense, with a receipt."));
    expect(readSkillReferences(writer, "file-expense")).toEqual([{ path: "references/edge-cases.md", content: "# Edge cases\n\nLost receipts.\n" }]);
    const revisions = readdirSync(join(own, "skills", ".revisions"));
    expect(revisions).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
    expect(readdirSync(join(own, "skills", ".revisions", revisions[0]!)).sort()).toEqual(["SKILL.md", "references"]);
    expect(readdirSync(join(DATA_DIR, "skill-state", writer, "reviewed-revisions")), "the copy the review prepared is gone").toEqual([]);
    expect(realpathSync(join(own, ".claude", "skills", "file-expense"))).toBe(join(own, "skills", ".revisions", revisions[0]!));
    expect(promptFor(writer)).toContain("- file-expense (your own):");
    expect(promptFor(writer)).not.toContain(join(own, "skills", ".revisions", revisions[0]!, "SKILL.md"));
  });

  it("come along, still switched on, when a bot that already had skills joins a project", () => {
    joined = false;
    installSkill(writer, "src", [{ path: "SKILL.md", content: SKILL("beat-sheet") }]);
    setSkillEnabled(writer, "beat-sheet", true);
    learn(writer, "create", "Files an expense.");
    learn(writer, "update", "Files an expense, with a receipt.");
    installSkill(writer, "src", [{ path: "SKILL.md", content: SKILL("cold-open") }]);
    expect(links(privateBotFolder(writer), "beat-sheet")).toEqual(NATIVE);

    joined = true;
    ensureWorkspace(writer);
    syncSkillLinks(writer);

    expect(listSkills(writer).map((skill) => [skill.name, skill.enabled, skill.warnings])).toEqual([["beat-sheet", true, []], ["cold-open", false, []], ["file-expense", true, []]]);
    expect([links(own, "beat-sheet"), links(own, "file-expense"), links(own, "cold-open")]).toEqual([NATIVE, NATIVE, []]);
    expect(realpathSync(join(own, ".agents", "skills", "beat-sheet"))).toBe(join(own, "skills", "beat-sheet"));
    expect(readSkillFile(writer, "file-expense")).toBe(SKILL("file-expense", "Files an expense, with a receipt."));
    expect(promptFor(writer)).toContain("- beat-sheet (your own):");
    expect(readdirSync(privateBotFolder(writer)), "nothing of them stays in the data folder").toEqual([]);
  });
});

describe("a project bot's own skills while its project folder is away", () => {
  const away = () => `This bot's project folder was not found at ${project}. Reconnect the drive or put the folder back, then try again.`;

  it("are refused with the reason, kept as they were, and nothing is made", () => {
    installSkill(writer, "src", [{ path: "SKILL.md", content: SKILL("beat-sheet") }]);
    setSkillEnabled(writer, "beat-sheet", true);
    learn(writer, "create", "Files an expense.");
    const unplugged = `${project}-unplugged`;
    renameSync(project, unplugged);
    try {
      expect(installSkill(writer, "src", [{ path: "SKILL.md", content: SKILL("cold-open") }])).toEqual({ error: away() });
      expect(learn(writer, "update", "Files an expense, with a receipt.")).toEqual({ error: away() });
      expect(learn(writer, "create", "Opens cold.", [], "cold-open")).toEqual({ error: away() });
      expect(setSkillEnabled(writer, "beat-sheet", true)).toEqual({ error: away() });
      expect(removeSkill(writer, "beat-sheet")).toEqual({ error: away() });
      expect(listSkills(writer).map((skill) => [skill.name, skill.enabled, skill.warnings])).toEqual([["beat-sheet", false, [away()]], ["file-expense", false, [away()]]]);
      expect(promptFor(writer)).toBe("");
      syncSkillLinks(writer);
      expect(managed(writer).sort()).toEqual(["beat-sheet", "file-expense"]);
      expect(existsSync(project), "the project folder is never made again").toBe(false);
      expect(readdirSync(privateBotFolder(writer)), "and nothing is written to the data folder instead").toEqual([]);

      expect(setSkillEnabled(writer, "file-expense", false)).toMatchObject({ name: "file-expense", enabled: false });
    } finally {
      renameSync(unplugged, project);
    }
    expect(listSkills(writer).map((skill) => [skill.name, skill.enabled])).toEqual([["beat-sheet", true], ["file-expense", false]]);
    expect(links(own, "file-expense"), "its links are still there until the next look").toEqual(NATIVE);
    syncSkillLinks(writer);
    expect([links(own, "beat-sheet"), links(own, "file-expense")]).toEqual([NATIVE, []]);
    expect(managed(writer)).toEqual(["beat-sheet"]);
  });

  it("are refused when nothing knows the project", () => {
    setTeamProjectLookup(() => undefined);
    expect(installSkill(writer, "src", [{ path: "SKILL.md", content: SKILL("beat-sheet") }]))
      .toEqual({ error: "MagicBot has no record of this bot's project. Restore projects.json in MagicBot's data folder from a backup, then try again." });
    expect(existsSync(join(privateBotFolder(writer), "skills"))).toBe(false);
  });
});

describe("a bot in no project, whose own folder is on another volume", () => {
  beforeEach(() => { otherVolume.root = workspaceDir(plain); });

  it("keeps failing as it did: no update is published and no link is unlinked in place", () => {
    expect(workspaceDir(plain)).toBe(privateBotFolder(plain));
    expect(learn(plain, "create", "Files an expense.")).toMatchObject({ name: "file-expense", enabled: true });
    expect(learn(plain, "update", "Files an expense, with a receipt.")).toEqual({ error: expect.stringContaining("EXDEV") });
    expect(readSkillFile(plain, "file-expense")).toBe(SKILL("file-expense", "Files an expense."));

    expect(setSkillEnabled(plain, "file-expense", false)).toMatchObject({ enabled: false });
    expect(links(workspaceDir(plain), "file-expense")).toEqual(NATIVE);
    expect(managed(plain)).toEqual(["file-expense"]);
  });
});
