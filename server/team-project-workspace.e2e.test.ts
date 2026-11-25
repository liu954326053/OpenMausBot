// POSIX only: a Windows SIGTERM ends the process without its shutdown hooks.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";
import { CAPTURE_MARKER } from "./memory-capture.ts";
import { waitForExit } from "./testing/cleanup.ts";

const PROJECT = "project-night-shift";

const tree = (dir: string): string[] => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? [`${entry.name}/`, ...tree(join(dir, entry.name)).map((path) => `${entry.name}/${path}`)] : [entry.name]).sort()
  : [];

/** Every file under `root` that holds `needle`, as a path from `root`; links are not followed. */
function filesHolding(root: string, needle: string): string[] {
  return readdirSync(root, { recursive: true }).map(String)
    .filter((path) => lstatSync(join(root, path)).isFile() && readFileSync(join(root, path)).includes(needle)).sort();
}

/**
 * The real server on a fixture of its own, where the bot Writer is in a project whose folder is a temporary one. The
 * lookup is the test's: it is set in the server's process after whatever the server itself wired, and reads a file the
 * test rewrites.
 */
async function projectBotServer(knobs: (scratch: string) => NodeJS.ProcessEnv, beforeJoining?: (bot: WireBot, inData: string, api: Api) => Promise<WireBot[] | void>) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-bot-")));
  const projectFolder = join(scratch, "Night Shift");
  const lookupFile = join(scratch, "lookup.json");
  const project = (record: { folder: string; archivedAt?: number } | null) => writeFileSync(lookupFile, JSON.stringify(record ? { [PROJECT]: record } : {}));
  mkdirSync(projectFolder);
  writeFileSync(join(projectFolder, "script.md"), "# Night Shift\n");
  project({ folder: projectFolder });
  const parentEnv = { ...process.env, ...knobs(scratch) };
  const fixture = await launchVerificationServer(parentEnv);
  const { url, dataDir, logPath } = fixture.info;
  let server: ChildProcess = fixture.child;
  const api: Api = async (method, path, body) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() };
  };
  const startWithLookup = async () => {
    const env = verificationServerEnvironment(parentEnv, dataDir, Number(new URL(url).port));
    const log = openSync(logPath, "a", 0o600);
    const bootstrap = `process.on('message', message => { if (message === 'stop') process.emit('SIGTERM'); });
      await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
      const { setTeamProjectLookup } = await import(${JSON.stringify(new URL("./workspace.ts", import.meta.url).href)});
      const { readFileSync } = await import('node:fs');
      setTeamProjectLookup((id) => { try { return JSON.parse(readFileSync(${JSON.stringify(lookupFile)}, 'utf8'))[id]; } catch { return undefined; } });
      process.send('lookup-set');`;
    server = spawn(process.execPath, [...verificationServerArgs(env).slice(0, -1), "--input-type=module", "-e", bootstrap], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", log, log, "ipc"],
    });
    closeSync(log);
    await new Promise<void>((resolve, reject) => {
      server.on("message", (message) => { if (message === "lookup-set") resolve(); });
      server.once("exit", () => reject(new Error(`the server stopped before it was ready; see ${logPath}`)));
    });
    await expect.poll(async () => {
      try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; }
    }, { timeout: 30_000, interval: 150 }).toBe(true);
  };
  const stop = async () => {
    if (server.connected) {
      server.send("stop");
      await waitForExit(server, { graceMs: 10_000 });
    } else {
      await waitForExit(server, { signal: "SIGTERM" });
    }
  };
  const close = async () => {
    await stop();
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  };
  try {
    const created = await api("POST", "/api/bots", { name: "Writer" });
    expect(created.status).toBe(201);
    const bot: WireBot = created.body.bot;
    const inData = join(dataDir, "workspaces", bot.id);
    const teammates = (await beforeJoining?.(bot, inData, api)) ?? [];
    await stop();
    const roles = new Map([[bot.id, "writer"], ...teammates.map((teammate) => [teammate.id, teammate.name.toLowerCase()] as const)]);
    const bots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8")) as Array<Record<string, unknown>>;
    writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots.map((record) => roles.has(String(record.id))
      ? { ...record, teamProject: { id: PROJECT, role: roles.get(String(record.id)) }, cwd: projectFolder } : record)));
    const config = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ ...config, memory: { ...config.memory, captureQuietMs: 1_000 } }, null, 2));
    await startWithLookup();
    return {
      scratch, projectFolder, own: join(projectFolder, ".magic-team", "bots", "writer"), inData, dataDir, url, bot, teammates, api, project, close,
      told: () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { cwd: string; systemPrompt: string; mcpConfig: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } },
      settled: () => runControlOmb(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30", "--url", url]),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
type Api = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

it.skipIf(process.platform === "win32")("keeps a project bot's memory in its project folder, tells the bot where, and refuses its turns while the folder is gone", async () => {
  const fixture = await projectBotServer((scratch) => {
    writeFileSync(join(scratch, "routes.json"), JSON.stringify({
      [CAPTURE_MARKER]: JSON.stringify([{ text: "The person wants every episode to end on a cliffhanger", kind: "fact", evidence: "End every episode on a cliffhanger", confidence: 0.9 }]),
    }));
    return {
      FAKE_CLAUDE_RUN_BASH: "1", FAKE_CLAUDE_TOOL_CALLS_FILE: join(scratch, "tool-calls.json"), FAKE_CLAUDE_TEXT_ROUTES: join(scratch, "routes.json"),
      FAKE_CLAUDE_TEXT_DUMP: join(scratch, "one-shot-dump.json"),
    };
  }, async (bot, inData, api) => {
    expect((await api("PUT", `/api/bots/${bot.id}/memory`, { text: "- 2026-11-19 · The person's name is Sam\n" })).status).toBe(200);
    expect(readFileSync(join(inData, "MEMORY.md"), "utf8")).toContain("The person's name is Sam");
    return [(await api("POST", "/api/bots", { name: "Editor" })).body.bot];
  });
  const { scratch, projectFolder, own, inData, dataDir, url, bot, teammates: [editor], api, project, settled } = fixture;
  const unplugged = join(scratch, "unplugged");
  const toolCalls = join(scratch, "tool-calls.json");
  const texts = async () => ((await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).body.messages as Array<{ role: string; kind: string; text?: string }>)
    .filter((message) => message.kind === "text").map((message) => `${message.role}: ${message.text}`);

  try {
    writeFileSync(toolCalls, JSON.stringify([{ name: "Bash", input: { command: "printf '%s\\n' '- 2026-11-20 · The pilot is set in Lisbon' >> .magic-team/bots/writer/MEMORY.md" } }]));
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "End every episode on a cliffhanger. Note where the pilot is set." })).status).toBe(202);
    expect(await settled()).toMatchObject({ status: "settled" });

    const told = fixture.told();
    expect(told.cwd).toBe(projectFolder);
    expect(told.systemPrompt).toContain(`"sharedBotFolder":${JSON.stringify(own)}`);
    expect(told.systemPrompt).toContain("sharedBotFolder is your own folder inside this project's .magic-team folder: your memory and the skills you learn are kept there.");
    expect(told.systemPrompt).toContain("Inside .magic-team, change only that folder.");
    expect(told.systemPrompt).toContain("The person's name is Sam");

    const memory = () => readFileSync(join(own, "MEMORY.md"), "utf8");
    expect(memory()).toContain("The person's name is Sam");
    expect(memory()).toContain("The pilot is set in Lisbon");
    await expect.poll(memory, { timeout: 30_000, interval: 250 }).toContain("every episode to end on a cliffhanger");
    expect(tree(inData), "nothing of its memory stays in or returns to the data folder").toEqual([]);
    expect((await api("GET", `/api/bots/${bot.id}/memory/file?path=MEMORY.md`)).body.text).toContain("The pilot is set in Lisbon");
    expect(existsSync(join(dataDir, "bots", bot.id, "SOUL.md")), "the persona stays in the data folder").toBe(true);
    expect(tree(join(projectFolder, ".magic-team")).filter((path) => !path.startsWith("bots/writer/")), "only its own folder is made in the project").toEqual(["bots/"]);
    expect(readdirSync(projectFolder).sort()).toEqual([".magic-team", "script.md"]);

    const before = await texts();
    const kept = tree(own);
    renameSync(projectFolder, unplugged);
    const refused = await api("POST", `/api/bots/${bot.id}/messages`, { text: "Are you there?" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: `Writer can't work right now: its project folder was not found at ${projectFolder}. Reconnect the drive or put the folder back, then try again.`,
      code: "bot_held",
    });
    const edit = await api("PUT", `/api/bots/${bot.id}/memory`, { text: "- written while the folder is away\n" });
    expect(edit).toMatchObject({ status: 409, body: { errorKey: "serverError.teamProjectBot.folderMissing", errorParams: { folder: projectFolder } } });
    expect(await api("POST", "/api/share/export", { botId: bot.id }), "making a template of it is refused in the same words").toMatchObject({
      status: 409, body: { error: `This bot's project folder was not found at ${projectFolder}. Reconnect the drive or put the folder back, then try again.` },
    });
    expect(await texts()).toEqual(before);
    expect(existsSync(projectFolder), "the project folder is never made again").toBe(false);
    expect(readdirSync(scratch).sort()).toEqual(["lookup.json", "one-shot-dump.json", "routes.json", "tool-calls.json", "unplugged"]);
    expect(tree(inData), "and nothing is written to the data folder instead").toEqual([]);
    expect(tree(join(unplugged, ".magic-team", "bots", "writer"))).toEqual(kept);

    renameSync(unplugged, projectFolder);
    writeFileSync(toolCalls, "[]");
    const skill = "---\nname: beat-sheet\ndescription: Lays out the beats of an episode.\n---\n\n# beat-sheet\n\nList the beats in order.\n";
    expect((await api("POST", `/api/bots/${bot.id}/skill-template`, { name: "beat-sheet", description: "Lays out the beats of an episode.", source: "fixture", text: skill, enabled: true })).status).toBe(201);
    expect(readFileSync(join(own, "skills", "beat-sheet", "SKILL.md"), "utf8")).toBe(skill);
    expect(tree(inData), "its skills are not in the data folder either").toEqual([]);
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Welcome back." })).status).toBe(202);
    expect(await settled()).toMatchObject({ status: "settled" });
    expect(memory()).toContain("The pilot is set in Lisbon");
    const index = fixture.told().systemPrompt;
    expect(index).toContain("- beat-sheet (your own): Lays out the beats of an episode.");
    expect(index).toContain("Read one in full with the skill tool");
    expect(index).not.toContain(join(own, "skills", "beat-sheet", "SKILL.md"));
    expect((await api("POST", "/api/share/export", { botId: bot.id })).status).toBe(201);
    expect(readFileSync(join(own, "templates", "writer", "skills", "beat-sheet", "SKILL.md"), "utf8"), "a template of it is written in its own folder").toContain("List the beats in order.");
    expect(tree(inData), "and not in the data folder").toEqual([]);

    const group: { id: string; threadId: string } = (await api("POST", "/api/groups", {
      name: "Writers' room", memberIds: [bot.id, editor.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
    })).body.group;
    const room = async (text: string) => {
      await runControlOmb(["send-channel", "--channel", group.id, "--text", text, "--url", url]);
      expect(await runControlOmb(["wait", "--channel", group.id, "--timeout", "30", "--url", url])).toMatchObject({ status: "settled" });
      const messages: Array<{ kind: string; text?: string; from?: { botId: string }; tool?: { name: string; ok: boolean } }> = (await api("GET", `/api/threads/${group.threadId}/messages?limit=100`)).body.messages;
      return {
        replies: messages.filter((message) => message.kind === "text" && message.from?.botId === bot.id).length,
        notes: messages.filter((message) => message.kind === "activity" && message.from?.botId === bot.id && message.tool?.ok === false).map((message) => message.tool!.name),
      };
    };
    expect(await room("Pitch the cold open.")).toEqual({ replies: 1, notes: [] });
    expect(fixture.told().systemPrompt).toContain("Inside .magic-team, change only that folder.");

    const archivedLine = "Writer takes no new work because its project is archived. Restore the project in Settings → Data, then try again.";
    project({ folder: projectFolder, archivedAt: 1_800_000_000_000 });
    expect(await api("POST", `/api/bots/${bot.id}/messages`, { text: "One more scene?" })).toMatchObject({ status: 409, body: { error: archivedLine, code: "bot_held" } });
    expect(await room("One more scene?")).toEqual({ replies: 1, notes: [archivedLine] });
    expect(await room("Anyone?"), "the room hears why once, not at every message").toEqual({ replies: 1, notes: [archivedLine] });

    project(null);
    expect(await api("POST", `/api/bots/${bot.id}/messages`, { text: "One more scene?" })).toMatchObject({
      status: 409,
      body: { error: "Writer can't work right now: MagicBot has no record of its project. Restore projects.json in MagicBot's data folder from a backup, then try again.", code: "bot_held" },
    });

    project({ folder: projectFolder });
    expect((await api("DELETE", `/api/bots/${bot.id}`)).status).toBe(200);
    const ownFolders = join(projectFolder, ".magic-team", "bots");
    const aside = readdirSync(join(ownFolders, ".deleted"));
    expect(aside, "a deleted bot's folder is moved aside in the project, not removed").toEqual([expect.stringMatching(/^writer-\d{8}T\d{6}Z$/)]);
    expect(readFileSync(join(ownFolders, ".deleted", aside[0]!, "MEMORY.md"), "utf8")).toContain("The pilot is set in Lisbon");
    expect(readFileSync(join(ownFolders, ".deleted", aside[0]!, "skills", "beat-sheet", "SKILL.md"), "utf8")).toBe(skill);
    expect(readdirSync(ownFolders)).toEqual([".deleted"]);
    expect(existsSync(inData)).toBe(false);
    expect(readFileSync(join(projectFolder, "script.md"), "utf8")).toBe("# Night Shift\n");
  } finally {
    await fixture.close();
  }
}, 180_000);

