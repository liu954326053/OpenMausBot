// A project is one short drama: a folder under the projects root, and the team that works in it. The code calls it a
// "team project" to keep it apart from a bot's own thread folders, which the wire types call `BotProject`.

/** The folder inside a project folder that holds its team's own files. */
export const TEAM_PROJECT_FOLDER = ".magic-team";

/** The longest a project's name may be, in UTF-16 units: its department takes the same name, and a department's is at most this long. */
export const TEAM_PROJECT_NAME_MAX = 60;

// Windows keeps these device names in every folder, in any case and with any extension (Microsoft, "Naming Files, Paths, and Namespaces").
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\s*(\..*)?$/i;

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || (code >= 127 && code < 160) || code === 0x2028 || code === 0x2029;
}

/**
 * Whether `name` can be a project's name: one folder's name on Windows, macOS and Linux alike, and a department's name.
 * A name with spaces around it is refused, so trim what a person typed first.
 */
export function isTeamProjectName(name: string): boolean {
  if (!name || name.length > TEAM_PROJECT_NAME_MAX || name !== name.trim()) return false;
  if (name.startsWith(".") || name.endsWith(".")) return false;
  if (/[/\\:*?"<>|]/.test(name) || [...name].some(isControlCharacter)) return false;
  return !WINDOWS_DEVICE_NAME.test(name);
}

/** One entry of `<data dir>/projects.json`. */
export interface TeamProjectRecord {
  id: string;
  /** Also the name of its folder and, when it is made, of its department. */
  name: string;
  /** Absolute path of the project folder. */
  folder: string;
  /** The department that is this project's team. */
  section: string;
  /**
   * The team the project was made from: the memory key of its department, which a rename keeps and a deletion retires,
   * and the department's name when it was last seen. Absent for a project made from a team template: its bots follow nobody.
   */
  team?: { key: string; name: string };
  /** On a project made from a team template instead of a team: that template. Nothing reads it. */
  template?: { id: string; name: string; version: number };
  leadBotId: string;
  createdAt: number;
  archivedAt?: number;
}

/**
 * A bot's place in a project. `role` is unique within the project and names the bot's folder under `.magic-team/bots/`.
 * For a copy of a team member it is the member's key in the team's share export. For a bot that joined the project's
 * department on its own it is `member-` and eight hex digits.
 */
export interface TeamProjectMembership {
  id: string;
  role: string;
  /** The team member this bot is a copy of: it shows that bot's name, title, description, persona, look and model. */
  source?: string;
  /** Its source was deleted, archived or left the team, or the team was deleted: it follows nobody until the person decides. */
  sourceLeft?: true;
}

/** What a copy shows of its source. Nobody can change these on a copy while it follows its source. */
export const COPY_FIELDS = [
  "name", "title", "description", "soul", "modelSelection",
  "color", "mascotExpression", "mascotBody", "mascotFaceColor", "avatarUrl", "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY",
] as const;

export type CopyField = (typeof COPY_FIELDS)[number];

const ROLE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Names Windows keeps for devices: no folder can be called one, and a role names its bot's folder in a project. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** A bot's role in a project: 1 to 40 lowercase letters, digits and dashes, starting and ending with a letter or digit. */
export function isTeamProjectRole(value: string): boolean {
  return ROLE.test(value) && !DEVICE_NAME.test(value);
}

/** A role for a new member: the letters and digits of `name` when it has any, else `role-1`, `role-2`, …; never one of `taken`. */
export function teamProjectRole(name: string, taken: ReadonlySet<string>): string {
  const slug = name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/, "");
  const base = isTeamProjectRole(slug) ? slug : "role";
  if (base !== "role" && !taken.has(base)) return base;
  for (let n = base === "role" ? 1 : 2; ; n += 1) {
    const role = `${base}-${n}`;
    if (!taken.has(role)) return role;
  }
}

/** How the server finds a project for one of its bots. Undefined: there is no such project. */
export type TeamProjectLookup = (projectId: string) => Pick<TeamProjectRecord, "folder" | "archivedAt"> | undefined;

/** A bot of a team, as the app names it. */
export interface TeamMemberWire {
  id: string;
  name: string;
  title: string;
}

/** What changed in a project's team since its copies were made, waiting for the person to decide. */
export interface TeamProjectChanges {
  /** Members of the team the project has no copy of. */
  joined: TeamMemberWire[];
  /** Copies whose source left the team, as the copies are named. */
  left: TeamMemberWire[];
}

/**
 * `POST /api/team-projects/:id/team-changes`: what the person decided about the changes they were shown. Each change
 * is made only if it still stands; the ones that do not, or that could not be made, are `skipped`.
 */
export interface TeamChangesInput {
  /** Members of the team to make copies of: ids from `joined`. */
  add: string[];
  /** Copies to delete: ids from `left`. Their files in the project folder are moved aside, not removed. */
  remove: string[];
  /** Copies to keep as the project's own: ids from `left`. */
  keep: string[];
}

export interface TeamChangesResult {
  project: TeamProjectWire;
  /** The ids of the changes that were not made. */
  skipped: string[];
}

/** A project as the app shows it. */
export interface TeamProjectWire extends TeamProjectRecord {
  /** "missing": the project folder is not there, as when its drive is not connected. Its bots do not run. */
  folderState: "ready" | "missing";
  /** The project's bots, in the order the app lists bots. A bot does not say on the wire which project it is in: this does. */
  botIds: string[];
  /** The source of each copy that follows one, by the copy's id. */
  follows: Record<string, string>;
  /** Absent when nothing changed. */
  teamChanges?: TeamProjectChanges;
}

/** The live event the owner's and admins' open apps get when a project's folder goes missing or comes back, within a
 * few seconds. They read the list again. */
export interface TeamProjectsEvent {
  kind: "team-projects";
  projectId: string;
  folderState: TeamProjectWire["folderState"];
}

/**
 * Why a team cannot be made into a project:
 * - `empty`: it has no bots.
 * - `no_chief`: none of its bots is its Chief.
 * - `main_bot_chief`: its Chief is the main bot, which belongs to no team.
 */
export type ProjectTeamUnusable = "empty" | "no_chief" | "main_bot_chief";

/** Why no project can be made from a department, from its Chief of Staff (if any) and how many of its bots are not the main bot. */
export const projectTeamUnusable = (chief: { defaultBot?: unknown } | undefined, bots: number): ProjectTeamUnusable | undefined =>
  chief?.defaultBot ? "main_bot_chief" : !bots ? "empty" : !chief ? "no_chief" : undefined;

/** A team a project can be made from: one department that is no project's. */
export interface ProjectTeamWire {
  name: string;
  /** The department's context. */
  context: string;
  chief: TeamMemberWire | null;
  /** Its bots, the Chief first. */
  members: TeamMemberWire[];
  /** Absent when a project can be made from it. */
  unusable?: ProjectTeamUnusable;
}

/** `GET /api/team-projects/teams`. */
export interface ProjectTeamsWire {
  teams: ProjectTeamWire[];
}

/** `GET /api/team-projects`: every project, archived ones included. `root` is null until the person chooses the folder new projects go in. */
export interface TeamProjectsListWire {
  root: string | null;
  projects: TeamProjectWire[];
}

export interface CreateTeamProjectInput {
  name: string;
  /** The name of the team the project is made from. */
  team: string;
}

/**
 * Why a project was not made:
 * - `no_root`: no projects root is set.
 * - `root_missing`: the projects root is not there.
 * - `bad_name`: the name cannot be a folder's name.
 * - `name_taken`: a project or a department already has the name.
 * - `folder_exists`: the projects root already holds a folder of that name.
 * - `no_team`: no team has that name.
 * - `team_unusable`: the team cannot be made into a project; `errorParams.reason` is its `ProjectTeamUnusable`.
 * - `failed`: it could not be made, and nothing was left behind. The one exception has the `errorKey`
 *   `serverError.teamProject.failedLeftovers`: part of what was made could not be removed again, and `error` says so.
 */
export type TeamProjectRefusal = "no_root" | "root_missing" | "bad_name" | "name_taken" | "folder_exists" | "no_team" | "team_unusable" | "failed";

export type CreateTeamProjectResult =
  | { project: TeamProjectWire }
  | {
    /** The reason in English, for a caller that has no words of its own. */
    error: string;
    code: TeamProjectRefusal;
    /** The `serverError.*` key of `error` in the app's language files, and what its placeholders stand for. */
    errorKey?: string;
    errorParams?: Record<string, string | number>;
  };

/** What the rest of the server asks of projects. */
export interface TeamProjectsApi {
  /** Every project, archived ones included, in the order they were made. */
  list(): TeamProjectWire[];
  /** Every team, in the order the departments are listed: the ones a project can be made from and, with why, the rest. */
  teams(): ProjectTeamWire[];
  create(input: CreateTeamProjectInput): Promise<CreateTeamProjectResult>;
  /**
   * Pauses the routines of the project's bots that are running and remembers which. The folder and everything in it
   * stay. Changes nothing for a project that is archived already. Null: no project has that id.
   */
  archive(id: string): TeamProjectWire | null;
  /**
   * Resumes the routines `archive` paused, and no others; one that can no longer run stays paused. Changes nothing
   * for a project that is not archived. Null: no project has that id.
   */
  restore(id: string): TeamProjectWire | null;
}
