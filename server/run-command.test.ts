import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RUN_COMMAND_MAX_SECONDS, RUN_COMMAND_OUTPUT_BYTES, runCommandText } from "./drivers/run-command-tool.ts";
import { commandDirectory, commandLimitSeconds, commandRoot, runCommand, RunCommandRefusal, runCommandEnabled, shellEnvironment } from "./run-command.ts";
import { privateBotFolder, setTeamProjectLookup, setTeamProjectMemberships } from "./workspace.ts";

const posix = process.platform !== "win32";
const PROJECT = "project-1";

function alive(pattern: string): string[] {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("run_command", () => {
  let scratch: string;
  let project: string;
  let data: string;
  let writer: string;
  let plain: string;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "omb-run-command-")));
    project = join(scratch, "Night Shift");
    data = join(scratch, "data");
    mkdirSync(join(project, "scripts"), { recursive: true });
    const suffix = Math.random().toString(36).slice(2, 10);
    writer = `writer-${suffix}`;
    plain = `plain-${suffix}`;
    setTeamProjectMemberships((botId) => (botId === writer ? { id: PROJECT, role: "writer" } : undefined));
    setTeamProjectLookup((id) => (id === PROJECT ? { folder: project } : undefined));
  });

  afterEach(() => {
    setTeamProjectMemberships(() => undefined);
    setTeamProjectLookup(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
    for (const botId of [writer, plain]) rmSync(privateBotFolder(botId), { recursive: true, force: true });
  });

  const run = (botId: string, command: string, extra: { cwd?: string; timeoutSeconds?: number } = {}) =>
    runCommand({ bot: { id: botId, name: "Writer" }, threadId: "thread-1", command, dataDir: data, ...extra });

  it("is off unless features.runCommand is true", () => {
    expect(runCommandEnabled({})).toBe(false);
    expect(runCommandEnabled({ features: {} })).toBe(false);
    expect(runCommandEnabled({ features: { runCommand: "true" } })).toBe(false);
    expect(runCommandEnabled({ features: { runCommand: true } })).toBe(true);
  });

  it("starts a project bot in its project folder and a bot with no project in its private workspace", () => {
    expect(commandRoot(writer)).toBe(realpathSync(project));
    const own = commandRoot(plain);
    expect(own).toBe(realpathSync(privateBotFolder(plain)));
    if (posix) expect(statSync(own).mode & 0o777).toBe(0o700);
  });

  it("refuses a project bot whose project folder is away, rather than running it somewhere else", () => {
    rmSync(project, { recursive: true, force: true });
    expect(() => commandRoot(writer)).toThrow(RunCommandRefusal);
  });

  it.runIf(posix)("runs in the project folder and in a folder below it", async () => {
    const top = await run(writer, "pwd");
    expect(top).toMatchObject({ exitCode: 0, timedOut: false, cwd: "." });
    expect(top.stdout.trim()).toBe(realpathSync(project));
    const below = await run(writer, "pwd", { cwd: "scripts" });
    expect(below).toMatchObject({ exitCode: 0, cwd: "scripts" });
    expect(below.stdout.trim()).toBe(realpathSync(join(project, "scripts")));
    expect(await run(writer, "pwd", { cwd: "./scripts/../scripts" })).toMatchObject({ exitCode: 0, cwd: "scripts" });
  });

  it("refuses a cwd outside the folder, by .., by an absolute path or through a link, saying why", () => {
    const root = realpathSync(project);
    mkdirSync(join(scratch, "elsewhere"));
    if (posix) symlinkSync(join(scratch, "elsewhere"), join(project, "door"));
    const refusal = (cwd: string) => {
      try {
        commandDirectory(root, cwd);
      } catch (error) {
        expect(error).toBeInstanceOf(RunCommandRefusal);
        return (error as Error).message;
      }
      throw new Error(`${cwd} was not refused`);
    };
    expect(refusal("..")).toBe(`cwd .. leads outside your own folder (${root}), so it was refused. Commands run only there.`);
    expect(refusal("scripts/../../elsewhere")).toContain("leads outside your own folder");
    expect(refusal(join(scratch, "elsewhere"))).toContain("not an absolute path");
    expect(refusal("/etc")).toContain("not an absolute path");
    expect(refusal("C:\\Windows")).toContain("not an absolute path");
    expect(refusal("missing")).toBe(`cwd missing is not a folder that exists inside your own folder (${root}).`);
    writeFileSync(join(project, "notes.txt"), "x");
    expect(refusal("notes.txt")).toContain("is not a folder that exists");
    if (posix) expect(refusal("door")).toContain("leads outside your own folder");
  });

  it.runIf(posix)("refuses an escaping cwd before anything runs, and leaves no audit row for it", async () => {
    await expect(run(writer, "touch ran", { cwd: "../" })).rejects.toThrow("leads outside your own folder");
    expect(() => statSync(join(scratch, "ran"))).toThrow();
    expect(() => readFileSync(join(data, "logs", "run-command.log"))).toThrow();
  });

  it("caps the time limit and defaults it to 120 seconds", () => {
    expect(commandLimitSeconds(undefined)).toBe(120);
    expect(commandLimitSeconds(0)).toBe(120);
    expect(commandLimitSeconds(Number.NaN)).toBe(120);
    expect(commandLimitSeconds(5)).toBe(5);
    expect(commandLimitSeconds(0.2)).toBe(1);
    expect(commandLimitSeconds(10_000)).toBe(RUN_COMMAND_MAX_SECONDS);
  });

  it.runIf(posix)("stops the command and everything it started at its limit, and says so", async () => {
    const marker = `omb-run-command-sleeper-${Math.random().toString(36).slice(2, 10)}`;
    const started = Date.now();
    const outcome = await run(writer, `sh -c 'sleep 30; echo ${marker}' & sh -c 'sleep 31; echo ${marker}'`, { timeoutSeconds: 1 });
    const took = Date.now() - started;
    expect(outcome.timedOut).toBe(true);
    expect(outcome.limitSeconds).toBe(1);
    expect(took).toBeGreaterThanOrEqual(1_000);
    expect(took).toBeLessThan(6_000);
    expect(alive(marker)).toEqual([]);
    expect(runCommandText(outcome)).toContain("The command was stopped, with everything it started: it ran past its 1-second limit.");
  });

  it.runIf(posix)("stops what a command left running in the background once the shell exits", async () => {
    const marker = `omb-run-command-orphan-${Math.random().toString(36).slice(2, 10)}`;
    const outcome = await run(writer, `(sh -c 'sleep 30; echo ${marker}' &) ; echo started`, { timeoutSeconds: 20 });
    expect(outcome).toMatchObject({ exitCode: 0, timedOut: false });
    expect(outcome.durationMs).toBeLessThan(10_000);
    expect(alive(marker)).toEqual([]);
  });

  it.runIf(posix)("keeps the first bytes of a large output and tells the model it was cut", async () => {
    const outcome = await run(writer, "head -c 100000 /dev/zero | tr '\\0' 'a'; head -c 50000 /dev/zero | tr '\\0' 'b' >&2");
    expect(outcome.stdout).toHaveLength(RUN_COMMAND_OUTPUT_BYTES);
    expect(outcome.stdoutBytes).toBe(100_000);
    expect(outcome.stderr).toHaveLength(RUN_COMMAND_OUTPUT_BYTES);
    expect(outcome.stderrBytes).toBe(50_000);
    const text = runCommandText(outcome);
    expect(text).toContain(`[stdout truncated: only the first ${RUN_COMMAND_OUTPUT_BYTES} of 100000 bytes are shown.`);
    expect(text).toContain(`[stderr truncated: only the first ${RUN_COMMAND_OUTPUT_BYTES} of 50000 bytes are shown.`);
  });

  it.runIf(posix)("gives the command no input and no terminal", async () => {
    const outcome = await run(writer, "if [ -t 0 ] || [ -t 1 ]; then echo tty; fi; cat; echo \"read:$?\"; echo \"term:$TERM\"");
    expect(outcome.stdout.trim().split("\n")).toEqual(["read:0", "term:dumb"]);
  });

  it("passes only allow-listed environment names, never the server's own", () => {
    const env = shellEnvironment({ HOME: "/home/a", LANG: "en_US.UTF-8", OPENAI_API_KEY: "sk-secret", OMB_INTERNAL_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "s", PATH: "/nowhere" });
    expect(env).toMatchObject({ HOME: "/home/a", LANG: "en_US.UTF-8", TERM: "dumb" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OMB_INTERNAL_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.PATH).not.toBe("/nowhere");
  });

  it.runIf(posix)("does not hand the server's environment to the shell", async () => {
    process.env.OMB_RUN_COMMAND_TEST_SECRET = "do-not-leak";
    try {
      const outcome = await run(writer, "env");
      expect(outcome.stdout).not.toContain("do-not-leak");
      expect(outcome.stdout).toContain("TERM=dumb");
    } finally {
      delete process.env.OMB_RUN_COMMAND_TEST_SECRET;
    }
  });

  it.runIf(posix)("leaves one audit row per run with who, what, where and how it ended, never the output", async () => {
    const outcome = await run(writer, "printf 'printed-%s' secret-body; exit 3", { cwd: "scripts" });
    expect(outcome.stdout).toBe("printed-secret-body");
    const file = join(data, "logs", "run-command.log");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("printed-secret-body");
    const rows = text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      botId: writer,
      botName: "Writer",
      threadId: "thread-1",
      tool: "run_command",
      command: "printf 'printed-%s' secret-body; exit 3",
      cwd: "scripts",
      root: realpathSync(project),
      exitCode: 3,
      timedOut: false,
      stdoutBytes: 19,
      stderrBytes: 0,
    });
    expect(rows[0]).not.toHaveProperty("stdout");
    expect(rows[0]).not.toHaveProperty("stderr");
    expect(typeof rows[0]!.durationMs).toBe("number");
  });

  it.runIf(posix)("stops the command when the caller goes away", async () => {
    const marker = `omb-run-command-abort-${Math.random().toString(36).slice(2, 10)}`;
    const gone = new AbortController();
    const pending = runCommand({ bot: { id: writer, name: "Writer" }, threadId: "thread-1", command: `sh -c 'sleep 30; echo ${marker}'`, dataDir: data, signal: gone.signal });
    setTimeout(() => gone.abort(), 300);
    const outcome = await pending;
    expect(outcome.timedOut).toBe(false);
    expect(outcome.durationMs).toBeLessThan(5_000);
    expect(alive(marker)).toEqual([]);
  });
});
