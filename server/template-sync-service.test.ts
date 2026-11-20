import { describe, expect, it } from "vitest";

import type { PackageAgent } from "../shared/package-format.ts";
import type { TeamTemplateContent, TemplateRoleExtras } from "../shared/template-library.ts";
import {
  applyUpdate, depositMemory, isSyncRefusal, previewUpdate, saveBack,
  type ApplyRole, type ProjectForSync, type SavedTemplate, type TemplateSyncDeps,
} from "./template-sync-service.ts";
import type { BotSettingsSource } from "./template-sync.ts";

function agent(key: string, soul = ""): PackageAgent {
  return { key, name: key, appearance: { color: "maus" }, soul } as unknown as PackageAgent;
}

function content(agents: PackageAgent[], extras: Record<string, TemplateRoleExtras>, over: Partial<TeamTemplateContent> = {}): TeamTemplateContent {
  return { id: "t1", name: "都市短剧团队", version: 2, document: { package: { agents } }, extras, ...over } as unknown as TeamTemplateContent;
}

function botSrc(role: string, soul: string, id = `bot-${role}`): BotSettingsSource {
  return { id, name: role, soul, teamProject: { id: "p1", role } };
}

function project(bots: BotSettingsSource[], over: Partial<ProjectForSync> = {}): ProjectForSync {
  return { id: "p1", name: "我的短剧", section: "剧本部", template: { id: "t1", name: "都市短剧团队", version: 1 }, bots, ...over };
}

interface Harness {
  deps: TemplateSyncDeps;
  applied: Array<{ botId: string; role: ApplyRole }>;
  setCalls: Array<{ projectId: string; template: { id: string; name: string; version: number } }>;
  starter: Array<{ templateId: string; roleKey: string; entry: string }>;
  savedVersion: Array<{ department: string; templateId: string }>;
  savedNew: string[];
}

function harness(over: Partial<TemplateSyncDeps> & { failApplyOn?: string } = {}): Harness {
  const applied: Harness["applied"] = [];
  const setCalls: Harness["setCalls"] = [];
  const starter: Harness["starter"] = [];
  const savedVersion: Harness["savedVersion"] = [];
  const savedNew: Harness["savedNew"] = [];
  const deps: TemplateSyncDeps = {
    project: over.project ?? (() => undefined),
    readTemplate: over.readTemplate ?? (() => null),
    applyRole: over.applyRole ?? ((botId, role) => {
      if (over.failApplyOn && botId === over.failApplyOn) throw new Error("boom");
      applied.push({ botId, role });
    }),
    setTemplate: over.setTemplate ?? ((projectId, template) => { setCalls.push({ projectId, template }); return null; }),
    saveDepartmentAsVersion: over.saveDepartmentAsVersion ?? ((department, templateId) => {
      savedVersion.push({ department, templateId });
      return { id: "t1", name: "都市短剧团队", version: 3 };
    }),
    saveDepartmentAsNew: over.saveDepartmentAsNew ?? ((department) => { savedNew.push(department); return { id: "t2", name: "新模板", version: 1 }; }),
    addStarterMemory: over.addStarterMemory ?? ((templateId, roleKey, entry) => { starter.push({ templateId, roleKey, entry }); return { id: templateId, name: "都市短剧团队", version: 4 }; }),
    projectBot: over.projectBot ?? (() => null),
    readMemory: over.readMemory ?? (() => null),
  };
  return { deps, applied, setCalls, starter, savedVersion, savedNew };
}

function expectRefusal(result: object, refusal: string, status: number): void {
  expect(isSyncRefusal(result)).toBe(true);
  expect(result).toMatchObject({ refusal, status });
}

describe("previewUpdate", () => {
  it("refuses when the project or its template is gone", () => {
    expectRefusal(previewUpdate("p1", harness().deps), "serverError.templateSync.noProject", 404);
    const noTemplate = harness({ project: () => project([]) });
    expectRefusal(previewUpdate("p1", noTemplate.deps), "serverError.templateSync.noTemplate", 409);
  });

  it("returns a diff and can-update true only when something changed", () => {
    const changed = harness({
      project: () => project([botSrc("writer", "old")]),
      readTemplate: () => content([agent("writer", "new")], { writer: { librarySkills: [] } }),
    });
    expect(previewUpdate("p1", changed.deps)).toEqual({
      diff: {
        templateId: "t1", templateName: "都市短剧团队", fromVersion: 1, toVersion: 2,
        changed: [{ key: "writer", botId: "bot-writer", templateName: "writer", currentName: "writer", fields: ["persona"] }],
        unchanged: [], added: [], removed: [],
      },
      can: true,
    });

    const same = harness({
      project: () => project([botSrc("writer", "same")]),
      readTemplate: () => content([agent("writer", "same")], { writer: { librarySkills: [] } }),
    });
    expect((previewUpdate("p1", same.deps) as { can: boolean }).can).toBe(false);
  });
});

