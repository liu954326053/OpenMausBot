import { constants } from "node:fs";
import { mkdir, open, realpath, stat, type FileHandle } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";

import { TEAM_PROJECT_FOLDER } from "../../shared/team-projects.ts";
import { mimeFor } from "../message-file.ts";
import { SECRET_FOLDERS } from "../secret-folder.ts";

export type ProjectPathCode = "invalid_path" | "outside_project" | "team_folder" | "not_found" | "not_file" | "too_large" | "folder_missing" | "changed";

export type ProjectPathError = Error & { status: number; code: ProjectPathCode };

const STATUS: Record<ProjectPathCode, number> = {
  invalid_path: 400, outside_project: 403, team_folder: 403, not_found: 404, not_file: 400, too_large: 413, folder_missing: 409, changed: 409,
};

function pathError(code: ProjectPathCode, message: string): ProjectPathError {
  return Object.assign(new Error(message), { status: STATUS[code], code });
}

export const isProjectPathError = (error: unknown): error is ProjectPathError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === "string" && (error as { code: string }).code in STATUS;

const PATH_MAX_CHARS = 1024;
const NAME_MAX_BYTES = 180;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;
const RESERVED_CHARACTERS = /[<>:"|?*]/g;

const isTeamFolder = (part: string | undefined) => part?.toLowerCase() === TEAM_PROJECT_FOLDER;

/** A relative, `/`-separated path inside a project folder, or null: never absolute, never a `.` or `..` step, never
 * the app's own folder or a secret folder. */
export function cleanProjectPath(input: unknown): string | null {
  if (typeof input !== "string" || !input || input.length > PATH_MAX_CHARS) return null;
  if (/[\p{Cc}\\]/u.test(input) || input.startsWith("/") || /^[a-z]:/i.test(input)) return null;
  const parts = input.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  if (isTeamFolder(parts[0]) || parts.some((part) => SECRET_FOLDERS.includes(part))) return null;
  return parts.join("/");
}

function within(root: string, candidate: string): string | null {
  const suffix = relative(root, candidate);
  if (suffix === "") return "";
  return suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix) ? null : suffix;
}

async function projectRoot(folder: string): Promise<string> {
  try {
    const root = await realpath(folder);
    if ((await stat(root)).isDirectory()) return root;
  } catch {
    // The folder is gone or a drive is disconnected: refused below as missing.
  }
  throw pathError("folder_missing", "the project folder is missing");
}

/** The real location of `target`, as a path relative to `root`; refused when it leads out or into the app's own folder. */
async function inside(root: string, target: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw pathError("not_found", "no such file in the project folder");
  }
  const suffix = within(root, real);
  if (suffix === null) throw pathError("outside_project", "that path leads out of the project folder");
  const parts = suffix.split(sep);
  if (isTeamFolder(parts[0])) throw pathError("team_folder", "the project's own .magic-team folder is not served");
  if (parts.some((part) => SECRET_FOLDERS.includes(part))) throw pathError("outside_project", "that path leads into a secret folder");
  return suffix;
}

const toPosix = (path: string) => path.split(sep).join("/");

export interface OpenedProjectFile {
  handle: FileHandle;
  bytes: number;
  name: string;
  mime: string;
  /** Where the file really is, relative to the project folder. */
  path: string;
}

/** Security: resolved before and after opening, and the open handle compared with the path, so a link swapped in
 * between cannot lead out of the folder. */
export async function openProjectFile(folder: string, requested: string, maxBytes: number): Promise<OpenedProjectFile> {
  const clean = cleanProjectPath(requested);
  if (clean === null) throw pathError("invalid_path", "give a path inside the project folder, relative to it");
  const root = await projectRoot(folder);
  const target = join(root, ...clean.split("/"));
  const before = await inside(root, target);
  let handle: FileHandle | undefined;
  try {
    handle = await open(join(root, before), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    if (!opened.isFile()) throw pathError("not_file", "that path is not a file");
    if (opened.size > maxBytes) throw pathError("too_large", "that file is too large");
    const after = await inside(root, target);
    const now = await stat(join(root, after));
    if (after !== before || now.dev !== opened.dev || now.ino !== opened.ino) throw pathError("changed", "the file changed while it was opened");
    return { handle, bytes: opened.size, name: basename(after), mime: mimeFor(after), path: toPosix(after) };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (isProjectPathError(error)) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw pathError("changed", "the file changed while it was opened");
    throw pathError("not_found", "no such file in the project folder");
  }
}

function truncateBytes(text: string, max: number): string {
  let out = "";
  for (const point of text) {
    if (Buffer.byteLength(out + point) > max) break;
    out += point;
  }
  return out;
}

/** The last part of a requested name, without control or reserved characters, not hidden, at most 180 bytes. */
export function safeFileName(requested: string, fallback = "file"): string {
  const last = requested.split(/[\\/]/).pop() ?? "";
  let name = last.replace(/\p{Cc}/gu, "").replace(RESERVED_CHARACTERS, "_").trim().replace(/^\.+/, "").trim();
  if (!name) name = fallback;
  if (WINDOWS_DEVICE.test(name)) name = `_${name}`;
  if (Buffer.byteLength(name) <= NAME_MAX_BYTES) return name;
  const ext = extname(name);
  const keep = Buffer.byteLength(ext) < 20 ? ext : "";
  return `${truncateBytes(name.slice(0, name.length - keep.length), NAME_MAX_BYTES - Buffer.byteLength(keep))}${keep}`;
}

function numbered(name: string, n: number): string {
  if (n === 1) return name;
  const ext = extname(name);
  return `${name.slice(0, name.length - ext.length)}-${n}${ext}`;
}

const MAX_NUMBERED = 1000;

export interface CreatedProjectFile {
  handle: FileHandle;
  /** Relative to the project folder. */
  path: string;
  name: string;
  /** The absolute path, for removing the file when writing it fails. */
  absolute: string;
}

/** A new file in `dir` of the project folder, under the requested name or the first free numbered one; it is created
 * exclusively, so neither an existing file nor a link holding the name is ever written through. */
export async function createProjectFile(folder: string, dir: string, requestedName: string): Promise<CreatedProjectFile> {
  const cleanDir = cleanProjectPath(dir);
  if (cleanDir === null) throw pathError("invalid_path", "give a folder inside the project folder, relative to it");
  const root = await projectRoot(folder);
  const target = join(root, ...cleanDir.split("/"));
  await mkdir(target, { recursive: true }).catch(() => undefined);
  const real = await inside(root, target);
  if (!(await stat(join(root, real))).isDirectory()) throw pathError("not_file", "that path is not a folder");
  const name = safeFileName(requestedName);
  for (let n = 1; n <= MAX_NUMBERED; n += 1) {
    const candidate = numbered(name, n);
    const absolute = join(root, real, candidate);
    try {
      const handle = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      return { handle, path: toPosix(join(real, candidate)), name: candidate, absolute };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw pathError("changed", "no free name for the file");
}
