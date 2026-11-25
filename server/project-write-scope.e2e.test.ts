// Real isolated server + native Claude permission broker, with the fake engine parked. The "engine" asking for
// permission is this test, writing fake requests to the broker's socket and reading the answers back: no file named
// here is written by anything, and no live data is touched.
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const TEAM = "Lighthouse crew";

it("keeps a project bot's writes in its project folder at Full access, and leaves a bot in no project as it was", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang", OMB_TEST_PORTS: process.env.OMB_TEST_PORTS ?? "8860-8899" });
  const { url, dataDir, logPath } = fixture.info;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-scope-")));
  const sockets: Socket[] = [];
  const api = async (method: string, path: string, body?: unknown, status?: number) => {
    const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    if (status !== undefined) expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    else expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBeLessThan(300);
    return result;
  };
  const messages = async (thread: string): Promise<any[]> => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).messages;
  const card = async (thread: string, id: string) => (await messages(thread)).find(message => message.card?.requestId === id)?.card;
  const decision = async (id: string) => (await api("GET", "/api/decisions")).decisions.filter((row: any) => row.requestId === id);
  const dumpPath = join(dataDir, "fake-claude-dump.json");
  /** Start a turn the fake engine parks; its launch as the CLI saw it. */
  const start = async (bot: { id: string; threadId: string }) => {
    rmSync(dumpPath, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Hold this verification task while its approvals are exercised." }, 202);
    await expect.poll(() => existsSync(dumpPath), { timeout: 15_000 }).toBe(true);
    const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
    return { dump, socket: dump.mcpConfig.mcpServers.ogb.args.at(-1) as string };
  };
  /** One fake permission request, as the engine's broker client sends it. */
  const ask = async (socketPath: string, tool: string, input: Record<string, unknown>) => {
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const id = randomUUID();
    let answer: any;
    let buffer = "";
    const reply = new Promise<any>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("close", () => reject(new Error(`Permission socket closed before its reply: ${id}`)));
      socket.setTimeout(10_000, () => socket.destroy(new Error(`Permission reply timed out: ${id}`)));
      socket.on("data", chunk => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        answer = JSON.parse(buffer.split("\n")[0]!);
        socket.setTimeout(0);
        resolve(answer);
      });
    });
    void reply.catch(() => {});
    const request = { t: "ask", id, tool, input };
    socket.write(JSON.stringify(request) + "\n");
    return { id, request, answer: () => answer, reply };
  };
  const stop = (bot: { id: string; threadId: string }) => api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
  const argValue = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];
  const evidence: Record<string, unknown> = {};
  try {
    await api("PUT", "/api/team-projects/root", { path: root });
    const member = async (name: string) => (await api("POST", "/api/bots", { name, section: TEAM, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).bot as { id: string };
    const lead = await member("Mo");
    await member("Ink");
    await api("PATCH", `/api/bots/${lead.id}`, { chiefOfStaff: true });
    const project = (await api("POST", "/api/team-projects", { name: "Harbour lights", team: TEAM }, 201)).project as { folder: string; leadBotId: string; botIds: string[] };
    const folder = realpathSync(project.folder);
    const writer = (await api("GET", `/api/bots/${project.leadBotId}`)).bot as { id: string; threadId: string };
    expect(project.botIds).toContain(writer.id);
    await api("PATCH", `/api/bots/${writer.id}/tasks/${writer.threadId}`, { approvalMode: "full" });

    const { dump, socket } = await start(writer);
    // Full access still asks the server, and the turn works in the project folder.
    expect(argValue(dump.argv, "--permission-mode")).toBe("default");
    expect(dump.argv).toContain("--permission-prompt-tool");
    expect(realpathSync(dump.cwd)).toBe(folder);
    expect(dump.systemPrompt).toContain(`"projectFolder":${JSON.stringify(project.folder)}`);
    expect(dump.systemPrompt).toContain("A path in a skill's instructions or examples (such as /home/oai/share, /mnt/data or output/) means the same place inside projectFolder");
    evidence.projectLaunch = { permissionMode: argValue(dump.argv, "--permission-mode"), permissionPromptTool: argValue(dump.argv, "--permission-prompt-tool"), cwd: dump.cwd };

    // Inside the project: answered by Full access with nobody asked.
    const inside = await ask(socket, "Write", { file_path: join(folder, "docs", "visual-bible.md"), content: "x" });
    expect(await inside.reply).toMatchObject({ id: inside.id, behavior: "allow" });
    expect(await card(writer.threadId, inside.id)).toBeUndefined();
    await expect.poll(async () => await decision(inside.id)).toEqual([expect.objectContaining({ decision: "auto-approved", source: "full-access" })]);
    // A relative shell write runs in the project folder, so it lands there.
    const relative = await ask(socket, "Bash", { command: "mkdir -p out && echo draft > out/scene-01.md" });
    expect(await relative.reply).toMatchObject({ id: relative.id, behavior: "allow" });
    await expect.poll(async () => await decision(relative.id)).toEqual([expect.objectContaining({ decision: "auto-approved", source: "full-access" })]);
    evidence.inside = { request: inside.request, reply: inside.answer() };
    evidence.relative = { request: relative.request, reply: relative.answer() };

    // Outside it, even at Full access: a card that says why, and no answer until the person gives one.
    const outside = await ask(socket, "Write", { file_path: "/home/oai/share/dao_medical_visual_bible.md", content: "x" });
    await expect.poll(async () => (await card(writer.threadId, outside.id))?.heldCode).toBe("approval.held.outsideProject");
    expect(outside.answer()).toBeUndefined();
    await expect.poll(async () => await decision(outside.id)).toEqual([expect.objectContaining({ decision: "card-shown", source: "project-scope" })]);
    const shown = await card(writer.threadId, outside.id);
    evidence.outside = { request: outside.request, card: { title: shown.title, held: shown.held, heldCode: shown.heldCode }, replyBeforeAnswer: outside.answer() ?? null };
    await api("POST", `/api/threads/${writer.threadId}/respond`, { requestId: outside.id, behavior: "deny" });
    expect(await outside.reply).toMatchObject({ id: outside.id, behavior: "deny" });
    evidence.outsideAfterDeny = outside.answer();

    // Climbing out with .. and a shell redirect into a sibling folder are outside too.
    const climbing = await ask(socket, "Edit", { file_path: join(folder, "..", "escape.md"), old_string: "a", new_string: "b" });
    await expect.poll(async () => (await card(writer.threadId, climbing.id))?.heldCode).toBe("approval.held.outsideProject");
    const redirect = await ask(socket, "Bash", { command: `echo x > ${join(root, "sibling.md")}` });
    await expect.poll(async () => (await card(writer.threadId, redirect.id))?.heldCode).toBe("approval.held.outsideProject");
    // A write whose place a variable decides cannot be read, so it asks too.
    const unknown = await ask(socket, "Bash", { command: 'echo x > "$OUT/x.md"' });
    await expect.poll(async () => (await card(writer.threadId, unknown.id))?.heldCode).toBe("approval.held.outsideProject");
    // Reads are not writes: a read of a file outside the project is answered as before.
    const read = await ask(socket, "Read", { file_path: "/etc/hosts" });
    expect(await read.reply).toMatchObject({ id: read.id, behavior: "allow" });
    for (const held of [climbing, redirect, unknown]) await api("POST", `/api/threads/${writer.threadId}/respond`, { requestId: held.id, behavior: "deny" });
    await stop(writer);

    // A bot in no project: Full access is the engine's own, and a write anywhere is answered as it was.
    const plain = (await api("POST", "/api/bots", { name: "Plain fixture", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot as { id: string; threadId: string };
    await api("PATCH", `/api/bots/${plain.id}/tasks/${plain.threadId}`, { approvalMode: "full" });
    const plainStart = await start(plain);
    expect(argValue(plainStart.dump.argv, "--permission-mode")).toBe("bypassPermissions");
    expect(plainStart.dump.argv).not.toContain("--permission-prompt-tool");
    expect(plainStart.dump.systemPrompt).not.toContain("projectFolder");
    const anywhere = await ask(plainStart.socket, "Write", { file_path: "/home/oai/share/dao_medical_visual_bible.md", content: "x" });
    expect(await anywhere.reply).toMatchObject({ id: anywhere.id, behavior: "allow" });
    await expect.poll(async () => await decision(anywhere.id)).toEqual([expect.objectContaining({ decision: "auto-approved", source: "full-access" })]);
    await stop(plain);
    // At Ask the same write is a card, with no project note.
    await api("PATCH", `/api/bots/${plain.id}/tasks/${plain.threadId}`, { approvalMode: "ask" });
    const plainAsk = await start(plain);
    const asked = await ask(plainAsk.socket, "Write", { file_path: "/home/oai/share/dao_medical_visual_bible.md", content: "x" });
    await expect.poll(async () => Boolean(await card(plain.threadId, asked.id))).toBe(true);
    expect((await card(plain.threadId, asked.id)).heldCode).toBeUndefined();
    await api("POST", `/api/threads/${plain.threadId}/respond`, { requestId: asked.id, behavior: "deny" });
    await stop(plain);
    evidence.plain = { fullPermissionMode: argValue(plainStart.dump.argv, "--permission-mode"), fullReply: anywhere.answer(), askCardHeldCode: null };
    console.info(`Project write scope real-server verification passed; isolated log: ${logPath}\n${JSON.stringify(evidence, null, 2)}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await fixture.close();
    await removeTempDir(root);
  }
}, hostTimeout(180_000));
