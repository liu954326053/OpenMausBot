// A drama team, the project made from it and generation's test MCP server on a real server with the scripted fake
// engine, for the production's end-to-end tests. Nothing here reaches the user's data, JianYing's own folder or port
// 8799: the server's home is a temporary folder, and a server the desktop app did not start writes no draft.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import type { ProductionWire } from "../../shared/production.ts";
import type { CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { TeamProjectMembership, TeamProjectWire } from "../../shared/team-projects.ts";
import { removeTempDir } from "./cleanup.ts";
import { startFakeGenerationMcp } from "./fake-generation-mcp-server.ts";
import { GENERATION_KEY } from "./project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "./restartable-server.ts";

export const TEAM = "Drama crew";
export const PROJECT = "Harbour bride";
export const LIST = "Characters: Mei, the bride. Scenes: the harbour at night.";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };

export type Role = "lead" | "writer" | "faces" | "sets" | "boarder" | "cutter";
export type Bot = { id: string; name: string; threadId: string; busy?: boolean };
export type StoredBot = { id: string; name: string; threadId: string; section?: string; teamProject?: TeamProjectMembership };
export type Line = { id: string; role?: string; kind?: string; text?: string; tool?: { name: string; ok?: boolean }; from?: { botId: string } };
export type Room = { id: string; threadId: string; memberIds: string[] };
export type Turn = { botId: string; threadId?: string; planKey?: string; unplanned?: boolean; resumed?: boolean; system: string; prompt: unknown; evidence: any[] };
type ScriptEntry = { key: string; match: string[]; repeat?: boolean; reply?: string; steps?: unknown[] };
export type Plan = Record<string, { script: ScriptEntry[] }>;

export interface ProductionFixture {
  server: RestartableServer;
  fake: Awaited<ReturnType<typeof startFakeGenerationMcp>>;
  team: Record<Role, Bot>;
  copies: Record<Role, Bot>;
  project: TeamProjectWire;
  api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  bots(): Promise<Bot[]>;
  stored(): StoredBot[];
  settled(): Promise<void>;
  messages(threadId: string): Promise<Line[]>;
  canvas(): Promise<CanvasSnapshot>;
  production(): Promise<ProductionWire | undefined>;
  listed(): Promise<TeamProjectWire>;
  room(): Room;
  turns(): Turn[];
  script(plan: Plan): void;
  send(bot: Bot, text: string, threadId?: string): Promise<void>;
  close(): Promise<void>;
}

export function keep(name: string, value: unknown): void {
  const dir = process.env.OMB_UI_EVIDENCE_DIR;
  if (dir) writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

export async function startProductionFixture(options: {
  concurrency: { episodes: number; videos: number; images: number };
  beforeProject?: (made: Pick<ProductionFixture, "server" | "team" | "api" | "settled">) => Promise<void>;
}): Promise<ProductionFixture> {
  const fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 300 });
  const server = await launchRestartableServer({ scripted: true }).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omb-production-")));
  const close = async () => {
    await server.close();
    await fake.close();
    await removeTempDir(root);
  };
  try {
    return await madeIn(server, fake, root, close, options);
  } catch (error) {
    await close();
    throw error;
  }
}

async function madeIn(
  server: RestartableServer,
  fake: ProductionFixture["fake"],
  root: string,
  close: () => Promise<void>,
  options: Parameters<typeof startProductionFixture>[0],
): Promise<ProductionFixture> {
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
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

  expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
  const member = async (name: string, title: string) => {
    const made = await api("POST", "/api/bots", { name, section: TEAM });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect((await api("PATCH", `/api/bots/${made.body.bot.id}`, { title })).status).toBe(200);
    return made.body.bot as Bot;
  };
  const team: Record<Role, Bot> = {
    lead: await member("Mo", "Showrunner"),
    writer: await member("Ink", "Screenwriter"),
    faces: await member("Jade", "Character designer"),
    sets: await member("Hall", "Scene designer"),
    boarder: await member("Frame", "Storyboard artist"),
    cutter: await member("Cut", "Editor"),
  };
  expect((await api("PATCH", `/api/bots/${team.lead.id}`, { chiefOfStaff: true })).status).toBe(200);
  await settled();
  await options.beforeProject?.({ server, team, api, settled });

  const made = await api("POST", "/api/team-projects", { name: PROJECT, team: TEAM });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const project = made.body.project as TeamProjectWire;
  await settled();
  const all = await bots();
  const copies = {} as Record<Role, Bot>;
  for (const role of Object.keys(team) as Role[]) {
    const copy = stored().find((bot) => bot.teamProject?.id === project.id && bot.teamProject.source === team[role].id)!;
    copies[role] = all.find((bot) => bot.id === copy.id)!;
  }
  expect(copies.lead.id).toBe(project.leadBotId);
  expect((await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } })).status).toBe(201);
  expect((await api("PATCH", "/api/mcp/servers/gen", { enabled: true })).status).toBe(200);
  const saved = await api("PUT", `/api/team-projects/${project.id}/generation/settings`, { image: IMAGE, video: VIDEO, concurrency: options.concurrency });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.settings.concurrency).toEqual(options.concurrency);

  const canvas = async (): Promise<CanvasSnapshot> => (await api("GET", `/api/team-projects/${project.id}/canvas`)).body;
  return {
    server, fake, team, copies, project, api, bots, stored, settled, canvas,
    messages: async (threadId) => (await api("GET", `/api/threads/${threadId}/messages?limit=500`)).body.messages as Line[],
    production: async () => (await canvas()).production,
    listed: async () => ((await api("GET", "/api/team-projects")).body.projects as TeamProjectWire[]).find((one) => one.id === project.id)!,
    room: () => {
      const groups = JSON.parse(readFileSync(join(server.dataDir, "groups.json"), "utf8")) as Room[] | { groups: Room[] };
      return (Array.isArray(groups) ? groups : groups.groups).find((one) => one.id === project.roomId)!;
    },
    turns: () => {
      const path = `${server.planPath}.evidence.jsonl`;
      return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Turn) : [];
    },
    script: (plan) => writeFileSync(server.planPath, JSON.stringify(plan)),
    send: async (bot, text, threadId = bot.threadId) => {
      const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId, sendId: crypto.randomUUID() });
      expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    },
    close,
  };
}

const add = (id: string, nodeType: string, title: string, metadata: Record<string, unknown>) => ({ type: "add_node", id, nodeType, title, metadata });
const connect = (fromNodeId: string, toNodeId: string) => ({ type: "connect_nodes", fromNodeId, toNodeId });
const apply = (...ops: unknown[]) => ({ tool: "canvas_apply_ops", arguments: { ops } });
const shot = (id: string, title: string) => add(id, "shot", title, { prompt: `${title}: the bride runs along the water`, shot: { size: "wide", move: "slow push-in", audio: "waves" }, settings: { seconds: 5 } });
const episode = (number: number, title: string) => add(`ep-${number}`, "text", title, { content: `EXT. HARBOUR, NIGHT. Episode ${number}.`, role: "episode", episode: number, card: { subtitle: `Logline ${number}` } });

/** The turns of a two-episode production, each bot doing its job: the lead plans it on MAKE-THE-DRAMA and notes
 * whatever else it is told; the script bot also tries the lead's tool, which it does not have. Each episode's own bots
 * play under "*", since no test knows their ids before the production makes them. */
export function productionPlan(copies: Record<Role, Bot>): Plan {
  return {
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
  };
}
