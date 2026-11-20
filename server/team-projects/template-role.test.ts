import { afterEach, describe, expect, it } from "vitest";

import type { PackageAgent } from "../../shared/package-format.ts";
import type { TemplateRoleExtras } from "../../shared/template-library.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

const SKILL = "---\nname: shot-list\ndescription: Lists the shots of an episode.\n---\n\nList every shot.\n";

async function withBot() {
  app = await teamProjectsInstallation();
  const { applyTemplateRole } = await import("./template-role.ts");
  const bot = app.store.createBot({ name: "Quill", title: "Writer", description: "Writes.", soul: "You write.", section: "Drama", color: "blue" }, { seedMessages: false });
  app.store.patchBot(bot.id, { avatarUrl: "/api/attachments/quill.png", mcpServers: ["old-server"], assignedSkills: ["old-skill"], modelSelection: { instanceId: "claude", model: "kept-model" } });
  app.workspace.writeMemoryFile(bot.id, "Remember the male lead is Gu Yan.");
  const host = { store: app.store, skills: { setEnabled: app.skills.setSkillEnabled }, librarySkillNames: () => app!.librarySkills };
  const apply = (agent: Partial<PackageAgent>, extras?: TemplateRoleExtras, keepServers?: string[]) =>
    applyTemplateRole(bot.id, { agent: { key: "writer", name: "Head writer", appearance: { color: "green" }, ...agent }, extras, keepServers }, host);
  let writes = 0;
  app.store.onChange((change) => { if (change.type === "bot" && change.botId === bot.id) writes += 1; });
  return { app, bot: () => app!.store.bot(bot.id)!, apply, writes: () => writes };
}

describe("giving a bot what a template's role says", () => {
  it("sets the title, description, persona and look, the model, the MCP servers and the library skills", async () => {
    const { bot, apply } = await withBot();
    const outcome = apply(
      { title: "Head writer", description: "Writes every episode.", soul: "You write every episode's script.", appearance: { color: "green", mascotExpression: "happy" } },
      {
        model: { instanceId: "codex", model: "gpt-test", effort: "high" }, librarySkills: ["beat-sheet", "not-there", "beat-sheet", "also-missing"], mcpServers: ["drive", "drive", "notes"],
        look: { mascotFaceColor: "black", avatarZoom: 2, avatarFocusX: 0.25, avatarFocusY: 0.75 },
      },
    );
    expect(outcome).toEqual({ missingSkills: ["not-there", "also-missing"] });
    expect(bot()).toMatchObject({
      title: "Head writer", description: "Writes every episode.", soul: "You write every episode's script.", color: "green", mascotExpression: "happy",
      mascotFaceColor: "black", avatarZoom: 2, avatarFocusX: 0.25, avatarFocusY: 0.75,
      modelSelection: { instanceId: "codex", model: "gpt-test", effort: "high" }, mcpServers: ["drive", "notes"], assignedSkills: ["beat-sheet"],
    });
  });

  it("leaves the bot's name, picture, memory and department as they are", async () => {
    const { app, bot, apply } = await withBot();
    apply({ title: "Head writer", soul: "New." }, { librarySkills: [] });
    expect(bot()).toMatchObject({ name: "Quill", avatarUrl: "/api/attachments/quill.png", section: "Drama" });
    expect(app.workspace.readMemoryFile(bot().id).text).toContain("Gu Yan");
  });

  it("leaves the model and the MCP servers alone when the role names none, and takes away library skills it no longer names", async () => {
    const { bot, apply } = await withBot();
    expect(apply({}, { librarySkills: [] })).toEqual({ missingSkills: [] });
    expect(bot()).toMatchObject({ modelSelection: { instanceId: "claude", model: "kept-model" }, mcpServers: ["old-server"], assignedSkills: [] });
    apply({}, { librarySkills: [], model: { instanceId: "", model: "" }, mcpServers: [] });
    expect(bot()).toMatchObject({ modelSelection: { instanceId: "claude", model: "kept-model" }, mcpServers: [] });
  });

  it("works for a role the template keeps nothing extra about", async () => {
    const { bot, apply } = await withBot();
    expect(apply({ title: "Head writer" })).toEqual({ missingSkills: [] });
    expect(bot()).toMatchObject({ title: "Head writer", description: "", soul: "You write.", mcpServers: ["old-server"], assignedSkills: [] });
  });

  it("keeps the servers made for the bot from the template's own connections", async () => {
    const { bot, apply } = await withBot();
    apply({}, { librarySkills: [], mcpServers: ["drive"] }, ["crm", "drive"]);
    expect(bot().mcpServers).toEqual(["crm", "drive"]);
  });

  it("switches on the template's own skills the role uses, and stops at one the bot does not hold", async () => {
    const { app, bot, apply } = await withBot();
    expect(app.skills.installSkill(bot().id, "package:template-drama", [{ path: "SKILL.md", content: SKILL }])).toMatchObject({ name: "shot-list", enabled: false });
    apply({ skills: ["shot-list"] }, { librarySkills: [] });
    expect(app.skills.listSkills(bot().id)).toEqual([expect.objectContaining({ name: "shot-list", enabled: true })]);
    expect(() => apply({ skills: ["shot-list", "storyboard"] }, { librarySkills: [] })).toThrow(/storyboard could not be switched on/);
  });

  it("writes nothing when the bot already is what the role says", async () => {
    const { apply, writes } = await withBot();
    const role = [{ title: "Head writer", soul: "New.", appearance: { color: "green" as const } }, { librarySkills: ["beat-sheet"], mcpServers: ["drive"], model: { instanceId: "codex", model: "gpt-test" } }] as const;
    apply(role[0], { ...role[1], librarySkills: [...role[1].librarySkills], mcpServers: [...role[1].mcpServers] });
    const before = writes();
    expect(before).toBeGreaterThan(0);
    apply(role[0], { ...role[1], librarySkills: [...role[1].librarySkills], mcpServers: [...role[1].mcpServers] });
    expect(writes()).toBe(before);
  });

  it("says so when the bot is not there", async () => {
    app = await teamProjectsInstallation();
    const { applyTemplateRole } = await import("./template-role.ts");
    const host = { store: app.store, skills: { setEnabled: app.skills.setSkillEnabled }, librarySkillNames: () => [] };
    expect(() => applyTemplateRole("nobody", { agent: { key: "writer", name: "Writer", appearance: { color: "blue" } } }, host)).toThrow(/nobody is not there/);
  });
});
