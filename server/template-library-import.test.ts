import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import type { TeamTemplateInput, TemplateRole } from "../shared/template-library.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const skillText = "---\nname: pick-novel\ndescription: How a novel is picked.\n---\n\n# Picking\n\nRead the first three chapters.\n";
let home: string;

function role(overrides: Partial<TemplateRole>): TemplateRole {
  return { key: "writer", name: "剧本编写", title: "把大纲写成分集剧本", description: "写分集剧本。", soul: "你是编剧。", look: { color: "blue" }, ownSkills: [], memory: "", librarySkills: [], ...overrides };
}
const template: TeamTemplateInput = {
  name: "都市短剧创作团队", genre: "都市情感短剧", context: "每集两分钟，前三秒要有钩子。", lead: "lead",
  roles: [
    role({ key: "picker", name: "选书", title: "挑适合改编的小说", look: { color: "green", picture: PNG, pictureCrop: "square" }, ownSkills: ["pick-novel"], librarySkills: ["novel-search"] }),
    role({ key: "lead", name: "总编剧", title: "带队并把关", soul: "你带队。", memory: "上一季的口碑不错。", model: { instanceId: "codex", model: "gpt-test", effort: "high" }, mcpServers: ["drama-db"] }),
    role({}),
  ],
  skills: [{ name: "pick-novel", description: "", text: skillText, files: [{ path: "notes/criteria.md", content: "# Criteria\n" }] }],
};

async function installation() {
  home = mkdtempSync(join(tmpdir(), "omb-template-import-"));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const { Store } = await import("./store.ts");
  const { RoutineManager } = await import("./routines.ts");
  const skills = await import("./skills.ts");
  const workspace = await import("./workspace.ts");
  const sections = await import("./section-context.ts");
  const { saveImage } = await import("./attachments.ts");
  const { botAvatarUrlFromStoredPath } = await import("../shared/bot-avatar.ts");
  const importer = await import("./package-import.ts");
  const { createTemplateLibrary } = await import("./template-library.ts");
  const store = new Store(() => ({ instanceId: "claude", model: "default-model" }));
  const routines = new RoutineManager({
    file: join(home, "routines.json"),
    botState: (id) => (store.bot(id) && !store.bot(id)!.hidden ? "ready" : "missing"),
    goalState: (groupId, botId) => (store.group(groupId ?? "")?.memberIds.includes(botId) ? "ready" : "missing"),
    createTask: () => null,
    startTurn: async () => {},
  });
  const deps = {
    store, routines,
    skills: { install: skills.installSkill, setEnabled: skills.setSkillEnabled, installOrg: skills.installOrgSkill },
    memory: { writeIndex: workspace.writeMemoryFile, writeTopic: workspace.writeMemoryTopic },
    mcp: { servers: () => ({}), refusal: () => undefined, persist: () => {} },
    sections: { writeBrief: (section: string, text: string) => void sections.writeSectionContext(section, text) },
    images: { save: (bytes: Uint8Array, mime: string) => botAvatarUrlFromStoredPath(saveImage(Buffer.from(bytes), mime).path)! },
    defaultSelection: () => ({ instanceId: "claude", model: "default-model" }),
  };
  const library = createTemplateLibrary({
    root: join(home, "templates"), bots: () => store.bots, routines: () => routines.listRoutines(), ownSkillNames: (botId) => skills.listSkills(botId).map((skill) => skill.name),
    exportDocument: () => { throw new Error("no share export in this test"); },
  });
  return { store, skills, workspace, sections, importer, deps, library };
}

afterEach(async () => {
  const { closeMessageDb } = await import("./message-db.ts");
  closeMessageDb();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it("makes a real team from a team template with the package importer, twice", async () => {
  const app = await installation();
  const { id } = app.library.saveTeam(template);
  const whole = app.library.readTeam(id)!;
  const make = (project: string) => {
    const document = structuredClone(whole.document);
    document.package.name = project;
    document.package.team = { ...document.package.team!, name: project };
    const result = app.importer.importPackageDocument(document, { trust: "file", mode: "add" }, app.deps);
    if (result.alreadyAdded) throw new Error("unexpected");
    return { result, byKey: new Map(result.bots.map((bot) => [bot.installedPackage!.agentKey, app.store.bot(bot.id)!])) };
  };

  const first = make("霸总短剧第一季");
  expect(first.result.section).toBe("霸总短剧第一季");
  expect([...first.byKey.keys()].sort()).toEqual(Object.keys(whole.extras).sort());
  const lead = first.byKey.get(whole.lead)!, picker = first.byKey.get("picker")!, writer = first.byKey.get("writer")!;
  expect(lead).toMatchObject({ name: "总编剧", title: "带队并把关", soul: "你带队。", section: "霸总短剧第一季", chiefOfStaff: true, modelSelection: { instanceId: "claude", model: "default-model" } });
  expect(picker).toMatchObject({ name: "选书", title: "挑适合改编的小说", description: "写分集剧本。", color: "green", avatarCrop: "square", section: "霸总短剧第一季", installedPackage: { id: `template-${id}`, release: "1.0.0", source: "file" } });
  expect(picker.avatarUrl).toMatch(/^\/api\/attachments\/[\w-]+\.png$/);
  expect(picker.chiefOfStaff).toBeFalsy();
  expect(writer).toMatchObject({ name: "剧本编写", soul: "你是编剧。" });
  expect(app.sections.readSectionContext("霸总短剧第一季")?.text).toBe("每集两分钟，前三秒要有钩子。");
  expect(app.workspace.readMemoryFile(lead.id).text).toContain("上一季的口碑不错。");
  expect(app.skills.listSkills(picker.id)).toEqual([expect.objectContaining({ name: "pick-novel", enabled: false })]);
  expect(app.skills.listSkills(lead.id)).toEqual([]);
  expect(first.result).toMatchObject({ groups: [], routines: [], brief: true, notes: 1 });
  expect(whole.extras[whole.lead]).toEqual({ model: { instanceId: "codex", model: "gpt-test", effort: "high" }, librarySkills: [], mcpServers: ["drama-db"] });
  expect(whole.extras.picker).toEqual({ librarySkills: ["novel-search"] });

  const second = make("霸总短剧第二季");
  expect(second.result.section).toBe("霸总短剧第二季");
  expect(second.byKey.get(whole.lead)).toMatchObject({ chiefOfStaff: true, section: "霸总短剧第二季" });
  expect([...second.byKey.keys()].sort()).toEqual(["lead", "picker", "writer"]);
  expect(app.store.bots.filter((bot) => bot.installedPackage?.id === `template-${id}`)).toHaveLength(6);
});
