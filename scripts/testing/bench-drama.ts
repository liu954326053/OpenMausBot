// The drama of scripts/bench-many-bots.ts --drama: seeds a drama of many episodes into the stopped fixture server's data
// folder, and with the server up again measures what that size costs it, each a few times, as medians: its lists and
// the drama's canvas, a bot's roster as `list_bots` builds it, the production's advance when the canvas changes, and
// what one bot's change sends to an open app and costs the server. The server's side of each comes from
// bench-server-probe.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { verificationServerEnvironment } from "../control-omb.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROBE_ARGS = ["--import", new URL("./bench-server-probe.mjs", import.meta.url).href];

export interface DramaSeed {
  projectId: string;
  crew: string[];
  copies: Record<"lead" | "writer" | "faces" | "sets" | "boarder" | "cutter", string>;
  episodeBots: Record<string, { storyboard: string; post: string }>;
  bots: number;
  projectBots: number;
  canvas: { nodes: number; connections: number; shots: number };
  episodeBotMs: { count: number; median: number; p95: number; total: number };
}

export function seedDrama(dataDir: string, port: number, folder: string, episodes: number): DramaSeed {
  const env = verificationServerEnvironment(process.env, dataDir, port);
  const printed = execFileSync(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts", "testing", "bench-drama-seed.ts"), folder, String(episodes)],
    { cwd: ROOT, env, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(printed.trim().split("\n").at(-1)!) as DramaSeed;
}

interface Stat { calls: number; totalMs: number; medianMs: number | null; maxMs: number | null; samples: number[] }
export interface Probe {
  at: number;
  cpuMs: number;
  memory: NodeJS.MemoryUsage;
  loopDelayMs: { p50: number; p99: number; max: number };
  routes: Record<string, Stat>;
  methods: Record<string, Stat>;
  writes: Record<string, { calls: number; bytes: number; renames: number }>;
}

/** What the server's probe saw since it was read before; the server's pid is the one its health answers with. */
export async function readProbe(url: string, dataDir: string): Promise<Probe> {
  const { pid } = await (await fetch(`${url}/api/health`)).json() as { pid: number };
  const file = join(dataDir, "bench-probe.json");
  const before = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Probe).at : 0;
  process.kill(pid, "SIGUSR2");
  for (let tries = 0; tries < 400; tries += 1) {
    await delay(25);
    try {
      const probe = JSON.parse(readFileSync(file, "utf8")) as Probe;
      if (probe.at !== before) return probe;
    } catch { /* not written yet */ }
  }
  throw new Error("the server's probe did not answer");
}

const median = (values: readonly number[]): number | null => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : null);
const fixed = (value: number | null | undefined, digits = 1): number | null => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
const mb = (bytes: number) => fixed(bytes / 1024 / 1024);
const perCall = (stat: Stat | undefined, count: number) => (stat ? { calls: fixed(stat.calls / count), ms: fixed(stat.totalMs / count, 2) } : { calls: 0, ms: 0 });

export interface DramaContext {
  url: string;
  dataDir: string;
  planPath: string;
  seed: DramaSeed;
  /** A bot of no project, made through the API. */
  ordinaryBotId: string;
  repeats: number;
  /** What the open app's stream carried so far, by frame kind. */
  frames(): ReadonlyMap<string, { frames: number; bytes: number }>;
  print(line: Record<string, unknown>): void;
}

