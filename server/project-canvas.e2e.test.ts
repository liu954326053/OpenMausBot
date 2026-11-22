// A project's canvas on a real server with the scripted fake engine: a project made from a team, its bots' nodes and
// statuses, their replies, their tools through each turn's own agents server, attach_file, uploads and files, a task
// with what is connected to a bot, revisions and live events. Nothing here reaches the user's data or port 8799.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { botNodeId, dispatchConnectionId, type CanvasNode, type CanvasSnapshot, type ProjectCanvasEvent } from "../shared/project-canvas.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";
import { openSse, type SseRecorder } from "./testing/sse.ts";

const TEAM = "Canvas crew";
const SECRET = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

type Bot = { id: string; name: string; title?: string; threadId: string; busy?: boolean };
type Line = { id: string; role?: string; kind?: string; text?: string };
type Turn = { botId: string; planKey?: string; prompt: unknown; evidence: any[] };

/** A valid one-pixel PNG of one red level, so two of them differ. */
function png(red: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, red, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
}

const keep = (name: string, value: unknown) => {
  if (evidenceDir) writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

describe("a project's canvas", () => {
  let server: RestartableServer;
  let root: string;
  let outside: string;
  let events: SseRecorder;
  let project: TeamProjectWire;
  let lead: Bot;
  let writer: Bot;
  let brief: string;
  let reference: string;
  const gate = () => join(server.dataDir, "gate-writer");

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const canvasPath = () => `/api/team-projects/${project.id}/canvas`;
  const canvas = async (): Promise<CanvasSnapshot> => {
    const read = await api("GET", canvasPath());
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    return read.body;
  };
  const ops = (body: unknown) => api("POST", `${canvasPath()}/ops`, body);
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as Bot[];
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages`)).body.messages as Line[];
  const say = async (to: Bot, text: string) => {
    const sent = await api("POST", `/api/bots/${to.id}/messages`, { text, threadId: to.threadId, sendId: crypto.randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
  };
  const said = (threadId: string, text: string) => expect.poll(async () => (await messages(threadId)).some((line) => line.text === text), { timeout: 30_000 }).toBe(true);
  const idle = () => expect.poll(async () => (await bots()).some((one) => one.busy), { timeout: 30_000 }).toBe(false);
  const settled = async () => {
    const until = Date.now() + 30_000;
    while ((await bots()).some((one) => one.busy)) {
      if (Date.now() > until) throw new Error("a bot is still at work");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const turns = (): Turn[] => {
    const path = `${server.planPath}.evidence.jsonl`;
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const turnOf = (botId: string, key: string) => {
    const turn = turns().find((one) => one.botId === botId && one.planKey === key);
    expect(turn, `${key} turn of ${botId}`).toBeDefined();
    return turn!;
  };
  const answer = (turn: Turn, index: number) => {
    const response = turn.evidence.filter((item) => item.step)[index].response as { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: { message: string } };
    return { isError: Boolean(response.result?.isError || response.error), text: response.error?.message ?? response.result!.content.map((part) => part.text).join("\n") };
  };
  const canvasEvents = (): ProjectCanvasEvent[] => events.frames.filter((frame) => frame.kind === "project-canvas" && frame.projectId === project.id);
  const plan = (script: unknown[]) => writeFileSync(server.planPath, JSON.stringify({ [writer.id]: { script } }));
  const upload = async (name: string, bytes: Buffer, at = "") => {
    const response = await fetch(`${server.url}${canvasPath()}/files?name=${encodeURIComponent(name)}${at}`, {
      method: "POST", headers: { origin: server.url, "content-type": "application/octet-stream" }, body: new Uint8Array(bytes),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const served = async (path: string) => {
    const response = await fetch(`${server.url}${canvasPath()}/files?path=${encodeURIComponent(path)}`, { headers: { origin: server.url } });
    const headers = Object.fromEntries(["content-type", "content-disposition", "x-content-type-options", "content-security-policy", "cross-origin-resource-policy"].map((name) => [name, response.headers.get(name)]));
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers, body };
  };

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-canvas-")));
    outside = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-canvas-outside-")));
    events = await openSse(`${server.url}/api/events`, { origin: server.url });
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const member = async (name: string, title: string) => {
      const made = await api("POST", "/api/bots", { name, section: TEAM });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      expect((await api("PATCH", `/api/bots/${made.body.bot.id}`, { title })).status).toBe(200);
      return made.body.bot as Bot;
    };
    const director = await member("Director", "Runs the production");
    await member("Writer", "Writes the episodes");
    expect((await api("PATCH", `/api/bots/${director.id}`, { chiefOfStaff: true })).status).toBe(200);
    await settled();
    const made = await api("POST", "/api/team-projects", { name: "Canvas drama", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
    const all = await bots();
    lead = all.find((one) => one.id === project.leadBotId)!;
    writer = all.find((one) => project.botIds.includes(one.id) && one.id !== project.leadBotId)!;
    expect(lead && writer).toBeTruthy();
    await settled();
  }, hostTimeout(90_000));

  afterAll(async () => {
    events?.close();
    await server?.close();
    if (root) await removeTempDir(root);
    if (outside) await removeTempDir(outside);
  });

  it("shows every bot of a project made from a team, the lead above the others, all idle", async () => {
    const snapshot = await canvas();
    keep("01-snapshot-of-a-new-project.json", snapshot);
    expect(snapshot.project).toEqual({ id: project.id, name: "Canvas drama", leadBotId: lead.id, archived: false, folderState: "ready" });
    expect(snapshot.nodes.map((node) => node.id)).toEqual(project.botIds.map(botNodeId));
    expect(snapshot.bots[lead.id]).toMatchObject({ botId: lead.id, name: lead.name, lead: true, stages: ["lead"], status: "idle", placed: false });
    expect(snapshot.bots[writer.id]).toMatchObject({ botId: writer.id, name: writer.name, title: "Writes the episodes", lead: false, stages: ["other"], status: "idle", placed: false });
    expect(snapshot.connections).toEqual([{ id: dispatchConnectionId(lead.id, writer.id), fromNodeId: botNodeId(lead.id), toNodeId: botNodeId(writer.id), kind: "dispatch" }]);
    const [leadNode, writerNode] = snapshot.nodes;
    expect(writerNode!.position.x).toBe(leadNode!.position.x);
    expect(writerNode!.position.y).toBeGreaterThan(leadNode!.position.y);
  });

  it("shows a bot at work, then its reply as its node's output with the secret in it redacted, and tells open apps", async () => {
    plan([{ key: "draft", match: ["WRITE-DRAFT"], gateFile: gate(), reply: `Draft ready. Key ${SECRET}` }]);
    await say(writer, "WRITE-DRAFT");
    await expect.poll(async () => (await canvas()).bots[writer.id]!.status, { timeout: 30_000 }).toBe("working");
    const working = (await canvas()).bots[writer.id];
    const told = await events.until((frame) => frame.kind === "project-canvas" && frame.projectId === project.id && frame.reason === "bots", 10_000);
    writeFileSync(gate(), "go");
    await idle();
    await expect.poll(async () => (await canvas()).bots[writer.id]!.output?.text ?? "", { timeout: 30_000 }).toContain("Draft ready.");
    const after = (await canvas()).bots[writer.id]!;
    keep("02-reply-as-output-redacted.json", { working, event: told, after });
    expect(after.status).toBe("idle");
    expect(after.output!.text).not.toContain(SECRET);
    expect(after.output!.text).toMatch(/^Draft ready\. Key .*redacted/);
    const reply = (await messages(writer.threadId)).filter((line) => line.role === "bot" && line.kind === "text" && line.text).at(-1)!;
    expect(after.output).toMatchObject({ threadId: writer.threadId, messageId: reply.id });
  }, hostTimeout(60_000));

  it("lets a bot add a shot in its lane, connected from it, and refuses it a node the person made", async () => {
    const before = await canvas();
    const added = await ops({ baseRevision: before.revision, ops: [{ type: "add_node", nodeType: "text", title: "Brief", metadata: { content: "Episode one: the bride is swapped at the altar." } }] });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    brief = added.body.nodeIds[0];
    await events.until((frame) => frame.kind === "project-canvas" && frame.reason === "document" && frame.revision === added.body.revision, 10_000);
    plan([{ key: "shot", match: ["ADD-SHOT"], reply: "SHOT ADDED", steps: [
      { tool: "canvas_get_state", arguments: {} },
      { tool: "canvas_apply_ops", arguments: { ops: [{ type: "add_node", nodeType: "shot", title: "Opening shot", metadata: { prompt: "A bride alone at the altar as the groom turns away" } }] }, capture: { shot: '"nodeIds":\\["([^"]+)"' } },
      { tool: "canvas_apply_ops", arguments: { ops: [{ type: "update_node", id: brief, patch: { title: "Mine now" } }] }, expectError: true },
      { tool: "canvas_apply_ops", arguments: { ops: [{ type: "delete_node", id: brief }] }, expectError: true },
      { tool: "canvas_get_state", arguments: { connected: true } },
      { tool: "canvas_generate", arguments: { node_id: "{{shot}}" }, expectError: true },
    ] }]);
    await say(writer, "ADD-SHOT");
    await said(writer.threadId, "SHOT ADDED");
    await idle();
    const turn = turnOf(writer.id, "shot");
    const read = answer(turn, 0);
    expect(JSON.parse(read.text)).toMatchObject({ you: botNodeId(writer.id), bots: expect.arrayContaining([expect.objectContaining({ id: botNodeId(writer.id), status: "working" })]) });
    expect(read.text).toContain("Episode one");
    expect(read.text).not.toContain("Draft ready");
    const shotId = JSON.parse(answer(turn, 1).text).nodeIds[0] as string;
    expect(answer(turn, 2)).toEqual({ isError: true, text: expect.stringMatching(/was not put there by you|only nodes you made|not yours/i) });
    expect(answer(turn, 3).isError).toBe(true);
    expect(JSON.parse(answer(turn, 4).text).nodes.map((node: CanvasNode) => node.id)).toEqual([shotId]);
    expect(answer(turn, 5)).toEqual({ isError: true, text: "Choose an MCP server for videos in this project's settings first." });
    const after = await canvas();
    keep("03-bot-adds-a-shot-and-is-refused.json", { tools: turn.evidence.filter((item) => item.step).map((item) => ({ step: item.step, response: item.response })), nodes: after.nodes, connections: after.connections, bots: after.bots });
    const shot = after.nodes.find((node) => node.id === shotId)!;
    const own = after.nodes.find((node) => node.id === botNodeId(writer.id))!;
    expect(shot).toMatchObject({ type: "shot", title: "Opening shot", createdBy: { kind: "bot", botId: writer.id }, metadata: { prompt: "A bride alone at the altar as the groom turns away" } });
    expect(shot.metadata?.status).toBeUndefined();
    expect(shot.position.x).toBe(own.position.x + own.width + 80);
    expect(shot.position.y).toBeGreaterThanOrEqual(own.position.y);
    const overlaps = (a: CanvasNode, b: CanvasNode) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
    expect(after.nodes.filter((node) => node.id !== shot.id && overlaps(node, shot))).toEqual([]);
    expect(after.connections).toContainEqual(expect.objectContaining({ fromNodeId: botNodeId(writer.id), toNodeId: shotId, kind: "content" }));
    expect(after.bots[writer.id]!.placed).toBe(true);
    expect(after.nodes.find((node) => node.id === brief)).toMatchObject({ title: "Brief", createdBy: { kind: "person" } });
  }, hostTimeout(60_000));

  it("makes one node of a file a bot attaches, and none for the same file again", async () => {
    writeFileSync(join(project.folder, "poster.png"), png(10));
    const own = join(project.folder, ".magic-team", "bots");
    for (const role of readdirSync(own)) writeFileSync(join(own, role, "draft.png"), png(200));
    const poster = join(project.folder, "poster.png");
    plan([{ key: "attach", match: ["ATTACH"], reply: "ATTACHED", steps: [
      { tool: "attach_file", arguments: { path: poster } },
      { tool: "attach_file", arguments: { path: poster } },
      { tool: "attach_file", arguments: { path: "draft.png" } },
      { tool: "attach_file", arguments: { path: "draft.png" } },
    ] }]);
    await say(writer, "ATTACH");
    await said(writer.threadId, "ATTACHED");
    await idle();
    const files = async () => (await canvas()).nodes.filter((node) => node.metadata?.file);
    await expect.poll(async () => (await files()).map((node) => node.metadata!.file!.path).sort(), { timeout: 15_000 }).toEqual(["poster.png", "产出/draft.png"]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const after = await canvas();
    const made = after.nodes.filter((node) => node.metadata?.file);
    keep("04-attach-file-once.json", { attached: turnOf(writer.id, "attach").evidence.filter((item) => item.step).map((item) => item.response), fileNodes: made, connections: after.connections.filter((one) => made.some((node) => node.id === one.toNodeId)) });
    expect(made).toHaveLength(2);
    for (const node of made) {
      expect(node).toMatchObject({ type: "image", createdBy: { kind: "bot", botId: writer.id } });
      expect(after.connections).toContainEqual(expect.objectContaining({ fromNodeId: botNodeId(writer.id), toNodeId: node.id, kind: "content" }));
    }
    expect(readFileSync(join(project.folder, "产出", "draft.png"))).toEqual(png(200));
    expect(readdirSync(join(project.folder, "产出"))).toEqual(["draft.png"]);
  }, hostTimeout(60_000));

  it("puts an upload in 素材 as a node, serves only files in the project folder, and images only inline", async () => {
    const first = await upload("reference.png", png(90), "&x=40&y=900");
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.file).toEqual({ path: "素材/reference.png", mime: "image/png", bytes: png(90).length, name: "reference.png" });
    reference = first.body.nodeId;
    const again = await upload("reference.png", png(91));
    const escaping = await upload("../../escape.png", png(92));
    expect(again.body.file.path).toBe("素材/reference-2.png");
    expect(escaping.status, JSON.stringify(escaping.body)).toBe(201);
    expect(escaping.body.file.path).toMatch(/^素材\/[^/]+\.png$/);
    expect(readFileSync(join(project.folder, "素材", "reference.png"))).toEqual(png(90));
    expect(existsSync(join(root, "escape.png"))).toBe(false);
    const node = (await canvas()).nodes.find((one) => one.id === reference)!;
    expect(node).toMatchObject({ type: "image", position: { x: 40, y: 900 }, createdBy: { kind: "person" }, metadata: { file: { path: "素材/reference.png" } } });

    writeFileSync(join(outside, "secret.txt"), "outside the project");
    symlinkSync(join(outside, "secret.txt"), join(project.folder, "link-out.txt"));
    const role = readdirSync(join(project.folder, ".magic-team", "bots"))[0]!;
    symlinkSync(join(project.folder, ".magic-team", "bots", role, "draft.png"), join(project.folder, "peek.png"));
    writeFileSync(join(project.folder, "page.html"), "<script>alert(1)</script>");
    mkdirSync(join(project.folder, "notes"), { recursive: true });
    const image = await served("素材/reference.png");
    const page = await served("page.html");
    const refused = {
      parent: await served(`../${outside.split("/").at(-1)}/secret.txt`),
      absolute: await served(join(outside, "secret.txt")),
      linkOut: await served("link-out.txt"),
      appFolder: await served(`.magic-team/bots/${role}/draft.png`),
      linkIntoAppFolder: await served("peek.png"),
      folder: await served("notes"),
      missing: await served("nope.png"),
    };
    keep("05-upload-and-serving.json", {
      uploads: [first.body, again.body, escaping.body],
      image: { status: image.status, headers: image.headers, bytes: image.body.length },
      page: { status: page.status, headers: page.headers },
      refused: Object.fromEntries(Object.entries(refused).map(([name, answer]) => [name, { status: answer.status, body: answer.body.toString("utf8") }])),
    });
    expect(image).toMatchObject({ status: 200, headers: { "content-type": "image/png", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });
    expect(image.headers["content-disposition"]).toMatch(/^inline/);
    expect(image.body).toEqual(png(90));
    expect(page.headers).toMatchObject({ "content-type": "application/octet-stream", "content-security-policy": "default-src 'none'; sandbox" });
    expect(page.headers["content-disposition"]).toMatch(/^attachment/);
    expect(refused.parent.status).toBe(400);
    expect(refused.absolute.status).toBe(400);
    expect(refused.linkOut.status).toBe(403);
    expect(refused.appFolder.status).toBe(400);
    expect(refused.linkIntoAppFolder.status).toBe(403);
    expect(refused.folder.status).toBe(404);
    expect(refused.missing.status).toBe(404);
    for (const answer of Object.values(refused)) {
      expect(answer.body.toString("utf8")).not.toContain("outside the project");
      expect(answer.body.includes(png(200))).toBe(false);
    }
  });

  it("sends a bot a task with what is connected into its node", async () => {
    const connected = await ops({ ops: [
      { type: "connect_nodes", fromNodeId: brief, toNodeId: botNodeId(writer.id) },
      { type: "connect_nodes", fromNodeId: reference, toNodeId: botNodeId(writer.id) },
    ] });
    expect(connected.status, JSON.stringify(connected.body)).toBe(200);
    plan([{ key: "task", match: ["Write the opening scene"], reply: "SCENE WRITTEN" }]);
    const sent = await api("POST", `${canvasPath()}/tasks`, { botId: writer.id, text: "Write the opening scene" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body).toMatchObject({ threadId: writer.threadId, references: 2 });
    await said(writer.threadId, "SCENE WRITTEN");
    await idle();
    const asked = (await messages(writer.threadId)).find((line) => line.id === sent.body.messageId)!;
    const prompt = JSON.stringify(turnOf(writer.id, "task").prompt);
    keep("06-task-with-references.json", { response: sent.body, message: asked, prompt: turnOf(writer.id, "task").prompt });
    expect(asked.text).toMatch(/^Write the opening scene\n\nConnected to your node on the project's canvas:\n\nText 1 "Brief":\n\n> Episode one: the bride is swapped at the altar\.\n\nImage 1 "reference\.png"\n\n<attached-image path="[^"]+" name="reference\.png"\/>$/);
    expect(prompt).toContain("> Episode one: the bride is swapped at the altar.");
    expect(prompt).toContain(`"data":"${png(90).toString("base64")}"`);
  }, hostTimeout(60_000));

  it("merges a change made against an old revision that touches other nodes, and refuses one that touches a changed node", async () => {
    const base = (await canvas()).revision;
    const first = await ops({ baseRevision: base, ops: [{ type: "update_node", id: brief, patch: { title: "Brief, second draft" } }] });
    const merged = await ops({ baseRevision: base, ops: [{ type: "update_node", id: reference, patch: { title: "Reference" } }] });
    const refused = await ops({ baseRevision: base, ops: [{ type: "update_node", id: brief, metadata: { content: "An older idea" } }] });
    const ahead = await ops({ baseRevision: base + 50, ops: [{ type: "update_node", id: reference, patch: { title: "From the future" } }] });
    keep("07-revisions.json", { base, first, merged, refused, ahead });
    expect(first).toMatchObject({ status: 200, body: { revision: base + 1 } });
    expect(merged).toMatchObject({ status: 200, body: { revision: base + 2 } });
    expect(refused).toMatchObject({ status: 409, body: { code: "canvas_conflict", revision: base + 2, changed: { nodes: [brief], connections: [] } } });
    expect(ahead.status).toBe(400);
    const after = await canvas();
    expect(after.nodes.find((node) => node.id === brief)).toMatchObject({ title: "Brief, second draft", metadata: { content: "Episode one: the bride is swapped at the altar." } });
    expect(after.nodes.find((node) => node.id === reference)!.title).toBe("Reference");
  });

  it("reads an archived project's canvas and changes nothing in it", async () => {
    expect((await api("POST", `/api/team-projects/${project.id}/archive`)).status).toBe(200);
    const read = await canvas();
    const refused = await ops({ ops: [{ type: "update_node", id: brief, patch: { title: "Too late" } }] });
    keep("08-archived.json", { readOnly: read.readOnly, project: read.project, refused });
    expect(read).toMatchObject({ readOnly: "archived", project: { archived: true } });
    expect(refused).toMatchObject({ status: 409, body: { code: "canvas_read_only", reason: "archived" } });
    expect((await api("POST", `/api/team-projects/${project.id}/restore`)).status).toBe(200);
  });

  it("told open apps of every change as it happened", () => {
    const told = canvasEvents();
    keep("09-live-events.json", told);
    expect(told.filter((event) => event.reason === "document").map((event) => event.revision)).toEqual([...new Set(told.filter((event) => event.reason === "document").map((event) => event.revision))].sort((a, b) => a - b));
    expect(told.some((event) => event.reason === "bots")).toBe(true);
    for (const event of told) expect(Object.keys(event).filter((key) => key !== "seq").sort()).toEqual(["kind", "projectId", "reason", "revision"]);
  });
});
