// The heart of template sync: compare a project's team with its team template, matched by role key, and report what one
// "update from template" would change. Pure so it can be tested in every direction; the memory and the name of a bot are
// never part of a change here.
import type { PackageAgent } from "../shared/package-format.ts";
import { isSkillName } from "../shared/skill-md.ts";
import type { TeamTemplateContent, TemplateRoleExtras } from "../shared/template-library.ts";
import { sameModelSelection } from "../shared/thread-model.ts";
import type { AddedRole, MatchedRole, RemovedRole, RoleFieldChange, TemplateSyncDiff } from "../shared/template-sync.ts";
import type { ModelSelection } from "../shared/wire.ts";

/** The settings "update from template" compares and applies. Memory and name are never here. */
export interface AppliedRoleSettings {
  /** The persona (a bot's standing instructions, stored as `soul`). */
  persona: string;
  /** The model, or null when the template names none, in which case the bot's model is left as it is. */
  model: ModelSelection | null;
  /** Skills-library skills by name, sorted and unique. Replaces the bot's assigned library skills; its own learned skills are untouched. */
  librarySkills: string[];
  /**
   * Skills held as copies, by name, sorted and unique: the template's own skills its role names, or every skill the bot
   * holds itself. A bot is given the copies it lacks and loses none.
   */
  ownSkills: string[];
  /** MCP servers by name, sorted and unique, or null for "every server that is switched on". */
  mcpServers: string[] | null;
}

/** A project's bot as the comparison needs it. */
export interface ProjectRoleBot {
  botId: string;
  /** `bot.teamProject.role`: the role key the bot was made as. */
  role: string;
  name: string;
  settings: AppliedRoleSettings;
}

/** A template's role as the comparison needs it. */
export interface TemplateRoleTarget {
  key: string;
  name: string;
  title: string;
  settings: AppliedRoleSettings;
}

/** The minimum of a bot record the comparison and the apply read. */
export interface BotSettingsSource {
  id: string;
  name: string;
  soul?: string;
  modelSelection?: ModelSelection;
  assignedSkills?: string[];
  /** The names of the skills the bot holds itself. */
  ownSkills?: readonly string[];
  mcpServers?: string[];
  teamProject?: { id: string; role: string };
}

const sortedSkills = (names: readonly string[]): string[] => [...new Set(names.filter(isSkillName))].sort();

const normalizeMcp = (list: readonly string[] | null | undefined): string[] | null =>
  list ? [...new Set(list)].sort() : null;

/** The settings a project's bot should hold to match this template role. */
export function roleTargetFromTemplate(agent: PackageAgent, extras: TemplateRoleExtras | undefined): TemplateRoleTarget {
  return {
    key: agent.key,
    name: agent.name,
    title: agent.title ?? "",
    settings: {
      persona: agent.soul ?? "",
      model: extras?.model ?? null,
      librarySkills: sortedSkills(extras?.librarySkills ?? []),
      ownSkills: sortedSkills(agent.skills ?? []),
      mcpServers: normalizeMcp(extras?.mcpServers),
    },
  };
}

export function templateRoleTargets(content: TeamTemplateContent): TemplateRoleTarget[] {
  return content.document.package.agents.map((agent) => roleTargetFromTemplate(agent, content.extras[agent.key]));
}

/** A project bot's current settings, normalized the same way as a template role's. */
export function projectRoleBot(bot: BotSettingsSource): ProjectRoleBot {
  return {
    botId: bot.id,
    role: bot.teamProject?.role ?? "",
    name: bot.name,
    settings: {
      persona: bot.soul ?? "",
      model: bot.modelSelection ?? null,
      librarySkills: sortedSkills(bot.assignedSkills ?? []),
      ownSkills: sortedSkills(bot.ownSkills ?? []),
      mcpServers: normalizeMcp(bot.mcpServers),
    },
  };
}

const sameSortedSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const sameMcp = (a: string[] | null, b: string[] | null): boolean =>
  a === null || b === null ? a === b : sameSortedSet(a, b);

/** Which settings of a matched role differ. The model and the MCP servers are compared only when the template names them,
 * because applying leaves a bot's own model, and its own servers, as they are when the template's role names neither.
 * The skills differ too when the bot lacks one of the template's own skills its role names. */
export function changedFields(template: AppliedRoleSettings, current: AppliedRoleSettings): RoleFieldChange[] {
  const fields: RoleFieldChange[] = [];
  if (template.persona !== current.persona) fields.push("persona");
  if (template.model !== null && !sameModelSelection(template.model, current.model ?? undefined)) fields.push("model");
  const lacksOwnSkill = template.ownSkills.some((name) => !current.ownSkills.includes(name));
  if (lacksOwnSkill || !sameSortedSet(template.librarySkills, current.librarySkills)) fields.push("skills");
  if (template.mcpServers !== null && !sameMcp(template.mcpServers, current.mcpServers)) fields.push("mcp");
  return fields;
}

/** The settings "update from template" would leave a matched role holding: the template's, but keeping the bot's own model,
 * and its own servers, where the template's role names neither, and every skill the bot holds itself. */
export function appliedSettingsFor(template: AppliedRoleSettings, current: AppliedRoleSettings): AppliedRoleSettings {
  return {
    ...template,
    model: template.model ?? current.model,
    ownSkills: sortedSkills([...current.ownSkills, ...template.ownSkills]),
    mcpServers: template.mcpServers ?? current.mcpServers,
  };
}

export interface CompareInput {
  templateId: string;
  templateName: string;
  fromVersion: number;
  toVersion: number;
  templateRoles: readonly TemplateRoleTarget[];
  projectBots: readonly ProjectRoleBot[];
}

export function compareTeam(input: CompareInput): TemplateSyncDiff {
  const templateKeys = new Set(input.templateRoles.map((role) => role.key));
  const botByRole = new Map<string, ProjectRoleBot>();
  for (const bot of input.projectBots) if (bot.role && !botByRole.has(bot.role)) botByRole.set(bot.role, bot);

  const changed: MatchedRole[] = [];
  const unchanged: MatchedRole[] = [];
  const added: AddedRole[] = [];
  for (const role of input.templateRoles) {
    const bot = botByRole.get(role.key);
    if (!bot) {
      added.push({ key: role.key, name: role.name, title: role.title });
      continue;
    }
    const fields = changedFields(role.settings, bot.settings);
    const entry: MatchedRole = { key: role.key, botId: bot.botId, templateName: role.name, currentName: bot.name, fields };
    (fields.length ? changed : unchanged).push(entry);
  }
  const removed: RemovedRole[] = input.projectBots
    .filter((bot) => bot.role && !templateKeys.has(bot.role))
    .map((bot) => ({ key: bot.role, name: bot.name, botId: bot.botId }));

  return {
    templateId: input.templateId,
    templateName: input.templateName,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    changed,
    unchanged,
    added,
    removed,
  };
}

/** Compare a project's team against the whole template content it was made from. */
export function diffProjectAgainstTemplate(
  content: TeamTemplateContent,
  fromVersion: number,
  bots: readonly BotSettingsSource[],
): TemplateSyncDiff {
  return compareTeam({
    templateId: content.id,
    templateName: content.name,
    fromVersion,
    toVersion: content.version,
    templateRoles: templateRoleTargets(content),
    projectBots: bots.map(projectRoleBot),
  });
}