export async function measureDrama(context: DramaContext): Promise<Record<string, unknown>> {
  const { url, dataDir, seed, repeats, print } = context;
  const probe = () => readProbe(url, dataDir);
  const request = async (method: string, path: string, body?: unknown) => {
    const at = performance.now();
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    const ms = performance.now() - at;
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return { ms, bytes: Buffer.byteLength(text), body: text ? JSON.parse(text) : {} };
  };
  const summary: Record<string, unknown> = {};

  const startup = await probe();
  summary.atReady = {
    rssMb: mb(startup.memory.rss), heapUsedMb: mb(startup.memory.heapUsed), cpuMsSinceLaunch: startup.cpuMs,
    list: perCall(startup.methods["TeamProjects.list"], 1), advance: perCall(startup.methods["Productions.advance"], 1),
    botsJsonWrites: startup.writes["bots.json"]?.calls ?? 0,
  };
  print({ drama: "ready", ...summary.atReady as object });

  const canvasPath = `/api/team-projects/${seed.projectId}/canvas`;
  const cold = await request("GET", canvasPath);
  summary.firstCanvasMs = fixed(cold.ms);
  const routes: Array<[string, string]> = [
    ["GET /api/bots?messages=0", "/api/bots?messages=0"],
    ["GET /api/bots", "/api/bots"],
    ["GET /api/sidebar-sections", "/api/sidebar-sections"],
    ["GET /api/team-projects", "/api/team-projects"],
    ["GET /api/team-projects/:id/canvas", canvasPath],
  ];
  const routeResults: Record<string, unknown> = {};
  for (const [key, path] of routes) {
    await probe();
    const runs = [];
    for (let run = 0; run < repeats; run += 1) runs.push(await request("GET", path));
    const seen = await probe();
    routeResults[key] = {
      clientMs: fixed(median(runs.map((run) => run.ms))), serverMs: fixed(seen.routes[key]?.medianMs), kb: Math.round(runs[0]!.bytes / 1024),
      list: perCall(seen.methods["TeamProjects.list"], repeats), canvasReads: perCall(seen.methods["CanvasDocuments.read"], repeats), shots: perCall(seen.methods["Productions.shots"], repeats),
    };
    print({ drama: "route", route: key, ...routeResults[key] as object });
  }
  summary.routes = routeResults;

  summary.roster = {
    project: await roster(context, request, probe, seed.episodeBots["1"]!.post),
    ordinary: await roster(context, request, probe, context.ordinaryBotId),
  };
  print({ drama: "roster", ...summary.roster as object });

  await probe();
  await delay(10_000);
  const idle = await probe();
  summary.idle = {
    cpuMsPerSecond: fixed(idle.cpuMs / 10), advances: idle.methods["Productions.advance"]?.calls ?? 0, list: idle.methods["TeamProjects.list"]?.calls ?? 0,
    routes: Object.fromEntries(Object.entries(idle.routes).map(([key, stat]) => [key, stat.calls])),
  };
  print({ drama: "idle", ...summary.idle as object });

  await probe();
  const moves = [];
  for (let run = 0; run < repeats; run += 1) {
    moves.push(await request("POST", `${canvasPath}/ops`, { ops: [{ type: "update_node", id: "episode-1", patch: { position: { x: 1600 + (run % 2) * 40, y: 0 } } }] }));
    await delay(1_000);
  }
  const moved = await probe();
  const advance = moved.methods["Productions.advance"];
  summary.advance = {
    canvasMoveClientMs: fixed(median(moves.map((move) => move.ms))), canvasMoveServerMs: fixed(moved.routes["POST /api/team-projects/:id/canvas/ops"]?.medianMs),
    advances: advance?.calls ?? 0, advanceMedianMs: fixed(advance?.medianMs), advanceMaxMs: fixed(advance?.maxMs),
    shotsPerAdvance: advance ? fixed((moved.methods["Productions.shots"]?.calls ?? 0) / advance.calls) : null,
    listPerAdvance: advance ? fixed((moved.methods["TeamProjects.list"]?.calls ?? 0) / advance.calls) : null,
    cpuMsPerMove: fixed(moved.cpuMs / repeats),
  };
  print({ drama: "advance", ...summary.advance as object });

  summary.fanOut = {
    ordinaryBot: await fanOut(context, request, probe, context.ordinaryBotId, 2_000),
    crewMemberWithCopies: await fanOut(context, request, probe, seed.crew[4]!, 4_000),
  };
  print({ drama: "fan-out", ...summary.fanOut as object });

  const end = await probe();
  summary.atEnd = { rssMb: mb(end.memory.rss), heapUsedMb: mb(end.memory.heapUsed) };
  print({ drama: "end", ...summary.atEnd as object });
  return summary;
}

type Request = (method: string, path: string, body?: unknown) => Promise<{ ms: number; bytes: number; body: any }>;

