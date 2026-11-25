// An OpenAI-compatible bot's skills index and its run_command tool, end to end: the real server on a disposable home, a
// loopback provider that records every request body it is sent, and a project whose folder is a temporary one.
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { isTitleCall } from "./testing/title-call.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = "project-run";
const SKILL_BODY = "STEP-BODY-7f3a: fetch the source with tools/fetch.py, then count the lines.";

type ChatMessage = { role: string; content?: unknown; tool_call_id?: string };
type ChatRequest = { messages: ChatMessage[]; tools?: Array<{ function: { name: string } }> };
type Call = { name: string; arguments: Record<string, unknown> };

let child: ChildProcess;
let upstream: Server;
let home = "";
let data = "";
let project = "";
let base = "";
let stderr = "";
const raw: string[] = [];
const requests: ChatRequest[] = [];
const script: Call[] = [];

const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const text = (content: unknown) => (typeof content === "string" ? content : JSON.stringify(content));
const toolNames = (request: ChatRequest | undefined) => (request?.tools ?? []).map((tool) => tool.function.name);
/** Every agents tool a request lets the model call: listed ones, and those find_tool names for use_tool (the tool bridge
 * these engines run with). */
const reachable = (request: ChatRequest | undefined) => {
  const tools = (request?.tools ?? []) as Array<{ function: { name: string; description?: string } }>;
  const hidden = tools.find((tool) => tool.function.name === "agents_find_tool")?.function.description?.match(/Tools reached this way: ([^.]*)\./)?.[1]?.split(", ") ?? [];
  return [...tools.map((tool) => tool.function.name.replace(/^agents_/, "")), ...hidden];
};
const bridged = (name: string, args: Record<string, unknown>): Call => ({ name: "agents_use_tool", arguments: { name, arguments: args } });
const run = (args: Record<string, unknown>) => bridged("run_command", args);

