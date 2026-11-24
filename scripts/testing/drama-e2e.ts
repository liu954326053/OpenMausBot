// One drama from an empty fixture to its first real product, on a real server with the scripted fake engine and the
// repository's own fake generation MCP server: create a project, tell its lead to pick a 修仙 book from the hot-video
// 番茄 IP 池, choose one, get the brief, and go as far as S1/S2. Images and videos are the fake provider's; text is a
// real model, reached only through OMB_E2E_* and never written down.
//
//   OMB_E2E_BASE_URL=https://…/v1 OMB_E2E_API_KEY=… OMB_E2E_MODEL=… [OMB_E2E_PROVIDER=openaiCompat]
//     node --experimental-strip-types scripts/testing/drama-e2e.ts
//
// Without those three it prints what is missing and exits 0. Flags: `--run-dir DIR` reuses a run's checkpoints,
// `--from STEP` resumes there, `--pool live` reads the API instead of the committed snapshot (needs
// OMB_E2E_IP_SCOUT_KEY), `--keep` keeps the fixture's data folder, `--stop-on-failure` stops the server a failed run
// would otherwise leave up for `--from`, `--no-lock` skips the shared UI-fixture lock. A failed run leaves its server
// running on purpose: fix the cause and resume from the step it named.
//
// S3, S4 and S5 continue from here without new harness code:
//   S3 — after `script` passes, the production dispatches `character` and `scene` in parallel; wait for both jobs to be
//        `done` in `production.jobs`, then the per-episode `storyboard` task appears. The canvas `episode` nodes the
//        script bot wrote are its input, and the same `until()` on `production.tasks` is the check.
//   S4 — the character and scene bots add image nodes themselves; the fake generation server makes the PNGs, so no
//        new wiring is needed. Assert `production.jobs.character.status === "done"` and a node with
//        `metadata.role === "character"` that has `metadata.status === "success"`.
//   S5 — each episode's `storyboard` bot adds `shot` nodes; the production generates each shot's video through the same
//        fake server (`generate_video`, 6 KB sample MP4). Assert one `metadata.role === "take"` node per shot with
//        `selected: true`. Nothing here needs a real video provider.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";

import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { startFakeGenerationMcp } from "../../server/testing/fake-generation-mcp-server.ts";
import { verificationServerArgs, verificationServerEnvironment } from "../control-omb.ts";
import { bookFacts, pickXianxia, shortlistText, type PoolBook, type PoolSnapshot } from "./drama-ip-pool.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI_LOCK = "/tmp/omb-ui-fixture.lock";
const DEFAULT_PORT = 8820;
const TEAM = "修仙短剧组";
const PROJECT = "E2E 修仙短剧";

/** Everything a step reads and passes on; a resumed run fills it from the checkpoints it already has. */
interface Run {
  runDir: string;
  checkpointDir: string;
  evidenceDir: string;
  url: string;
  dataDir: string;
  logPath: string;
  pid: number;
  root: string;
  projectId: string;
  folder: string;
  leadId: string;
  threadIds: Record<string, string>;
  bots: Array<{ id: string; name: string; title: string; threadId: string }>;
  generationUrl: string;
  candidates: PoolBook[];
  chosen?: PoolBook;
}

class StepFailure extends Error {
  readonly step: string;
  readonly need: string;
  readonly detail: string;
  constructor(step: string, need: string, detail: string) {
    super(`${step}: ${need}${detail ? ` — ${detail}` : ""}`);
    this.step = step;
    this.need = need;
    this.detail = detail;
  }
}

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at > 0 && process.argv[at + 1] && !process.argv[at + 1]!.startsWith("--")) return process.argv[at + 1];
  return process.argv.includes(`--${name}`) ? "" : fallback;
}

const flags = new Set(process.argv.slice(2).filter((one) => one.startsWith("--") && !one.includes("=")));

interface Provider {
  instanceId: string;
  baseUrl: string;
  key: string;
  model: string;
}

