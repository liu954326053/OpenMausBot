import type { PackageAgent } from "../../shared/package-format.ts";
import type { TemplateRoleExtras } from "../../shared/template-library.ts";
import { memberFromAgent, type PackageImportDeps } from "../package-import.ts";
import type { BotRecord, Store } from "../store.ts";
import { importedMemberProfile } from "../team-manifest.ts";

/** One role of a team template: the role as the template's document holds it, and what that document cannot carry. */
export interface TemplateRoleSettings {
  agent: PackageAgent;
  extras?: TemplateRoleExtras;
  /** MCP servers that stay in the bot's list whatever the role names: those made for it from the template's own connections. */
  keepServers?: readonly string[];
}

export interface TemplateRoleHost {
  store: Pick<Store, "bots" | "patchBot" | "patchBotProfile">;
  skills: Pick<PackageImportDeps["skills"], "setEnabled">;
  librarySkillNames(): readonly string[];
}

type Fields = Partial<BotRecord>;

function changed(bot: BotRecord, fields: Fields): Fields {
  const before = bot as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== undefined && JSON.stringify(before[key]) !== JSON.stringify(value)));
}

/**
 * Gives a bot what one role of a team template says about it: its title, description, persona and look, its model,
 * its MCP servers and its library skills, and switches on the template's own skills the role uses. Making a project
 * and bringing a project's bot up to a newer template both go through here.
 *
 * The bot keeps its name, its picture, its memory and its department. A role that names no model leaves the bot's
 * model as it is, and one that has no list of MCP servers leaves the bot's list as it is. The template's own skills
 * must already be in the bot, as the package importer leaves them: this throws when one is not, and the bot may then
 * hold part of the role.
 *
 * Returns the library skills the role names that the library does not hold; the bot gets the others.
 */
export function applyTemplateRole(botId: string, role: TemplateRoleSettings, host: TemplateRoleHost): { missingSkills: string[] } {
  const bot = host.store.bots.find((candidate) => candidate.id === botId);
  if (!bot) throw new Error(`the bot ${botId} is not there`);
  const { agent, extras } = role;
  const persona = importedMemberProfile(memberFromAgent(agent), new Set());

  const library = new Set(host.librarySkillNames());
  const wanted = [...new Set(extras?.librarySkills ?? [])];
  const held = wanted.filter((skill) => library.has(skill));

  const profile = changed(bot, {
    title: persona.title, description: persona.description, soul: persona.soul, mascotBody: persona.mascotBody,
    mascotFaceColor: extras?.look?.mascotFaceColor, avatarZoom: extras?.look?.avatarZoom,
    avatarFocusX: extras?.look?.avatarFocusX, avatarFocusY: extras?.look?.avatarFocusY,
  });
  if (Object.keys(profile).length) host.store.patchBotProfile(bot.id, profile);

  const settings = changed(bot, {
    color: persona.color, mascotExpression: persona.mascotExpression,
    modelSelection: extras?.model?.instanceId && extras.model.model ? structuredClone(extras.model) : undefined,
    mcpServers: extras?.mcpServers ? [...new Set([...(role.keepServers ?? []), ...extras.mcpServers])] : undefined,
    assignedSkills: held.length || bot.assignedSkills?.length ? held : undefined,
  });
  if (Object.keys(settings).length) host.store.patchBot(bot.id, settings);

  for (const skill of agent.skills ?? []) {
    const on = host.skills.setEnabled(bot.id, skill, true);
    if ("error" in on) throw new Error(`the skill ${skill} could not be switched on: ${on.error}`);
  }
  return { missingSkills: wanted.filter((skill) => !library.has(skill)) };
}