const api = async (method: string, path: string, body?: unknown, status?: number) => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const answer = await response.json() as any;
  if (status !== undefined) expect(response.status, `${method} ${path}: ${JSON.stringify(answer)}`).toBe(status);
  else expect(response.ok, `${method} ${path}: ${JSON.stringify(answer)}`).toBe(true);
  return answer;
};

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= end) throw new Error(`Fixture wait expired: ${JSON.stringify(value)}\n${stderr.slice(-4000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const idle = (botId: string) => until(() => api("GET", "/api/bots?messages=0"), (state) => !state.bots.find((bot: any) => bot.id === botId)?.busy);

/** One turn: the person's message, then each scripted call answered by the model in turn. Returns the requests it made. */
async function turn(botId: string, message: string, calls: Call[] = []): Promise<ChatRequest[]> {
  const before = requests.length;
  script.push(...calls);
  await api("POST", `/api/bots/${botId}/messages`, { text: message });
  await until(() => requests.length - before, (count) => count >= calls.length + 1, 60_000);
  await idle(botId);
  return requests.slice(before);
}

/** What the tool with `id` answered, as the next request carried it back to the model. */
function toolAnswer(made: ChatRequest[], index: number): { ok: boolean; result: string } {
  const answer = made[index + 1]?.messages.findLast((message) => message.role === "tool");
  return JSON.parse(text(answer?.content)) as { ok: boolean; result: string };
}

const alive = (pattern: string) => {
  try { return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; }
};
const auditRows = () => {
  const file = join(data, "logs", "run-command.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>) : [];
};

beforeAll(async () => {
  home = realpathSync(mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-rc-")));
  data = join(home, "data");
  project = join(home, "Harbor Story");
  mkdirSync(join(project, "scripts"), { recursive: true });
  mkdirSync(join(home, "outside"));
  symlinkSync(join(home, "outside"), join(project, "door"));
  mkdirSync(data);
  const ui = join(home, "static");
  mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<title>run_command fixture</title>");
  writeFileSync(join(ui, "assets", "test.css"), "body{}");

  upstream = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
    if (req.method === "GET") { res.statusCode = 404; return res.end(); }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body || "{}") as ChatRequest;
    if (isTitleCall(request)) { res.statusCode = 500; return res.end(); }
    if (!request.tools?.length) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end(frame({ content: "Noted." }, "stop") + "data: [DONE]\n\n");
    }
    raw.push(body);
    requests.push(request);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const next = script[0];
    if (next && toolNames(request).includes(next.name)) {
      script.shift();
      const call = { index: 0, id: `call-${requests.length}`, type: "function", function: { name: next.name, arguments: JSON.stringify(next.arguments) } };
      return res.end(frame({ tool_calls: [call] }, "tool_calls") + "data: [DONE]\n\n");
    }
    script.length = 0;
    res.end(frame({ content: "Done." }, "stop") + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;

  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: { claude: { driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") }, environment: { FAKE_CLAUDE_DUMP: join(home, "claude-dump.json") } } },
  }));
  writeFileSync(join(home, "lookup.json"), JSON.stringify({ [PROJECT]: { folder: project } }));
  writeFileSync(join(home, "members.json"), "{}");

  const port = await freePortBlock([0, 1], 8870, 30);
  base = `http://127.0.0.1:${port}`;
  const bootstrap = `await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
    const workspace = await import(${JSON.stringify(new URL("./workspace.ts", import.meta.url).href)});
    const { readFileSync } = await import("node:fs");
    const read = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };
    workspace.setTeamProjectLookup((id) => read(${JSON.stringify(join(home, "lookup.json"))})[id]);
    workspace.setTeamProjectMemberships((botId) => read(${JSON.stringify(join(home, "members.json"))})[botId]);`;
  child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", bootstrap], {
    cwd: ROOT,
    env: {
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      HOME: home, USERPROFILE: home, OMB_DATA_DIR: data, TMPDIR: home, TEMP: home, TMP: home, LANG: "en_US.UTF-8",
      OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), OMB_STATIC_DIR: ui, OMB_USER_DATA: join(home, "user-data"),
      OMB_DISABLE_MODEL_MANIFEST_FETCH: "1", OMB_DISABLE_ANNOUNCEMENTS: "1",
      OMB_RUN_COMMAND_E2E_SECRET: "server-secret-must-not-reach-the-shell",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", () => {});
  child.stderr!.on("data", (chunk) => { stderr += chunk; });
  await until(async () => {
    if (child.exitCode !== null) throw new Error(stderr);
    try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
  }, Boolean, 60_000);
  await api("PATCH", "/api/config", { openaiCompat: { key: "fixture-key", url: `http://127.0.0.1:${upstreamPort}/v1`, model: "fixture-model" } });
  const seeded = (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.chiefOfStaff);
  if (seeded) await api("PATCH", `/api/bots/${seeded.id}`, { chiefOfStaff: false });
}, 90_000);

afterAll(async () => {
  if (process.env.OMB_RUN_COMMAND_EVIDENCE) {
    writeFileSync(process.env.OMB_RUN_COMMAND_EVIDENCE, JSON.stringify({ requests: raw.map((body) => JSON.parse(body)), audit: auditRows() }, null, 2));
  }
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve()));
  if (home) await removeTempDir(home);
});