/** The text model, from the environment only. A miss names every variable that is missing. */
export function modelFromEnv(env: NodeJS.ProcessEnv): { provider: Provider } | { missing: string[] } {
  const instanceId = env.OMB_E2E_PROVIDER?.trim() || "openaiCompat";
  const baseUrl = env.OMB_E2E_BASE_URL?.trim() ?? "";
  const key = env.OMB_E2E_API_KEY?.trim() ?? "";
  const model = env.OMB_E2E_MODEL?.trim() ?? "";
  const missing = [
    ...(baseUrl ? [] : ["OMB_E2E_BASE_URL (the OpenAI-compatible base URL, ending in /v1)"]),
    ...(key ? [] : ["OMB_E2E_API_KEY"]),
    ...(model ? [] : ["OMB_E2E_MODEL"]),
  ];
  if (missing.length) return { missing };
  return { provider: { instanceId, baseUrl, key, model } };
}

/** One short chat completion: a refused or unreachable provider must stop the run before it makes anything. */
async function probeProvider(provider: Provider, timeoutMs = 20_000): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return `连不上 ${provider.baseUrl}（${cause ?? (error instanceof Error ? error.name : String(error))}）`;
  }
  if (response.ok) return null;
  const text = (await response.text().catch(() => "")).slice(0, 300);
  if (response.status === 401 || response.status === 403) return `模型不可用：${provider.baseUrl} 拒绝了 key（HTTP ${response.status}）${text}`;
  if (response.status === 404) return `模型不可用：${provider.baseUrl} 上没有 ${provider.instanceId}/${provider.model}（HTTP 404）${text}`;
  return `模型不可用：${provider.baseUrl} 回答 HTTP ${response.status}${text}`;
}

function freePort(from: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number) => {
      const probe = createServer();
      probe.once("error", () => (port - from > 40 ? reject(new Error(`8820–${port} 都被占用`)) : attempt(port + 1)));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(port)));
    };
    attempt(from);
  });
}

interface Answer { status: number; body: any }

function makeApi(run: Run) {
  return async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const response = await fetch(run.url + path, {
      method,
      headers: { "content-type": "application/json", origin: run.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 500) }; }
    return { status: response.status, body: parsed };
  };
}

async function until<T>(what: string, read: () => Promise<T | null | undefined | false>, timeoutMs: number, intervalMs = 1_000): Promise<T> {
  const started = Date.now();
  let last = "";
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`等不到${what}（${Math.round((Date.now() - started) / 1000)} 秒）${last}`);
    await sleep(intervalMs);
    last = "";
  }
}

function takeUiLock(owner: string): (() => void) | null {
  try {
    mkdirSync(UI_LOCK);
    writeFileSync(join(UI_LOCK, "owner"), `${owner}\n`);
  } catch {
    return null;
  }
  return () => { try { rmSync(UI_LOCK, { recursive: true, force: true }); } catch { /* another owner already took it */ } };
}

function readCheckpoints(run: Run): Map<string, any> {
  const done = new Map<string, any>();
  if (!existsSync(run.checkpointDir)) return done;
  for (const file of readdir(run.checkpointDir)) {
    try {
      const one = JSON.parse(readFileSync(join(run.checkpointDir, file), "utf8"));
      if (one?.status === "ok") done.set(one.step, one);
    } catch { continue; }
  }
  return done;
}

