// The server side of template sync, as pure orchestration over an injected set of dependencies: the project registry,
// the template library's write side, and the apply-one-role function (owned by projects). Each action either returns
// its result or a refusal with the status and the key the person is shown. Filing one learned skill into the library is
// not here: that is the app's existing `POST /api/bots/:id/skills/:name/share`, which template sync only adds a button for.
import type { PackageAgent, PackageDocument } from "../shared/package-format.ts";
import type { ServerTextParams } from "../shared/server-text.ts";
import type { TeamProjectTemplateSetter } from "../shared/team-projects.ts";
import type { TeamTemplateContent, TemplateRoleExtras } from "../shared/template-library.ts";
import type {
  DepositMemoryInput, SaveBackInput, SaveBackResult, TemplateUpdatePreview, TemplateUpdateResult,
} from "../shared/template-sync.ts";
import { changedFields, diffProjectAgainstTemplate, projectRoleBot, templateRoleTargets, type BotSettingsSource } from "./template-sync.ts";
import type { UserErrorKey } from "./user-errors.ts";

/** A saved template as template sync needs it back: enough to record the project's version and name the template. */
export interface SavedTemplate {
  id: string;
  name: string;
  version: number;
}

/**
 * One role of a team template as the project worker's `applyTemplateRole` takes it: the role's agent and the extras the
 * folder format cannot carry. Structurally this is that function's `TemplateRoleSettings`, so the integration wraps it
 * without a second copy of how a role maps onto a bot.
 */
export interface ApplyRole {
  agent: PackageAgent;
  extras?: TemplateRoleExtras;
  keepServers?: readonly string[];
  /**
   * The template's own skills the role names, each as the folder a bot is given: a bot made from an earlier version of
   * the template may not hold them yet, and `applyTemplateRole` switches on only what the bot holds. Absent: the role
   * names none.
   */
  ownSkills?: TemplateOwnSkillCopy[];
}

/** One of a template's own skills as it is copied into a bot. */
export interface TemplateOwnSkillCopy {
  name: string;
  /** Where the copy says it came from, as the bots made with a project say it. */
  source: string;
  files: Array<{ path: string; content: string }>;
}

/** A project as template sync reads it, with the bots that belong to it right now. */
export interface ProjectForSync {
  id: string;
  name: string;
  /** The department that is the project's team; what "save back" and "add to starter memory" read from. */
  section: string;
  template: { id: string; name: string; version: number };
  bots: BotSettingsSource[];
}

/**
 * Everything template sync asks of the other workers. The integration step hands these the real `templateLibrary`
 * (readTeam and the write side), the projects registry, the apply-one-role function projects keeps in one place, and
 * the bots' memory.
 */
export interface TemplateSyncDeps {
  /** The project, with its current bots; undefined when there is no such project. */
  project(projectId: string): ProjectForSync | undefined;
  /** The team template content now; null when it is gone from the library. */
  readTemplate(templateId: string): TeamTemplateContent | null;
  /**
   * Apply one role of the template to an existing bot: give it the role's own skills it does not hold, then the rest
   * through the project worker's `applyTemplateRole`. That sets the persona, the model, the library skills and the MCP
   * servers, and keeps the bot's memory, name and department; it may throw, and the bot may then hold part of the role.
   */
  applyRole(botId: string, role: ApplyRole): void;
  /**
   * Record the template, and its version, the project's team now matches. Backed by the projects worker's
   * `TeamProjectTemplateSetter.setTemplate` (lab-contract-projects-4); the wire it returns is not needed here.
   */
  setTemplate: TeamProjectTemplateSetter["setTemplate"];
  /** Save a department as the next version of the template it names. May throw the library's refusal. */
  saveDepartmentAsVersion(department: string, templateId: string): SavedTemplate;
  /** Save a department as a brand new team template. May throw the library's refusal. */
  saveDepartmentAsNew(department: string): SavedTemplate;
  /** Add one memory entry to a template role's starter memory. May throw the library's refusal. */
  addStarterMemory(templateId: string, roleKey: string, entry: string): SavedTemplate;
  /** Which project and role a bot belongs to; null when it is not a project bot. */
  projectBot(botId: string): { project: ProjectForSync; role: string } | null;
  /** One of a bot's memory entries; null when the file is not there. */
  readMemory(botId: string, path: string): string | null;
}

/** A refusal the route turns into `json(res, status, userError(refusal, params))`. */
export interface SyncRefusal {
  refusal: UserErrorKey;
  status: number;
  params?: ServerTextParams;
}

export function isSyncRefusal(value: object): value is SyncRefusal {
  return "refusal" in value;
}

