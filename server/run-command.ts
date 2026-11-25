// The run_command tool's command, run through a shell as the server's own user. Security invariants, in the order a call
// meets them:
// - features.runCommand is off unless a person set it, and the route refuses while it is off. No Cloud home or hosted
//   workspace offers it: there a bot's work runs on someone else's server, and it has no folder of its own to run in.
// - The command line comes from the model, so the only thing keeping it inside the bot's own files is the folder it starts
//   in: that is the bot's writable range (its project's folder, or its private workspace), and `cwd` must resolve, links
//   followed, to that folder or below it. The shell itself has no sandbox: a command that names a path outside it runs
//   there. Audit rows are how an operator sees that happen.
// - Each call ends: a hard stop of the child's process group after its limit, closed stdin, no TTY, and bounded output.
// - The child gets an allow-list of environment names, never the server's own environment: the fixed list, plus names an
//   operator set in features.runCommandEnv. Values are read here, never stored, and the audit row keeps names only.
// - Every run leaves one audit row in <data>/logs/run-command.log: the command, the folder, the outcome, never output.
import { appendFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { under } from "./bot-box/plan.ts";
import { DATA_DIR } from "./config.ts";
import { RUN_COMMAND_DEFAULT_SECONDS, RUN_COMMAND_MAX_SECONDS, RUN_COMMAND_OUTPUT_BYTES, RUN_COMMAND_TOOL, type RunCommandOutcome } from "./drivers/run-command-tool.ts";
import { augmentedPath } from "./env-path.ts";
import { killCliTree, spawnCli } from "./procs.ts";
import { redactSecrets } from "./redact.ts";
import { privateBotFolder, teamProjectFolder, teamProjectFolderProblem } from "./workspace.ts";

/** `features.runCommand`: the run_command tool runs shell commands on this server. Off unless true. */
export function runCommandEnabled({ features }: { features?: unknown }): boolean {
  return typeof features === "object" && features !== null && "runCommand" in features && features.runCommand === true;
}

/** A refusal a person can read and act on: a status the route answers with, never a stack. */
export class RunCommandRefusal extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Names a bot's shell may read. Not the server's environment: no OMB_ name, no engine key, no credential the app holds.
 * spawnCli adds SSL_CERT_FILE and REQUESTS_CA_BUNDLE for a run outside the bot box (python-trust.ts), as for every bot
 * process; inside the box the host's bundle is not mounted, so a name carried from here would point at nothing. */
export const SHELL_ENV_NAMES: readonly string[] = [
  "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "COLORTERM",
  "NO_COLOR", "FORCE_COLOR", "SSL_CERT_DIR", "CURL_CA_BUNDLE",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
  "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE",
  // Windows: what cmd.exe and most programs need to find themselves and the user's folders.
  "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
];

/** A bot's shell environment: PATH as a GUI launch needs it, TERM not claiming a terminal, and nothing else of the server's
 * but the operator's own names. A name in both lists keeps the fixed list's value, so no entry is ambiguous. */
export function shellEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  extraNames: readonly string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SHELL_ENV_NAMES) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  for (const name of extraNames) {
    if (Object.hasOwn(env, name)) continue;
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  env.PATH = augmentedPath();
  env.TERM = "dumb";
  return env;
}

/** The folder commands run in, which is also the boundary of what a call may name: a project bot's project folder, else
 * the bot's private workspace, both resolved so no link in it reads as somewhere else. */
export function commandRoot(botId: string): string {
  const problem = teamProjectFolderProblem(botId);
  if (problem) throw new RunCommandRefusal(problem, 409);
  const project = teamProjectFolder(botId);
  if (project) return realpathSync(project);
  const own = privateBotFolder(botId);
  mkdirSync(own, { recursive: true, mode: 0o700 });
  return realpathSync(own);
}

/** The folder a call starts in, or a refusal naming why. `cwd` is relative to the root; an absolute path, a `..` that
 * leaves it, a link that points out of it and a path that is not a folder are all refused. */
export function commandDirectory(root: string, cwd: string | undefined): string {
  const wanted = (cwd ?? "").trim();
  if (!wanted) return root;
  if (isAbsolute(wanted) || /^[a-zA-Z]:/.test(wanted)) {
    throw new RunCommandRefusal(`cwd must be a folder inside your own folder, relative to it, not an absolute path: ${wanted}`);
  }
  const joined = resolve(root, wanted);
  const outside = `cwd ${wanted} leads outside your own folder (${root}), so it was refused. Commands run only there.`;
  if (!under(joined, root)) throw new RunCommandRefusal(outside);
  let real: string;
  try {
    real = realpathSync(joined);
    if (!statSync(real).isDirectory()) throw new Error("not a folder");
  } catch {
    throw new RunCommandRefusal(`cwd ${wanted} is not a folder that exists inside your own folder (${root}).`);
  }
  // Checked again once links are followed: a link inside the folder may point anywhere.
  if (!under(real, root)) throw new RunCommandRefusal(outside);
  return real;
}

export function commandLimitSeconds(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return RUN_COMMAND_DEFAULT_SECONDS;
  return Math.min(RUN_COMMAND_MAX_SECONDS, Math.max(1, Math.round(requested)));
}

