// A project bot's work goes in its project folder. A write that lands anywhere else, and one whose place cannot be read,
// is never allowed with nobody asked: it comes to the person as an approval card. Reads are not writes.
import { lstatSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { readOnlyPaths } from "./own-file-reads.ts";

export interface ProjectWriteScope {
  /** The project folder: it and everything below it, `.magic-team` included. */
  folder: string;
  /** Places a write may reach without asking although outside the project: temporary folders and the bot's own private
   * folders, which its engine and memory already use; never one that holds the project itself. */
  exempt: readonly string[];
}

/** `not-a-write`: nothing in the request writes. `unknown`: it writes, but its place cannot be read. */
export type ProjectWriteVerdict = "not-a-write" | "inside" | "outside" | "unknown";

export function projectWriteScope(folder: string, dataDir: string, botId: string): ProjectWriteScope {
  const project = realPlace(folder) ?? resolve(folder);
  const exempt = [tmpdir(), "/tmp", "/var/tmp", "/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", join(dataDir, "workspaces", botId), join(dataDir, "task-workspaces", botId)]
    .filter((root) => !within(project, realPlace(root) ?? root));
  return { folder, exempt };
}

/** Where a path really leads, following every link, for a file that may not exist yet: its nearest existing folder
 * resolved, with the rest put back. null for a link that leads nowhere, whose target is the link's to choose. */
export function realPlace(path: string): string | null {
  const rest: string[] = [];
  for (let at = resolve(path); ; at = dirname(at)) {
    try {
      return join(realpathSync(at), ...rest.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      if (lstatSync(at, { throwIfNoEntry: false })) return null;
      if (dirname(at) === at) return null;
      rest.push(basename(at));
    }
  }
}

const within = (path: string, root: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Whether `path`, made absolute against `cwd`, lands in the project or an exempt place once every link is followed. */
export function placeAllowed(scope: ProjectWriteScope, path: string, cwd: string): boolean {
  const place = realPlace(resolve(cwd, path));
  if (place === null) return false;
  return [scope.folder, ...scope.exempt].some((root) => {
    const real = realPlace(root);
    return within(place, root) || (real !== null && within(place, real));
  });
}

const WRITE_TOOL_FIELD: Record<string, string> = { Write: "file_path", Edit: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path" };

/** The files a write tool's ask names (Claude's Write, Edit, MultiEdit and NotebookEdit, this computer's write_file and
 * make_folder), as given; undefined for any other tool. A value that is not a path makes the write unreadable. */
export function writeToolPaths(tool: unknown, input: unknown): string[] | undefined {
  if (typeof tool !== "string") return undefined;
  const bare = tool.replace(/^mcp__computer__|^computer_/, "");
  const field = WRITE_TOOL_FIELD[tool] ?? (bare === "write_file" || bare === "make_folder" ? "path" : undefined);
  if (!field) return undefined;
  const value = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>)[field] : undefined;
  return [typeof value === "string" ? value : ""];
}

/** The files an ACP edit, delete or move call names; undefined for any other kind. */
export function acpWritePaths(toolCall: { kind?: unknown; locations?: unknown; rawInput?: unknown }): string[] | undefined {
  if (toolCall.kind !== "edit" && toolCall.kind !== "delete" && toolCall.kind !== "move") return undefined;
  const input = toolCall.rawInput && typeof toolCall.rawInput === "object" && !Array.isArray(toolCall.rawInput) ? toolCall.rawInput as Record<string, unknown> : {};
  const located = Array.isArray(toolCall.locations) ? toolCall.locations.map((location) => (location as { path?: unknown })?.path) : [];
  const paths = [...located, input.filePath, input.file_path, input.path, input.destination].filter((path): path is string => typeof path === "string");
  return paths.length ? [...new Set(paths)] : [""];
}

/** The shell commands whose writes are read from their words: the last word is the destination, or every word for those
 * in EVERY_WORD_WRITTEN. A command that writes through its own logic (`npm run build`, `sed -i`, a script) is not one,
 * and keeps the rules it had. */
const WRITERS: Record<string, true> = { cp: true, mv: true, ln: true, install: true, tee: true, mkdir: true, touch: true, rm: true, rmdir: true, truncate: true, rsync: true };
const EVERY_WORD_WRITTEN = new Set(["tee", "mkdir", "touch", "rm", "rmdir", "truncate", "mv"]);
const VALUED = /^-[mogS]$/;

const TOKEN = /"[^"]*"|'[^']*'|\|\||&&|&>>?|\d?>>?\|?|[;|&()<\n]|[^\s;|&()<>"']+/g;
const SEPARATOR = /^(?:\|\||&&|[;|&()<\n])$/;

/** The words of a line as a shell splits them, enough to find paths: quoted strings, operators and redirections. */
function shellWords(line: string): string[] {
  return line.replace(/\\\n/g, " ").match(TOKEN) ?? [];
}

const unquote = (word: string) => /^(["']).*\1$/s.test(word) ? word.slice(1, -1) : word;

/** Where a command line writes, as the words it names (unresolved, `~` and `$HOME` kept as they are), or null when it is
 * not one of the commands read here. Each segment's places are given with the folder it runs in. */
export function shellWriteTargets(line: string): Array<{ path: string; cwd: string | null }> | null {
  const segments = shellWords(line);
  let cwd: string | null = null;
  const targets: Array<{ path: string; cwd: string | null }> = [];
  for (let index = 0; index < segments.length; index++) {
    const token = segments[index]!;
    const word = unquote(token);
    const commandWord = index === 0 || SEPARATOR.test(segments[index - 1]!);
    if (commandWord && word === "cd") {
      const next = segments[index + 1] && !SEPARATOR.test(segments[index + 1]!) ? unquote(segments[index + 1]!) : "~";
      cwd = next.startsWith("/") || next.startsWith("~") || next.startsWith("$") ? next : `${cwd ?? "."}/${next}`;
      continue;
    }
    if (/^(?:&|\d)?>>?\|?$/.test(token)) {
      const next = segments[index + 1] ? unquote(segments[index + 1]!) : "";
      if (next && !next.startsWith("&")) targets.push({ path: next, cwd });
      continue;
    }
    if (!commandWord || !WRITERS[word]) continue;
    const words: string[] = [];
    for (let at = index + 1; at < segments.length && !SEPARATOR.test(segments[at]!) && !/^(?:&|\d)?>>?\|?$/.test(segments[at]!); at++) words.push(unquote(segments[at]!));
    const plain: string[] = [];
    let targetFolder: string | undefined;
    for (let at = 0; at < words.length; at++) {
      const arg = words[at]!;
      if (arg === "-t" || arg === "--target-directory") { targetFolder = words[++at] ?? ""; continue; }
      if (arg.startsWith("--target-directory=")) { targetFolder = arg.slice("--target-directory=".length); continue; }
      if (VALUED.test(arg)) { at++; continue; }
      if (!arg.startsWith("-")) plain.push(arg);
    }
    if (targetFolder !== undefined) targets.push({ path: targetFolder, cwd });
    if (EVERY_WORD_WRITTEN.has(word)) {
      for (const arg of plain) targets.push({ path: arg, cwd });
    } else if (targetFolder === undefined && plain.length) {
      targets.push({ path: plain[plain.length - 1]!, cwd });
    }
  }
  return targets.length ? targets : null;
}

export interface WriteRequest {
  /** A shell command with its working folder. */
  command?: { command: string; cwd: string };
  /** A shell command line whose working folder is unknown. */
  commandLine?: string;
  /** The places a write tool names (`writeToolPaths`, `acpWritePaths`). */
  writes?: readonly string[];
}

/** `~` and `$HOME` as the shell expands them; null for a word any other variable builds. */
function expandHome(word: string): string | null {
  const expanded = word === "~" || word.startsWith("~/") ? homedir() + word.slice(1) : word.replace(/^\$(?:HOME|\{HOME\})(?=\/|$)/, homedir());
  return /[$`~]/.test(expanded) ? null : expanded;
}

/** `cwd` null: no folder to read a relative path against. */
function verdictOfPlace(scope: ProjectWriteScope, path: string, cwd: string | null): ProjectWriteVerdict {
  const expanded = expandHome(path);
  if (expanded === null || (!isAbsolute(expanded) && cwd === null)) return "unknown";
  return placeAllowed(scope, expanded, cwd ?? "/") ? "inside" : "outside";
}

function worst(verdicts: readonly ProjectWriteVerdict[]): ProjectWriteVerdict {
  if (verdicts.includes("outside")) return "outside";
  return verdicts.includes("unknown") ? "unknown" : "inside";
}

/** Where a request writes, for a project bot. A tool that names its files is read from them; a shell line from the
 * commands above; anything else writes nothing that can be read here. A write tool that names no path is `unknown`,
 * which asks. */
export function projectWriteVerdict(scope: ProjectWriteScope, request: WriteRequest): ProjectWriteVerdict {
  if (request.writes) {
    if (!request.writes.length) return "unknown";
    return worst(request.writes.map((path) => (path ? verdictOfPlace(scope, path, null) : "unknown")));
  }
  const line = request.command?.command ?? request.commandLine;
  if (!line || readOnlyPaths(line)) return "not-a-write";
  const targets = shellWriteTargets(line);
  if (!targets) return "not-a-write";
  const base = request.command?.cwd ?? null;
  return worst(targets.map((target) => {
    if (target.cwd === null) return verdictOfPlace(scope, target.path, base);
    const moved = expandHome(target.cwd);
    if (moved === null || (!isAbsolute(moved) && base === null)) return "unknown";
    return verdictOfPlace(scope, target.path, resolve(base ?? "/", moved));
  }));
}

/** A write that must reach a person: outside the project, or one whose place could not be read. */
export function leavesProject(verdict: ProjectWriteVerdict): boolean {
  return verdict === "outside" || verdict === "unknown";
}

/** Whether a conversation is a project bot's work in its project: its own conversations, or its own project's room. */
export function doesProjectWork(inProject: boolean, room: boolean, ownProjectRoom: boolean): boolean {
  return inProject && (!room || ownProjectRoom);
}
