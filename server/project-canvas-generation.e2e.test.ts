// A project's canvas generating through the project's generation, on a real server with the scripted fake engine and
// generation's test MCP server. Nothing here reaches the user's data or port 8799.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CanvasNode, CanvasSnapshot } from "../shared/project-canvas.ts";
import type { GenerationJob } from "../shared/project-generation.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { startFakeGenerationMcp } from "./testing/fake-generation-mcp-server.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { GENERATION_KEY } from "./testing/project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";
import { ownTurnText } from "./testing/room-handoff-agent.ts";

const TEAM = "Canvas generation crew";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type Line = { id: string; role?: string; kind?: string; text?: string; card?: any };
type Turn = { botId: string; planKey?: string; unplanned?: boolean; prompt: unknown; evidence: any[] };

const keep = (name: string, value: unknown) => {
  if (evidenceDir) writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

const take = (n: number) => ({ type: "add_node", id: `take-${n}`, nodeType: "shot", title: `镜头 ${n}`, metadata: { prompt: `Take ${n}: the bride turns to the camera` } });
const generate = (n: number) => ({ tool: "canvas_generate", arguments: { node_id: `take-${n}` } });

/** No catch-all entry: a turn of the writer that nothing here expects fails loudly. */
const script = [
  { key: "past", match: ["PAST-THE-CEILING"], reply: "ASKED FOR THE FOURTH", steps: [
    { tool: "canvas_apply_ops", arguments: { ops: [1, 2, 3, 4, 5].map(take) } },
    generate(1), generate(2), generate(3), generate(4), generate(4),
  ] },
  { key: "confirmed", match: ["MagicBot generation decision", "the person confirmed"], reply: "HEARD CONFIRM" },
  { key: "fifth", match: ["ONE-MORE"], reply: "ASKED FOR THE FIFTH", steps: [generate(5)] },
  { key: "declined", match: ["MagicBot generation decision", "the person declined"], reply: "HEARD DECLINE" },
];

describe("generating on a project's canvas", () => {
  let server: RestartableServer;
  let fake: Awaited<ReturnType<typeof startFakeGenerationMcp>>;
  let root: string;
  let project: TeamProjectWire;
  let writer: Bot;
  let starts = 1;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  /** Another suite's server can take the port between the fixture's probe and its own listen, and answer its health check. */
  const ownServerListening = async () => {
    const deadline = Date.now() + 30_000;
    while (readFileSync(server.logPath, "utf8").split(`openmausbot server on ${server.url}\n`).length - 1 < starts) {
      if (Date.now() > deadline) throw new Error(`something answered on ${server.url}, but this fixture's server never listened there; see ${server.logPath}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  const canvasPath = () => `/api/team-projects/${project.id}/canvas`;
  const canvas = async (): Promise<CanvasSnapshot> => {
    const read = await api("GET", canvasPath());
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    return read.body;
  };
  const node = async (id: string) => (await canvas()).nodes.find((one) => one.id === id)!;
  const addNodes = async (...ops: unknown[]) => {
    const added = await api("POST", `${canvasPath()}/ops`, { baseRevision: (await canvas()).revision, ops });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
  };
  const generateNode = (nodeId: string) => api("POST", `${canvasPath()}/generate`, { nodeId });
  const settledNode = async (id: string) => {
    await expect.poll(async () => (await node(id)).metadata?.status, { timeout: 60_000 }).toMatch(/^(success|error|idle)$/);
    return node(id);
  };
  /** The nodes connected from `id`, as the canvas has them. */
  const results = async (id: string): Promise<CanvasNode[]> => {
    const read = await canvas();
    const to = new Set(read.connections.filter((one) => one.fromNodeId === id && one.kind === "content").map((one) => one.toNodeId));
    return read.nodes.filter((one) => to.has(one.id));
  };
  const onDisk = (path: string) => existsSync(join(project.folder, ...path.split("/")));
  const jobs = async () => (await api("GET", `/api/team-projects/${project.id}/generation/jobs`)).body.jobs as GenerationJob[];
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as Bot[];
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages`)).body.messages as Line[];
  const cards = async () => (await messages(writer.threadId)).filter((line) => line.card?.canvasGeneration);
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
  const respond = (requestId: string, behavior: "allow" | "deny") => api("POST", `/api/threads/${writer.threadId}/respond`, { requestId, behavior });
  const turns = (): Turn[] => {
    const path = `${server.planPath}.evidence.jsonl`;
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const turnOf = (key: string) => {
    const turn = turns().find((one) => one.botId === writer.id && one.planKey === key);
    expect(turn, `${key} turn of the writer`).toBeDefined();
    return turn!;
  };
  const answers = (turn: Turn) => turn.evidence.filter((item) => item.step).map((item) => {
    const response = item.response as { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: { message: string } };
    return { isError: Boolean(response.result?.isError || response.error), text: response.error?.message ?? response.result!.content.map((part) => part.text).join("\n") };
  });
  const waitingTurns = () => {
    const path = join(server.dataDir, "runtime.db");
    if (!existsSync(path)) return [];
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return (db.prepare("SELECT json FROM assignments ORDER BY created_at, id").all() as Array<{ json: string }>).map((row) => JSON.parse(row.json))
        .filter((one) => one.status === "needs_input" && one.assignee.destination.threadId === writer.threadId).map((one) => one.cards as string[]);
    } finally { db.close(); }
  };

  beforeAll(async () => {
    fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 2_000 });
    server = await launchRestartableServer({ scripted: true });
    await ownServerListening();
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-generation-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const member = async (name: string) => {
      const made = await api("POST", "/api/bots", { name, section: TEAM });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      return made.body.bot as Bot;
    };
    const director = await member("Director");
    await member("Writer");
    expect((await api("PATCH", `/api/bots/${director.id}`, { chiefOfStaff: true })).status).toBe(200);
    await settled();
    const made = await api("POST", "/api/team-projects", { name: "Generated drama", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
    writer = (await bots()).find((one) => project.botIds.includes(one.id) && one.id !== project.leadBotId)!;
    expect(writer).toBeTruthy();
    writeFileSync(server.planPath, JSON.stringify({ [writer.id]: { script } }));
    expect((await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } })).status).toBe(201);
    expect((await api("PATCH", "/api/mcp/servers/gen", { enabled: true })).status).toBe(200);
    const saved = await api("PUT", `/api/team-projects/${project.id}/generation/settings`, { image: IMAGE, video: VIDEO });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    keep("00-fixture.json", { url: server.url, dataDir: server.dataDir, logPath: server.logPath, projectFolder: project.folder, mcpServer: fake.url });
    await settled();
  }, hostTimeout(120_000));

  afterAll(async () => {
    keep("99-mcp-calls.json", fake?.calls);
    await server?.close();
    await fake?.close();
    if (root) await removeTempDir(root);
  });

  it("puts what a person's generate makes to the right of its node, connected from it, with its files in 产出/图片 and 产出/视频", async () => {
    await addNodes(
      { type: "add_node", id: "poster", nodeType: "image", title: "海报", metadata: { prompt: "A lighthouse at dusk", settings: { count: 2 } } },
      { type: "add_node", id: "opening", nodeType: "shot", title: "开场", metadata: { prompt: "Waves against the lighthouse" } },
    );
    const poster = await generateNode("poster");
    expect(poster).toEqual({ status: 202, body: { jobId: expect.any(String) } });
    const opening = await generateNode("opening");
    expect(opening.status).toBe(202);

    const image = await settledNode("poster");
    const video = await settledNode("opening");
    expect(image.metadata).toMatchObject({ status: "success", jobId: poster.body.jobId });
    expect(video.metadata).toMatchObject({ status: "success", jobId: opening.body.jobId });
    const pictures = await results("poster");
    expect(pictures.map((one) => [one.type, one.metadata?.file?.path])).toEqual([
      ["image", expect.stringMatching(/^产出\/图片\/海报-.+-1\.png$/)], ["image", expect.stringMatching(/^产出\/图片\/海报-.+-2\.png$/)],
    ]);
    expect(pictures.map((one) => one.position.x)).toEqual([image.position.x + image.width + 80, image.position.x + image.width + 80]);
    const films = await results("opening");
    expect(films.map((one) => [one.type, one.metadata?.file?.path])).toEqual([["video", expect.stringMatching(/^产出\/视频\/开场-.+\.mp4$/)]]);
    for (const one of [...pictures, ...films]) {
      expect(onDisk(one.metadata!.file!.path), one.metadata!.file!.path).toBe(true);
      expect(one.createdBy).toEqual({ kind: "person" });
    }
    const started = (await jobs()).filter((job) => job.nodeId === "poster" || job.nodeId === "opening");
    expect(started.map((job) => [job.nodeId, job.kind, job.requester])).toEqual(expect.arrayContaining([["poster", "image", { kind: "person" }], ["opening", "video", { kind: "person" }]]));
    keep("01-person-generates.json", { poster: poster.body, opening: opening.body, nodes: { image, video }, pictures, films, jobs: started });
  }, hostTimeout(90_000));

  it("answers generation's refusal in its own words and keys, and shows a failed job on its node", async () => {
    await addNodes(
      { type: "add_node", id: "wide", nodeType: "image", title: "Wide", metadata: { prompt: "A wide sea", settings: { aspect: "21:9" } } },
      { type: "add_node", id: "storm", nodeType: "shot", title: "Storm", metadata: { prompt: "A storm [fail:the model is overloaded]" } },
    );
    const refused = await generateNode("wide");
    expect(refused).toEqual({ status: 422, body: expect.objectContaining({
      code: "setting_refused", error: "Pixel 1 doesn't make the shape 21:9. It makes 1:1, 16:9, 9:16.", errorKey: expect.stringMatching(/^serverError\.projectGeneration\./),
    }) });
    expect((await node("wide")).metadata).toEqual({ prompt: "A wide sea", settings: { aspect: "21:9" } });

    expect((await generateNode("storm")).status).toBe(202);
    const failed = await settledNode("storm");
    expect(failed.metadata).toMatchObject({ status: "error", errorDetails: "gen couldn't make it: the model is overloaded" });
    expect(await results("storm")).toEqual([]);
    keep("02-refused-and-failed.json", { refused, failed });
  }, hostTimeout(90_000));

  it("finishes a node whose job was running when the server restarted", async () => {
    await addNodes({ type: "add_node", id: "held", nodeType: "shot", title: "镜头 H", metadata: { prompt: "A storm over the sea [hold]" } });
    const started = await generateNode("held");
    expect(started.status).toBe(202);
    await expect.poll(async () => (await jobs()).find((job) => job.id === started.body.jobId)?.taskId, { timeout: 30_000 }).toBeTruthy();
    const before = await node("held");
    expect(before.metadata).toEqual({ prompt: "A storm over the sea [hold]", status: "loading", jobId: started.body.jobId });
    await server.stop();
    await server.start();
    starts += 1;
    await ownServerListening();
    const after = await node("held");
    expect(after.metadata).toMatchObject({ status: "loading", jobId: started.body.jobId });

    fake.release();
    const finished = await settledNode("held");
    expect(finished.metadata).toMatchObject({ status: "success", jobId: started.body.jobId });
    const made = await results("held");
    expect(made.map((one) => [one.type, one.metadata?.file?.path])).toEqual([["video", expect.stringMatching(/^产出\/视频\/镜头 H-.+\.mp4$/)]]);
    expect(onDisk(made[0]!.metadata!.file!.path)).toBe(true);
    keep("03-across-a-restart.json", { started: started.body, before, afterRestart: after, finished, made });
  }, hostTimeout(120_000));

  it("asks the person on a card once a bot is past its ceiling: Confirm runs the job, and the bot hears it", async () => {
    await say(writer, "PAST-THE-CEILING");
    await said(writer.threadId, "ASKED FOR THE FOURTH");
    const [card] = await cards();
    expect(card).toMatchObject({ kind: "options", card: {
      title: "Generate “镜头 4”?", subtitle: "A bot may start 3 videos a day without you, and this one has started 3. Confirm to let it make 1 more.",
      options: ["Confirm", "Cancel"], tool: "canvas_generate", fixedOptions: true,
      canvasGeneration: { projectId: project.id, nodeId: "take-4", title: "镜头 4", botId: writer.id, threadId: writer.threadId, reasonKey: "serverError.projectGeneration.confirmVideos", reasonParams: { ceiling: 3, used: 3, asked: 1 } },
    } });
    const told = answers(turnOf("past"));
    expect(told.map((one) => one.isError)).toEqual([false, false, false, false, false, false]);
    expect(told.slice(1, 4).map((one) => one.text)).toEqual([1, 2, 3].map(() => expect.stringMatching(/^Generation of take-\d started \(job [^)]+\)/)));
    expect(told[4]!.text).toMatch(/^A bot may start 3 videos a day without you, .+ A card now asks the person to confirm it, and nothing is generated until they press Confirm\./);
    expect(told[5]!.text).toMatch(/^A card already asks the person to confirm generating this node\./);
    expect(await cards()).toHaveLength(1);
    expect((await node("take-4")).metadata).toEqual({ prompt: "Take 4: the bride turns to the camera" });
    const asking = await canvas();
    expect(asking.bots[writer.id]).toMatchObject({ status: "waiting", waiting: { threadId: writer.threadId, messageId: card!.id, card: { canvasGeneration: { nodeId: "take-4" } } } });
    await expect.poll(waitingTurns, { timeout: 15_000 }).toEqual([[card!.id]]);
    const byTheBot = (await jobs()).filter((job) => job.requester.kind === "bot");
    expect(byTheBot.map((job) => [job.nodeId, job.requester])).toEqual(expect.arrayContaining([1, 2, 3].map((n) => [`take-${n}`, { kind: "bot", botId: writer.id }])));
    expect(byTheBot).toHaveLength(3);

    expect(await respond(card!.card.requestId, "allow")).toEqual({ status: 200, body: { ok: true, outcome: "allowed-once" } });
    await said(writer.threadId, "HEARD CONFIRM");
    const confirmed = (await jobs()).find((job) => job.nodeId === "take-4")!;
    expect(confirmed.requester).toEqual({ kind: "bot", botId: writer.id, confirmed: true });
    expect(ownTurnText(turnOf("confirmed").prompt)).toContain(`MagicBot generation decision ${card!.card.requestId}: the person confirmed, and the generation of "镜头 4" (take-4) started (job ${confirmed.id}).`);
    const settled = (await cards())[0]!;
    expect(settled.card).toMatchObject({ answered: "allow", canvasGeneration: { result: { state: "started", jobId: confirmed.id }, resumed: true } });
    const done = await settledNode("take-4");
    expect(done.metadata).toMatchObject({ status: "success", jobId: confirmed.id });
    expect((await results("take-4")).map((one) => one.metadata?.file?.path)).toEqual([expect.stringMatching(/^产出\/视频\/镜头 4-.+\.mp4$/)]);
    await idle();
    expect(waitingTurns()).toEqual([]);
    expect((await canvas()).bots[writer.id]!.waiting).toBeUndefined();
    keep("04-bot-past-its-ceiling-confirmed.json", { card, toolAnswers: told, waitingOnTheCanvas: asking.bots[writer.id], confirmed, settled: settled.card, done });
  }, hostTimeout(120_000));

  it("generates nothing when the person cancels the card, leaves the node as it was, and the bot hears it", async () => {
    const before = await node("take-5");
    await say(writer, "ONE-MORE");
    await said(writer.threadId, "ASKED FOR THE FIFTH");
    const card = (await cards()).at(-1)!;
    expect(card.card).toMatchObject({ title: "Generate “镜头 5”?", canvasGeneration: { nodeId: "take-5" } });
    await expect.poll(waitingTurns, { timeout: 15_000 }).toEqual([[card.id]]);

    expect(await respond(card.card.requestId, "deny")).toEqual({ status: 200, body: { ok: true, outcome: "rejected" } });
    await said(writer.threadId, "HEARD DECLINE");
    expect(ownTurnText(turnOf("declined").prompt)).toContain(`MagicBot generation decision ${card.card.requestId}: the person declined generating "镜头 5" (take-5), so nothing was generated and the node is as it was.`);
    expect((await cards()).at(-1)!.card).toMatchObject({ answered: "deny", canvasGeneration: { result: { state: "declined" }, resumed: true } });
    expect((await jobs()).filter((job) => job.nodeId === "take-5")).toEqual([]);
    expect(await node("take-5")).toEqual(before);
    await idle();
    expect(waitingTurns()).toEqual([]);
    expect(turns().filter((turn) => turn.unplanned).map((turn) => ownTurnText(turn.prompt).slice(0, 200))).toEqual([]);
    keep("05-bot-past-its-ceiling-declined.json", { card, before, after: await node("take-5"), mcpGenerateCalls: fake.calls.filter((call) => String(call.arguments.prompt ?? "").includes("Take 5")) });
  }, hostTimeout(90_000));
});
