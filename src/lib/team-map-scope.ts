import type { SideBot, TeamProjectSide } from "./team-projects";

/** The team map draws the teams outside projects: a project's bots and department are drawn by the project view. */
export const teamMapBots = <B extends SideBot & { hidden?: boolean }>(bots: B[], side: Pick<TeamProjectSide, "of">): B[] =>
  bots.filter((bot) => !bot.hidden && !side.of(bot));

export const teamMapDepartments = (names: string[], side: Pick<TeamProjectSide, "department">): string[] =>
  names.filter((name) => side.department(name));

/** A main bot belongs to no department, as the server holds: the map offers it only the team of bots in none. */
export const mayJoinOnMap = (bot: { defaultBot?: unknown }, destination: string | null): boolean => !bot.defaultBot || !destination;