/** `/bin/sh -c` on POSIX; Windows has no POSIX shell, so its own command interpreter, where `/s` takes the one quoted
 * argument as the command line as written. Neither starts a login shell, so no rc file of the server's decides what a
 * command means. */
function shellArguments(command: string): { file: string; args: string[] } {
  return process.platform === "win32"
    ? { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${command}"`] }
    : { file: "/bin/sh", args: ["-c", command] };
}

/** Output read so far, not output kept: what a stream wrote past the bound stays visible in its byte count. */
function collected(): { take(chunk: Buffer): void; text(): string; bytes(): number } {
  const chunks: Buffer[] = [];
  let kept = 0, total = 0;
  return {
    take(chunk) {
      total += chunk.length;
      if (kept >= RUN_COMMAND_OUTPUT_BYTES) return;
      const room = RUN_COMMAND_OUTPUT_BYTES - kept;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(piece);
      kept += piece.length;
    },
    // A bound may cut a multi-byte character in two; the decoder's replacement marks it, and it is dropped.
    text: () => Buffer.concat(chunks).toString("utf8").replace(/\uFFFD+$/u, ""),
    bytes: () => total,
  };
}

export interface RunCommandRequest {
  bot: { id: string; name: string };
  threadId: string;
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
  /** The caller went away (the turn ended): the command is stopped as at its limit. */
  signal?: AbortSignal;
  /** `features.runCommandEnv`: names whose values the operator lets this command read from the server's environment. */
  envNames?: string[];
  /** For tests: where the audit row goes. */
  dataDir?: string;
}

/** Runs one command in the bot's own folder and returns its outcome; refusals throw RunCommandRefusal. */
export async function runCommand(request: RunCommandRequest): Promise<RunCommandOutcome> {
  const root = commandRoot(request.bot.id);
  const dir = commandDirectory(root, request.cwd);
  const limitSeconds = commandLimitSeconds(request.timeoutSeconds);
  const limitMs = limitSeconds * 1_000;
  const shell = shellArguments(request.command);
  const started = Date.now();
  const out = collected(), err = collected();
  let timedOut = false;
  const envNames = request.envNames ?? [];

  const child = spawnCli(shell.file, shell.args, {
    cwd: dir,
    env: shellEnvironment(process.env, envNames),
    // No terminal and no input: a command that asks a question reads end-of-file and fails instead of waiting a person.
    stdio: ["ignore", "pipe", "pipe"],
    // The bot's own work, not its engine: the bot box where this server has one, with this folder writable; memory runs
    // out on it before the server.
    box: { botId: request.bot.id, rw: [dir] },
    botWork: true,
    ...(process.platform === "win32" ? { windowsVerbatimArguments: true } : {}),
  });
  child.stdout.on("data", (chunk: Buffer) => out.take(chunk));
  child.stderr.on("data", (chunk: Buffer) => err.take(chunk));

  // The whole group: a build tool, a package manager or a shell loop a command started dies with it.
  const stopGroup = () => void killCliTree(child, 2_000);
  const timer = setTimeout(() => {
    timedOut = true;
    stopGroup();
  }, limitMs);
  timer.unref?.();
  if (request.signal?.aborted) stopGroup();
  else request.signal?.addEventListener("abort", stopGroup, { once: true });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | { failed: string }>((resolve) => {
    child.once("error", (error: NodeJS.ErrnoException) => resolve({ failed: error.code ?? error.message }));
    // Something the command left running in the background can hold its output open after the shell exits, and then
    // "close" never comes: the group is stopped shortly after the exit instead.
    child.once("exit", () => {
      const holders = setTimeout(() => void killCliTree(child, 1_000), 500);
      holders.unref?.();
      child.once("close", () => clearTimeout(holders));
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  request.signal?.removeEventListener("abort", stopGroup);
  if ("failed" in exit) throw new RunCommandRefusal(`The shell could not start (${exit.failed}).`, 500);
  // A command that left something running in its group is stopped before the answer, so nothing outlives the call.
  await killCliTree(child, 1_000).catch(() => false);

  const outcome: RunCommandOutcome = {
    exitCode: exit.code,
    signal: exit.signal ?? null,
    timedOut,
    limitSeconds,
    stdout: out.text(),
    stderr: err.text(),
    stdoutBytes: out.bytes(),
    stderrBytes: err.bytes(),
    cwd: relative(root, dir) || ".",
    durationMs: Date.now() - started,
  };
  audit(request, root, outcome, envNames);
  return outcome;
}

/** One row per run: who, what, where and how it ended. Never what it printed, which may hold anything. */
function audit(request: RunCommandRequest, root: string, outcome: RunCommandOutcome, envNames: readonly string[]): void {
  const row = redactSecrets({
    at: new Date().toISOString(),
    botId: request.bot.id,
    botName: request.bot.name,
    threadId: request.threadId,
    tool: RUN_COMMAND_TOOL,
    command: request.command.length > 2_000 ? `${request.command.slice(0, 2_000)}…` : request.command,
    cwd: outcome.cwd,
    root,
    envNames,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    durationMs: outcome.durationMs,
    stdoutBytes: outcome.stdoutBytes,
    stderrBytes: outcome.stderrBytes,
  });
  try {
    const dir = request.dataDir ?? DATA_DIR;
    mkdirSync(join(dir, "logs"), { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, "logs", "run-command.log"), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  } catch {
    // An audit row that cannot be written must not change what the command did.
  }
}
