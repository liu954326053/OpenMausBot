// A drama's production on a real server with the scripted fake engine and generation's test MCP server: the lead
// plans it once, and from there the script, the characters and scenes, each episode's storyboard, its videos and its
// post follow by themselves, an episode at a time as the project allows. Nothing here reaches the user's data,
// JianYing's own folder or port 8799: the server's home is a temporary folder, and a server the desktop app did not
// start writes no draft.
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProductionWire } from "../shared/production.ts";
import { botNodeId, type CanvasSnapshot } from "../shared/project-canvas.ts";
import type { TeamProjectMembership, TeamProjectWire } from "../shared/team-projects.ts";
import { serverLine } from "./server-lines.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { startFakeGenerationMcp } from "./testing/fake-generation-mcp-server.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { GENERATION_KEY } from "./testing/project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";

const TEAM = "Drama crew";
const LIST = "Characters: Mei, the bride. Scenes: the harbour at night.";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type StoredBot = { id: string; name: string; threadId: string; teamProject?: TeamProjectMembership };
type Line = { id: string; role?: string; kind?: string; text?: string; tool?: { name: string; ok?: boolean }; from?: { botId: string } };
type Room = { id: string; threadId: string; memberIds: string[] };
type Turn = { botId: string; planKey?: string; unplanned?: boolean; evidence: any[] };

const keep = (name: string, value: unknown) => {
  if (evidenceDir) writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
};

const add = (id: string, nodeType: string, title: string, metadata: Record<string, unknown>) => ({ type: "add_node", id, nodeType, title, metadata });
const connect = (fromNodeId: string, toNodeId: string) => ({ type: "connect_nodes", fromNodeId, toNodeId });
const apply = (...ops: unknown[]) => ({ tool: "canvas_apply_ops", arguments: { ops } });
const shot = (id: string, title: string) => add(id, "shot", title, { prompt: `${title}: the bride runs along the water`, shot: { size: "wide", move: "slow push-in", audio: "waves" }, settings: { seconds: 5 } });

