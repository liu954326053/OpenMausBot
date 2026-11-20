import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { TEAM_PROJECT_FOLDER, type TeamProjectLookup, type TeamProjectMembership } from "../shared/team-projects.ts";
import { SECRET_FOLDERS } from "./secret-folder.ts";
import { userError, userErrorThrown, type UserErrorKey } from "./user-errors.ts";

let projectOf: TeamProjectLookup = () => undefined;
let membershipOf: (botId: string) => TeamProjectMembership | undefined = () => undefined;

/** Until this is called, every bot with a `teamProject` reads as being in an unknown project and does not run. */
export function setTeamProjectLookup(lookup: TeamProjectLookup): void {
  projectOf = lookup;
}

/** A bot's place in a project, from its record. An id that names no bot (a memory layer, a deleted bot) has none. */
export function setTeamProjectMemberships(membership: (botId: string) => TeamProjectMembership | undefined): void {
  membershipOf = membership;
}

/** A drive that is not connected reads as not there. */
export function teamProjectFolderReady(folder: string): boolean {
  try {
    return isAbsolute(folder) && statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

export type TeamProjectStop =
  | { reason: "unknown_project" }
  | { reason: "archived" }
  | { reason: "folder_missing"; folder: string };

const ROLE_MAX_BYTES = 200;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/** Names that start with a dot are the app's own under `.magic-team/bots/`. */
function roleFolderName(role: string): string | null {
  if (!role || role.startsWith(".") || /[. ]$/.test(role) || Buffer.byteLength(role, "utf8") > ROLE_MAX_BYTES) return null;
  if ([...role].some((char) => char < " " || char === "\u007f" || '<>:"|?*\\/'.includes(char))) return null;
  return WINDOWS_DEVICE.test(role) ? null : role;
}

interface Place {
  folder: string;
  archived: boolean;
  /** null when the project's folder is no path of this computer (a project recorded on another one): never ready. */
  own: string | null;
}

/** undefined: in no project. null: in one that cannot be placed. */
function placeOf(membership: TeamProjectMembership | undefined): Place | null | undefined {
  if (!membership) return undefined;
  const project = projectOf(membership.id);
  const role = roleFolderName(membership.role);
  if (!project || !role) return null;
  const own = isAbsolute(project.folder) ? join(project.folder, TEAM_PROJECT_FOLDER, "bots", role) : null;
  return { folder: project.folder, archived: project.archivedAt !== undefined, own };
}

/** Why a project bot takes no work now; null when it may run, or is in no project. */
export function teamProjectStop(botId: string): TeamProjectStop | null {
  const place = placeOf(membershipOf(botId));
  if (place === undefined) return null;
  if (place === null) return { reason: "unknown_project" };
  if (place.archived) return { reason: "archived" };
  return teamProjectFolderReady(place.folder) ? null : { reason: "folder_missing", folder: place.folder };
}

/** `<project folder>/.magic-team/bots/<role>`; null for a bot in no project, or in one that cannot be placed. */
export function teamProjectBotFolder(botId: string): string | null {
  return placeOf(membershipOf(botId))?.own ?? null;
}

/** A project bot's files cannot be read now, so not finding them says nothing about them. */
export function teamProjectFilesAway(botId: string): boolean {
  const place = placeOf(membershipOf(botId));
  return place === null || (place !== undefined && !teamProjectFolderReady(place.folder));
}

/** In the words a person is told, why a project bot's own folder cannot be used now; null when it can, and for a bot in
 * no project. */
export function teamProjectFolderProblem(botId: string): string | null {
  const place = placeOf(membershipOf(botId));
  if (place === undefined) return null;
  if (place === null) return userError("serverError.teamProjectBot.unknown").error;
  return teamProjectFolderReady(place.folder) ? null : userError("serverError.teamProjectBot.folderMissing", { folder: place.folder }).error;
}

const refused = (key: UserErrorKey, params?: Record<string, string>) => Object.assign(userErrorThrown(key, params), { status: 409 });

/**
 * Security invariant: no level on the way to a project bot's folder is made with a recursive mkdir, so a project folder
 * that is gone is never made again (macOS: the path of an unplugged drive is under /Volumes, where making it fails or
 * lands on the startup disk). A level that is a link or a file is refused, so a link left in a project never sends a
 * bot's files somewhere else.
 */
function makeLevel(dir: string, projectFolder: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw refused("serverError.teamProjectBot.folderMissing", { folder: projectFolder });
    if (code !== "EEXIST") throw error;
  }
  if (!lstatSync(dir).isDirectory()) throw refused("serverError.teamProjectBot.ownFolderBlocked", { path: dir });
}

const entryExists = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
function realDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Security invariant: a project bot's folder widens what the bot reads or writes without being asked only while every
 * level from its project folder down to it is a real folder. Whoever works in the project folder can put a link there.
 */
export function teamProjectBotFolderInPlace(botId: string): string | null {
  const own = placeOf(membershipOf(botId))?.own;
  if (!own) return null;
  const bots = dirname(own);
  return [dirname(bots), bots, own].every(realDirectory) ? own : null;
}

const KEPT_IN_DATA_FOLDER = new Set([...SECRET_FOLDERS, "tools"]);
const APP_SKILL_LINK = /^\.(?:claude|agents|grok)\/skills\/[^/]+$/;

function copyEntry(source: string, target: string, relative: string): void {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    if (APP_SKILL_LINK.test(relative)) return;
    try {
      symlinkSync(readlinkSync(source), target);
    } catch {
    }
  } else if (stat.isDirectory()) {
    mkdirSync(target, { mode: 0o700 });
    for (const name of readdirSync(source)) copyEntry(join(source, name), join(target, name), `${relative}/${name}`);
  } else if (stat.isFile()) {
    // Linux refuses a chmod on FAT and exFAT volumes, which fs.copyFile makes: the mode goes in at creation instead.
    writeFileSync(target, readFileSync(source), { mode: stat.mode & 0o777, flag: "wx" });
    try {
      utimesSync(target, stat.atime, stat.mtime);
    } catch {
    }
  }
}