describe.skipIf(process.platform === "win32")("an OpenAI-compatible bot", () => {
  let lead: { id: string; threadId: string };

  it("is told its skills by name and use, never their text or file, and reads one with the skill tool", async () => {
    lead = (await api("POST", "/api/bots", { name: "Lead" }, 201)).bot;
    writeFileSync(join(home, "members.json"), JSON.stringify({ [lead.id]: { id: PROJECT, role: "lead" } }));
    await api("PATCH", `/api/bots/${lead.id}/model`, { instanceId: "openaiCompat", model: "fixture-model" });
    const skill = `---\nname: fetch-source\ndescription: Downloads a story's source text into the project.\n---\n\n# fetch-source\n\n${SKILL_BODY}\n`;
    await api("POST", `/api/bots/${lead.id}/skill-template`, { name: "fetch-source", description: "Downloads a story's source text into the project.", source: "fixture", text: skill, enabled: true }, 201);

    const made = await turn(lead.id, "Get the source text.", [bridged("skill", { name: "fetch-source" })]);
    const first = raw[raw.length - made.length]!;
    expect(first).toContain("- fetch-source (your own): Downloads a story's source text into the project.");
    expect(first).toContain("Read one in full with the skill tool");
    expect(first).not.toContain("STEP-BODY-7f3a");
    expect(first).not.toContain("SKILL.md");
    expect(reachable(made[0])).toContain("skill");
    const answer = toolAnswer(made, 0);
    expect(answer.ok).toBe(true);
    expect(answer.result).toContain(SKILL_BODY);
  }, 90_000);

  it("has no run_command while features.runCommand is off, and the route runs nothing for anyone", async () => {
    expect((await api("GET", "/api/config")).features.runCommand).toBe(false);
    const made = await turn(lead.id, "List the files.");
    expect(reachable(made[0])).toContain("skill");
    expect(reachable(made[0])).not.toContain("run_command");
    expect(raw[raw.length - made.length]).not.toContain("run_command");
    const anonymous = await fetch(`${base}/api/internal/run-command`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ command: "touch pwned" }) });
    expect(anonymous.status).toBe(401);
    expect(existsSync(join(project, "pwned"))).toBe(false);
    expect(auditRows()).toEqual([]);
  }, 90_000);

  it("lists run_command once it is switched on, and runs in the project folder and below it", async () => {
    expect((await api("PATCH", "/api/config", { features: { runCommand: true } })).features?.runCommand ?? (await api("GET", "/api/config")).features.runCommand).toBe(true);
    const made = await turn(lead.id, "Fetch the source.", [
      run({ command: "pwd; printf 'chapter one' > source.txt; env" }),
      run({ command: "pwd", cwd: "scripts" }),
    ]);
    expect(reachable(made[0])).toContain("run_command");
    const top = toolAnswer(made, 0);
    expect(top.ok).toBe(true);
    expect(top.result).toContain(`exit code 0 (in .,`);
    expect(top.result).toContain(realpathSync(project));
    expect(top.result).toContain("TERM=dumb");
    expect(top.result).not.toContain("server-secret-must-not-reach-the-shell");
    const names = top.result.split("\n").map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1]).filter(Boolean).sort();
    expect(names).toEqual(["HOME", "LANG", "OMB_ENGINE_TAG", "PATH", "PWD", "REQUESTS_CA_BUNDLE", "SHLVL", "SSL_CERT_FILE", "TEMP", "TERM", "TMP", "TMPDIR", "USERPROFILE", "_"]);
    expect(readFileSync(join(project, "source.txt"), "utf8")).toBe("chapter one");
    const below = toolAnswer(made, 1);
    expect(below.result).toContain("exit code 0 (in scripts,");
    expect(below.result).toContain(join(realpathSync(project), "scripts"));
  }, 90_000);

  it("refuses a cwd that leaves the project folder, by .., an absolute path or a link, and says why", async () => {
    const made = await turn(lead.id, "Look around.", [
      run({ command: "touch escaped-1", cwd: "../" }),
      run({ command: "touch escaped-2", cwd: join(home, "outside") }),
      run({ command: "touch escaped-3", cwd: "door" }),
    ]);
    const root = realpathSync(project);
    expect(toolAnswer(made, 0)).toMatchObject({ ok: false, result: expect.stringContaining(`cwd ../ leads outside your own folder (${root}), so it was refused. Commands run only there.`) });
    expect(toolAnswer(made, 1)).toMatchObject({ ok: false, result: expect.stringContaining("not an absolute path") });
    expect(toolAnswer(made, 2)).toMatchObject({ ok: false, result: expect.stringContaining(`cwd door leads outside your own folder (${root})`) });
    for (const name of ["escaped-1", "escaped-2", "escaped-3"]) {
      expect(existsSync(join(home, name))).toBe(false);
      expect(existsSync(join(home, "outside", name))).toBe(false);
    }
  }, 90_000);

  it("stops a command at its limit with everything it started, and cuts a large output saying so", async () => {
    const marker = `omb-e2e-sleeper-${Date.now()}`;
    const started = Date.now();
    const made = await turn(lead.id, "Run the slow one.", [
      run({ command: `sh -c 'sleep 40; echo ${marker}' & sleep 41`, timeout_seconds: 2 }),
      run({ command: "head -c 200000 /dev/zero | tr '\\0' 'x'" }),
    ]);
    expect(Date.now() - started).toBeLessThan(30_000);
    const slow = toolAnswer(made, 0);
    expect(slow.ok).toBe(false);
    expect(slow.result).toContain("The command was stopped, with everything it started: it ran past its 2-second limit.");
    expect(alive(marker)).toEqual([]);
    const big = toolAnswer(made, 1);
    expect(big.result.split("\n").slice(0, 2)).toEqual([
      expect.stringMatching(/^exit code 0 \(in \., /),
      "[stdout truncated: only the first 32000 of 200000 bytes are shown. Write the output to a file and read the part you need.]",
    ]);
  }, 90_000);

  it("leaves an audit row per run with the bot, command, folder, exit code and time, and none of its output", () => {
    const rows = auditRows();
    expect(rows.map((row) => row.command)).toEqual([
      "pwd; printf 'chapter one' > source.txt; env",
      "pwd",
      expect.stringContaining("sleep 41"),
      "head -c 200000 /dev/zero | tr '\\0' 'x'",
    ]);
    for (const row of rows) expect(row).toMatchObject({ botId: lead.id, botName: "Lead", tool: "run_command", root: realpathSync(project), durationMs: expect.any(Number) });
    expect(rows[1]).toMatchObject({ cwd: "scripts", exitCode: 0 });
    expect(rows[2]).toMatchObject({ timedOut: true });
    expect(rows[3]).toMatchObject({ stdoutBytes: 200_000 });
    const file = readFileSync(join(data, "logs", "run-command.log"), "utf8");
    expect(file).not.toContain("TERM=dumb");
    expect(file).not.toContain("xxxxxxxx");
  });

  it("asks the person first on Ask, and a denied command never runs", async () => {
    await api("PATCH", `/api/bots/${lead.id}`, { approvalMode: "ask", applyToAllThreads: true });
    script.push(run({ command: "touch asked.txt" }));
    await api("POST", `/api/bots/${lead.id}/messages`, { text: "Make the file." });
    const card = await until(async (): Promise<{ requestId: string } | undefined> => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === lead.id).messages
      .find((message: any) => message.card?.requestId && !message.card.answered)?.card, Boolean);
    expect(existsSync(join(project, "asked.txt"))).toBe(false);
    await api("POST", `/api/bots/${lead.id}/respond`, { threadId: lead.threadId, requestId: card!.requestId, behavior: "deny" });
    await idle(lead.id);
    expect(existsSync(join(project, "asked.txt"))).toBe(false);
    expect(auditRows().some((row) => row.command === "touch asked.txt")).toBe(false);
    await api("PATCH", `/api/bots/${lead.id}`, { approvalMode: "full", applyToAllThreads: true });
  }, 90_000);

  it("runs a bot in no project in its private workspace", async () => {
    const solo = (await api("POST", "/api/bots", { name: "Solo" }, 201)).bot;
    await api("PATCH", `/api/bots/${solo.id}/model`, { instanceId: "openaiCompat", model: "fixture-model" });
    const made = await turn(solo.id, "Where are you?", [run({ command: "pwd" })]);
    expect(toolAnswer(made, 0).result).toContain(realpathSync(join(data, "workspaces", solo.id)));
  }, 90_000);

  it("leaves an engine with a shell of its own as it was: a Claude bot gets no run_command", async () => {
    const claude = (await api("POST", "/api/bots", { name: "Claude control" }, 201)).bot;
    const instances = (await api("GET", "/api/instances")).instances as Array<{ instanceId: string; models: { default: string } }>;
    await api("PATCH", `/api/bots/${claude.id}/model`, { instanceId: "claude", model: instances.find((item) => item.instanceId === "claude")!.models.default });
    await api("POST", `/api/bots/${claude.id}/messages`, { text: "hello" });
    const dump = await until(() => {
      try { return JSON.parse(readFileSync(join(home, "claude-dump.json"), "utf8")) as { mcpConfig?: { mcpServers?: Record<string, { env?: Record<string, string> }> } }; } catch { return null; }
    }, (value) => Boolean(value?.mcpConfig?.mcpServers?.agents));
    await idle(claude.id);
    expect(dump!.mcpConfig!.mcpServers!.agents!.env?.OMB_RUN_COMMAND).toBe("0");
  }, 90_000);
});