describe("applyUpdate", () => {
  it("applies only the changed role, hands the apply the role not a bot's memory, and records the version", () => {
    const h = harness({
      project: () => project([botSrc("writer", "old"), botSrc("editor", "same"), botSrc("", "main", "bot-main")]),
      readTemplate: () => content(
        [agent("writer", "new"), agent("editor", "same")],
        { writer: { librarySkills: ["beats"] }, editor: { librarySkills: [] } },
      ),
    });
    expect(applyUpdate("p1", h.deps)).toEqual({ applied: 1, toVersion: 2 });
    expect(h.applied.map((call) => call.botId)).toEqual(["bot-writer"]);
    const role = h.applied[0]!.role;
    expect(Object.keys(role).sort()).toEqual(["agent", "extras"]);
    expect(role.agent.key).toBe("writer");
    expect(role.agent.soul).toBe("new");
    expect(role.extras).toEqual({ librarySkills: ["beats"] });
    expect(h.setCalls).toEqual([{ projectId: "p1", template: { id: "t1", name: "都市短剧团队", version: 2 } }]);
  });

  it("hands the apply the template's own skills a role names, whole, for a bot that does not hold them yet", () => {
    const withSkill = { ...agent("writer", "same"), skills: ["hook-check"] } as PackageAgent;
    const skills = { entries: [
      { name: "hook-check", instructions: "---\nname: hook-check\n---\nEnd on a hook.\n", files: [{ path: "notes.md", content: "Examples." }] },
      { name: "unused", instructions: "---\nname: unused\n---\n" },
    ] };
    const h = harness({
      project: () => project([botSrc("writer", "same"), { ...botSrc("editor", "same"), ownSkills: ["hook-check"] }]),
      readTemplate: () => content([withSkill, { ...withSkill, key: "editor", name: "editor" }], {}, { document: { package: { id: "template-t1", agents: [withSkill, { ...withSkill, key: "editor", name: "editor" }], skills } } } as unknown as Partial<TeamTemplateContent>),
    });

    expect(applyUpdate("p1", h.deps)).toEqual({ applied: 1, toVersion: 2 });

    expect(h.applied.map((call) => call.botId)).toEqual(["bot-writer"]);
    expect(h.applied[0]!.role.ownSkills).toEqual([{
      name: "hook-check", source: "package:template-t1",
      files: [{ path: "SKILL.md", content: "---\nname: hook-check\n---\nEnd on a hook.\n" }, { path: "notes.md", content: "Examples." }],
    }]);
  });

  it("records the version even when nothing needed to change", () => {
    const h = harness({
      project: () => project([botSrc("writer", "same")]),
      readTemplate: () => content([agent("writer", "same")], { writer: { librarySkills: [] } }),
    });
    expect(applyUpdate("p1", h.deps)).toEqual({ applied: 0, toVersion: 2 });
    expect(h.applied).toEqual([]);
    expect(h.setCalls).toEqual([{ projectId: "p1", template: { id: "t1", name: "都市短剧团队", version: 2 } }]);
  });

  it("records no version when an apply throws, so the project is not advanced", () => {
    const h = harness({
      project: () => project([botSrc("writer", "old1"), botSrc("editor", "old2")]),
      readTemplate: () => content(
        [agent("writer", "neo"), agent("editor", "neo2")],
        { writer: { librarySkills: [] }, editor: { librarySkills: [] } },
      ),
      failApplyOn: "bot-editor",
    });
    expectRefusal(applyUpdate("p1", h.deps), "serverError.templateSync.applyFailed", 500);
    expect(h.setCalls).toEqual([]);
  });

  it("refuses when the project or its template is gone", () => {
    expectRefusal(applyUpdate("p1", harness().deps), "serverError.templateSync.noProject", 404);
    expectRefusal(applyUpdate("p1", harness({ project: () => project([]) }).deps), "serverError.templateSync.noTemplate", 409);
  });
});

describe("saveBack", () => {
  it("saves a new version of the project's template and records it", () => {
    const h = harness({ project: () => project([botSrc("writer", "x")]) });
    expect(saveBack("p1", { mode: "version" }, h.deps)).toEqual({ templateId: "t1", name: "都市短剧团队", version: 3, mode: "version" });
    expect(h.savedVersion).toEqual([{ department: "剧本部", templateId: "t1" }]);
    expect(h.setCalls).toEqual([{ projectId: "p1", template: { id: "t1", name: "都市短剧团队", version: 3 } }]);
  });

  it("saves a brand new template without touching the project's recorded version", () => {
    const h = harness({ project: () => project([botSrc("writer", "x")]) });
    expect(saveBack("p1", { mode: "new" }, h.deps)).toEqual({ templateId: "t2", name: "新模板", version: 1, mode: "new" });
    expect(h.savedNew).toEqual(["剧本部"]);
    expect(h.setCalls).toEqual([]);
  });

  it("lets the library's own refusal through", () => {
    const h = harness({
      project: () => project([botSrc("writer", "x")]),
      saveDepartmentAsVersion: () => { throw new Error("library full"); },
    });
    expect(() => saveBack("p1", { mode: "version" }, h.deps)).toThrow("library full");
  });

  it("refuses when there is no such project", () => {
    expectRefusal(saveBack("p1", { mode: "version" }, harness().deps), "serverError.templateSync.noProject", 404);
  });
});

describe("depositMemory", () => {
  const resolved = { project: project([]), role: "writer" };

  it("adds the entry to the template role's starter memory", () => {
    const h = harness({ projectBot: () => resolved, readMemory: () => "我学到的东西" });
    expect(depositMemory({ botId: "bot-writer", path: "memory/notes.md" }, h.deps)).toEqual<SavedTemplate>({ id: "t1", name: "都市短剧团队", version: 4 });
    expect(h.starter).toEqual([{ templateId: "t1", roleKey: "writer", entry: "我学到的东西" }]);
  });

  it("refuses a bot that is not in a project, a missing file, and an empty note", () => {
    expectRefusal(depositMemory({ botId: "x", path: "p" }, harness().deps), "serverError.templateSync.notProjectBot", 422);
    const missing = harness({ projectBot: () => resolved, readMemory: () => null });
    expectRefusal(depositMemory({ botId: "bot-writer", path: "p" }, missing.deps), "serverError.templateSync.noMemoryFile", 404);
    const empty = harness({ projectBot: () => resolved, readMemory: () => "   \n" });
    expectRefusal(depositMemory({ botId: "bot-writer", path: "p" }, empty.deps), "serverError.templateSync.memoryEmpty", 400);
  });
});
