import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePackageDocument, type PackageDocument } from "../shared/package-format.ts";
import { writeShareFolder } from "../shared/share-folder.ts";
import { TEMPLATE_LIMITS, type TeamTemplateInput, type TemplateOwnSkill, type TemplateRole } from "../shared/template-library.ts";
import type { Routine } from "./routines.ts";
import { createCommunityPublisher } from "./share-publish.ts";
import { createShareHost } from "./share.ts";
import type { BotRecord } from "./store.ts";
import { createTemplateLibrary, TemplateLibraryError, type TemplateLibraryDeps } from "./template-library.ts";

const KEY = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const skillText = (name: string) => `---\nname: ${name}\ndescription: How ${name} is done.\n---\n\n# ${name}\n\nNewest first.\n`;
const ownSkill = (name: string, files?: TemplateOwnSkill["files"]): TemplateOwnSkill => ({ name, description: "", text: skillText(name), ...(files ? { files } : {}) });

const folders: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-template-library-"));
  folders.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function role(overrides: Partial<TemplateRole> = {}): TemplateRole {
  return { key: "writer", name: "剧本编写", title: "把大纲写成分集剧本", description: "", soul: "你是编剧。", look: { color: "blue" }, ownSkills: [], memory: "", librarySkills: [], ...overrides };
}

function team(overrides: Partial<TeamTemplateInput> = {}): TeamTemplateInput {
  return {
    name: "都市短剧创作团队", genre: "都市情感、职场逆袭类短剧", context: "每集两分钟，前三秒要有钩子。", lead: "lead",
    roles: [
      role({ key: "lead", name: "总编剧", title: "带队并把关", model: { instanceId: "claude", model: "claude-test-model", effort: "high" }, librarySkills: ["story-beats"], mcpServers: ["drama-db"], memory: "上一季的口碑不错。" }),
      role({ key: "picker", name: "选书", title: "挑适合改编的小说", look: { color: "green", picture: PNG, pictureCrop: "square" }, ownSkills: ["pick-novel"] }),
      role(),
    ],
    skills: [ownSkill("pick-novel", [{ path: "notes/criteria.md", content: "# Criteria\n" }])],
    ...overrides,
  };
}

function library(options: { dataDir?: string; deps?: Partial<TemplateLibraryDeps> } = {}) {
  const dataDir = options.dataDir ?? scratch();
  let clock = 1_800_000_000_000;
  const made = createTemplateLibrary({
    root: join(dataDir, "templates"), bots: () => [], routines: () => [], ownSkillNames: () => [],
    exportDocument: () => { throw new Error("no share export in this test"); },
    now: () => (clock += 1000),
    ...options.deps,
  });
  return { library: made, dataDir, root: join(dataDir, "templates") };
}