describe("a drama's production", () => {
  let server: RestartableServer;
  let fake: Awaited<ReturnType<typeof startFakeGenerationMcp>>;
  let root: string;
  let project: TeamProjectWire;
  const copies: Record<"lead" | "writer" | "faces" | "sets" | "boarder" | "cutter", Bot> = {} as never;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as Bot[];
  const stored = () => JSON.parse(readFileSync(join(server.dataDir, "bots.json"), "utf8")) as StoredBot[];
  const settled = async () => {
    const until = Date.now() + 30_000;
    while ((await bots()).some((one) => one.busy)) {
      if (Date.now() > until) throw new Error("a bot is still at work");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=500`)).body.messages as Line[];
  const canvas = async (): Promise<CanvasSnapshot> => (await api("GET", `/api/team-projects/${project.id}/canvas`)).body;
  const production = async (): Promise<ProductionWire | undefined> => (await canvas()).production;
  const listed = async (): Promise<TeamProjectWire> => ((await api("GET", "/api/team-projects")).body.projects as TeamProjectWire[]).find((one) => one.id === project.id)!;
  const room = (): Room => {
    const groups = JSON.parse(readFileSync(join(server.dataDir, "groups.json"), "utf8")) as Room[] | { groups: Room[] };
    return (Array.isArray(groups) ? groups : groups.groups).find((one) => one.id === project.roomId)!;
  };
  const notesIn = (lines: Line[]) => lines.filter((line) => line.kind === "activity" && line.tool?.name.startsWith("Production:")).map((line) => line.tool!.name);
  const turns = (): Turn[] => {
    const path = `${server.planPath}.evidence.jsonl`;
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const retry = (body: unknown, projectId = project.id) => api("POST", `/api/team-projects/${projectId}/production/retry`, body);

  beforeAll(async () => {
    fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 300 });
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-production-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const member = async (name: string, title: string) => {
      const made = await api("POST", "/api/bots", { name, section: TEAM });
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
      expect((await api("PATCH", `/api/bots/${made.body.bot.id}`, { title })).status).toBe(200);
      return made.body.bot as Bot;
    };
    const team = {
      lead: await member("Mo", "Showrunner"),
      writer: await member("Ink", "Screenwriter"),
      faces: await member("Jade", "Character designer"),
      sets: await member("Hall", "Scene designer"),
      boarder: await member("Frame", "Storyboard artist"),
      cutter: await member("Cut", "Editor"),
    };
    expect((await api("PATCH", `/api/bots/${team.lead.id}`, { chiefOfStaff: true })).status).toBe(200);
    await settled();
    const made = await api("POST", "/api/team-projects", { name: "Harbour bride", team: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    project = made.body.project;
    await settled();
    const all = await bots();
    for (const role of Object.keys(team) as Array<keyof typeof team>) {
      const copy = stored().find((bot) => bot.teamProject?.id === project.id && bot.teamProject.source === team[role].id)!;
      copies[role] = all.find((bot) => bot.id === copy.id)!;
    }
    expect(copies.lead.id).toBe(project.leadBotId);
    expect((await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } })).status).toBe(201);
    expect((await api("PATCH", "/api/mcp/servers/gen", { enabled: true })).status).toBe(200);
    const saved = await api("PUT", `/api/team-projects/${project.id}/generation/settings`, { image: IMAGE, video: VIDEO, concurrency: { episodes: 1, videos: 2, images: 2 } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.settings.concurrency).toEqual({ episodes: 1, videos: 2, images: 2 });

    const episode = (number: number, title: string) => add(`ep-${number}`, "text", title, { content: `EXT. HARBOUR, NIGHT. Episode ${number}.`, role: "episode", episode: number, card: { subtitle: `Logline ${number}` } });
    writeFileSync(server.planPath, JSON.stringify({
      [copies.lead.id]: { script: [
        { key: "plan", match: ["MAKE-THE-DRAMA"], reply: "The production is planned.", steps: [
          { tool: "production_plan", arguments: { brief: [["Episodes", "2 × 1 min"], ["Style", "Period romance"]], episodes: 2 } },
        ] },
        { key: "any", match: [""], repeat: true, reply: "Noted." },
      ] },
      [copies.writer.id]: { script: [{ key: "script", match: ["adapt the source into 2 episodes"], reply: LIST, steps: [
        { tool: "canvas_get_state", arguments: { connected: true } },
        { tool: "production_plan", arguments: { brief: [["Episodes", "9"]] }, expectError: true },
        apply(episode(1, "The swap"), episode(2, "The flight")),
      ] }] },
      [copies.faces.id]: { script: [{ key: "characters", match: ["Design the drama's characters", LIST], reply: "Mei is on the canvas.", steps: [
        apply(
          add("mei", "text", "Mei", { content: "The bride, 24, a seamstress.", role: "character", card: { badge: "Lead", subtitle: "24, seamstress", tags: ["calm"], rows: [["Look", "White dress"]], palette: ["#f5f0e6"] } }),
          add("mei-front", "image", "Mei, front", { prompt: "Front view, white dress" }),
          connect("mei", "mei-front"),
        ),
      ] }] },
      [copies.sets.id]: { script: [{ key: "scenes", match: ["Design the drama's scenes", LIST], reply: "The harbour is on the canvas.", steps: [
        apply(
          add("harbour", "text", "Harbour", { content: "A stone quay, lamps in fog.", role: "scene", card: { subtitle: "Night, the old port" } }),
          add("harbour-night", "image", "Harbour at night", { prompt: "A stone quay at night, lamps in fog" }),
          connect("harbour", "harbour-night"),
        ),
      ] }] },
      "*": { script: [
        { key: "board-1", match: ["you are the storyboard bot of EP01", "- mei · Mei (24, seamstress) · mei-front"], reply: "Two shots.", steps: [
          { tool: "canvas_get_state", arguments: { connected: true } },
          apply(shot("ep1-s1", "1-1"), shot("ep1-s2", "1-2"), connect("mei-front", "ep1-s1"), connect("harbour-night", "ep1-s1")),
        ] },
        { key: "board-2", match: ["you are the storyboard bot of EP02"], reply: "One shot.", steps: [apply(shot("ep2-s1", "2-1"))] },
        { key: "post-1", match: ["you are the post bot of EP01"], reply: "The cut is ready.", steps: [{ tool: "timeline_get_state", arguments: {} }] },
        { key: "post-2", match: ["you are the post bot of EP02"], reply: "The cut is ready." },
      ] },
    }));
    keep("00-fixture.json", { url: server.url, dataDir: server.dataDir, logPath: server.logPath, project, copies, mcpServer: fake.url });
    await settled();
  }, hostTimeout(120_000));

  afterAll(async () => {
    keep("99-mcp-calls.json", fake?.calls);
    await server?.close();
    await fake?.close();
    if (root) await removeTempDir(root);
  });

  it("says who does what from the members' titles before any plan, and has no production yet", async () => {
    const drawn = await canvas();
    expect(drawn.production).toBeUndefined();
    expect(Object.fromEntries(Object.values(copies).map((bot) => [bot.name, drawn.bots[bot.id]!.stages]))).toEqual({
      Mo: ["lead"], Ink: ["script"], Jade: ["character"], Hall: ["scene"], Frame: ["storyboard"], Cut: ["post"],
    });
    expect(await retry({ job: "script" })).toMatchObject({ status: 409, body: { errorKey: "serverError.production.notPlanned" } });
  });

  it("runs by itself from the lead's plan to every episode's film: script, characters and scenes side by side, then an episode at a time with its own storyboard and post bot", async () => {
    const sent = await api("POST", `/api/bots/${copies.lead.id}/messages`, { text: "MAKE-THE-DRAMA", threadId: copies.lead.threadId, sendId: crypto.randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);

    await expect.poll(async () => (await production())?.endedAt, { timeout: 240_000, interval: 1_000 }).toBeTypeOf("number");
    await settled();
    const drawn = await canvas();
    const ended = drawn.production!;
    keep("01-production-ended.json", ended);
    expect(turns().filter((turn) => turn.unplanned)).toEqual([]);
    expect(ended.plan).toMatchObject({ episodes: 2, assignments: { script: copies.writer.id, character: copies.faces.id, scene: copies.sets.id, storyboard: copies.boarder.id, post: copies.cutter.id } });
    expect(ended.jobs).toEqual([
      { job: "script", botId: copies.writer.id, status: "done" }, { job: "character", botId: copies.faces.id, status: "done" }, { job: "scene", botId: copies.sets.id, status: "done" },
    ]);
    expect(ended.ready).toBe(true);
    expect(ended.episodes).toEqual([
      { episode: 1, nodeId: "ep-1", title: "The swap", status: "done", storyboardBotId: expect.any(String), postBotId: expect.any(String), shots: 2, ready: 2, generating: 0, failed: 0 },
      { episode: 2, nodeId: "ep-2", title: "The flight", status: "done", storyboardBotId: expect.any(String), postBotId: expect.any(String), shots: 1, ready: 1, generating: 0, failed: 0 },
    ]);
    expect(ended.tasks.map((task) => [task.job, task.episode ?? 0, task.status])).toEqual([
      ["script", 0, "done"], ["character", 0, "done"], ["scene", 0, "done"], ["storyboard", 1, "done"], ["post", 1, "done"], ["storyboard", 2, "done"], ["post", 2, "done"],
    ]);

    const now = await listed();
    const own = (episode: number, job: string) => Object.entries(now.episodeBots).find(([, one]) => one.number === episode && one.job === job)![0];
    expect(Object.keys(now.episodeBots)).toHaveLength(4);
    expect([ended.episodes[0]!.storyboardBotId, ended.episodes[0]!.postBotId, ended.episodes[1]!.storyboardBotId, ended.episodes[1]!.postBotId])
      .toEqual([own(1, "storyboard"), own(1, "post"), own(2, "storyboard"), own(2, "post")]);
    const names = Object.fromEntries(stored().filter((bot) => now.episodeBots[bot.id]).map((bot) => [bot.id, bot.name]));
    expect([names[own(1, "storyboard")], names[own(2, "storyboard")], names[own(1, "post")], names[own(2, "post")]]).toEqual(["Frame EP01", "Frame EP02", "Cut EP01", "Cut EP02"]);
    expect([...room().memberIds].sort()).toEqual(Object.values(copies).map((bot) => bot.id).sort());

    const node = (id: string) => drawn.nodes.find((one) => one.id === id)!;
    const links = (id: string) => drawn.connections.filter((one) => one.kind === "content" && (one.fromNodeId === id || one.toNodeId === id)).map((one) => `${one.fromNodeId} > ${one.toNodeId}`);
    const brief = drawn.nodes.find((one) => one.metadata?.role === "brief")!;
    expect(brief).toMatchObject({ type: "text", title: "Brief", createdBy: { kind: "bot", botId: copies.lead.id }, metadata: { card: { rows: [["Episodes", "2 × 1 min"], ["Style", "Period romance"]] } } });
    expect(links(brief.id)).toEqual([`${botNodeId(copies.lead.id)} > ${brief.id}`, `${brief.id} > ${botNodeId(copies.writer.id)}`]);
    expect(drawn.nodes.filter((one) => one.metadata?.role === "plan")).toHaveLength(1);
    expect(node("ep-1")).toMatchObject({ title: "The swap", metadata: { role: "episode", episode: 1, card: { subtitle: "Logline 1" } } });
    expect(links("ep-2")).toEqual([`${botNodeId(copies.writer.id)} > ep-2`, `ep-2 > ${botNodeId(own(2, "storyboard"))}`]);
    expect(node("mei")).toMatchObject({ groupId: expect.any(String), metadata: { role: "character", card: { badge: "Lead", palette: ["#f5f0e6"] } } });
    expect(node("mei-front")).toMatchObject({ groupId: node("mei").groupId, metadata: { status: "success", file: { mime: "image/png" } } });
    expect(node("harbour-night").metadata).toMatchObject({ status: "success", file: { mime: "image/png" } });
    expect(node("ep1-s1")).toMatchObject({ type: "shot", createdBy: { kind: "bot", botId: own(1, "storyboard") }, metadata: { episode: 1, shot: { size: "wide", move: "slow push-in", audio: "waves" }, settings: { seconds: 5 } } });
    expect(node("ep2-s1").metadata).toMatchObject({ episode: 2 });
    const takes = drawn.nodes.filter((one) => one.metadata?.role === "take");
    expect(takes.map((take) => [take.metadata?.shotId, take.metadata?.episode, take.metadata?.selected]).sort()).toEqual([["ep1-s1", 1, true], ["ep1-s2", 1, true], ["ep2-s1", 2, true]]);
    const firstTake = takes.find((take) => take.metadata?.shotId === "ep1-s1")!;
    expect(links(firstTake.id)).toContain(`${firstTake.id} > ${botNodeId(own(1, "post"))}`);
    expect(drawn.bots[own(2, "post")]).toMatchObject({ stages: ["post"], episode: 2 });
    const generated = (tool: string) => fake.calls.filter((call) => call.tool === tool).map((call) => call.arguments as { prompt: string; referenceImages: unknown[] });
    expect(generated("generate_image").map((call) => call.prompt.split("\n")[0]).sort()).toEqual(["A stone quay at night, lamps in fog", "Front view, white dress"]);
    const videos = generated("generate_video");
    expect(videos.map((call) => call.prompt.split("\n").at(-1))).toEqual(["1-1: the bride runs along the water", "1-2: the bride runs along the water", "2-1: the bride runs along the water"]);
    expect(videos.map((call) => call.referenceImages.length)).toEqual([2, 0, 0]);

    const roomLines = await messages(room().threadId);
    const notes = notesIn(roomLines);
    keep("02-group-chat.json", roomLines.map(({ role, kind, text, tool, from }) => ({ role, kind, text, tool, from })));
    expect(notes).toEqual([
      "Production: the plan is set.", "Production: script goes to Ink.", "Production: character design goes to Jade.", "Production: scene design goes to Hall.",
      "Production: EP01 storyboard goes to Frame EP01.", "Production: EP01 post-production goes to Cut EP01.", "Production: EP01 is done.",
      "Production: EP02 storyboard goes to Frame EP02.", "Production: EP02 post-production goes to Cut EP02.", "Production: EP02 is done.",
      "Production: every episode is done.",
    ]);
    const tasked = (name: string, words: string) => roomLines.some((line) => line.role === "user" && line.text?.startsWith(`@${name} `) && line.text.includes(words));
    expect([tasked("Ink", "adapt the source into 2 episodes"), tasked("Jade", "Design the drama's characters"), tasked("Hall", "Design the drama's scenes")]).toEqual([true, true, true]);
    expect(roomLines.some((line) => line.role === "user" && line.text === `@Mo ${serverLine("en", "server.production.lead.done", { project: "Harbour bride" })}`)).toBe(true);
    const boarder = stored().find((bot) => bot.id === own(1, "storyboard"))!;
    const asked = (await messages(boarder.threadId)).filter((line) => line.role === "user").map((line) => line.text ?? "");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("you are the storyboard bot of EP01");
    expect(asked[0]).toContain("EXT. HARBOUR, NIGHT. Episode 1.");
    expect(roomLines.some((line) => line.text?.includes("storyboard bot of EP01"))).toBe(false);

    const refusedPlan = turns().find((turn) => turn.botId === copies.writer.id)!.evidence.filter((item) => item.step)[1].response;
    keep("03-writer-plans.json", { refusedPlan, calls: fake.calls });
    expect(refusedPlan.error).toMatchObject({ message: "Unknown tool: production_plan" });
    const file = join(server.dataDir, "productions", `${project.id}.json`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, projectId: project.id, production: { plan: { episodes: 2 } } });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  }, hostTimeout(360_000));

  it("refuses a retry of what has not stopped, one that names nothing, and one for no project", async () => {
    expect(await retry({ episode: 1 })).toMatchObject({ status: 409, body: { errorKey: "serverError.production.notStopped" } });
    expect(await retry({ job: "script" })).toMatchObject({ status: 409, body: { errorKey: "serverError.production.notStopped" } });
    expect((await retry({})).status).toBe(400);
    expect((await retry({ job: "script" }, "no-such-project")).status).toBe(404);
  });

  it("made no JianYing folder in the server's home", () => {
    expect(existsSync(join(server.dataDir, "Movies"))).toBe(false);
  });
});
