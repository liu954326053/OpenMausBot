# The run_command tool for API engines

Bots on an engine with no shell of its own (OpenAI-compatible and the other
Chat Completions engines) get one tool that runs shell commands on the server,
inside the bot's own folder. It is off until a person turns on **Let API bots
run commands** in Settings, Experimental features.

Run the acceptance test:

```sh
pnpm exec vitest run server/openai-compat-run-command.e2e.test.ts
```

The test launches its own server on a disposable home and data folder, points
`openaiCompat` at a loopback provider that records every request body, and
gives one bot a project whose folder is a temporary directory, with another
bot in no project at all. No provider account, key or person's data is used.

The assertions prove, through the wire bodies and the fixture's own files:

- The request carries the skills index by name, source and one line of what a
  skill does, never a skill's text or the file it lives in; the `skill` tool
  (listed, or named by `find_tool` for `use_tool`) returns the full skill.
- With the flag off, no request offers `run_command` — not even through
  `find_tool` — and `POST /api/internal/run-command` answers 401 to a caller
  with no turn capability.
- With the flag on, a project bot runs in the project folder and in a folder
  below it, and a bot in no project runs in its private workspace.
- `cwd` of `../`, an absolute path, a folder that does not exist and a link
  pointing out of the folder are each refused with a sentence naming the
  folder, before anything runs.
- A command past its `timeout_seconds` is stopped with everything it started
  (no process matching its marker is left), and output past 32,000 bytes per
  stream is cut with a line saying so before the text, since a chat runtime
  shortens a long tool result from its end.
- The child gets only the allow-listed environment names plus `PATH` and
  `TERM=dumb`; a secret in the server's environment never reaches it.
- Each run appends one row to `<data>/logs/run-command.log` with the bot, the
  command, the folder, the exit code and the duration, and none of its output.
- On Ask, the call shows a card naming the command; denying it runs nothing
  and leaves no audit row. Full access runs it without a card.
- A Claude bot on the same server gets `OMB_RUN_COMMAND=0`: an engine with a
  shell of its own keeps its own shell.

`server/run-command.test.ts` covers the folder rule, the limit, the output bound,
the environment and the audit row directly, including a caller that goes away
mid-command.

What this does not prove: the shell itself is not a sandbox. A command that
names a path outside the bot's folder runs there, because the range is the
folder the command starts in. Audit rows are how an operator sees that, and the
test does not attempt a container or OS-level containment.