function refusalOf(run: () => unknown): { status: number; errorKey?: string; error: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof TemplateLibraryError) return { status: error.status, ...error.body };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the template library on disk", () => {
  it("keeps a team template as a template folder with magicbot.json beside it, and reads it back whole", () => {
    const { library: first, dataDir, root } = library();
    const saved = first.saveTeam(team());
    expect(saved).toMatchObject({ name: "都市短剧创作团队", genre: "都市情感、职场逆袭类短剧", version: 1, lead: "lead", context: "每集两分钟，前三秒要有钩子。", carried: { groupChats: 0, routines: 0 } });
    expect(saved.id).toMatch(/^[a-f0-9]{16}$/);
    expect(saved.roles.map((each) => each.key)).toEqual(["lead", "picker", "writer"]);

    const dir = join(root, "teams", saved.id);
    expect(readdirSync(dir).sort()).toEqual(["avatars", "magicbot.json", "skills", "team.md"]);
    expect(readdirSync(join(dir, "avatars"))).toEqual(["picker.png"]);
    expect(readFileSync(join(dir, "skills", "pick-novel", "SKILL.md"), "utf8")).toBe(skillText("pick-novel"));
    expect(readFileSync(join(dir, "skills", "pick-novel", "notes", "criteria.md"), "utf8")).toBe("# Criteria\n");
    const manifest = readFileSync(join(dir, "team.md"), "utf8");
    expect(manifest).toContain("每集两分钟，前三秒要有钩子。");
    expect(manifest).not.toMatch(/claude-test-model|story-beats|drama-db|都市情感、职场逆袭类短剧\n.*genre/);
    expect(JSON.parse(readFileSync(join(dir, "magicbot.json"), "utf8"))).toEqual({
      schema: 1, kind: "team", version: 1, updatedAt: saved.updatedAt, genre: "都市情感、职场逆袭类短剧", lead: "lead",
      roles: {
        lead: { model: { instanceId: "claude", model: "claude-test-model", effort: "high" }, librarySkills: ["story-beats"], mcpServers: ["drama-db"] },
        picker: { librarySkills: [] },
        writer: { librarySkills: [] },
      },
    });

    const again = library({ dataDir }).library;
    expect(again.teamTemplate(saved.id)).toEqual(saved);
    expect(again.list()).toEqual({
      bots: [],
      teams: [{
        id: saved.id, name: "都市短剧创作团队", genre: "都市情感、职场逆袭类短剧", version: 1, updatedAt: saved.updatedAt, lead: "lead",
        roles: [{ key: "lead", name: "总编剧", title: "带队并把关" }, { key: "picker", name: "选书", title: "挑适合改编的小说" }, { key: "writer", name: "剧本编写", title: "把大纲写成分集剧本" }],
      }],
    });
    const picker = again.teamTemplate(saved.id)!.roles[1]!;
    expect(picker).toMatchObject({ look: { color: "green", picture: PNG, pictureCrop: "square" }, ownSkills: ["pick-novel"] });
  });

  it("hands the rest of the server a team the package importer takes, with the extras by role key", () => {
    const { library: made } = library();
    const { id } = made.saveTeam(team());
    const whole = made.readTeam(id)!;
    expect(whole).toMatchObject({ id, lead: "lead", version: 1, genre: "都市情感、职场逆袭类短剧" });
    expect(parsePackageDocument(whole.document, { trust: "file" })).toEqual(whole.document);
    const pkg = whole.document.package;
    expect(pkg.team).toEqual({ name: "都市短剧创作团队", brief: "每集两分钟，前三秒要有钩子。", leader: "lead" });
    expect(pkg.agents.map((agent) => agent.key)).toEqual(whole.roles.map((each) => each.key));
    expect(pkg.agents[0]).toMatchObject({ name: "总编剧", title: "带队并把关", soul: "你是编剧。", seed: { memory: { "MEMORY.md": "上一季的口碑不错。" } } });
    expect(pkg.agents[1]).toMatchObject({ skills: ["pick-novel"], appearance: { color: "green", avatar: { mime: "image/png", crop: "square" } } });
    expect(pkg.skills?.entries.map((skill) => skill.name)).toEqual(["pick-novel"]);
    expect(whole.extras).toEqual({
      lead: { model: { instanceId: "claude", model: "claude-test-model", effort: "high" }, librarySkills: ["story-beats"], mcpServers: ["drama-db"] },
      picker: { librarySkills: [] },
      writer: { librarySkills: [] },
    });
    expect(made.readTeam("0000000000000000")).toBeNull();
    expect(made.readBot(id)).toBeNull();
  });

  it("keeps the parts of a look the folder format has no field for: the face colour, and a picture's framing", () => {
    const { library: made, root } = library();
    const saved = made.saveTeam(team({
      roles: [
        role({ key: "lead", name: "总编剧", look: { color: "purple", mascotBody: "cat", mascotFaceColor: "white", avatarZoom: 2, avatarFocusX: 0.1 } }),
        role({ key: "picker", name: "选书", look: { color: "green", picture: PNG, avatarZoom: 1.456, avatarFocusX: 0.3, avatarFocusY: 0.5 } }),
        role({ look: { color: "blue", picture: PNG, pictureCrop: "rounded", avatarZoom: 9, avatarFocusY: -1 } }),
      ],
      skills: [],
    }));
    expect(saved.roles.map((each) => each.look)).toEqual([
      { color: "purple", mascotBody: "cat", mascotFaceColor: "white" },
      { color: "green", picture: PNG, avatarZoom: 1.46, avatarFocusX: 0.3 },
      { color: "blue", picture: PNG, pictureCrop: "rounded", avatarZoom: 3, avatarFocusY: 0 },
    ]);
    const whole = made.readTeam(saved.id)!;
    expect(whole.extras).toEqual({
      lead: { librarySkills: [], look: { mascotFaceColor: "white" } },
      picker: { librarySkills: [], look: { avatarZoom: 1.46, avatarFocusX: 0.3 } },
      writer: { librarySkills: [], look: { avatarZoom: 3, avatarFocusY: 0 } },
    });
    expect(readFileSync(join(root, "teams", saved.id, "team.md"), "utf8")).not.toMatch(/mascotFaceColor|avatarZoom|avatarFocus/);
    expect(made.saveTeam({ ...team(), roles: saved.roles.map((each) => ({ ...each, look: { color: each.look.color } })), skills: [] }, saved.id).roles.map((each) => each.look))
      .toEqual([{ color: "purple" }, { color: "green" }, { color: "blue" }]);
    expect(made.readTeam(saved.id)!.extras.lead).toEqual({ librarySkills: [] });
    expect(refusalOf(() => made.saveBot({ role: role({ look: { color: "blue", mascotFaceColor: "red" as never } }), skills: [] }))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.invalid" });
  });

  it("counts the version up with every save and keeps every role under its key", () => {
    const { library: made, root } = library();
    const first = made.saveTeam(team());
    const second = made.saveTeam({
      ...team(), name: "都市短剧团队", lead: "writer",
      roles: [...team().roles.map((each) => each.key === "writer" ? { ...each, name: "编剧", model: { instanceId: "codex", model: "gpt-test" } } : each), role({ key: "role-1", name: "镜头脚本设计" })],
    }, first.id);
    expect(second).toMatchObject({ id: first.id, version: 2, name: "都市短剧团队", lead: "writer" });
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.roles.map((each) => [each.key, each.name])).toEqual([["lead", "总编剧"], ["picker", "选书"], ["writer", "编剧"], ["role-1", "镜头脚本设计"]]);
    expect(second.roles[2]!.model).toEqual({ instanceId: "codex", model: "gpt-test" });
    expect(made.saveTeam({ ...team(), name: "都市短剧团队", roles: team().roles.slice(0, 2) }, first.id)).toMatchObject({ version: 3, roles: [{ key: "lead" }, { key: "picker" }] });
    expect(made.readTeam(first.id)).toMatchObject({ version: 3, document: { package: { release: "3.0.0" } } });
    expect(readdirSync(join(root, "teams"))).toEqual([first.id]);
    expect(refusalOf(() => made.saveTeam(team(), "0123456789abcdef"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.notFound" });
  });

  it("remembers the keys of roles a team template had once, across saves and restarts", () => {
    const { library: made, root, dataDir } = library();
    const [lead, , writer] = team().roles as [TemplateRole, TemplateRole, TemplateRole];
    const first = made.saveTeam(team());
    expect("retiredKeys" in first).toBe(false);
    const stored = () => JSON.parse(readFileSync(join(root, "teams", first.id, "magicbot.json"), "utf8")) as { retiredKeys?: string[] };
    expect("retiredKeys" in stored()).toBe(false);

    expect(made.saveTeam({ ...team(), roles: [lead, writer], skills: [] }, first.id).retiredKeys).toEqual(["picker"]);
    expect(stored().retiredKeys).toEqual(["picker"]);
    const restarted = library({ dataDir }).library;
    expect(restarted.teamTemplate(first.id)!.retiredKeys).toEqual(["picker"]);
    expect(restarted.saveTeam({ ...team(), roles: [lead, role({ key: "role-1", name: "镜头脚本设计" })], skills: [] }, first.id).retiredKeys).toEqual(["picker", "writer"]);

    const back = restarted.saveTeam({ ...team(), roles: [lead, writer], skills: [] }, first.id);
    expect(back.retiredKeys, "a role back under its key is one of the template's roles again").toEqual(["picker", "role-1"]);
    restarted.addStarterMemory("team", first.id, "lead", "Open on a cliffhanger.");
    expect(restarted.teamTemplate(first.id)).toMatchObject({ version: 5, retiredKeys: ["picker", "role-1"] });
    expect(restarted.saveTeam(team(), first.id).retiredKeys).toEqual(["role-1"]);
  });

  it("reads a magicbot.json whose list of retired keys is damaged, without the keys that are none", () => {
    const { library: made, root } = library();
    const saved = made.saveTeam(team());
    const path = join(root, "teams", saved.id, "magicbot.json");
    const meta = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...meta, retiredKeys: ["old-role", "Not A Key", "lead", "../etc"] }));
    expect(made.teamTemplate(saved.id)).toMatchObject({ version: 1, genre: "都市情感、职场逆袭类短剧", retiredKeys: ["old-role"] });
    writeFileSync(path, JSON.stringify({ ...meta, retiredKeys: "all of them" }));
    const read = made.teamTemplate(saved.id)!;
    expect(read).toMatchObject({ version: 1, genre: "都市情感、职场逆袭类短剧", lead: "lead" });
    expect("retiredKeys" in read).toBe(false);
  });

  it("keeps a bot template as one role named as the template", () => {
    const { library: made, root } = library();
    const saved = made.saveBot({ role: role({ key: "picker", name: "选书", title: "挑适合改编的小说", librarySkills: ["novel-search"], ownSkills: ["pick-novel"] }), skills: [ownSkill("pick-novel"), ownSkill("unused")] });
    expect(saved).toMatchObject({ name: "选书", title: "挑适合改编的小说", version: 1, role: { key: "picker", librarySkills: ["novel-search"], ownSkills: ["pick-novel"] } });
    expect(saved.skills.map((skill) => skill.name)).toEqual(["pick-novel"]);
    expect(readdirSync(join(root, "bots", saved.id)).sort()).toEqual(["bot.md", "magicbot.json", "skills"]);
    expect(made.list().bots).toEqual([{ id: saved.id, name: "选书", title: "挑适合改编的小说", version: 1, updatedAt: saved.updatedAt }]);
    expect(made.readBot(saved.id)).toMatchObject({ key: "picker", extras: { librarySkills: ["novel-search"] }, document: { package: { name: "选书", agents: [{ key: "picker", name: "选书" }] } } });
    expect(made.saveBot({ role: { ...saved.role, name: "选书人" }, skills: saved.skills }, saved.id)).toMatchObject({ name: "选书人", version: 2 });
    expect(made.readTeam(saved.id)).toBeNull();
  });

  it("refuses a name that is empty, too long, on two lines or already taken", () => {
    const { library: made, root } = library();
    const first = made.saveTeam(team());
    for (const name of ["", "   ", "x".repeat(TEMPLATE_LIMITS.name + 1), "两行\n名字"]) {
      expect(refusalOf(() => made.saveTeam(team({ name })))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.nameRule" });
    }
    expect(refusalOf(() => made.saveTeam(team()))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.nameTaken", errorParams: { name: "都市短剧创作团队" } });
    made.saveTeam(team({ name: "Ancient Costume" }));
    expect(refusalOf(() => made.saveTeam(team({ name: " ancient costume " })))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.nameTaken" });
    expect(made.saveTeam(team(), first.id).version).toBe(2);
    expect(refusalOf(() => made.saveTeam(team({ name: "三", roles: [role(), role({ key: "other" })] })))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.roleNameTaken", errorParams: { name: "剧本编写" } });
    expect(refusalOf(() => made.saveTeam(team({ name: "四", lead: "writer", roles: [role({ name: " " })] })))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.roleNameRule" });
    expect(refusalOf(() => made.saveTeam(team({ name: "五", roles: [] })))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.invalid" });
    expect(refusalOf(() => made.saveTeam(team({ name: "六", lead: "nobody" })))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.invalid" });
    expect(refusalOf(() => made.saveTeam(team({ name: "七", roles: [role({ key: "Writer_1" })] })))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.invalid" });
    expect(refusalOf(() => made.saveBot({ role: role({ name: "" }), skills: [] }))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.nameRule" });
    expect(readdirSync(join(root, "teams"))).toHaveLength(2);
    expect(existsSync(join(root, "bots"))).toBe(false);
  });

  it("refuses a picture that is not one and a skill it was not given, and drops skills no role uses", () => {
    const { library: made } = library();
    expect(refusalOf(() => made.saveBot({ role: role({ look: { color: "blue", picture: "data:image/png;base64,AAAA" } }), skills: [] })))
      .toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.picture", errorParams: { name: "剧本编写" } });
    expect(refusalOf(() => made.saveBot({ role: role({ ownSkills: ["missing"] }), skills: [] }))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.skill", errorParams: { name: "missing" } });
    expect(refusalOf(() => made.saveBot({ role: role({ ownSkills: ["renamed"] }), skills: [{ name: "renamed", description: "", text: skillText("original") }] })))
      .toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.skill" });
    expect(made.list().bots).toEqual([]);
  });

  it("refuses a template that is larger than a template folder may be", () => {
    const { library: made, root } = library();
    const names = Array.from({ length: 20 }, (_, index) => `skill-${index}`);
    const heavy = names.map((name) => ownSkill(name, [{ path: "notes/big.md", content: "x".repeat(250 * 1024) }]));
    expect(refusalOf(() => made.saveBot({ role: role({ ownSkills: names }), skills: heavy }))).toMatchObject({ status: 413, errorKey: "serverError.templateLibrary.tooLarge" });
    expect(existsSync(join(root, "bots"))).toBe(false);
  });

  it("deletes into the archive and puts back with undo", () => {
    const { library: made, root } = library();
    const saved = made.saveTeam(team());
    made.saveTeam(team(), saved.id);
    const { undo } = made.remove("team", saved.id);
    expect(undo).toMatch(new RegExp(`^team\\.${saved.id}\\.[0-9a-f-]{36}$`));
    expect(made.list().teams).toEqual([]);
    expect(made.readTeam(saved.id)).toBeNull();
    expect(readdirSync(join(root, "archive", "removed"))).toEqual([undo]);
    expect(readdirSync(join(root, "teams"))).toEqual([]);

    expect(made.restore(undo)).toEqual({ kind: "team", id: saved.id });
    expect(made.teamTemplate(saved.id)).toMatchObject({ version: 2, name: "都市短剧创作团队", lead: "lead" });
    expect(readdirSync(join(root, "archive", "removed"))).toEqual([]);
    expect(refusalOf(() => made.restore(undo))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.undoGone" });
    expect(refusalOf(() => made.remove("team", "0123456789abcdef"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.notFound" });
    expect(refusalOf(() => made.remove("bot", saved.id))).toMatchObject({ status: 404 });
  });

  it("does not put a deleted template back over one that took its name", () => {
    const { library: made } = library();
    const first = made.saveTeam(team());
    const { undo } = made.remove("team", first.id);
    const second = made.saveTeam(team());
    expect(refusalOf(() => made.restore(undo))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.restoreNameTaken", errorParams: { name: "都市短剧创作团队" } });
    expect(made.list().teams.map((each) => each.id)).toEqual([second.id]);
    made.saveTeam(team({ name: "换个名字" }), second.id);
    expect(made.restore(undo)).toEqual({ kind: "team", id: first.id });
    expect(made.list().teams).toHaveLength(2);
  });

  it("lists a template whose magicbot.json is damaged or gone, with what the folder still says", () => {
    const { library: made, root } = library();
    const saved = made.saveTeam(team({ lead: "picker" }));
    made.saveTeam(team({ lead: "picker" }), saved.id);
    const other = made.saveTeam(team({ name: "古风创作团队" }));
    const meta = join(root, "teams", saved.id, "magicbot.json");
    for (const damage of ["{ not json", JSON.stringify({ version: "two" }), JSON.stringify([1, 2])]) {
      writeFileSync(meta, damage);
      expect(made.list().teams.map((each) => each.name)).toEqual(["古风创作团队", "都市短剧创作团队"]);
      expect(made.readTeam(saved.id)).toMatchObject({ version: 2, genre: "", lead: "picker", extras: { lead: { librarySkills: [] }, picker: { librarySkills: [] }, writer: { librarySkills: [] } } });
    }
    rmSync(meta);
    expect(made.teamTemplate(saved.id)).toMatchObject({ version: 2, lead: "picker", roles: [{ key: "lead", librarySkills: [] }, { key: "picker" }, { key: "writer" }] });
    expect(made.saveTeam(team({ lead: "picker" }), saved.id)).toMatchObject({ version: 3, genre: "都市情感、职场逆袭类短剧" });
    expect(made.readTeam(other.id)).toMatchObject({ version: 1 });
  });

  it("leaves out one damaged folder, says so once, and still lists and deletes the rest", () => {
    const { library: made, root } = library();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = made.saveTeam(team());
    const fine = made.saveTeam(team({ name: "古风创作团队" }));
    writeFileSync(join(root, "teams", broken.id, "team.md"), "---\nbotmrr: 2\nname: [unclosed\n---\n");
    mkdirSync(join(root, "teams", "aaaaaaaaaaaaaaaa"));
    mkdirSync(join(root, "teams", "not-a-template"));
    writeFileSync(join(root, "teams", "bbbbbbbbbbbbbbbb"), "a file where a folder belongs");
    expect(made.list().teams.map((each) => each.id)).toEqual([fine.id]);
    expect(made.list().teams).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(made.readTeam(broken.id)).toBeNull();
    expect(made.teamTemplate(broken.id)).toBeNull();
    expect(refusalOf(() => made.saveTeam(team({ name: "新名字" }), broken.id))).toMatchObject({ status: 404 });
    expect(made.remove("team", broken.id).undo).toContain(broken.id);
    expect(made.saveTeam(team()).version).toBe(1);
  });

  it("never reads or writes through a link, or outside the templates folder", () => {
    const { library: made, dataDir, root } = library();
    const saved = made.saveTeam(team());
    const outside = scratch();
    const elsewhere = join(outside, "cccccccccccccccc");
    mkdirSync(elsewhere);
    for (const [path, value] of Object.entries(writeShareFolder(made.readTeam(saved.id)!.document, "department"))) {
      mkdirSync(join(elsewhere, path, ".."), { recursive: true });
      writeFileSync(join(elsewhere, path), value);
    }
    symlinkSync(elsewhere, join(root, "teams", "cccccccccccccccc"));
    expect(made.list().teams.map((each) => each.id)).toEqual([saved.id]);
    expect(made.readTeam("cccccccccccccccc")).toBeNull();
    expect(refusalOf(() => made.remove("team", "cccccccccccccccc"))).toMatchObject({ status: 404 });
    expect(() => made.saveTeam(team({ name: "别处" }), "cccccccccccccccc")).toThrow();
    expect(existsSync(join(elsewhere, "magicbot.json"))).toBe(false);

    for (const id of ["..", "../bots", "../../escape", "teams/x", "CCCCCCCCCCCCCCCC", ""]) {
      expect(made.readTeam(id)).toBeNull();
      expect(made.teamTemplate(id)).toBeNull();
      expect(refusalOf(() => made.remove("team", id))).toMatchObject({ status: 404 });
      expect(refusalOf(() => made.saveTeam(team({ name: "逃" }), id))).toMatchObject({ status: 404 });
    }
    for (const undo of ["../../teams", `team.${saved.id}.not-a-uuid`, `team.../../x.${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`, ""]) {
      expect(refusalOf(() => made.restore(undo))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.undoGone" });
    }
    expect(refusalOf(() => made.saveBot({ role: role({ ownSkills: ["escape"] }), skills: [{ name: "escape", description: "", text: skillText("escape"), files: [{ path: "../../../escaped.md", content: "out" }] }] })))
      .toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.invalid" });
    expect(readdirSync(dataDir)).toEqual(["templates"]);
    expect(readdirSync(root).sort()).toEqual(["teams"]);
    expect(readdirSync(outside)).toEqual(["cccccccccccccccc"]);
  });

  it("refuses to use a templates folder that is a link", () => {
    const dataDir = scratch(), target = scratch();
    symlinkSync(target, join(dataDir, "templates"));
    const { library: made } = library({ dataDir });
    expect(made.list()).toEqual({ bots: [], teams: [] });
    expect(() => made.saveTeam(team())).toThrow(/not a plain folder/);
    expect(readdirSync(target)).toEqual([]);
  });

  it("finishes a save that was cut short between its two folder swaps", () => {
    const { library: made, dataDir, root } = library();
    const saved = made.saveTeam(team());
    const teams = join(root, "teams");
    renameSync(join(teams, saved.id), join(teams, `.${saved.id}.11111111-2222-3333-4444-555555555555.old`));
    mkdirSync(join(teams, `.${saved.id}.66666666-7777-8888-9999-000000000000.new`));
    expect(made.list().teams).toEqual([]);
    const restarted = library({ dataDir }).library;
    expect(restarted.list().teams.map((each) => each.id)).toEqual([saved.id]);
    expect(readdirSync(teams)).toEqual([saved.id]);
  });

  it("holds a bounded number of templates of a kind", () => {
    const { library: made, root } = library();
    mkdirSync(join(root, "teams"), { recursive: true });
    for (let index = 0; index < TEMPLATE_LIMITS.templates; index += 1) mkdirSync(join(root, "teams", index.toString(16).padStart(16, "0")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(refusalOf(() => made.saveTeam(team()))).toMatchObject({ status: 409, errorKey: "serverError.templateLibrary.full", errorParams: { count: TEMPLATE_LIMITS.templates } });
    expect(made.saveBot({ role: role(), skills: [] }).version).toBe(1);
  });

  it("gives a folder made elsewhere role keys a project can name folders by, and follows them through the team", () => {
    const { library: made, root } = library();
    const document: PackageDocument = parsePackageDocument({
      format: "openmaus.package", version: 2,
      package: {
        id: "ops", release: "4.2.0", name: "Ops", tagline: "An ops team.", summary: "An ops team.", category: "Community", author: { name: "Someone" }, license: "Unspecified",
        outcomes: ["Run ops."], setupMinutes: 2, requirements: { apps: [], capabilities: [] },
        team: { name: "Ops", leader: "ops_lead" },
        agents: [
          { key: "ops_lead", name: "Lead", appearance: { color: "blue" } },
          { key: "con", name: "Console", appearance: { color: "green" } },
          { key: "helper", name: "Helper", appearance: { color: "red" } },
        ],
        rooms: [{ key: "standup", name: "Standup", members: ["ops_lead", "con"], defaultResponder: { kind: "agent", agent: "ops_lead" } }],
        routines: [{ key: "sweep", name: "Sweep", agent: "con", prompt: "Sweep.", runOn: "maus", schedule: { type: "daily", time: "09:00", weekdays: [1] }, durationMinutes: 30, enabledAfterInstall: false }],
      },
    }, { trust: "file" });
    const dir = join(root, "teams", "dddddddddddddddd");
    for (const [path, value] of Object.entries(writeShareFolder(document, "department"))) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), value);
    }
    const read = made.readTeam("dddddddddddddddd")!;
    expect(read).toMatchObject({ name: "Ops", version: 4, lead: "ops-lead", genre: "" });
    expect(read.roles.map((each) => each.key)).toEqual(["ops-lead", "role-1", "helper"]);
    expect(read.document.package).toMatchObject({
      team: { leader: "ops-lead" },
      rooms: [{ members: ["ops-lead", "role-1"], defaultResponder: { kind: "agent", agent: "ops-lead" } }],
      routines: [{ agent: "role-1" }],
    });
    expect(Object.keys(read.extras)).toEqual(["ops-lead", "role-1", "helper"]);
    const edited = made.teamTemplate("dddddddddddddddd")!;
    expect(edited.carried).toEqual({ groupChats: 1, routines: 1 });
    const kept = made.saveTeam({ name: edited.name, genre: "运维", context: "", lead: "helper", roles: edited.roles.filter((each) => each.key !== "role-1"), skills: edited.skills }, "dddddddddddddddd");
    expect(kept).toMatchObject({ version: 5, lead: "helper", carried: { groupChats: 1, routines: 0 } });
    expect(made.readTeam("dddddddddddddddd")!.document.package.rooms).toMatchObject([{ members: ["ops-lead"], defaultResponder: { kind: "agent", agent: "ops-lead" } }]);
  });
});

describe("saving what already exists as a template", () => {
  function bot(overrides: Partial<BotRecord> = {}): BotRecord {
    return {
      id: "bot-1", name: "Helper", title: "Inbox helper", description: "Keeps the inbox tidy.", soul: `Be brief. The admin key is ${KEY}.`, color: "blue",
      section: "Ops", modelSelection: { instanceId: "claude", model: "claude-test-model", effort: "high" }, assignedSkills: ["story-beats", "triage"], mcpServers: ["crm"],
      connectorTools: { gmail: { tools: "*" } }, ...overrides,
    } as BotRecord;
  }
  const routine = { id: "r1", name: "Morning sweep", botId: "bot-1", prompt: "Sweep the inbox.", runOn: "maus", enabled: true,
    schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 30 } as unknown as Routine;

  function installation(bots: BotRecord[], brief?: string) {
    const dataDir = scratch(), botFolder = scratch();
    const share = createShareHost({
      dataDir, bots: () => bots, groups: () => [], routines: () => [routine], brief: () => brief,
      collectTeamSkills: (list) => ({ ok: true, skipped: [], skillsByBot: new Map(list.map((each) => [each.id, ["triage", "story-beats", "from-this-computer"].map((name) => ({ name, description: `How ${name} is done.`, instructions: skillText(name), enabled: true }))])) }),
      picture: () => undefined, botFolder: (id) => join(botFolder, id),
      publisher: createCommunityPublisher({ access: () => null }), patch: () => {},
    });
    const made = library({ dataDir, deps: { bots: () => bots, routines: () => [routine], exportDocument: share.document, ownSkillNames: () => ["triage"] } });
    return { ...made, botFolder };
  }

  it("saves a bot through the share export: its own skills as copies, the library's by name, no key, memory or chat", () => {
    const { library: made, dataDir, root, botFolder } = installation([bot()]);
    const saved = made.saveFromBot("bot-1");
    expect(saved).toMatchObject({
      name: "Helper", title: "Inbox helper", version: 1,
      role: { key: "helper", name: "Helper", description: "Keeps the inbox tidy.", ownSkills: ["triage"], librarySkills: ["story-beats"], mcpServers: ["crm"], memory: "", model: { instanceId: "claude", model: "claude-test-model", effort: "high" } },
    });
    expect(saved.skills.map((skill) => skill.name)).toEqual(["triage"]);
    const dir = join(root, "bots", saved.id);
    const manifest = readFileSync(join(dir, "bot.md"), "utf8");
    expect(manifest).not.toContain(KEY);
    expect(manifest).not.toMatch(/claude-test-model|seed:|approval|https?:\/\//);
    expect(readdirSync(join(dir, "skills"))).toEqual(["triage"]);
    expect(made.readBot(saved.id)!.document.package).toMatchObject({ id: `template-${saved.id}`, release: "1.0.0", name: "Helper", team: { name: "Helper", leader: "helper" } });
    expect(made.readBot(saved.id)!.document.package.routines).toBeUndefined();
    expect(readdirSync(dataDir)).toEqual(["templates"]);
    expect(readdirSync(botFolder)).toEqual([]);

    expect(made.saveFromBot("bot-1")).toMatchObject({ name: "Helper 2", version: 1, role: { key: "helper", name: "Helper 2" } });
    expect(made.list().bots.map((each) => each.name)).toEqual(["Helper", "Helper 2"]);
    expect(refusalOf(() => made.saveFromBot("nobody"))).toMatchObject({ status: 404, errorKey: "serverError.bot.missing" });
  });

  it("leaves a bot that uses every MCP server and the default model without a list or a model", () => {
    const { library: made } = installation([bot({ mcpServers: undefined, assignedSkills: undefined, modelSelection: { instanceId: "", model: "" }, name: "选书", mascotFaceColor: "black", avatarZoom: 2 })]);
    const saved = made.saveFromBot("bot-1");
    expect(saved.role).toMatchObject({ key: "bot-1", name: "选书", librarySkills: [], look: { color: "blue", mascotFaceColor: "black" } });
    expect(saved.role).not.toHaveProperty("mcpServers");
    expect(saved.role).not.toHaveProperty("model");
    expect(saved.role.look).not.toHaveProperty("avatarZoom");
    expect(made.readBot(saved.id)!.extras).toEqual({ librarySkills: [], look: { mascotFaceColor: "black" } });
  });

  it("saves a department as a team template led by its Chief, with its context and its routines paused", () => {
    const bots = [
      bot(),
      bot({ id: "bot-2", name: "Chief", title: "Runs ops", chiefOfStaff: true, assignedSkills: [], mcpServers: undefined, modelSelection: { instanceId: "codex", model: "gpt-test" } }),
      bot({ id: "bot-3", name: "Elsewhere", section: "Sales" }),
      bot({ id: "bot-4", name: "Hidden", hidden: true }),
    ];
    const { library: made } = installation(bots, "We sell a team plan at 49 per seat.");
    const saved = made.saveFromDepartment(" Ops ");
    expect(saved).toMatchObject({ name: "Ops", genre: "", version: 1, lead: "chief", context: "We sell a team plan at 49 per seat.", carried: { groupChats: 0, routines: 1 } });
    expect(saved.roles.map((each) => [each.key, each.name])).toEqual([["helper", "Helper"], ["chief", "Chief"]]);
    expect(saved.roles[0]).toMatchObject({ librarySkills: ["story-beats"], mcpServers: ["crm"], ownSkills: ["triage"] });
    expect(saved.roles[1]).toMatchObject({ librarySkills: [], model: { instanceId: "codex", model: "gpt-test" } });
    expect(saved.roles[1]).not.toHaveProperty("mcpServers");
    const whole = made.readTeam(saved.id)!;
    expect(whole.document.package.team).toMatchObject({ name: "Ops", leader: "chief" });
    expect(whole.document.package.routines).toMatchObject([{ agent: "helper", enabledAfterInstall: false }]);
    expect(made.saveFromDepartment("Ops").name).toBe("Ops 2");
    expect(refusalOf(() => made.saveFromDepartment("Nowhere"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.noBots" });
    expect(refusalOf(() => made.saveFromDepartment("  "))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.noBots" });
  });

  it("saves a department back as its template's next version: the name, the genre, the role keys and the starter memory stay", () => {
    const bots: BotRecord[] = [];
    const { library: made } = installation(bots, "This drama is set in Shanghai.");
    const template = made.saveTeam(team({
      name: "都市短剧创作团队", genre: "都市、爽剧", context: "Every drama has 60 episodes.",
      roles: [
        role({ key: "lead", name: "总编剧", memory: "Hook in the first three seconds.\n" }),
        role({ key: "picker", name: "选书", memory: "Prefer finished novels.\n" }),
        role({ key: "writer", name: "剧本编写" }),
      ],
      skills: [],
    }));
    const stamp = (agentKey: string) => ({ id: `template-${template.id}`, agentKey }) as BotRecord["installedPackage"];
    bots.push(
      bot({ id: "bot-1", name: "总编剧", section: "霸总归来", chiefOfStaff: true, soul: "Lead the room, and cut what drags.", teamProject: { id: "p1", role: "lead" } }),
      bot({ id: "bot-2", name: "选书 2", section: "霸总归来", installedPackage: stamp("picker"), mascotFaceColor: "white" }),
      bot({ id: "bot-3", name: "Lead", section: "霸总归来", title: "Joined later" }),
    );
    const next = made.saveFromDepartment("霸总归来", template.id);
    expect(next).toMatchObject({
      id: template.id, name: "都市短剧创作团队", genre: "都市、爽剧", version: 2, lead: "lead", context: "This drama is set in Shanghai.",
    });
    expect(next.roles.map((each) => [each.key, each.name, each.memory])).toEqual([
      ["lead", "总编剧", "Hook in the first three seconds.\n"],
      ["picker", "选书 2", "Prefer finished novels.\n"],
      ["lead-2", "Lead", ""],
    ]);
    expect(next.retiredKeys, "the role no bot of the department stands for is gone, and its key with it").toEqual(["writer"]);
    expect(next.roles[0]!.soul).toBe("Lead the room, and cut what drags.");
    expect(next.roles[1]!.look).toMatchObject({ mascotFaceColor: "white" });
    expect(made.list().teams.map((each) => [each.name, each.version])).toEqual([["都市短剧创作团队", 2]]);
    expect(made.readTeam(template.id)!.document.package).toMatchObject({ id: `template-${template.id}`, release: "2.0.0", team: { leader: "lead" } });

    bots.push(bot({ id: "bot-4", name: "Writer", section: "霸总归来", title: "Another writer, not the role that left" }));
    const later = made.saveFromDepartment("霸总归来", template.id);
    expect(later.roles.map((each) => [each.key, each.name])).toEqual([["lead", "总编剧"], ["picker", "选书 2"], ["lead-2", "Lead"], ["writer-2", "Writer"]]);
    expect(later.retiredKeys).toEqual(["writer"]);
    bots.pop();

    expect(made.saveFromDepartment("霸总归来")).toMatchObject({ name: "霸总归来", version: 1, genre: "", lead: "lead" });
    expect(refusalOf(() => made.saveFromDepartment("霸总归来", "0123456789abcdef"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.notFound" });
  });

  it("adds an entry to the end of one role's starter memory, as the next version", () => {
    const { library: made } = installation([bot(), bot({ id: "bot-2", name: "Chief", chiefOfStaff: true })]);
    const saved = made.saveFromDepartment("Ops");
    made.addStarterMemory("team", saved.id, "helper", "  The client wants every episode under two minutes.\n\n");
    made.addStarterMemory("team", saved.id, "helper", "Never name a real brand.");
    made.addStarterMemory("team", saved.id, "helper", "   ");
    const after = made.teamTemplate(saved.id)!;
    expect(after.version).toBe(3);
    expect(after.roles.map((each) => each.memory)).toEqual(["The client wants every episode under two minutes.\n\nNever name a real brand.\n", ""]);
    expect(after.carried).toEqual(saved.carried);
    expect(made.readTeam(saved.id)!.document.package.agents[0]!.seed).toEqual({ memory: { "MEMORY.md": after.roles[0]!.memory } });

    const one = made.saveFromBot("bot-1");
    made.addStarterMemory("bot", one.id, one.role.key, "Answer in Chinese.");
    expect(made.botTemplate(one.id)).toMatchObject({ version: 2, role: { memory: "Answer in Chinese.\n" } });

    expect(refusalOf(() => made.addStarterMemory("team", saved.id, "nobody", "x"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.notFound" });
    expect(refusalOf(() => made.addStarterMemory("bot", one.id, "nobody", "x"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.notFound" });
    expect(refusalOf(() => made.addStarterMemory("team", "0123456789abcdef", "helper", "x"))).toMatchObject({ status: 404, errorKey: "serverError.templateLibrary.notFound" });
    expect(refusalOf(() => made.addStarterMemory("team", saved.id, "helper", "x".repeat(300_000)))).toMatchObject({ status: 400, errorKey: "serverError.templateLibrary.invalid" });
  });
});
