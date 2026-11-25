export const RUN_COMMAND_TOOL = "run_command";
export const RUN_COMMAND_DEFAULT_SECONDS = 120;
export const RUN_COMMAND_MAX_SECONDS = 300;
/** Kept of stdout and of stderr each; the rest is counted, not kept. */
export const RUN_COMMAND_OUTPUT_BYTES = 32_000;
export const RUN_COMMAND_MAX_CHARS = 16_000;
export const RUN_COMMAND_CWD_MAX_CHARS = 1_024;

export const RUN_COMMAND_TOOL_DEFINITION = {
  name: RUN_COMMAND_TOOL,
  description:
    "Run a shell command on this computer, in your own folder (your project's folder, or your private workspace when you are in no project), and get its exit code, stdout and stderr back as text. " +
    "Use it for command-line work: running a script, downloading a file, converting or checking files. " +
    "It has no terminal and no input, so a command that waits for input or a password fails instead of waiting. " +
    `Each of stdout and stderr keeps its first ${RUN_COMMAND_OUTPUT_BYTES} bytes; write long output to a file and read the part you need. ` +
    `It is stopped, with everything it started, after ${RUN_COMMAND_DEFAULT_SECONDS} seconds unless you raise timeout_seconds (at most ${RUN_COMMAND_MAX_SECONDS}). ` +
    "The person may be asked to approve each command.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: { type: "string", minLength: 1, maxLength: RUN_COMMAND_MAX_CHARS, description: "The shell command, for example: python3 tools/fetch.py --out data/source.txt && wc -c data/source.txt" },
      cwd: {
        type: "string",
        maxLength: RUN_COMMAND_CWD_MAX_CHARS,
        description: "A folder inside your own folder to run in, relative to it (for example scripts/build). Leave it out to run in your own folder.",
      },
      timeout_seconds: { type: "integer", minimum: 1, maximum: RUN_COMMAND_MAX_SECONDS, description: `How long it may run before it is stopped. Default ${RUN_COMMAND_DEFAULT_SECONDS}.` },
    },
    required: ["command"],
  },
};

/** What the server answers a run with. */
export interface RunCommandOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  limitSeconds: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  /** The folder it ran in, relative to the bot's own folder ("." for that folder). */
  cwd: string;
  durationMs: number;
}

function stream(label: "stdout" | "stderr", text: string, bytes: number): string[] {
  return bytes ? [`--- ${label} ---`, text.replace(/\s+$/, "")] : [];
}

function truncated(label: "stdout" | "stderr", bytes: number): string[] {
  return bytes > RUN_COMMAND_OUTPUT_BYTES
    ? [`[${label} truncated: only the first ${RUN_COMMAND_OUTPUT_BYTES} of ${bytes} bytes are shown. Write the output to a file and read the part you need.]`]
    : [];
}

/** The run as the model reads it. A chat runtime shortens a long tool result from its end, so what decides the next step
 * (how it ended, what was cut, the errors) comes before stdout. */
export function runCommandText(outcome: RunCommandOutcome): string {
  const head = outcome.timedOut
    ? `The command was stopped, with everything it started: it ran past its ${outcome.limitSeconds}-second limit.`
    : outcome.exitCode === null ? `The command was stopped by signal ${outcome.signal ?? "unknown"}.` : `exit code ${outcome.exitCode}`;
  const lines = [`${head} (in ${outcome.cwd}, ${(outcome.durationMs / 1000).toFixed(1)} s)`,
    ...truncated("stdout", outcome.stdoutBytes), ...truncated("stderr", outcome.stderrBytes),
    ...stream("stderr", outcome.stderr, outcome.stderrBytes), ...stream("stdout", outcome.stdout, outcome.stdoutBytes)];
  if (!outcome.stdoutBytes && !outcome.stderrBytes) lines.push("(no output)");
  return lines.join("\n");
}