/** The bot's roster, read by `list_bots` in a scripted turn of its own, on a thread the production never gave work. */
async function roster(context: DramaContext, request: Request, probe: () => Promise<Probe>, botId: string) {
  const plans = existsSync(context.planPath) ? JSON.parse(readFileSync(context.planPath, "utf8")) : {};
  writeFileSync(context.planPath, JSON.stringify({ ...plans, [botId]: { reply: "Roster read.", steps: [{ tool: "list_bots", arguments: {} }] } }));
  const made = await request("POST", `/api/bots/${botId}/tasks`, { title: "Roster" });
  const threadId = made.body.task?.threadId ?? made.body.threadId;
  if (typeof threadId !== "string") throw new Error(`a roster thread was not made: ${JSON.stringify(made.body).slice(0, 200)}`);
  const evidence = `${context.planPath}.evidence.jsonl`;
  const turns = () => (existsSync(evidence) ? readFileSync(evidence, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((turn) => turn.botId === botId) : []);
  const serverMs: number[] = [];
  let listed = 0;
  for (let run = 0; run < context.repeats; run += 1) {
    const before = turns().length;
    await probe();
    await request("POST", `/api/bots/${botId}/messages`, { text: `Who is on the team? (${run + 1})`, threadId });
    const until = Date.now() + 60_000;
    while (turns().length === before) {
      if (Date.now() > until) throw new Error(`the roster turn of ${botId} did not end`);
      await delay(50);
    }
    await delay(300);
    const seen = await probe();
    serverMs.push(...(seen.routes["GET /api/internal/agents"]?.samples ?? []));
    const answer = turns().at(-1)?.evidence?.find((step: any) => step?.step?.tool === "list_bots")?.response?.result?.content?.[0]?.text;
    listed = typeof answer === "string" ? (answer.match(/\[id: /g) ?? []).length : -1;
  }
  return { serverMs: fixed(median(serverMs), 2), calls: serverMs.length, listed };
}

/** One bot's description changes: what the open app is sent within `waitMs`, and what that costs the server. */
async function fanOut(context: DramaContext, request: Request, probe: () => Promise<Probe>, botId: string, waitMs: number) {
  const runs = [];
  for (let run = 0; run < context.repeats; run += 1) {
    await probe();
    const before = new Map([...context.frames()].map(([kind, tally]) => [kind, { ...tally }]));
    const patched = await request("PATCH", `/api/bots/${botId}`, { description: `Changed by the bench, run ${run + 1}.` });
    await delay(waitMs);
    const seen = await probe();
    const byKind: Record<string, number> = {};
    let frames = 0, bytes = 0;
    for (const [kind, tally] of context.frames()) {
      const added = tally.frames - (before.get(kind)?.frames ?? 0);
      if (added) byKind[kind] = added;
      frames += added;
      bytes += tally.bytes - (before.get(kind)?.bytes ?? 0);
    }
    runs.push({ patchMs: patched.ms, frames, kb: bytes / 1024, byKind, cpuMs: seen.cpuMs, loopMaxMs: seen.loopDelayMs.max,
      botsJsonWrites: seen.writes["bots.json"]?.calls ?? 0, botsJsonMb: (seen.writes["bots.json"]?.bytes ?? 0) / 1024 / 1024,
      saveBots: seen.methods["Store.saveBots"]?.calls ?? 0, saveBotsMs: seen.methods["Store.saveBots"]?.totalMs ?? 0,
      list: seen.methods["TeamProjects.list"]?.calls ?? 0, advances: seen.methods["Productions.advance"]?.calls ?? 0 });
  }
  const pick = (key: keyof typeof runs[number]) => fixed(median(runs.map((run) => Number(run[key]))));
  return {
    patchMs: pick("patchMs"), frames: pick("frames"), kb: pick("kb"), byKind: runs.at(-1)!.byKind, cpuMs: pick("cpuMs"), loopMaxMs: pick("loopMaxMs"),
    botsJsonWrites: pick("botsJsonWrites"), botsJsonMb: pick("botsJsonMb"), saveBots: pick("saveBots"), saveBotsMs: pick("saveBotsMs"), list: pick("list"), advances: pick("advances"),
  };
}
