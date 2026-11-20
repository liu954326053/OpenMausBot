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
   * The team template its team matches, at the version it last matched: the one it was made from, until the team is
   * updated from a template or saved back to one.
   */
  template: { id: string; name: string; version: number };
  leadBotId: string;
  createdAt: number;
  archivedAt?: number;
}

/**
 * A bot's place in a project. `role` is unique within the project and names the bot's folder under `.magic-team/bots/`.
 * For a bot made with the project it is the key of its role in the team template. For one that joined later it is
 * `member-` and eight hex digits: a key no team template gives a role, so the bot is never taken for one.
 */
export interface TeamProjectMembership {
  id: string;
  role: string;
}

/** How the server finds a project for one of its bots. Undefined: there is no such project. */
export type TeamProjectLookup = (projectId: string) => Pick<TeamProjectRecord, "folder" | "archivedAt"> | undefined;

/** A project as the app shows it. */
export interface TeamProjectWire extends TeamProjectRecord {
  /** "missing": the project folder is not there, as when its drive is not connected. Its bots do not run. */
  folderState: "ready" | "missing";
  /** The project's bots, in the order the app lists bots. A bot does not say on the wire which project it is in: this does. */
  botIds: string[];
}

/** `GET /api/team-projects`: every project, archived ones included. `root` is null until the person chooses the folder new projects go in. */
export interface TeamProjectsListWire {
  root: string | null;
  projects: TeamProjectWire[];
}

export interface CreateTeamProjectInput {
  name: string;
  templateId: string;
}

/**
 * Why a project was not made:
 * - `no_root`: no projects root is set.
 * - `root_missing`: the projects root is not there.
 * - `bad_name`: the name cannot be a folder's name.
 * - `name_taken`: a project or a department already has the name.
 * - `folder_exists`: the projects root already holds a folder of that name.
 * - `no_template`: no team template has that id.
 * - `failed`: it could not be made, and nothing was left behind. The one exception has the `errorKey`
 *   `serverError.teamProject.failedLeftovers`: part of what was made could not be removed again, and `error` says so.
 */
export type TeamProjectRefusal = "no_root" | "root_missing" | "bad_name" | "name_taken" | "folder_exists" | "no_template" | "failed";

export type CreateTeamProjectResult =
  | {
    project: TeamProjectWire;
    /** Library skills the template names that the skills library does not hold. */
    missingSkills: string[];
  }
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

/** What template sync asks of projects. */
export interface TeamProjectTemplateSetter {
  /**
   * Records the template, and the version of it, that the project's team now matches: after the team was updated from
   * a template, or saved back as a template's next version. Null: no project has that id.
   */
  setTemplate(id: string, template: TeamProjectRecord["template"]): TeamProjectWire | null;
}
