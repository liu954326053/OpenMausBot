import { createHash } from "node:crypto";

import type { ProjectTeamUnusable, ProjectTeamWire, TeamMemberWire } from "../../shared/team-projects.ts";
import { sectionKey, type BotRecord } from "../store.ts";

/** What the teams are read from. */
export interface TeamSources {
  bots: readonly BotRecord[];
  /** Every department, in the order the app lists them. */
  sections: readonly string[];
  /** The departments that are a project's team: they are no team a project can be made from. */
  projectSections: ReadonlySet<string>;
  context(section: string): string;
}

const memberOf = (bot: BotRecord): TeamMemberWire => ({ id: bot.id, name: bot.name, title: bot.title ?? "" });

/** The bots of a team: the department's, less archived ones and the main bot, which belongs to no team. */
export function teamBots(bots: readonly BotRecord[], section: string): BotRecord[] {
  return bots.filter((bot) => !bot.hidden && !bot.defaultBot && sectionKey(bot.section) === section);
}

function teamOf(sources: TeamSources, name: string): ProjectTeamWire {
  const chief = sources.bots.find((bot) => !bot.hidden && bot.chiefOfStaff && sectionKey(bot.section) === name);
  const bots = teamBots(sources.bots, name);
  const members = chief && !chief.defaultBot ? [chief, ...bots.filter((bot) => bot !== chief)] : bots;
  const unusable: ProjectTeamUnusable | undefined = chief?.defaultBot ? "main_bot_chief" : !bots.length ? "empty" : !chief ? "no_chief" : undefined;
  return {
    name, context: sources.context(name), chief: chief ? memberOf(chief) : null, members: members.map(memberOf),
    ...(unusable ? { unusable } : {}),
  };
}

/** Every department that is no project's, as a team. */
export function projectTeams(sources: TeamSources): ProjectTeamWire[] {
  const names = new Set([...sources.sections, ...sources.bots.map((bot) => sectionKey(bot.section))].map((name) => sectionKey(name)));
  return [...names].filter((name) => name && !sources.projectSections.has(name)).map((name) => teamOf(sources, name));
}

/** The team a person or the main bot named: by its exact name, else by the one name that differs from it only in case. */
export function findProjectTeam(teams: readonly ProjectTeamWire[], wanted: unknown): ProjectTeamWire | undefined {
  if (typeof wanted !== "string") return undefined;
  const name = sectionKey(wanted.normalize("NFC"));
  const exact = teams.find((team) => team.name === name);
  if (exact) return exact;
  const alike = teams.filter((team) => team.name.toLowerCase() === name.toLowerCase());
  return alike.length === 1 ? alike[0] : undefined;
}

/** Changes when the team's name, its Chief, its members or their names and titles change: what a person was shown of it. */
export function teamRevision(team: Pick<ProjectTeamWire, "name" | "chief" | "members">): string {
  const shown = [team.name, team.chief?.id ?? null, team.members.map((member) => [member.id, member.name, member.title])];
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex").slice(0, 16);
}