/** What the bot's folder in the data folder held before the bot joined its project. Copied, then renamed in place, then
 * removed there: no step loses a file, and none needs a rename across volumes. */
function takeOver(from: string, bots: string, own: string, projectFolder: string): void {
  if (!realDirectory(from)) return;
  const names = readdirSync(from).filter((name) => !KEPT_IN_DATA_FOLDER.has(name));
  if (!names.length) return;
  const stagingRoot = join(bots, ".adopting");
  makeLevel(stagingRoot, projectFolder);
  const staging = join(stagingRoot, basename(own));
  rmSync(staging, { recursive: true, force: true });
  try {
    mkdirSync(staging, { mode: 0o700 });
    for (const name of names) copyEntry(join(from, name), join(staging, name), name);
    renameSync(staging, own);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  for (const name of names) rmSync(join(from, name), { recursive: true, force: true });
  for (const emptied of [stagingRoot, from]) {
    try {
      rmdirSync(emptied);
    } catch {
    }
  }
}

/** A project bot's own folder, or `parts` below it, made ready; null for a bot in no project, for which nothing is done.
 * `privateFolder` is the bot's folder in the data folder. */
export function ensureTeamProjectBotFolder(botId: string, privateFolder: string, parts: readonly string[] = []): string | null {
  const place = placeOf(membershipOf(botId));
  if (place === undefined) return null;
  if (place === null) throw refused("serverError.teamProjectBot.unknown");
  const own = place.own;
  if (!own || !teamProjectFolderReady(place.folder)) throw refused("serverError.teamProjectBot.folderMissing", { folder: place.folder });
  const bots = dirname(own);
  makeLevel(dirname(bots), place.folder);
  makeLevel(bots, place.folder);
  if (!entryExists(own)) takeOver(privateFolder, bots, own, place.folder);
  let dir = own;
  makeLevel(dir, place.folder);
  for (const part of parts) makeLevel(dir = join(dir, part), place.folder);
  return dir;
}

/** What a bot wrote in a project folder is the person's: a deleted bot's folder is moved aside there, never removed. */
export function retireTeamProjectBotFolder(membership: TeamProjectMembership, now: Date = new Date()): void {
  const place = placeOf(membership);
  const own = place?.own;
  if (!place || !own || !teamProjectFolderReady(place.folder)) return;
  try {
    if (!realDirectory(own)) return;
    const deleted = join(dirname(own), ".deleted");
    makeLevel(deleted, place.folder);
    const name = `${basename(own)}-${now.toISOString().replace(/[-:]|\.\d+/g, "")}`;
    for (let copy = 1; copy <= 100; copy += 1) {
      const target = join(deleted, copy === 1 ? name : `${name}-${copy}`);
      if (entryExists(target)) continue;
      renameSync(own, target);
      return;
    }
  } catch {
  }
}
