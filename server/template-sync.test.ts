import { describe, expect, it } from "vitest";

import type { PackageAgent } from "../shared/package-format.ts";
import type { TeamTemplateContent, TemplateRoleExtras } from "../shared/template-library.ts";
import type { ModelSelection } from "../shared/wire.ts";
import {
  appliedSettingsFor,
  changedFields,
  compareTeam,
  diffProjectAgainstTemplate,
  projectRoleBot,
  roleTargetFromTemplate,
  type AppliedRoleSettings,
  type BotSettingsSource,
  type ProjectRoleBot,
  type TemplateRoleTarget,
} from "./template-sync.ts";

const sonnet: ModelSelection = { instanceId: "claude", model: "sonnet-5" };
const opus: ModelSelection = { instanceId: "claude", model: "opus-5" };

function settings(over: Partial<AppliedRoleSettings> = {}): AppliedRoleSettings {
  return { persona: "", model: null, librarySkills: [], ownSkills: [], mcpServers: null, ...over };
}

function target(key: string, over: Partial<AppliedRoleSettings> = {}, name = key, title = ""): TemplateRoleTarget {
  return { key, name, title, settings: settings(over) };
}

function bot(role: string, over: Partial<AppliedRoleSettings> = {}, name = role, botId = `bot-${role}`): ProjectRoleBot {
  return { botId, role, name, settings: settings(over) };
}

const base = { templateId: "t1", templateName: "都市短剧团队", fromVersion: 1, toVersion: 2 };

describe("changedFields", () => {
  it("flags each setting that differs", () => {
    expect(changedFields(settings({ persona: "a" }), settings({ persona: "b" }))).toEqual(["persona"]);
    expect(changedFields(settings({ model: sonnet }), settings({ model: opus }))).toEqual(["model"]);
    expect(changedFields(settings({ librarySkills: ["x"] }), settings({ librarySkills: [] }))).toEqual(["skills"]);
    expect(changedFields(settings({ mcpServers: ["srv"] }), settings({ mcpServers: null }))).toEqual(["mcp"]);
  });

  it("ignores the model, and the MCP servers, when the template names neither", () => {
    expect(changedFields(settings({ model: null }), settings({ model: sonnet }))).toEqual([]);
    expect(changedFields(settings({ mcpServers: null }), settings({ mcpServers: ["srv"] }))).toEqual([]);
  });

  it("treats two 'all enabled' MCP lists, and two equal skill sets, as the same", () => {
    expect(changedFields(settings({ mcpServers: null }), settings({ mcpServers: null }))).toEqual([]);
    expect(changedFields(settings({ librarySkills: ["a", "b"] }), settings({ librarySkills: ["a", "b"] }))).toEqual([]);
  });

  it("counts one of the template's own skills the bot does not hold as a change of skills, and a skill only the bot holds as none", () => {
    expect(changedFields(settings({ ownSkills: ["hook-check"] }), settings({ ownSkills: [] }))).toEqual(["skills"]);
    expect(changedFields(settings({ ownSkills: ["hook-check"] }), settings({ ownSkills: ["hook-check", "learned-here"] }))).toEqual([]);
    expect(changedFields(settings(), settings({ ownSkills: ["learned-here"] }))).toEqual([]);
  });

  it("reports several fields at once", () => {
    expect(changedFields(settings({ persona: "p", model: sonnet, librarySkills: ["s"] }), settings()))
      .toEqual(["persona", "model", "skills"]);
  });
});

