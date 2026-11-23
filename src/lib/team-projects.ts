import { EPISODE_JOBS, type EpisodeJob } from "../../shared/production";
import type { ProjectTeamUnusable, TeamProjectRefusal, TeamProjectsListWire, TeamProjectWire } from "../../shared/team-projects";
import type { LocaleKey } from "@/locales";

export interface SideBot {
  id: string;
  section?: string;
  pinned?: boolean;
}

export interface SideRoom {
  section?: string;
}

/** The projects as the sidebar and Settings show them, and what is left of the bots and group chats for the departments. */
export interface TeamProjectSide {
  /** False until the list is read, and for good on a server that has no projects. */
  shown: boolean;
  root: string | null;
  /** The projects the sidebar lists, in the server's order. */
  projects: TeamProjectWire[];
  /** The latest archived first. */
  archived: TeamProjectWire[];
  /** The bots the rest of the sidebar draws. A pinned bot of a listed project is one of them and stays in its team too. */
  bots<T extends SideBot>(bots: T[]): T[];
  rooms<T extends SideRoom>(rooms: T[]): T[];
  /** False for a project's department, archived or not. */
  department(name: string): boolean;
  of(bot: SideBot): TeamProjectWire | undefined;
  /** The bot a copy shows, and the copy's project, while the copy follows it. */
  source(botId: string): { sourceId: string; project: TeamProjectWire } | undefined;
  /** The lead first, then the members in the server's order. */
  team<T extends SideBot>(project: TeamProjectWire, bots: T[]): T[];
  teamRooms<T extends SideRoom>(project: TeamProjectWire, rooms: T[]): T[];
}

const archived = (project: TeamProjectWire) => typeof project.archivedAt === "number";

/** `creating` is the name of a project on its way: its department and bots arrive before the server lists the project. */
export function teamProjectSide(list: TeamProjectsListWire | null, creating: string | null = null): TeamProjectSide {
  const all = list?.projects ?? [];
  const bySection = new Map(all.map((project) => [project.section, project]));
  const byBot = new Map(all.flatMap((project) => project.botIds.map((id) => [id, project] as const)));
  const ofSection = (section: string | undefined) => (section ? bySection.get(section.trim()) : undefined);
  const of = (bot: SideBot) => byBot.get(bot.id) ?? ofSection(bot.section);
  const arriving = (section: string | undefined) => creating !== null && section?.trim() === creating;
  const listedAt = new WeakMap<TeamProjectWire, Map<string, number>>();
  const placesIn = (project: TeamProjectWire) => {
    let places = listedAt.get(project);
    if (!places) listedAt.set(project, (places = new Map(project.botIds.map((id, at) => [id, at]))));
    return places;
  };
  return {
    shown: list !== null,
    root: list?.root ?? null,
    projects: all.filter((project) => !archived(project)),
    archived: all.filter(archived).sort((a, b) => b.archivedAt! - a.archivedAt!),
    bots: (bots) => bots.filter((bot) => {
      if (arriving(bot.section)) return false;
      const project = of(bot);
      return !project || (Boolean(bot.pinned) && !archived(project));
    }),
    rooms: (rooms) => rooms.filter((room) => !ofSection(room.section) && !arriving(room.section)),
    department: (name) => !ofSection(name) && !arriving(name),
    of,
    source: (botId) => {
      const project = byBot.get(botId);
      const sourceId = project?.follows[botId];
      return project && sourceId ? { sourceId, project } : undefined;
    },
    team: (project, bots) => {
      const places = placesIn(project);
      const place = (bot: SideBot) => (bot.id === project.leadBotId ? -1 : places.get(bot.id) ?? project.botIds.length);
      return bots.filter((bot) => of(bot)?.id === project.id).sort((a, b) => place(a) - place(b));
    },
    teamRooms: (project, rooms) => rooms.filter((room) => room.section?.trim() === project.section),
  };
}

