// The project canvas in a real browser. First the production board on a disposable server with the scripted fake engine
// and generation's test MCP server, inside the app's store: the lead plans three episodes made one at a time, EP01 is
// made and cut, EP02's storyboard fails and EP03's is held at work. The board shows the five stages and their states,
// EP01 folded into the stack, lines done, active and waiting, and reference lines only when asked for; a card the
// person drags is where it was let go after a reload; Retry sends EP02 back to wait its turn and the production ends by
// itself; the stack unfolds EP01, a take generated again gives way to the first by "Use this take", and zoomed far out
// the board draws labels only, in the light skin and the dark, at a normal and a small window. Then in the app itself:
// a click on the sidebar's project row opens its group chat under the project's top bar, its switch opens the board
// and goes back, a click on the open project folds it, the top bar reaches the project's group chats and team changes,
// a bot who joins is drawn at once clear of the others, a search for a part of the project's name keeps its one row and
// one for the writer finds no project, a project archived while open gives way to the main bot, and the project's
// settings cover the whole board while a terminal's sign-in card stays above them; at the app's smallest window, in both
// skins, the minimap starts folded until its button opens it, and the board's bars neither overlap nor leave the board.
// Last, the sixty-episode sample on the in-memory backend draws only what is in view; how long it takes to open, and the
// frames of a zoom and a pan, are kept as evidence. Nothing here reaches the user's data, JianYing or port 8799.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { botNodeId, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { TeamProjectMembership, TeamProjectWire } from "../../shared/team-projects.ts";
import { closeBrowserSession, resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { startFakeGenerationMcp } from "../../server/testing/fake-generation-mcp-server.ts";
import { hostTimeout } from "../../server/testing/host-timeout.ts";
import { GENERATION_KEY } from "../../server/testing/project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "../../server/testing/restartable-server.ts";
import { agentBrowser, ensureUiBrowser, searchSidebar, sessionEnv, UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
if (!enabled) console.info("skipping the project canvas UI e2e: set OMB_UI_E2E=1 to install the pinned browser");
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

const TEAM = "Drama crew";
const LIST = "Characters: Mei, the bride. Scenes: the harbour at night.";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };
const WINDOWS = [{ name: "normal", width: 1440, height: 900 }, { name: "small", width: 760, height: 560 }] as const;
const SKINS = ["daylight", "midnight"] as const;
type Bot = { id: string; name: string; title?: string; threadId: string; busy?: boolean; defaultBot?: object };
type StoredBot = { id: string; teamProject?: TeamProjectMembership };
type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

const add = (id: string, nodeType: string, title: string, metadata: Record<string, unknown>) => ({ type: "add_node", id, nodeType, title, metadata });
const connect = (fromNodeId: string, toNodeId: string) => ({ type: "connect_nodes", fromNodeId, toNodeId });
const apply = (...ops: unknown[]) => ({ tool: "canvas_apply_ops", arguments: { ops } });
const shotNode = (id: string, title: string) => add(id, "shot", title, { prompt: `${title}: the bride runs along the water`, shot: { size: "wide", move: "slow push-in" }, settings: { seconds: 5 } });
const episodeNode = (number: number, title: string) => add(`ep-${number}`, "text", title, { content: `EXT. HARBOUR, NIGHT. Episode ${number}.`, role: "episode", episode: number, card: { subtitle: `Logline ${number}` } });

/** The page's DevTools socket, for input the page takes as the person's own. */
async function devtools(browserUrl: string) {
  const pages = await (await fetch(`http://${new URL(browserUrl).host}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const socket = new WebSocket(pages.find((one) => one.type === "page")!.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const waiting = new Map<number, { done: (value: unknown) => void; fail: (error: Error) => void }>();
  let serial = 0;
  socket.onmessage = (event) => {
    const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } };
    const waiter = reply.id === undefined ? undefined : waiting.get(reply.id);
    if (!waiter) return;
    waiting.delete(reply.id!);
    if (reply.error) waiter.fail(new Error(reply.error.message));
    else waiter.done(reply);
  };
  return {
    send: (method: string, params: object) => new Promise((done, fail) => {
      serial += 1;
      waiting.set(serial, { done, fail });
      socket.send(JSON.stringify({ id: serial, method, params }));
    }),
    close: () => socket.close(),
  };
}

function frameStats(frames: readonly number[]) {
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (share: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]! * 10) / 10;
  return { frames: sorted.length, p50: at(0.5), p95: at(0.95), max: Math.round(sorted.at(-1)! * 10) / 10, over33: sorted.filter((one) => one > 33.4).length };
}

function pageTools(binary: string, env: () => NodeJS.ProcessEnv) {
  const browser = (...args: string[]) => agentBrowser(binary, env(), args, 60_000);
  const evaluate = async <T = unknown>(js: string) => (await browser("eval", js)).result as T;
  const waitFor = (js: string, message: string, timeout = 30_000) =>
    expect.poll(() => evaluate<boolean>(`Boolean(${js})`), { timeout, interval: 250, message }).toBe(true);
  const box = (selector: string) => evaluate<Box | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const centre = (found: Box): Point => ({ x: found.x + found.w / 2, y: found.y + found.h / 2 });
  const move = (x: number, y: number) => browser("mouse", "move", String(Math.round(x)), String(Math.round(y)));
  const clickAt = async (x: number, y: number) => {
    await move(x, y);
    await browser("mouse", "down", "left");
    await browser("mouse", "up", "left");
  };
  const clickSelector = async (selector: string) => {
    const found = await box(selector);
    if (!found) throw new Error(`${selector} is not on the page`);
    const point = centre(found);
    await clickAt(point.x, point.y);
  };
  const clickButton = async (label: string, scope: string) => {
    const found = await evaluate<Box | null>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (!found) throw new Error(`no button "${label}" in ${scope}`);
    const point = centre(found);
    await clickAt(point.x, point.y);
  };
  const drag = async (from: Point, to: Point) => {
    await move(from.x, from.y);
    await browser("mouse", "down", "left");
    for (let step = 1; step <= 8; step += 1) await move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
    await browser("mouse", "up", "left");
  };
  const emptySpot = () => evaluate<Point | null>(`(() => {
    const stage = document.querySelector("[data-production-board]").getBoundingClientRect();
    for (let y = stage.top + 90; y < stage.bottom - 220; y += 30) for (let x = stage.left + 260; x < stage.right - 60; x += 30) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest("[data-production-board]") && !hit.closest("[data-board-card-id], [data-board-chrome], [data-board-edge-label], button")) return { x, y };
    }
    return null;
  })()`);
  const card = (id: string) => `[data-board-card-id=${JSON.stringify(id)}]`;
  const drawn = () => evaluate<string[]>("[...document.querySelectorAll('[data-board-card-id]')].map((one) => one.dataset.boardCardId)");
  const stages = () => evaluate<Record<string, string>>("Object.fromEntries([...document.querySelectorAll('[data-board-stage]')].map((one) => [one.dataset.boardStage, one.dataset.stageState]))");
  const lines = () => evaluate<Record<string, string>>("Object.fromEntries([...document.querySelectorAll('[data-board-edge]')].map((one) => [one.dataset.boardEdge, one.dataset.edgeState]))");
  const zoom = () => evaluate<string>("document.querySelector('[data-board-zoom]')?.textContent ?? ''");
  const scale = () => evaluate<number>("new DOMMatrix(getComputedStyle(document.querySelector('[data-board-world]')).transform).a");
  const settle = () => sleep(450);
  const fitAll = async () => {
    await clickSelector('button[aria-label="Fit to view"]');
    await settle();
  };
  const focusStage = async (stage: string) => {
    await clickSelector(`[data-board-stage=${JSON.stringify(stage)}]`);
    await settle();
  };
  const zoomOutToFar = async () => {
    for (let tries = 0; tries < 14 && !(await evaluate<boolean>("Boolean(document.querySelector('[data-board-far]'))")); tries += 1) {
      await clickSelector('button[aria-label="Zoom out"]');
      await sleep(300);
    }
  };
  return { browser, evaluate, waitFor, box, clickAt, clickSelector, clickButton, drag, emptySpot, card, drawn, stages, lines, zoom, scale, settle, fitAll, focusStage, zoomOutToFar };
}

(enabled ? it : it.skip)("draws a drama's production as its board from the server, keeps what the person moves, retries what stopped, and holds its place in the app", async () => {
  const tools = await ensureUiBrowser();
  let server: RestartableServer | undefined;
  let fake: Awaited<ReturnType<typeof startFakeGenerationMcp>> | undefined;
  let root: string | undefined;
  let home: string | undefined;
  let preview: MountedPreview | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  const evidence: Record<string, unknown> = {};
  const page = pageTools(tools.binary, () => env!);
  const { browser, evaluate, waitFor, box, clickAt, clickSelector, clickButton, drag, card, drawn, stages, lines, zoom, scale, settle, fitAll, focusStage, zoomOutToFar } = page;
  const shot = async (name: string) => {
    if (evidenceDir) await browser("screenshot", join(evidenceDir, name));
  };
  try {
    fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 300 });
    server = await launchRestartableServer({ scripted: true });
    const fixture = server;
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-canvas-ui-")));
    // agent-browser 0.37 refuses a socket path over 103 bytes, and it lives under this home.
    home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-pc-"));
    mkdirSync(join(home, "tmp"));
    env = sessionEnv({ home, session: "pc", chrome: tools.chrome });
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });

    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(fixture.url + path, {
        method,
        headers: { "content-type": "application/json", origin: fixture.url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const answer = await response.json() as any;
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(answer)}`);
      return answer;
    };
    const bots = async () => (await api("GET", "/api/bots?messages=0")).bots as Bot[];
    const settled = () => expect.poll(async () => (await bots()).some((one) => one.busy), { timeout: 30_000 }).toBe(false);

    await api("PUT", "/api/team-projects/root", { path: root });
    const member = async (name: string, title: string, color?: string) => {
      const made = (await api("POST", "/api/bots", { name, section: TEAM })).bot as Bot;
      await api("PATCH", `/api/bots/${made.id}`, { title, ...(color ? { color } : {}) });
      return made;
    };
    const team = {
      lead: await member("Mo", "Showrunner", "purple"),
      writer: await member("Ink", "Screenwriter", "teal"),
      faces: await member("Jade", "Character designer"),
      sets: await member("Hall", "Scene designer"),
      boarder: await member("Frame", "Storyboard artist"),
      cutter: await member("Cut", "Editor"),
    };
    await api("PATCH", `/api/bots/${team.lead.id}`, { chiefOfStaff: true });
    await settled();
    const project = (await api("POST", "/api/team-projects", { name: "Harbour bride", team: TEAM })).project as TeamProjectWire;
    await settled();
    const stored = JSON.parse(readFileSync(join(fixture.dataDir, "bots.json"), "utf8")) as StoredBot[];
    const listed = await bots();
    const copyOf = (source: Bot) => listed.find((bot) => bot.id === stored.find((one) => one.teamProject?.id === project.id && one.teamProject.source === source.id)!.id)!;
    const lead = copyOf(team.lead);
    const writer = copyOf(team.writer);
    expect(lead.id).toBe(project.leadBotId);
    await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } });
    await api("PATCH", "/api/mcp/servers/gen", { enabled: true });
    await api("PUT", `/api/team-projects/${project.id}/generation/settings`, { image: IMAGE, video: VIDEO, concurrency: { episodes: 1, videos: 2, images: 2 } });

    const gate = join(fixture.dataDir, "gate-ep03");
    writeFileSync(fixture.planPath, JSON.stringify({
      [lead.id]: { script: [
        { key: "plan", match: ["MAKE-THE-DRAMA"], reply: "The production is planned.", steps: [
          { tool: "production_plan", arguments: { brief: [["Episodes", "3 × 1 min"], ["Style", "Period romance"]], episodes: 3 } },
        ] },
        { key: "any", match: [""], repeat: true, reply: "Noted." },
      ] },
      [writer.id]: { script: [{ key: "script", match: ["adapt the source into 3 episodes"], reply: LIST, steps: [
        apply(episodeNode(1, "The swap"), episodeNode(2, "The flight"), episodeNode(3, "The return")),
      ] }] },
      [copyOf(team.faces).id]: { script: [{ key: "characters", match: ["Design the drama's characters"], reply: "Mei is on the canvas.", steps: [apply(
        add("mei", "text", "Mei", { content: "The bride, 24, a seamstress.", role: "character", card: { badge: "Lead", subtitle: "24, seamstress", tags: ["calm"] } }),
        add("mei-front", "image", "Mei, front", { prompt: "Front view, white dress" }),
        connect("mei", "mei-front"),
      )] }] },
      [copyOf(team.sets).id]: { script: [{ key: "scenes", match: ["Design the drama's scenes"], reply: "The harbour is on the canvas.", steps: [apply(
        add("harbour", "text", "Harbour", { content: "A stone quay, lamps in fog.", role: "scene", card: { subtitle: "Night, the old port" } }),
        add("harbour-night", "image", "Harbour at night", { prompt: "A stone quay at night, lamps in fog" }),
        connect("harbour", "harbour-night"),
      )] }] },
      "*": { script: [
        { key: "board-1", match: ["you are the storyboard bot of EP01"], reply: "Two shots.", steps: [
          apply(shotNode("ep1-s1", "1-1"), shotNode("ep1-s2", "1-2"), connect("mei-front", "ep1-s1"), connect("harbour-night", "ep1-s1")),
        ] },
        { key: "board-2-fails", match: ["you are the storyboard bot of EP02"], fail: true },
        { key: "board-2", match: ["you are the storyboard bot of EP02"], reply: "One shot.", steps: [apply(shotNode("ep2-s1", "2-1"))] },
        { key: "board-3", match: ["you are the storyboard bot of EP03"], reply: "One shot.", gateFile: gate, steps: [
          apply(shotNode("ep3-s1", "3-1"), connect("harbour-night", "ep3-s1")),
        ] },
        { key: "post", match: ["you are the post bot of"], repeat: true, reply: "The cut is ready." },
      ] },
    }));
    const canvasPath = `/api/team-projects/${project.id}/canvas`;
    const snapshot = async () => await api("GET", canvasPath) as CanvasSnapshot;
    const statuses = async () => (await snapshot()).production?.episodes.map((one) => one.status) ?? [];

    await api("POST", `/api/bots/${lead.id}/messages`, { text: "MAKE-THE-DRAMA", threadId: lead.threadId, sendId: randomUUID() });
    await expect.poll(statuses, { timeout: 240_000, interval: 1_000, message: "EP01 made, EP02 stopped and EP03 at its storyboard" }).toEqual(["done", "failed", "storyboard"]);
    await expect.poll(async () => (await snapshot()).nodes.some((one) => one.id === "ep3-s1"), { timeout: 30_000, message: "EP03's shot on the canvas" }).toBe(true);
    const midway = await snapshot();
    evidence.midway = midway.production;
    const episodeWire = (episode: number) => midway.production!.episodes.find((one) => one.episode === episode)!;
    const boarderOf = (episode: number) => botNodeId(episodeWire(episode).storyboardBotId!);
    const brief = midway.nodes.find((one) => one.metadata?.role === "brief")!;

    preview = await mountPreview({ info: { url: fixture.url } }, { entry: "/scripts/testing/project-canvas-server-preview.tsx", route: "/__project-canvas.html", title: "Project canvas on a server", logLevel: "warn" });
    const pageUrl = (skin: string) => `${preview!.previewUrl}?project=${encodeURIComponent(project.id)}&skin=${skin}`;
    const openBoard = async (skin = "daylight") => {
      await browser("open", pageUrl(skin));
      await waitFor(`document.querySelector(${JSON.stringify(card(botNodeId(writer.id)))})`, "the writer's card on the board", 120_000);
      await settle();
    };

    try {
      await browser("set", "viewport", "1440", "900");
      await openBoard();
      expect(await drawn()).toEqual(expect.arrayContaining([botNodeId(lead.id), brief.id, botNodeId(writer.id)]));
      expect(await stages()).toEqual({ brief: "done", script: "done", library: "done", storyboard: "failed", post: "active" });
      await shot("00-opens-on-the-brief-and-the-writer.png");

      await fitAll();
      const whole = await drawn();
      evidence.midwayCards = whole;
      expect(whole).toEqual(expect.arrayContaining(["stack", "ep-2", "ep-3", boarderOf(2), boarderOf(3), "ep3-s1", "mei", "harbour"]));
      expect(whole).not.toContain("ep-1");
      expect(whole).not.toContain("ep1-s1");
      const midwayLines = await lines();
      evidence.midwayLines = midwayLines;
      expect(midwayLines).toMatchObject({
        [`output:${botNodeId(lead.id)}>${brief.id}`]: "done",
        [`dispatch:ep-3>${boarderOf(3)}`]: "active",
        [`output:${boarderOf(3)}>ep3-s1`]: "active",
        [`dispatch:ep-2>${boarderOf(2)}`]: "wait",
        [`output:${botNodeId(writer.id)}>stack`]: "done",
      });
      expect(Object.keys(midwayLines).some((id) => id.startsWith("ref:"))).toBe(false);
      await shot("01-the-whole-board-midway.png");

      await clickButton("Show reference lines", '[role="toolbar"]');
      await waitFor(`document.querySelector('[data-board-edge="ref:harbour>ep3-s1"]')`, "the harbour's reference line once asked for");
      await shot("02-reference-lines-shown.png");
      await clickButton("Show reference lines", '[role="toolbar"]');
      await waitFor(`!document.querySelector('[data-edge-kind="ref"]')`, "no reference line once put away");

      await focusStage("storyboard");
      expect(await evaluate<string>(`document.querySelector('[data-board-edge-label=${JSON.stringify(`dispatch:ep-3>${boarderOf(3)}`)}]')?.textContent ?? ""`)).toBe("Dispatch EP03");
      for (const skin of SKINS) {
        for (const size of WINDOWS) {
          await browser("set", "viewport", String(size.width), String(size.height));
          await openBoard(skin);
          await shot(`03-midway-${skin}-${size.name}.png`);
          await focusStage("storyboard");
          await shot(`04-midway-storyboards-${skin}-${size.name}.png`);
          await fitAll();
          await shot(`05-midway-whole-${skin}-${size.name}.png`);
        }
      }

      await browser("set", "viewport", "1440", "900");
      await openBoard();
      const where = () => evaluate<Point>(`(() => { const e = document.querySelector(${JSON.stringify(card(brief.id))}); return { x: Math.round(parseFloat(e.style.left)), y: Math.round(parseFloat(e.style.top)) }; })()`);
      const drawnAt = await where();
      const briefBox = (await box(card(brief.id)))!;
      const zoomed = await scale();
      const grab = { x: Math.round(briefBox.x + briefBox.w / 2), y: Math.round(briefBox.y + 14) };
      await drag(grab, { x: grab.x + 180, y: grab.y + 120 });
      const placed = { x: drawnAt.x + 180 / zoomed, y: drawnAt.y + 120 / zoomed };
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === brief.id), { timeout: 15_000, message: "the brief kept where it was let go" })
        .toMatchObject({ arranged: true });
      const moved = (await snapshot()).nodes.find((one) => one.id === brief.id)!;
      expect(Math.abs(moved.position.x - placed.x)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(moved.position.y - placed.y)).toBeLessThanOrEqual(1.5);
      await openBoard();
      expect(await where()).toEqual(moved.position);
      evidence.drag = { from: drawnAt, to: moved.position };
      await shot("06-the-brief-where-it-was-let-go-after-a-reload.png");

      await focusStage("script");
      await clickButton("Retry", card("ep-2"));
      await expect.poll(statuses, { timeout: 15_000, message: "EP02 back to wait its turn" }).toEqual(["done", "waiting", "storyboard"]);
      expect((await snapshot()).production!.tasks.some((task) => task.episode === 2 && task.status === "failed")).toBe(false);
      await waitFor(`!document.querySelector(${JSON.stringify(card("ep-2"))})`, "EP02 folded into the stack");
      await shot("07-ep02-waits-in-the-stack-after-retry.png");

      writeFileSync(gate, "go");
      await expect.poll(async () => (await snapshot()).production?.endedAt, { timeout: 240_000, interval: 1_000, message: "every episode done" }).toBeTypeOf("number");
      await settled();
      const ended = await snapshot();
      evidence.ended = ended.production;
      expect(ended.production!.episodes.map((one) => one.status)).toEqual(["done", "done", "done"]);
      await waitFor(`!document.querySelector(${JSON.stringify(card("ep-3"))}) && document.querySelector(${JSON.stringify(card("stack"))})`, "every episode folded into the stack");
      expect(await stages()).toEqual({ brief: "done", script: "done", library: "done", storyboard: "done", post: "done" });

      await focusStage("script");
      await clickSelector(`${card("stack")} article`);
      await waitFor(`document.querySelectorAll("[data-board-stack-episode]").length === 3`, "the stack's episodes in its menu");
      await shot("08-the-stack-menu.png");
      await clickSelector('[data-board-stack-episode="1"]');
      await waitFor(`document.querySelector(${JSON.stringify(card("ep-1"))})`, "EP01 unfolded");
      await focusStage("storyboard");
      await waitFor(`document.querySelector(${JSON.stringify(card("result:ep1-s1"))})`, "EP01's first result card");
      expect(await drawn()).toEqual(expect.arrayContaining(["ep1-s1", "ep1-s2", "result:ep1-s1", "result:ep1-s2", boarderOf(1)]));
      await shot("09-ep01-unfolded.png");

      const takesOf = async (shotId: string) => (await snapshot()).nodes.filter((one) => one.metadata?.role === "take" && one.metadata.shotId === shotId);
      const [firstTake] = await takesOf("ep1-s1");
      await clickButton("Generate again", card("result:ep1-s1"));
      await expect.poll(async () => (await takesOf("ep1-s1")).length, { timeout: 30_000, message: "a second take of 1-1" }).toBe(2);
      await expect.poll(async () => (await takesOf("ep1-s1")).find((one) => one.metadata?.selected)?.id, { timeout: 15_000 }).not.toBe(firstTake!.id);
      await waitFor(`document.querySelectorAll(${JSON.stringify(`${card("result:ep1-s1")} [data-result-take]`)}).length === 2`, "both takes on the result card");
      await clickSelector(`${card("result:ep1-s1")} [data-result-take][title="Take 1"]`);
      await clickButton("Use this take", card("result:ep1-s1"));
      await expect.poll(async () => (await takesOf("ep1-s1")).find((one) => one.metadata?.selected)?.id, { timeout: 15_000, message: "the first take used again" }).toBe(firstTake!.id);
      await shot("10-the-first-take-used-again.png");

      await zoomOutToFar();
      expect(await evaluate<number>("document.querySelectorAll('[data-board-far]').length")).toBe((await drawn()).length);
      expect(await evaluate<number>("document.querySelectorAll('article[data-board-card], [data-board-edge-label]').length")).toBe(0);
      evidence.farZoom = await zoom();
      await shot("11-far-out-labels-only.png");
      evidence.boardConsole = (await browser("console")).messages;
      expect(JSON.stringify(evidence.boardConsole)).not.toMatch(/Uncaught|ReferenceError|TypeError/);
    } catch (error) {
      await shot("failed-board.png").catch(() => {});
      throw error;
    }

    try {
      const main = (await bots()).find((one) => one.defaultBot)!;
      await api("PATCH", `/api/bots/${main.id}`, { welcomed: true });
      const room = (await api("POST", "/api/groups", { name: "Table read", memberIds: [lead.id, writer.id], section: project.section })).group as { id: string };
      await api("PATCH", `/api/groups/${room.id}/setup`, { action: "complete", bulletin: "", defaultResponder: { kind: "member", botId: lead.id } });
      const teamColorist = await member("Colorist", "Grades the picture", "orange");
      await settled();
      await preview.close();
      preview = await mountPreview({ info: { url: fixture.url } }, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Projects in the app", logLevel: "warn" });
      await browser("open", preview.previewUrl);
      const writerCard = card(botNodeId(writer.id));
      const projectRow = `[data-sidebar-project-row=${JSON.stringify(project.id)}]`;
      const roomRow = `[data-sidebar-project-room=${JSON.stringify(project.roomId)}]`;
      const botRow = (id: string) => `[data-sidebar-project-bot=${JSON.stringify(id)}]`;
      const chatBar = `[data-project-chat=${JSON.stringify(project.id)}]`;
      const view = `[data-project-view=${JSON.stringify(project.id)}]`;
      const slot = `${view} [data-project-canvas-slot]`;
      const mainOpen = `[data-sidebar-bot-row=${JSON.stringify(main.id)}][aria-current="page"]`;
      const onChat = `${chatBar} [data-project-mode-option="chat"][aria-pressed="true"]`;
      const text = (selector: string) => evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
      const roomChat = async (message: string) => waitFor(`document.querySelector(${JSON.stringify(onChat)})
        && document.querySelector(${JSON.stringify(`${roomRow}[aria-current="page"]`)}) && !document.querySelector(${JSON.stringify(view)})`, message);
      const underProject = () => evaluate<string[]>(`[...document.querySelector(${JSON.stringify(`[data-sidebar-team-project=${JSON.stringify(project.id)}]`)}).children]
        .map((one) => one.dataset.sidebarProjectRoom ? "room" : one.dataset.sidebarProjectBot).filter(Boolean)`);
      const openProject = async () => {
        await waitFor(`document.querySelector(${JSON.stringify(projectRow)})`, "the project in the sidebar", 120_000);
        const open = await evaluate<boolean>(`document.querySelector(${JSON.stringify(projectRow)}).getAttribute("aria-expanded") === "true"`);
        await clickSelector(open ? roomRow : projectRow);
        await roomChat("the project's group chat under the project's top bar");
        await clickSelector(`${chatBar} [data-project-mode-option="canvas"]`);
        await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerCard}`)})`, "the project's board in the app");
      };
      const mainInstead = (message: string) => waitFor(`!document.querySelector(${JSON.stringify(view)}) && document.querySelector(${JSON.stringify(mainOpen)})`, message);
      await waitFor(`document.querySelector(${JSON.stringify(projectRow)})`, "the project in the sidebar", 120_000);
      expect(await evaluate(`[document.querySelector(${JSON.stringify(projectRow)}).getAttribute("aria-expanded"), Boolean(document.querySelector(${JSON.stringify(roomRow)}))]`)).toEqual(["false", false]);
      await clickSelector(projectRow);
      await roomChat("a click on the project opening its group chat");
      expect(await text(`${chatBar} h1`)).toBe(project.name);
      expect(await text(`${chatBar} [data-project-folder]`)).toBe(project.folder);
      const rows = await underProject();
      expect(rows.slice(0, 2)).toEqual(["room", lead.id]);
      expect(rows).toContain(writer.id);
      const roleOf = (id: string) => evaluate<string | null>(`document.querySelector(${JSON.stringify(botRow(id))}).querySelector("[data-sidebar-project-bot-title]")?.textContent ?? null`);
      expect([await roleOf(lead.id), await roleOf(writer.id)]).toEqual(["Showrunner", "Screenwriter"]);
      await shot("20-project-row-opens-its-group-chat.png");
      await clickSelector(botRow(writer.id));
      await waitFor(`document.querySelector(${JSON.stringify(`${botRow(writer.id)}[aria-current="page"]`)}) && document.querySelector(${JSON.stringify(onChat)})
        && !document.querySelector(${JSON.stringify(`${roomRow}[aria-current="page"]`)})`, "the writer's own conversation under the project's top bar");
      await clickSelector(`${chatBar} [data-project-mode-option="canvas"]`);
      await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerCard}`)})`, "the board from the project's switch");
      expect(await evaluate(`document.querySelector(${JSON.stringify(`${slot} [data-project-mode-option="canvas"]`)}).getAttribute("aria-pressed")`)).toBe("true");
      expect(await text(`${slot} [data-project-folder]`)).toBe(project.folder);
      await waitFor(`document.querySelector(${JSON.stringify(`${slot} [data-project-team-changes]`)})`, "the team's change in the top bar");
      await shot("21-the-switch-opens-the-board.png");
      await clickSelector(`${slot} [data-project-mode-option="chat"]`);
      await roomChat("the switch back to the project's group chat");
      await clickSelector(projectRow);
      await waitFor(`!document.querySelector(${JSON.stringify(roomRow)}) && document.querySelector(${JSON.stringify(projectRow)}).getAttribute("aria-current") === "page"`, "the project folded, its row marked");
      await clickSelector(projectRow);
      await roomChat("the folded project opened again on its group chat");
      await clickSelector(`${chatBar} [data-project-mode-option="canvas"]`);
      await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerCard}`)})`, "the board again");

      await clickSelector(`${slot} button[aria-label="Group chats"]`);
      const roomItem = `[role="menu"] [data-menu-key=${JSON.stringify(room.id)}]`;
      await waitFor(`document.querySelector(${JSON.stringify(roomItem)})`, "the project's group chat in the top bar's menu");
      await clickSelector(roomItem);
      await waitFor(`!document.querySelector(${JSON.stringify(view)}) && !document.querySelector('[role="menu"]') && document.body.innerText.includes("Table read")`, "the group chat open");

      await openProject();
      await clickSelector(`${slot} [data-project-team-changes]`);
      await waitFor(`document.querySelector("[data-team-changes] [data-team-changes-apply]")`, "the team's changes to review");
      await clickSelector("[data-team-changes] [data-team-changes-apply]");
      await waitFor(`!document.querySelector(${JSON.stringify(`${slot} [data-project-team-changes]`)})`, "the team's change made");
      let joined: Bot | undefined;
      await expect.poll(async () => (joined = (await bots()).find((one) => one.name === "Colorist" && one.id !== teamColorist.id)) !== undefined, { timeout: 15_000, message: "the colorist's copy in the project" }).toBe(true);
      const colorist = card(botNodeId(joined!.id));
      await fitAll();
      await waitFor(`document.querySelector(${JSON.stringify(`${view} ${colorist}`)})`, "the colorist's card on the board at once");
      const overlapping = await evaluate<string[]>(`(() => {
        const mine = document.querySelector(${JSON.stringify(`${view} ${colorist}`)}).getBoundingClientRect();
        return [...document.querySelectorAll(${JSON.stringify(`${view} [data-board-card-id]`)})].filter((one) => one.dataset.boardCardId !== ${JSON.stringify(botNodeId(joined!.id))}).filter((one) => {
          const r = one.getBoundingClientRect();
          return r.left < mine.right - 1 && mine.left < r.right - 1 && r.top < mine.bottom - 1 && mine.top < r.bottom - 1;
        }).map((one) => one.dataset.boardCardId);
      })()`);
      evidence.colorist = { id: joined!.id, overlapping };
      expect(overlapping).toEqual([]);
      await shot("22-a-bot-who-joins-is-drawn-clear-of-the-others.png");

      const inSidebar = `({ projects: [...document.querySelectorAll("[data-sidebar-team-project]")].map((one) => [one.dataset.sidebarTeamProject, one.children.length]),
        bots: [...document.querySelectorAll("[data-sidebar-bot-row]")].map((one) => one.dataset.sidebarBotRow),
        noMatch: document.querySelector("[data-sidebar-no-project-match]")?.textContent ?? null })`;
      type InSidebar = { projects: Array<[string, number]>; bots: string[]; noMatch: string | null };
      await clickSelector(`[data-sidebar-bot-row=${JSON.stringify(main.id)}]`);
      await mainInstead("the main bot's chat in place of the board");
      const unfiltered = await evaluate<InSidebar>(inSidebar);
      const part = project.name.slice(project.name.indexOf(" ") + 1).toUpperCase();
      await expect.poll(() => evaluate<boolean>(searchSidebar(part)), { timeout: 10_000, interval: 250 }).toBe(true);
      await expect.poll(() => evaluate<InSidebar>(inSidebar), { timeout: 10_000, interval: 250 }).toEqual({ projects: [[project.id, 1]], bots: [main.id], noMatch: null });
      await shot("23-search-finds-the-project-by-a-part-of-its-name.png");
      await clickSelector(projectRow);
      await waitFor(`document.querySelector(${JSON.stringify(projectRow)})?.getAttribute("aria-current") === "page" && document.querySelector(${JSON.stringify(onChat)})`, "the project's group chat open from the search");
      await expect.poll(() => evaluate<boolean>(searchSidebar(writer.name)), { timeout: 10_000, interval: 250 }).toBe(true);
      await expect.poll(() => evaluate<InSidebar>(inSidebar), { timeout: 10_000, interval: 250 }).toEqual({ projects: [], bots: [main.id], noMatch: `No project matches “${writer.name}”` });
      await evaluate(searchSidebar(""));
      await expect.poll(() => evaluate<InSidebar>(inSidebar), { timeout: 10_000, interval: 250 }).toEqual(unfiltered);
      await clickSelector("[data-sidebar-search-toggle]");
      await waitFor(`!document.querySelector("[data-sidebar] input")`, "the search closed");

      await api("POST", `/api/team-projects/${project.id}/archive`);
      await evaluate("window.dispatchEvent(new Event('focus')); true");
      await mainInstead("the main bot in place of the project archived elsewhere");
      await api("POST", `/api/team-projects/${project.id}/restore`);
      await evaluate("window.dispatchEvent(new Event('focus')); true");
      await openProject();
      const row = (await box(projectRow))!;
      await evaluate(`document.querySelector(${JSON.stringify(projectRow)}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: ${Math.round(row.x + 40)}, clientY: ${Math.round(row.y + row.h / 2)} })); true`);
      await waitFor(`document.querySelector("[data-team-project-archive]")`, "the project's menu in the sidebar");
      await clickSelector("[data-team-project-archive]");
      await mainInstead("the main bot in place of the project archived from the sidebar");
      expect(((await api("GET", "/api/team-projects")).projects as TeamProjectWire[]).find((one) => one.id === project.id)?.archivedAt).toEqual(expect.any(Number));
      await clickButton("Undo", "[data-access-toast]");
      await openProject();

      const boardLayers = {
        topBar: `${view} header`,
        stages: `${view} nav[aria-label="Stages"]`,
        toolbar: `${view} [role="toolbar"][aria-label="Board tools"]`,
        minimap: `${view} [role="img"][aria-label="Minimap"]`,
        lead: `${view} ${card(botNodeId(lead.id))}`,
      };
      await waitFor(`document.querySelector(${JSON.stringify(boardLayers.lead)})`, "the lead's card in view");
      const coveredBy = (overlay: string) => evaluate<Record<string, boolean | "missing">>(`(() => {
        const scrim = document.querySelector(${JSON.stringify(overlay)})?.closest(".ui-scrim");
        return Object.fromEntries(Object.entries(${JSON.stringify(boardLayers)}).map(([name, selector]) => {
          const layer = document.querySelector(selector);
          if (!layer) return [name, "missing"];
          const r = layer.getBoundingClientRect();
          const x = Math.min(Math.max(r.x + r.width / 2, 1), innerWidth - 1);
          const y = Math.min(Math.max(r.y + r.height / 2, 1), innerHeight - 1);
          return [name, Boolean(scrim && scrim.contains(document.elementFromPoint(x, y)))];
        }));
      })()`);
      const drawnInFull = (selector: string, what: string) => waitFor(`(() => {
        const shown = document.querySelector(${JSON.stringify(selector)});
        const root = shown?.closest(".ui-scrim") ?? shown;
        return Boolean(root) && root.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity);
      })()`, what);
      const settingsDialog = "[data-project-canvas-settings]";
      await clickSelector(`${view} header button[aria-label="Project settings"]`);
      await drawnInFull(settingsDialog, "the project settings over the board");
      const underSettings = await coveredBy(settingsDialog);
      expect(underSettings).toEqual(Object.fromEntries(Object.keys(boardLayers).map((name) => [name, true])));
      await shot("24-project-settings-cover-the-board.png");

      const verifier = randomBytes(32).toString("base64url");
      const fromTerminal = (path: string, body: unknown) => fetch(fixture.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const signIn = await fromTerminal("/api/auth/cli-login", { label: "openmausbot CLI in the fixture", scope: "client", verifierHash: createHash("sha256").update(verifier).digest("base64url") });
      expect(signIn.status).toBe(201);
      const login = (await signIn.json()) as { id: string; code: string };
      const loginCard = "[data-notice='cli-login']";
      await waitFor(`document.querySelector(${JSON.stringify(loginCard)})?.textContent.includes(${JSON.stringify(login.code)})`, "the CLI login card over the project settings");
      expect(await evaluate<boolean>(`(() => { const card = document.querySelector(${JSON.stringify(loginCard)}); const r = card.getBoundingClientRect(); return card.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`)).toBe(true);
      await drawnInFull(loginCard, "the CLI login card drawn in full");
      await shot("25-cli-login-card-above-the-project-settings.png");
      await clickButton("Deny", loginCard);
      await waitFor(`!document.querySelector(${JSON.stringify(loginCard)})`, "the CLI login answered from its card");
      expect(await (await fromTerminal(`/api/auth/cli-login/${login.id}`, { verifier })).json()).toMatchObject({ state: "denied" });
      expect(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(settingsDialog)}))`)).toBe(true);
      await clickAt(20, 20);
      await waitFor(`!document.querySelector(${JSON.stringify(settingsDialog)})`, "the project settings closed from their scrim");
      evidence.overlays = { underSettings, cliLogin: { code: login.code } };

      type Chrome = { boardWidth: number; sidebarWidth: number; minimapPressed: string | null; overlapping: string[]; clipped: string[]; cornerShare: number };
      const chromeAtSmallest = () => evaluate<Chrome>(`(() => {
        const rectOf = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const board = rectOf(${JSON.stringify(`${view} [data-production-board]`)});
        const layers = Object.entries(${JSON.stringify({ topBar: boardLayers.topBar, stages: boardLayers.stages, toolbar: boardLayers.toolbar, minimap: boardLayers.minimap })})
          .map(([name, selector]) => [name, rectOf(selector)]).filter(([, r]) => r);
        const meet = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const overlapping = layers.flatMap(([name, r], at) => layers.slice(at + 1).filter(([, other]) => meet(r, other)).map(([other]) => name + "/" + other));
        const clipped = layers.filter(([name, r]) => {
          const room = name === "topBar" ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : board;
          return r.left < room.left - 1 || r.top < room.top - 1 || r.right > room.right + 1 || r.bottom > room.bottom + 1;
        }).map(([name]) => name);
        const corner = layers.filter(([name]) => name === "toolbar" || name === "minimap").reduce((sum, [, r]) => sum + r.width * r.height, 0);
        return { boardWidth: Math.round(board.width), sidebarWidth: Math.round(rectOf("[data-sidebar]")?.width ?? 0),
          minimapPressed: document.querySelector(${JSON.stringify(`${boardLayers.toolbar} button[aria-label="Minimap"]`)})?.getAttribute("aria-pressed") ?? null,
          overlapping, clipped, cornerShare: Math.round((corner / (board.width * board.height)) * 1000) / 10 };
      })()`);
      await browser("set", "viewport", "840", "620");
      const smallest: Record<string, { folded: Chrome; opened: Chrome }> = {};
      for (const skin of SKINS) {
        await evaluate(`localStorage.setItem("omb-skin", ${JSON.stringify(skin)}); true`);
        await browser("open", preview.previewUrl);
        await openProject();
        await settle();
        const folded = await chromeAtSmallest();
        expect(folded).toMatchObject({ minimapPressed: "false", overlapping: [], clipped: [] });
        expect(folded.sidebarWidth).toBeGreaterThan(0);
        expect(folded.boardWidth).toBeLessThan(900);
        await shot(`26-smallest-window-${skin}.png`);
        await clickSelector(`${boardLayers.toolbar} button[aria-label="Minimap"]`);
        await waitFor(`document.querySelector(${JSON.stringify(boardLayers.minimap)})`, "the minimap its button opens at the smallest window");
        const opened = await chromeAtSmallest();
        expect(opened).toMatchObject({ minimapPressed: "true", overlapping: [], clipped: [] });
        await shot(`27-smallest-window-minimap-opened-${skin}.png`);
        smallest[skin] = { folded, opened };
      }
      evidence.smallestWindow = smallest;
      expect(JSON.stringify((await browser("console")).messages)).not.toMatch(/Uncaught|ReferenceError|TypeError/);
    } catch (error) {
      await shot("failed-app.png").catch(() => {});
      throw error;
    }
  } finally {
    if (evidenceDir) writeFileSync(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    if (env) await closeBrowserSession(tools.binary, env).catch(() => false);
    await preview?.close();
    await server?.close();
    await fake?.close();
    if (root) await removeTempDir(root);
    if (home) await removeTempDir(home);
  }
}, hostTimeout(900_000));

(enabled ? it : it.skip)("draws the sixty-episode sample from what is in view, and keeps how long it takes to open, zoom and pan", async () => {
  const tools = await ensureUiBrowser();
  let home: string | undefined;
  let preview: MountedPreview | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  const page = pageTools(tools.binary, () => env!);
  const { browser, evaluate, waitFor, drawn, fitAll, zoomOutToFar, emptySpot } = page;
  const shot = async (name: string) => {
    if (evidenceDir) await browser("screenshot", join(evidenceDir, name));
  };
  const timings: Record<string, unknown> = {};
  try {
    home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-pb-"));
    mkdirSync(join(home, "tmp"));
    env = sessionEnv({ home, session: "pb", chrome: tools.chrome });
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    preview = await mountPreview({ info: { url: "http://127.0.0.1:9" } }, { entry: "/scripts/testing/project-canvas-preview.tsx", route: "/__production-board.html", title: "Production board preview", logLevel: "warn" });
    const open = async (skin: string) => {
      await browser("open", `${preview!.previewUrl}?episodes=60&skin=${skin}`);
      await waitFor("typeof window.boardOpenedMs === 'number'", "the sixty-episode board drawn", 120_000);
      await sleep(400);
      return await evaluate<number>("window.boardOpenedMs");
    };

    await browser("set", "viewport", "1440", "900");
    const opened: number[] = [];
    for (let load = 0; load < 3; load += 1) opened.push(Math.round(await open("daylight")));
    timings.openMs = opened;
    const atOpen = (await drawn()).length;
    await fitAll();
    const whole = (await drawn()).length;
    timings.cards = { atOpen, whole, dom: await evaluate<number>("document.querySelectorAll('[data-production-board] *').length") };
    expect(atOpen).toBeLessThan(whole);

    await open("daylight");
    const cdpUrl = (await browser("get", "cdp-url")).cdpUrl as string;
    const startFrames = `(() => { window.__frames = []; window.__framing = true; let last = performance.now(); const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__framing) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`;
    const stopFrames = "(() => { window.__framing = false; return window.__frames.slice(1); })()";
    const spot = await emptySpot();
    if (!spot) throw new Error("no empty board to pan from");
    const input = await devtools(cdpUrl);
    try {
      await evaluate(startFrames);
      for (let step = 0; step < 40; step += 1) {
        await input.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: spot.x, y: spot.y, deltaX: 0, deltaY: step < 20 ? 120 : -120 });
        await sleep(16);
      }
      await sleep(300);
      timings.zoom = frameStats(await evaluate<number[]>(stopFrames));
      await evaluate(startFrames);
      await input.send("Input.dispatchMouseEvent", { type: "mousePressed", x: spot.x, y: spot.y, button: "left", buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 60; step += 1) {
        await input.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: spot.x - step * 12, y: spot.y - step * 4, button: "left", buttons: 1 });
        await sleep(16);
      }
      await input.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: spot.x - 720, y: spot.y - 240, button: "left", buttons: 0, clickCount: 1 });
      await sleep(300);
      timings.pan = frameStats(await evaluate<number[]>(stopFrames));
    } finally {
      input.close();
    }
    timings.cardsAfterPan = (await drawn()).length;
    expect((timings.pan as { frames: number }).frames).toBeGreaterThan(30);

    for (const skin of SKINS) {
      for (const size of WINDOWS) {
        await browser("set", "viewport", String(size.width), String(size.height));
        await open(skin);
        await shot(`30-sixty-episodes-${skin}-${size.name}.png`);
        await zoomOutToFar();
        expect(await evaluate<number>("document.querySelectorAll('article[data-board-card]').length")).toBe(0);
        await shot(`31-sixty-episodes-far-${skin}-${size.name}.png`);
      }
    }
    expect(JSON.stringify((await browser("console")).messages)).not.toMatch(/Uncaught|ReferenceError|TypeError/);
  } catch (error) {
    await shot("failed-sixty-episodes.png").catch(() => {});
    throw error;
  } finally {
    if (evidenceDir) writeFileSync(join(evidenceDir, "sixty-episodes.json"), `${JSON.stringify(timings, null, 2)}\n`);
    if (env) await closeBrowserSession(tools.binary, env).catch(() => false);
    await preview?.close();
    if (home) await removeTempDir(home);
  }
}, hostTimeout(300_000));