describe("compareTeam", () => {
  it("matches by role key and lists the changed settings", () => {
    const diff = compareTeam({
      ...base,
      templateRoles: [target("writer", { persona: "new" })],
      projectBots: [bot("writer", { persona: "old" })],
    });
    expect(diff.changed).toEqual([{ key: "writer", botId: "bot-writer", templateName: "writer", currentName: "writer", fields: ["persona"] }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("puts a role the template added, or whose bot was deleted, under added", () => {
    const diff = compareTeam({ ...base, templateRoles: [target("editor", {}, "总编剧", "剧本把关")], projectBots: [] });
    expect(diff.added).toEqual([{ key: "editor", name: "总编剧", title: "剧本把关" }]);
    expect(diff.changed).toEqual([]);
  });

  it("puts a bot the person added, that the template lacks, under removed", () => {
    const diff = compareTeam({ ...base, templateRoles: [], projectBots: [bot("extra", {}, "临时助理")] });
    expect(diff.removed).toEqual([{ key: "extra", name: "临时助理", botId: "bot-extra" }]);
    expect(diff.added).toEqual([]);
  });

  it("matches a renamed bot by key and leaves it unchanged when only the name differs", () => {
    const diff = compareTeam({
      ...base,
      templateRoles: [target("writer", { persona: "same" }, "编剧")],
      projectBots: [bot("writer", { persona: "same" }, "我的编剧")],
    });
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([{ key: "writer", botId: "bot-writer", templateName: "编剧", currentName: "我的编剧", fields: [] }]);
  });

  it("handles a role changed, added and removed together", () => {
    const diff = compareTeam({
      ...base,
      templateRoles: [target("writer", { librarySkills: ["beats"] }), target("director", {}, "导演")],
      projectBots: [bot("writer", { librarySkills: [] }), bot("sound", {}, "音效")],
    });
    expect(diff.changed.map((role) => role.key)).toEqual(["writer"]);
    expect(diff.added.map((role) => role.key)).toEqual(["director"]);
    expect(diff.removed.map((role) => role.key)).toEqual(["sound"]);
  });

  it("ignores a project bot with no role key (not a project bot)", () => {
    const diff = compareTeam({ ...base, templateRoles: [], projectBots: [bot("", {}, "全局主 bot", "main")] });
    expect(diff.removed).toEqual([]);
  });
});

describe("appliedSettingsFor", () => {
  it("writes the template's settings but keeps the bot's model and servers when the template names neither", () => {
    expect(appliedSettingsFor(settings({ persona: "p", model: null, mcpServers: null }), settings({ model: opus, mcpServers: ["srv"] })))
      .toEqual(settings({ persona: "p", model: opus, mcpServers: ["srv"] }));
    expect(appliedSettingsFor(settings({ model: sonnet, mcpServers: ["only"] }), settings({ model: opus, mcpServers: ["srv"] })))
      .toEqual(settings({ model: sonnet, mcpServers: ["only"] }));
  });

  it("adds the template's own skills to the ones the bot holds, and takes none away", () => {
    expect(appliedSettingsFor(settings({ ownSkills: ["hook-check"] }), settings({ ownSkills: ["learned-here"] })).ownSkills)
      .toEqual(["hook-check", "learned-here"]);
  });
});

describe("snapshot builders", () => {
  function agent(key: string, over: Partial<PackageAgent> = {}): PackageAgent {
    return { key, name: key, appearance: { color: "maus" }, ...over } as unknown as PackageAgent;
  }

  it("reads a template role's settings from its agent and extras", () => {
    const extras: TemplateRoleExtras = { model: sonnet, librarySkills: ["b", "a"], mcpServers: ["srv"] };
    const roleTarget = roleTargetFromTemplate(agent("writer", { name: "编剧", title: "写剧本", soul: "你是编剧", skills: ["hook-check"] }), extras);
    expect(roleTarget).toEqual({
      key: "writer",
      name: "编剧",
      title: "写剧本",
      settings: { persona: "你是编剧", model: sonnet, librarySkills: ["a", "b"], ownSkills: ["hook-check"], mcpServers: ["srv"] },
    });
  });

  it("reads a bot's current settings, dropping invalid skill names", () => {
    const source: BotSettingsSource = {
      id: "bot-1", name: "编剧", soul: "现在的人设", modelSelection: opus,
      assignedSkills: ["beats", "NOT A SKILL"], ownSkills: ["learned-here"], mcpServers: ["srv"], teamProject: { id: "p1", role: "writer" },
    };
    expect(projectRoleBot(source)).toEqual({
      botId: "bot-1", role: "writer", name: "编剧",
      settings: { persona: "现在的人设", model: opus, librarySkills: ["beats"], ownSkills: ["learned-here"], mcpServers: ["srv"] },
    });
  });

  it("diffs a project against the whole template content, carrying the versions", () => {
    const content = {
      id: "t9", name: "古风团队", version: 5,
      document: { package: { agents: [agent("writer", { soul: "新人设" })] } },
      extras: { writer: { librarySkills: [] } as TemplateRoleExtras },
    } as unknown as TeamTemplateContent;
    const bots: BotSettingsSource[] = [{ id: "b1", name: "编剧", soul: "旧人设", teamProject: { id: "p", role: "writer" } }];
    const diff = diffProjectAgainstTemplate(content, 3, bots);
    expect(diff).toMatchObject({ templateId: "t9", templateName: "古风团队", fromVersion: 3, toVersion: 5 });
    expect(diff.changed).toEqual([{ key: "writer", botId: "b1", templateName: "writer", currentName: "编剧", fields: ["persona"] }]);
  });
});