it.skipIf(process.platform === "win32")("keeps a secret file a person hands to a project bot in the app's data folder, never in the project folder", async () => {
  const canary = `sk_test_PROJECTCANARY${randomBytes(12).toString("hex")}`;
  const fixture = await projectBotServer((scratch) => ({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: join(scratch, "finish"), FAKE_CLAUDE_VERSION: "2.1.270" }));
  const { scratch, projectFolder, dataDir, bot, api } = fixture;
  let proxy: ChildProcess | undefined;
  try {
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Set up Stripe test charges." })).status).toBe(202);
    let agents: { command: string; args: string[]; env: Record<string, string> } | undefined;
    await expect.poll(() => {
      try { agents = fixture.told().mcpConfig.mcpServers.agents; } catch { return false; }
      return Boolean(agents);
    }, { timeout: 15_000 }).toBe(true);
    expect(fixture.told().cwd).toBe(projectFolder);
    proxy = spawn(agents!.command, agents!.args, { env: { PATH: process.env.PATH, HOME: dataDir, ...agents!.env }, stdio: ["pipe", "pipe", "ignore"] });
    const lines = createInterface({ input: proxy.stdout! })[Symbol.asyncIterator]();
    let asked = 0;
    const ask = async (method: string, params: unknown) => {
      const id = ++asked;
      proxy!.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      for (;;) {
        const message = JSON.parse((await lines.next()).value as string);
        if (message.id === id) return message.result;
      }
    };
    const request = async () => String((await ask("tools/call", {
      name: "request_credential", arguments: { label: "Stripe secret key", reason: "To create test charges.", placeholder: "sk_test_…", delivery: "file" },
    })).content?.[0]?.text ?? "");
    await ask("initialize", { protocolVersion: "2024-11-05" });

    expect(await request()).toMatch(/^A secure card for Stripe secret key is now in this conversation/u);
    const card = ((await api("GET", `/api/threads/${bot.threadId}/messages`)).body.messages as Array<{ id: string; kind: string }>).filter((message) => message.kind === "secret").at(-1)!;
    expect(await api("POST", `/api/bots/${bot.id}/secret-cards/${card.id}/save`, { threadId: bot.threadId, value: canary })).toMatchObject({ status: 200, body: { provided: true } });

    const secrets = join(dataDir, "workspaces", bot.id, ".magicbot-secrets");
    expect(readFileSync(join(secrets, bot.threadId, card.id), "utf8")).toBe(canary);
    const again = await request();
    const handed = /saved Stripe secret key to the file (\S+vault-[\w-]+)\./u.exec(again)?.[1] ?? "";
    expect(handed.startsWith(secrets + sep), again).toBe(true);
    expect(readFileSync(handed, "utf8")).toBe(canary);
    expect(filesHolding(projectFolder, canary), "nothing of it reaches the project folder").toEqual([]);
    expect(filesHolding(dataDir, canary)).toEqual([relative(dataDir, join(secrets, bot.threadId, card.id)), relative(dataDir, handed)].sort());

    writeFileSync(join(scratch, "finish"), "");
    expect(await fixture.settled()).toMatchObject({ target: { busy: false, activity: "idle" } });
    expect(filesHolding(projectFolder, canary)).toEqual([]);
    expect(tree(join(projectFolder, ".magic-team")).filter((path) => !path.startsWith("bots/writer/"))).toEqual(["bots/"]);
  } finally {
    proxy?.kill();
    await fixture.close();
  }
}, 120_000);