const refuse = (status: number, refusal: UserErrorKey, params?: ServerTextParams): SyncRefusal => ({ refusal, status, params });

function ownSkillCopies(pkg: PackageDocument["package"], agent: PackageAgent): TemplateOwnSkillCopy[] {
  const entries = new Map((pkg.skills?.entries ?? []).map((skill) => [skill.name, skill]));
  return (agent.skills ?? []).flatMap((name) => {
    const skill = entries.get(name);
    if (!skill) return [];
    return [{ name, source: skill.source ?? `package:${pkg.id}`, files: [{ path: "SKILL.md", content: skill.instructions }, ...(skill.files ?? [])] }];
  });
}

/** The matched roles whose compared settings would change, each with the role to apply to its bot. */
function updatePlan(content: TeamTemplateContent, bots: readonly BotSettingsSource[]): Array<{ botId: string; role: ApplyRole }> {
  const agents = new Map(content.document.package.agents.map((agent) => [agent.key, agent]));
  const targets = new Map(templateRoleTargets(content).map((role) => [role.key, role]));
  const plan: Array<{ botId: string; role: ApplyRole }> = [];
  const seen = new Set<string>();
  for (const bot of bots.map(projectRoleBot)) {
    if (!bot.role || seen.has(bot.role)) continue;
    seen.add(bot.role);
    const target = targets.get(bot.role);
    const agent = agents.get(bot.role);
    if (!target || !agent || !changedFields(target.settings, bot.settings).length) continue;
    const ownSkills = ownSkillCopies(content.document.package, agent);
    plan.push({ botId: bot.botId, role: { agent, extras: content.extras[bot.role], ...(ownSkills.length ? { ownSkills } : {}) } });
  }
  return plan;
}

export function previewUpdate(projectId: string, deps: TemplateSyncDeps): TemplateUpdatePreview | SyncRefusal {
  const project = deps.project(projectId);
  if (!project) return refuse(404, "serverError.templateSync.noProject");
  const content = deps.readTemplate(project.template.id);
  if (!content) return refuse(409, "serverError.templateSync.noTemplate");
  const diff = diffProjectAgainstTemplate(content, project.template.version, project.bots);
  return { diff, can: diff.changed.length > 0 };
}

/**
 * Apply the template to the project's changed roles. The project's recorded version advances only when every role
 * applied, so a run that throws part way leaves the project where it was and the person can try again; one role that
 * throws can still leave its own bot partly changed, which is `applyTemplateRole`'s own contract.
 */
export function applyUpdate(projectId: string, deps: TemplateSyncDeps): TemplateUpdateResult | SyncRefusal {
  const project = deps.project(projectId);
  if (!project) return refuse(404, "serverError.templateSync.noProject");
  const content = deps.readTemplate(project.template.id);
  if (!content) return refuse(409, "serverError.templateSync.noTemplate");
  const plan = updatePlan(content, project.bots);
  try {
    for (const step of plan) deps.applyRole(step.botId, step.role);
  } catch {
    return refuse(500, "serverError.templateSync.applyFailed");
  }
  deps.setTemplate(projectId, { id: content.id, name: content.name, version: content.version });
  return { applied: plan.length, toVersion: content.version };
}

export function saveBack(projectId: string, input: SaveBackInput, deps: TemplateSyncDeps): SaveBackResult | SyncRefusal {
  const project = deps.project(projectId);
  if (!project) return refuse(404, "serverError.templateSync.noProject");
  if (input.mode === "version") {
    const saved = deps.saveDepartmentAsVersion(project.section, project.template.id);
    deps.setTemplate(projectId, { id: saved.id, name: saved.name, version: saved.version });
    return { templateId: saved.id, name: saved.name, version: saved.version, mode: "version" };
  }
  const saved = deps.saveDepartmentAsNew(project.section);
  return { templateId: saved.id, name: saved.name, version: saved.version, mode: "new" };
}

export function depositMemory(input: DepositMemoryInput, deps: TemplateSyncDeps): SavedTemplate | SyncRefusal {
  const resolved = deps.projectBot(input.botId);
  if (!resolved) return refuse(422, "serverError.templateSync.notProjectBot");
  const text = deps.readMemory(input.botId, input.path);
  if (text === null) return refuse(404, "serverError.templateSync.noMemoryFile");
  if (!text.trim()) return refuse(400, "serverError.templateSync.memoryEmpty");
  const saved = deps.addStarterMemory(resolved.project.template.id, resolved.role, text);
  return { id: saved.id, name: saved.name, version: saved.version };
}