/** One episode of a drama, with the bots the production made for it: its storyboard bot first, then its post bot. */
export interface EpisodeTeam<T> {
  number: number;
  bots: T[];
}

/** A drama's team, as `team` lists it, split into the bots of the whole drama, in their order, and each episode that
 * has bots of its own, in order. */
export function splitEpisodes<T extends SideBot>(project: Pick<TeamProjectWire, "episodeBots">, team: readonly T[]): { drama: T[]; episodes: EpisodeTeam<T>[] } {
  const drama: T[] = [];
  const byNumber = new Map<number, Array<{ bot: T; job: EpisodeJob }>>();
  for (const bot of team) {
    const episode = project.episodeBots[bot.id];
    const crew = episode && byNumber.get(episode.number);
    if (!episode) drama.push(bot);
    else if (crew) crew.push({ bot, job: episode.job });
    else byNumber.set(episode.number, [{ bot, job: episode.job }]);
  }
  const episodes = [...byNumber]
    .sort(([a], [b]) => a - b)
    .map(([number, crew]) => ({ number, bots: crew.sort((a, b) => EPISODE_JOBS.indexOf(a.job) - EPISODE_JOBS.indexOf(b.job)).map(({ bot }) => bot) }));
  return { drama, episodes };
}

export const teamProjectSectionId = (projectId: string): string => `team-project:${projectId}`;

/** The folder a project of that name gets. A root written the Windows way keeps its separator. */
export function teamProjectFolder(root: string, name: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.endsWith(separator) ? root : root + separator}${name.trim()}`;
}

export type RefusalPlace = "name" | "team" | "folder" | "form";

const REFUSAL_PLACES: Record<TeamProjectRefusal, RefusalPlace> = {
  no_root: "folder",
  root_missing: "folder",
  bad_name: "name",
  name_taken: "name",
  folder_exists: "name",
  no_team: "team",
  team_unusable: "team",
  failed: "form",
};

const REFUSAL_KEYS = {
  no_root: "teamProjects.refused.noRoot",
  root_missing: "teamProjects.refused.rootMissing",
  bad_name: "teamProjects.refused.badName",
  name_taken: "teamProjects.refused.nameTaken",
  folder_exists: "teamProjects.refused.folderExists",
  no_team: "teamProjects.refused.noTeam",
  team_unusable: "teamProjects.refused.teamUnusable",
  failed: "teamProjects.refused.failed",
} as const satisfies Record<TeamProjectRefusal, LocaleKey>;

const UNUSABLE_KEYS = {
  empty: "teamProjects.unusable.empty",
  no_chief: "teamProjects.unusable.noChief",
  main_bot_chief: "teamProjects.unusable.mainBotChief",
} as const satisfies Record<ProjectTeamUnusable, LocaleKey>;

export const isTeamProjectRefusal = (code: unknown): code is TeamProjectRefusal => typeof code === "string" && Object.hasOwn(REFUSAL_PLACES, code);

/** Which part of the New project dialog a refusal is shown beside. Null: the server refused without a code. */
export const refusalPlace = (code: TeamProjectRefusal | null): RefusalPlace => (code ? REFUSAL_PLACES[code] : "form");

export const refusalKey = (code: TeamProjectRefusal): LocaleKey => REFUSAL_KEYS[code];

/** Why no project can be made from a team, as the New project dialog says it beside the team. */
export const unusableKey = (reason: ProjectTeamUnusable): LocaleKey => UNUSABLE_KEYS[reason];

/**
 * Changes when a bot comes, goes, is archived or moves to another department, and when the departments change: each
 * is a reason to read the projects again.
 */
export function teamProjectsVersion(bots: ReadonlyArray<{ id: string; hidden?: boolean; section?: string }>, sections: readonly string[] | undefined): string {
  return JSON.stringify([bots.map((bot) => `${bot.id}${bot.hidden ? " archived" : ""} in ${bot.section?.trim() ?? ""}`).sort(), sections ?? null]);
}