function readdir(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

/** The pool the run picks from: a snapshot file (OMB_E2E_IP_POOL, else the committed one) or the live API. */
async function loadPool(online: boolean): Promise<{ pool: PoolSnapshot; from: string }> {
  if (online) {
    const key = process.env.OMB_E2E_IP_SCOUT_KEY?.trim() ?? "";
    const base = (process.env.OMB_E2E_IP_SCOUT_BASE?.trim() || "https://hot-video-pro.hongmaocy.com/api").replace(/\/$/, "");
    if (!key) throw new StepFailure("pool", "需要联网取番茄 IP 池，但没有 OMB_E2E_IP_SCOUT_KEY", "改用 --pool fixture 读仓库里的快照");
    const response = await fetch(`${base}/open/ip/recall`, {
      method: "POST",
      headers: { "X-Api-Key": key, "content-type": "application/json" },
      body: JSON.stringify({ category_ids: [1140, 124, 258], per_pool: 10 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new StepFailure("pool", "番茄 IP 池接口拒绝了这次请求", `HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const answer = await response.json() as { code?: unknown; data?: PoolSnapshot };
    if (String(answer.code) !== "1000" || !answer.data) throw new StepFailure("pool", "番茄 IP 池接口没有返回数据", JSON.stringify(answer).slice(0, 200));
    return { pool: answer.data, from: `${base}/open/ip/recall` };
  }
  const file = process.env.OMB_E2E_IP_POOL?.trim() || join(ROOT, "scripts", "testing", "fixtures", "fanqie-ip-pool.json");
  if (!existsSync(file)) throw new StepFailure("pool", "找不到番茄 IP 池快照", file);
  return { pool: JSON.parse(readFileSync(file, "utf8")) as PoolSnapshot, from: file };
}

function writeCheckpoint(run: Run, index: number, name: string, outcome: { status: string; startedAt: string; ms: number; artifacts?: unknown; error?: string }): void {
  mkdirSync(run.checkpointDir, { recursive: true });
  const file = join(run.checkpointDir, `${String(index).padStart(2, "0")}-${name}.json`);
  writeFileSync(file, `${JSON.stringify({ step: name, index, ...outcome }, null, 2)}\n`);
}

/** `scripts/testing/drama-e2e.ts` steps, in the order a run takes them. */
type Step = { name: string; run: (run: Run, ctx: { api: ReturnType<typeof makeApi>; provider?: Provider }) => Promise<Record<string, unknown>> };

const steps: Step[] = [
  {
    name: "preflight",
    run: async (_run, ctx) => {
      const provider = ctx.provider!;
      const refusal = await probeProvider(provider);
      if (refusal) throw new StepFailure("preflight", "文本模型不可用，什么都没做", refusal);
      return { provider: { instanceId: provider.instanceId, baseUrl: provider.baseUrl, model: provider.model, key: "set, not written down" } };
    },
  },
  {
    name: "pool",
    run: async (run) => {
      const online = flags.has("--pool=live") || arg("pool") === "live";
      const { pool, from } = await loadPool(online);
      const candidates = pickXianxia(pool.books, 5);
      if (!candidates.length) throw new StepFailure("pool", "池子里没有一本修仙题材的书", `${from}，共 ${pool.books.length} 本`);
      run.candidates = candidates;
      return { from, books: pool.books.length, candidates: candidates.map((book) => ({ id: book.fanqieBookId, name: book.bookName, category: book.categoryName, facts: bookFacts(book) })), shortlist: shortlistText(candidates) };
    },
  },
  {
    name: "launch",
    run: async (run) => {
      const port = await freePort(Number(arg("port") || DEFAULT_PORT));
      const dataDir = mkdtempSync(join(tmpdir(), "omb-drama-e2e-data-"));
      run.dataDir = dataDir;
      run.evidenceDir = join(run.runDir, "evidence");
      mkdirSync(join(dataDir, "tmp"), { recursive: true });
      mkdirSync(run.evidenceDir, { recursive: true });
      run.logPath = join(run.evidenceDir, "server.log");
      writeFileSync(run.logPath, "");
      run.url = `http://127.0.0.1:${port}`;
      const env = verificationServerEnvironment({ ...process.env, OMB_DEFAULT_LANGUAGE: "zh" }, dataDir, port);
      const log = openSync(run.logPath, "a", 0o600);
      const child = spawn(process.execPath, verificationServerArgs(env), { cwd: ROOT, env, stdio: ["ignore", log, log] });
      closeSync(log);
      server = child;
      run.pid = child.pid!;
      const deadline = Date.now() + 60_000;
      for (;;) {
        if (child.exitCode !== null) throw new StepFailure("launch", "服务端还没就绪就退出了", `${run.url}，日志见 ${run.logPath}`);
        const healthy = await fetch(`${run.url}/api/health`, { signal: AbortSignal.timeout(1_000) }).then((one) => one.ok).catch(() => false);
        if (healthy) break;
        if (Date.now() > deadline) throw new StepFailure("launch", "服务端 60 秒内没有就绪", `${run.url}，日志见 ${run.logPath}`);
        await sleep(200);
      }
      return { url: run.url, pid: run.pid, dataDir, logPath: run.logPath };
    },
  },
  {
    name: "config",
    run: async (run, ctx) => {
      const api = ctx.api;
      const provider = ctx.provider!;
      const saved = await api("PATCH", "/api/config", {
        openaiCompat: { key: provider.key, url: provider.baseUrl, model: provider.model },
        language: "zh",
      });
      if (saved.status !== 200) throw new StepFailure("config", "写不进文本模型设置", `PATCH /api/config 回答 ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
      run.root = join(run.runDir, "projects");
      mkdirSync(run.root, { recursive: true });
      const rooted = await api("PUT", "/api/team-projects/root", { path: run.root });
      if (rooted.status !== 200) throw new StepFailure("config", "设不了项目根目录", `PUT /api/team-projects/root 回答 ${rooted.status}`);
      const wanted = [
        { name: "云舟", title: "制片人" },
        { name: "砚青", title: "编剧" },
        { name: "墨白", title: "角色与场景设计" },
        { name: "青禾", title: "后期" },
      ];
      run.bots = [];
      for (const one of wanted) {
        const made = await api("POST", "/api/bots", { name: one.name, title: one.title, section: TEAM });
        if (made.status >= 300) throw new StepFailure("config", `建不出成员 ${one.name}`, `POST /api/bots 回答 ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`);
        run.bots.push({ id: made.body.bot.id, name: one.name, title: one.title, threadId: made.body.bot.threadId });
      }
      const lead = run.bots[0]!;
      const chief = await api("PATCH", `/api/bots/${lead.id}`, { chiefOfStaff: true });
      if (chief.status !== 200) throw new StepFailure("config", "指定不了负责人", `PATCH /api/bots/${lead.id} 回答 ${chief.status}`);
      for (const bot of run.bots) {
        const model = await api("PATCH", `/api/bots/${bot.id}/model`, { instanceId: provider.instanceId, model: provider.model });
        if (model.status !== 200) throw new StepFailure("config", `成员 ${bot.name} 的模型设不上`, `PATCH /api/bots/${bot.id}/model 回答 ${model.status} ${JSON.stringify(model.body).slice(0, 300)}`);
      }
      run.leadId = lead.id;
      const listed = await api("GET", "/api/bots?messages=0");
      run.threadIds = Object.fromEntries((listed.body.bots as any[]).map((bot) => [bot.id, bot.threadId]));
      return { team: TEAM, lead: { id: lead.id, name: lead.name }, bots: run.bots.map((bot) => ({ id: bot.id, name: bot.name, title: bot.title })), projectRoot: run.root };
    },
  },
  {
    name: "project",
    run: async (run, ctx) => {
      const api = ctx.api;
      const made = await api("POST", "/api/team-projects", { name: PROJECT, team: TEAM });
      if (made.status >= 300) throw new StepFailure("project", "建不出项目", `POST /api/team-projects 回答 ${made.status} ${JSON.stringify(made.body).slice(0, 400)}`);
      run.projectId = made.body.project.id;
      run.folder = made.body.project.folder;
      const added = await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: run.generationUrl, headers: { Authorization: "Bearer e2e-fake-generation" } });
      if (added.status >= 300) throw new StepFailure("project", "登记不了假生成服务", `POST /api/mcp/servers 回答 ${added.status} ${JSON.stringify(added.body).slice(0, 300)}`);
      const enabled = await api("PATCH", "/api/mcp/servers/gen", { enabled: true });
      if (enabled.status >= 300) throw new StepFailure("project", "开启不了假生成服务", `PATCH /api/mcp/servers/gen 回答 ${enabled.status}`);
      const settings = await api("PUT", `/api/team-projects/${run.projectId}/generation/settings`, {
        image: { server: "gen", defaults: { model: "pixel-1", aspect: "9:16", quality: "standard", count: 1 } },
        video: { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "9:16", seconds: 5 } },
        concurrency: { episodes: 1, videos: 2, images: 2 },
      });
      if (settings.status >= 300) throw new StepFailure("project", "设不了项目的生成配置", `PUT generation/settings 回答 ${settings.status} ${JSON.stringify(settings.body).slice(0, 300)}`);
      const rooms = await api("GET", "/api/team-projects");
      const listed = (rooms.body.projects as any[]).find((one) => one.id === run.projectId);
      return {
        projectId: run.projectId, name: PROJECT, folder: run.folder, leadBotId: made.body.project.leadBotId,
        roomId: listed?.roomId, botIds: made.body.project.botIds, generation: { server: "gen", url: run.generationUrl, image: "pixel-1", video: "motion-1" },
      };
    },
  },
  {
    name: "ask",
    run: async (run, ctx) => {
      const api = ctx.api;
      const shortlist = shortlistText(run.candidates);
      const text = [
        "我们做一部修仙题材的短剧。",
        "下面是从番茄热门 IP 池里筛出来的修仙小说候选（书号是番茄 ID）：",
        shortlist,
        "请挑一本最适合改编的，说明理由，并告诉我它适合做成几集、每集多长、什么形态（2D 漫 / 3D 漫 / AI 真人）。",
      ].join("\n");
      const sent = await api("POST", `/api/bots/${run.leadId}/messages`, { text, threadId: run.threadIds[run.leadId], sendId: crypto.randomUUID() });
      if (sent.status >= 300) throw new StepFailure("ask", "消息发不到负责人", `POST /api/bots/${run.leadId}/messages 回答 ${sent.status} ${JSON.stringify(sent.body).slice(0, 300)}`);
      const reply = await settleAndReply(run, api, run.leadId, Number(arg("timeout") || 240) * 1000);
      const named = run.candidates.find((book) => reply.includes(book.bookName));
      if (named) run.chosen = named;
      return { question: text, reply: reply.slice(0, 2_000), namedBook: named?.bookName ?? null, threadId: run.threadIds[run.leadId] };
    },
  },
  {
    name: "choose",
    run: async (run, ctx) => {
      const api = ctx.api;
      const chosen = run.chosen ?? run.candidates[0]!;
      run.chosen = chosen;
      const sent = await api("POST", `/api/bots/${run.leadId}/messages`, {
        text: `就做《${chosen.bookName}》（番茄书号 ${chosen.fanqieBookId}，${chosen.categoryName}，${bookFacts(chosen)}）。请按这个选定的书写需求单，然后开始制作。`,
        threadId: run.threadIds[run.leadId], sendId: crypto.randomUUID(),
      });
      if (sent.status >= 300) throw new StepFailure("choose", "选定书目发不到负责人", `POST /api/bots/${run.leadId}/messages 回答 ${sent.status}`);
      const reply = await settleAndReply(run, api, run.leadId, Number(arg("timeout") || 240) * 1000);
      return { chosen: { id: chosen.fanqieBookId, name: chosen.bookName, category: chosen.categoryName }, sent: chosen.bookName, reply: reply.slice(0, 2_000) };
    },
  },
  {
    name: "plan",
    run: async (run, ctx) => {
      const api = ctx.api;
      const production = await until("负责人调用 production_plan（画布上出现需求单）", async () => {
        const canvas = await api("GET", `/api/team-projects/${run.projectId}/canvas`);
        if (canvas.status !== 200) return false;
        const seen = canvas.body.production;
        return seen?.plan ? seen : false;
      }, Number(arg("timeout") || 300) * 1000);
      const canvas = await api("GET", `/api/team-projects/${run.projectId}/canvas`);
      const brief = (canvas.body.nodes as any[]).find((node) => node.metadata?.role === "brief");
      if (!brief) throw new StepFailure("plan", "画布上没有需求单", "负责人只写了计划，没有把需求单放上画布");
      return {
        assignments: production.plan.assignments, episodes: production.plan.episodes ?? null,
        brief: { title: brief.title, rows: brief.metadata?.card?.rows ?? [] },
      };
    },
  },
  {
    name: "script",
    run: async (run, ctx) => {
      const api = ctx.api;
      const done = await until("编剧交回分集（production.tasks 里 script 结束）", async () => {
        const canvas = await api("GET", `/api/team-projects/${run.projectId}/canvas`);
        const production = canvas.body?.production;
        if (!production) return false;
        const task = (production.tasks as any[]).findLast((one) => one.job === "script");
        if (!task || task.status === "working") return false;
        return { task, production };
      }, Number(arg("timeout") || 600) * 1000, 2_000);
      if (done.task.status !== "done") {
        throw new StepFailure("script", "编剧没有完成分集", `script 任务状态 ${done.task.status}；${await lastFailure(run, api, done.task.botId)}`);
      }
      const canvas = await api("GET", `/api/team-projects/${run.projectId}/canvas`);
      const episodes = (canvas.body.nodes as any[]).filter((node) => node.metadata?.role === "episode");
      if (!episodes.length) throw new StepFailure("script", "编剧结束了，但画布上没有分集", "production.tasks 里 script 是 done，但画布没有 metadata.role 为 episode 的节点");
      return {
        episodes: episodes.map((node) => ({ id: node.id, episode: node.metadata?.episode, title: node.title, chars: String(node.metadata?.content ?? "").length })),
        jobs: canvas.body.production?.jobs ?? [],
      };
    },
  },
  {
    name: "outline",
    run: async (run, ctx) => {
      const api = ctx.api;
      const file = join(run.folder, "outline.json");
      if (!existsSync(file)) {
        return {
          outlineJson: null,
          note: "本项目走的是 MagicBot 自己的制作流水线：S1/S2 的产物是画布上的分集剧本节点，仓库里没有 outline.json 这一层",
          episodes: (await api("GET", `/api/team-projects/${run.projectId}/canvas`)).body.nodes.filter((node: any) => node.metadata?.role === "episode").length,
        };
      }
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const skills = process.env.OMB_E2E_DRAMA_SKILLS?.trim() ?? "";
      const checked = skills ? await runPython(join(skills, "drama-adapt", "scripts", "check.py"), ["outline", run.folder]) : null;
      return {
        outlineJson: { path: file, episodes: Array.isArray(raw.episodes) ? raw.episodes.length : null, characters: Array.isArray(raw.characters) ? raw.characters.length : null },
        dramaAdaptCheck: checked ?? "未设置 OMB_E2E_DRAMA_SKILLS，没有跑 drama-adapt 的 check.py",
      };
    },
  },
];

/** Waits until no bot is at work, then reads the last thing `botId` said in its own conversation. */
async function settleAndReply(run: Run, api: ReturnType<typeof makeApi>, botId: string, timeoutMs: number): Promise<string> {
  await until("所有成员都停下来", async () => {
    const listed = await api("GET", "/api/bots?messages=0");
    return (listed.body.bots as any[]).every((bot) => !bot.busy);
  }, timeoutMs, 1_000);
  const thread = run.threadIds[botId] ?? botId;
  const messages = await api("GET", `/api/threads/${thread}/messages?limit=200`);
  const said = (messages.body.messages as any[]).filter((one) => one.role === "bot" && one.kind === "text" && one.text);
  if (!said.length) throw new StepFailure("ask", "负责人没有回话", `线程 ${thread} 里没有它的回复；服务端日志 ${run.logPath}`);
  return String(said.at(-1)!.text);
}

/** The last failure a bot's own conversation shows, for a step's readable reason. */
async function lastFailure(run: Run, api: ReturnType<typeof makeApi>, botId: string): Promise<string> {
  const thread = run.threadIds[botId] ?? botId;
  const messages = await api("GET", `/api/threads/${thread}/messages?limit=200`);
  const failed = (messages.body.messages as any[]).filter((one) => one.turnSucceeded === false || one.tool?.ok === false);
  const last = failed.at(-1);
  return last ? `最后一次失败：${last.text ?? last.tool?.name ?? "未知"}`.slice(0, 400) : "没有看到失败记录";
}

function runPython(script: string, args: string[]): Promise<string> {
  if (!existsSync(script)) return Promise.resolve(`不存在：${script}`);
  return new Promise((resolve) => {
    const child = spawn(process.env.OMB_E2E_PYTHON?.trim() || "python3", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.once("close", (code) => resolve(`exit ${code}: ${out.trim().slice(0, 600)}`));
    child.once("error", (error) => resolve(`跑不起来：${error.message}`));
  });
}

let server: ReturnType<typeof spawn> | undefined;

/** Rebuilds what a resumed run needs from the checkpoints its earlier run wrote. */
function restore(run: Run, done: Map<string, any>): void {
  const at = (step: string) => done.get(step)?.artifacts as Record<string, any> | undefined;
  const launch = at("launch");
  if (launch?.url) {
    run.url = launch.url;
    run.dataDir = launch.dataDir ?? "";
    run.logPath = launch.logPath ?? "";
    run.pid = Number(launch.pid) || 0;
  }
  const config = at("config");
  if (config?.lead?.id) {
    run.leadId = config.lead.id;
    run.root = config.projectRoot;
    run.bots = (config.bots as any[]).map((bot) => ({ ...bot }));
    for (const bot of run.bots) run.threadIds[bot.id] ??= "";
  }
  const project = at("project");
  if (project?.projectId) {
    run.projectId = project.projectId;
    run.folder = project.folder;
    run.generationUrl = project.generation?.url ?? run.generationUrl;
  }
  const pool = at("pool");
  if (pool?.candidates) {
    run.candidates = (pool.candidates as any[]).map((one) => ({ fanqieBookId: one.id, bookName: one.name, categoryName: one.category }));
  }
  const chosen = at("choose")?.chosen;
  if (chosen?.id) run.chosen = { fanqieBookId: chosen.id, bookName: chosen.name, categoryName: chosen.category };
}

async function main(): Promise<number> {
  const parsed = modelFromEnv(process.env);
  if ("missing" in parsed) {
    process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "没有配置文本模型，这一轮什么都没做", missing: parsed.missing }, null, 2)}\n`);
    return 0;
  }
  const provider = parsed.provider;

  const runDir = process.env.OMB_E2E_RUN_DIR?.trim() || mkdtempSync(join(tmpdir(), "omb-drama-e2e-"));
  mkdirSync(runDir, { recursive: true });
  const run: Run = {
    runDir, checkpointDir: join(runDir, "checkpoints"), evidenceDir: join(runDir, "evidence"),
    url: "", dataDir: "", logPath: "", pid: 0, root: "", projectId: "", folder: "", leadId: "", threadIds: {}, bots: [], generationUrl: "", candidates: [],
  };
  const done = readCheckpoints(run);
  const resumed = done.size > 0;
  if (resumed) restore(run, done);
  const api = makeApi(run);

  const release = takeUiLock(`e2e-story ${process.pid}`);
  if (!release && !flags.has("--no-lock")) {
    const owner = (() => { try { return readFileSync(join(UI_LOCK, "owner"), "utf8").trim(); } catch { return "（读不到 owner）"; } })();
    const pid = Number(owner.split(/\s+/)[1]);
    const stale = Number.isInteger(pid) && pid > 0 && (() => { try { process.kill(pid, 0); return false; } catch { return true; } })();
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: `界面上有一个夹具正占着 ${UI_LOCK}（owner: ${owner}${stale ? "，那个进程已经不在了，是别的夹具留下的" : ""}），这一轮没有启动`,
      fix: stale ? "确认没有别的夹具在跑后加 --no-lock" : "等它跑完，或加 --no-lock",
    }, null, 2)}\n`);
    return 1;
  }

  if (resumed && run.url && !(await fetch(`${run.url}/api/health`, { signal: AbortSignal.timeout(1_000) }).then((one) => one.ok).catch(() => false))) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: "这条 --run-dir 的上一个服务端已经退出，跳过的步骤没有服务端可依", fix: "去掉 --run-dir 重新跑一遍；检查点保留在旧目录" }, null, 2)}\n`);
    release?.();
    return 1;
  }
  if (!run.url) run.url = `http://127.0.0.1:${DEFAULT_PORT}`;

  const fake = await startFakeGenerationMcp({ key: "e2e-fake-generation", taskMs: 300 });
  run.generationUrl = fake.url;
  // A resumed run gets a new fake server: point the project's settings at it, or S3's videos would reach the old one.
  if (run.projectId) {
    await api("DELETE", "/api/mcp/servers/gen");
    await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: "Bearer e2e-fake-generation" } });
    await api("PATCH", "/api/mcp/servers/gen", { enabled: true });
  }

  const from = arg("from");
  const fromIndex = from ? steps.findIndex((step) => step.name === from) : 0;
  if (from && fromIndex < 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: `没有名为 ${from} 的步骤`, steps: steps.map((step) => step.name) }, null, 2)}\n`);
    await fake.close();
    release?.();
    return 1;
  }

  const report: Array<Record<string, unknown>> = [];
  let failure: StepFailure | Error | null = null;
  for (const [index, step] of steps.entries()) {
    if (index < fromIndex) continue;
    const already = done.get(step.name);
    if (already && !flags.has("--force")) {
      report.push({ step: step.name, status: "already done", ms: already.ms, artifacts: already.artifacts });
      process.stdout.write(`— ${step.name}：这一轮已通过（${already.ms} ms），跳过\n`);
      continue;
    }
    const startedAt = now();
    const started = Date.now();
    process.stdout.write(`▶ ${step.name}\n`);
    try {
      const artifacts = await step.run(run, { api, provider });
      const ms = Date.now() - started;
      writeCheckpoint(run, index, step.name, { status: "ok", startedAt, ms, artifacts });
      report.push({ step: step.name, status: "ok", ms, artifacts });
      process.stdout.write(`✓ ${step.name}（${ms} ms）${summaryOf(artifacts)}\n`);
    } catch (error) {
      const ms = Date.now() - started;
      const readable = error instanceof StepFailure ? error
        : new StepFailure(step.name, "没有走到这一步要的结果", error instanceof Error ? error.message : String(error));
      writeCheckpoint(run, index, step.name, { status: "failed", startedAt, ms, error: readable.message });
      report.push({ step: step.name, status: "failed", ms, error: readable.message });
      process.stderr.write(`✗ ${step.name}：${readable.need}\n  ${readable.detail}\n  服务端日志：${run.logPath || "（还没启动）"}\n`);
      failure = readable;
      break;
    }
  }

  await fake.close();
  const keepServer = Boolean(failure) && Boolean(server) && !flags.has("--stop-on-failure");
  if (server && !keepServer) await waitForExit(server, { signal: "SIGTERM", graceMs: 10_000 });
  // A resumed run has no child handle: the server it reused is stopped by its own pid, once it answers as ours.
  if (!server && !keepServer && run.pid) await stopKeptServer(run);
  // Kept for `--from`: the child's own file descriptors let it outlive this process, and unref lets this one exit.
  if (server && keepServer) server.unref();
  if (!flags.has("--keep") && run.dataDir && (!failure || !keepServer)) await removeTempDir(run.dataDir);
  release?.();

  const offlinePick = offlinePickFromFixture();
  process.stdout.write(`${JSON.stringify({
    ok: !failure,
    runDir,
    checkpoints: readdir(run.checkpointDir).sort(),
    report,
    reached: run.chosen?.bookName ?? null,
    offline: offlinePick,
    ...(keepServer ? {
      server: {
        url: run.url, pid: run.pid, logPath: run.logPath,
        note: `服务端还在跑：修好原因后用 --run-dir "${runDir}" --from ${failure instanceof StepFailure ? failure.step : "…"} 接着跑；用完 kill ${run.pid}`,
      },
    } : {}),
    ...(failure ? { error: failure.message } : {}),
  }, null, 2)}\n`);
  return failure ? 1 : 0;
}

/** Whether the committed snapshot alone answers "pick a 修仙 book", independent of how far this run got. */
function offlinePickFromFixture(): Record<string, unknown> {
  const file = join(ROOT, "scripts", "testing", "fixtures", "fanqie-ip-pool.json");
  try {
    const pool = JSON.parse(readFileSync(file, "utf8")) as PoolSnapshot;
    const picked = pickXianxia(pool.books, 1)[0];
    return {
      canPickXianxiaBookOffline: Boolean(picked),
      firstPick: picked ? { name: picked.bookName, category: picked.categoryName, id: picked.fanqieBookId, facts: bookFacts(picked) } : null,
      pool: `${file}（${pool.books.length} 行，真实 /open/ip/recall 数据）`,
      livePool: "改从接口取要 OMB_E2E_IP_SCOUT_KEY 和联网；接口是 https://hot-video-pro.hongmaocy.com/api，用 X-Api-Key 认证",
    };
  } catch (error) {
    return { canPickXianxiaBookOffline: false, pool: `${file} 读不出来（${error instanceof Error ? error.message : String(error)}）` };
  }
}

async function stopKeptServer(run: Run): Promise<boolean> {
  const health = await fetch(`${run.url}/api/health`, { signal: AbortSignal.timeout(2_000) })
    .then((one) => (one.ok ? one.json() : null)).catch(() => null) as { app?: string; pid?: number } | null;
  if (!health || health.app !== "openmausbot" || health.pid !== run.pid) return false;
  try { process.kill(run.pid, "SIGTERM"); } catch { return false; }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const alive = await fetch(`${run.url}/api/health`, { signal: AbortSignal.timeout(500) }).then(() => true).catch(() => false);
    if (!alive) return true;
    await sleep(200);
  }
  return false;
}

function summaryOf(artifacts: Record<string, unknown>): string {  const bits: string[] = [];
  if (typeof artifacts.projectId === "string") bits.push(`项目 ${artifacts.projectId}`);
  if (typeof artifacts.reply === "string") bits.push(`负责人回话 ${String(artifacts.reply).length} 字`);
  if (typeof artifacts.chosen === "object" && artifacts.chosen) bits.push(`选定 ${(artifacts.chosen as any).name}`);
  if (Array.isArray(artifacts.episodes)) bits.push(`分集 ${(artifacts.episodes as unknown[]).length}`);
  if (typeof artifacts.url === "string") bits.push(String(artifacts.url));
  return bits.length ? ` — ${bits.join("，")}` : "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch(async (error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    if (server) await waitForExit(server, { signal: "SIGTERM" });
    process.exitCode = 1;
  });
}
