import type { TeamProjectTemplateSetter, TeamProjectWire, TeamProjectsApi } from "../shared/team-projects.ts";
import type { TemplateLibraryEditor } from "../shared/template-library.ts";
import { MemoryStoreError, readMemoryDoc } from "./memory-store.ts";
import type { RouteHandler } from "./routes/table.ts";
import { createTemplateSyncRoutes } from "./routes/template-sync.ts";
import { readSkillLibraryIndex } from "./skill-library.ts";
import type { PackageImportDeps } from "./package-import.ts";
import type { BotRecord } from "./store.ts";
import { applyTemplateRole, type TemplateRoleHost } from "./team-projects/template-role.ts";
import type { ProjectForSync, SavedTemplate, TemplateSyncDeps } from "./template-sync-service.ts";

export interface TemplateSyncHostDeps {
  store: TemplateRoleHost["store"];
  projects: Pick<TeamProjectsApi, "list"> & TeamProjectTemplateSetter;
  templates: Pick<TemplateLibraryEditor, "readTeam" | "teamTemplate" | "saveFromDepartment" | "addStarterMemory">;
  skills: Pick<PackageImportDeps["skills"], "install" | "setEnabled"> & {
    /** The names of the skills a bot holds itself. */
    held(botId: string): readonly string[];
  };
  /** One memory file of a bot, read from wherever that bot keeps its own files; null when it is not there. */
  readMemory?(botId: string, path: string): string | null;
}

function memoryFile(botId: string, path: string): string | null {
  try {
    const doc = readMemoryDoc(botId, path);
    return doc.exists ? doc.text : null;
  } catch (error) {
    if (error instanceof MemoryStoreError) return null;
    throw error;
  }
}

/** Template sync over this installation's projects, template library, bots and their memory. */
export function templateSyncDeps(host: TemplateSyncHostDeps): TemplateSyncDeps {
  const bot = (id: string): BotRecord | undefined => host.store.bots.find((candidate) => candidate.id === id);
  const forSync = (project: TeamProjectWire): ProjectForSync => ({
    id: project.id,
    name: project.name,
    section: project.section,
    template: project.template,
    bots: project.botIds.flatMap((id) => {
      const record = bot(id);
      return record ? [{ ...record, ownSkills: host.skills.held(id) }] : [];
    }),
  });
  const saved = (template: SavedTemplate): SavedTemplate => ({ id: template.id, name: template.name, version: template.version });
  const roleHost: TemplateRoleHost = {
    store: host.store,
    skills: host.skills,
    librarySkillNames: () => Object.values(readSkillLibraryIndex()).map((skill) => skill.name),
  };
  return {
    project: (projectId) => {
      const project = host.projects.list().find((candidate) => candidate.id === projectId);
      return project && forSync(project);
    },
    readTemplate: (templateId) => host.templates.readTeam(templateId),
    applyRole: (botId, role) => {
      const held = new Set(host.skills.held(botId));
      for (const skill of role.ownSkills ?? []) {
        if (held.has(skill.name)) continue;
        const copied = host.skills.install(botId, skill.source, skill.files);
        if ("error" in copied) throw new Error(`the skill ${skill.name} could not be copied from the template: ${copied.error}`);
      }
      applyTemplateRole(botId, role, roleHost);
    },
    setTemplate: (projectId, template) => host.projects.setTemplate(projectId, template),
    saveDepartmentAsVersion: (department, templateId) => saved(host.templates.saveFromDepartment(department, templateId)),
    saveDepartmentAsNew: (department) => saved(host.templates.saveFromDepartment(department)),
    addStarterMemory: (templateId, roleKey, entry) => {
      host.templates.addStarterMemory("team", templateId, roleKey, entry);
      const now = host.templates.teamTemplate(templateId);
      if (!now) throw new Error(`the team template ${templateId} is gone right after it was saved`);
      return saved(now);
    },
    projectBot: (botId) => {
      const role = bot(botId)?.teamProject?.role;
      const project = host.projects.list().find((candidate) => candidate.botIds.includes(botId));
      return role && project ? { project: forSync(project), role } : null;
    },
    readMemory: host.readMemory ?? memoryFile,
  };
}

export const createTemplateSyncHost = (host: TemplateSyncHostDeps): RouteHandler => createTemplateSyncRoutes(templateSyncDeps(host));
