// A project's pipeline run on its canvas in a real browser, on a disposable server with the scripted fake engine and
// generation's test MCP server, in Chinese: the lead hands the script to the writer and the run goes on from stage to
// stage by itself, the run bar asks before the videos in the light skin, the dark and a narrow window, the person's
// click generates them, a shot whose generation fails is left out when the person says to go on, and post ends the
// run with the lead told. Nothing here reaches the user's data, JianYing or port 8799.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { PipelineRunWire } from "../../shared/pipeline-run.ts";
import { botNodeId, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { TeamProjectMembership, TeamProjectWire } from "../../shared/team-projects.ts";
import { closeBrowserSession, resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { startFakeGenerationMcp } from "../../server/testing/fake-generation-mcp-server.ts";
import { hostTimeout } from "../../server/testing/host-timeout.ts";
import { GENERATION_KEY } from "../../server/testing/project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "../../server/testing/restartable-server.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv, UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
if (!enabled) console.info("skipping the pipeline run UI e2e: set OMB_UI_E2E=1 to install the pinned browser");
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

const TEAM = "漫剧组";
const PROJECT = "替嫁新娘";
const SCRIPT = "第一场 外景 港口 夜。新娘提着婚纱沿着海边奔跑，身后的教堂钟声响起。";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };
type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type StoredBot = { id: string; teamProject?: TeamProjectMembership };
type Line = { role?: string; kind?: string; text?: string; tool?: { name: string } };
type Box = { x: number; y: number; w: number; h: number };

(enabled ? it : it.skip)("runs a project's pipeline from the lead's hand-off to post, asking on the canvas before the videos", async () => {
  const tools = await ensureUiBrowser();
  let server: RestartableServer | undefined;
  let fake: Awaited<ReturnType<typeof startFakeGenerationMcp>> | undefined;
  let root: string | undefined;
  let home: string | undefined;
  let preview: MountedPreview | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  const evidence: Record<string, unknown> = {};
  const browser = (...args: string[]) => agentBrowser(tools.binary, env!, args, 60_000);
  const evaluate = async <T = unknown>(js: string) => (await browser("eval", js)).result as T;
  const shot = async (name: string) => {
    if (evidenceDir) await browser("screenshot", join(evidenceDir, name));
  };
  try {
    server = await launchRestartableServer({ scripted: true });
    const fixture = server;
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-pipeline-run-ui-")));
    // agent-browser 0.37 refuses a socket path over 103 bytes, and it lives under this home.
    home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-pr-"));
    mkdirSync(join(home, "tmp"));
    env = sessionEnv({ home, session: "pr", chrome: tools.chrome });
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

    await api("PUT", "/api/config", { language: "zh" });
    await api("PUT", "/api/team-projects/root", { path: root });
    const member = async (name: string, title: string) => {
      const made = (await api("POST", "/api/bots", { name, section: TEAM })).bot as Bot;
      await api("PATCH", `/api/bots/${made.id}`, { title });
      return made;
    };
    const team = {
      lead: await member("云舟", "制片人"),
      writer: await member("砚青", "编剧"),
      designer: await member("素衣", "角色设计"),
      boarder: await member("墨白", "分镜"),
      editor: await member("青禾", "后期合成"),
    };
    await api("PATCH", `/api/bots/${team.lead.id}`, { chiefOfStaff: true });
    await settled();
    const staff = [team.writer.id, team.designer.id, team.boarder.id, team.editor.id];
    await api("PUT", "/api/team-pipelines/restore", {
      section: TEAM,
      state: { stages: { [team.writer.id]: ["script"], [team.designer.id]: ["character"], [team.boarder.id]: ["storyboard"], [team.editor.id]: ["post"] }, judged: {}, manual: staff, added: [], removed: [] },
    });
    const project = (await api("POST", "/api/team-projects", { name: PROJECT, team: TEAM })).project as TeamProjectWire;
    await settled();
    const stored = JSON.parse(readFileSync(join(fixture.dataDir, "bots.json"), "utf8")) as StoredBot[];
    const listed = await bots();
    const copyOf = (source: Bot) => listed.find((bot) => bot.id === stored.find((one) => one.teamProject?.id === project.id && one.teamProject.source === source.id)!.id)!;
    const copies = { lead: copyOf(team.lead), writer: copyOf(team.writer), designer: copyOf(team.designer), boarder: copyOf(team.boarder), editor: copyOf(team.editor) };
    expect(copies.lead.id).toBe(project.leadBotId);

    fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 1_500 });
    await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } });
    await api("PATCH", "/api/mcp/servers/gen", { enabled: true });
    await api("PUT", `/api/team-projects/${project.id}/generation/settings`, { image: IMAGE, video: VIDEO });
    const answered = (reply: string, steps?: unknown[]) => ({ script: [{ key: "task", match: [""], repeat: true, reply, ...(steps ? { steps } : {}) }] });
    writeFileSync(fixture.planPath, JSON.stringify({
      [copies.lead.id]: { script: [
        { key: "brief", match: ["写一集试播"], steps: [{ arguments: { bot_ids: [copies.writer.id], message: "写试播集的剧本。" } }], reply: "交给砚青写剧本了。" },
        { key: "after", match: [""], repeat: true, reply: "知道了。", resumeReply: "砚青写完了剧本。" },
      ] },
      [copies.writer.id]: answered(SCRIPT),
      [copies.designer.id]: answered("新娘和新郎的设定写好了。"),
      [copies.boarder.id]: answered("拆成了两个镜头。", [{ tool: "canvas_apply_ops", arguments: { ops: [
        { type: "add_node", nodeType: "shot", title: "港口奔跑", metadata: { prompt: "夜晚的港口，新娘提着婚纱奔跑" } },
        { type: "add_node", nodeType: "shot", title: "教堂转身", metadata: { prompt: "[fail:模型繁忙] 新郎在教堂门口转身" } },
      ] } }]),
      [copies.editor.id]: answered("顺序没问题。"),
    }));
    const snapshot = async () => await api("GET", `/api/team-projects/${project.id}/canvas`) as CanvasSnapshot;
    const run = async () => (await snapshot()).run as PipelineRunWire | undefined;

    preview = await mountPreview({ info: { url: fixture.url } }, { entry: "/scripts/testing/project-canvas-server-preview.tsx", route: "/__project-canvas.html", title: "Project canvas on a server", logLevel: "warn" });
    const waitFor = (js: string, message: string, timeout = 30_000) =>
      expect.poll(() => evaluate<boolean>(`Boolean(${js})`), { timeout, interval: 250, message }).toBe(true);
    const box = (selector: string) => evaluate<Box | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const clickAt = async (x: number, y: number) => {
      await browser("mouse", "move", String(Math.round(x)), String(Math.round(y)));
      await browser("mouse", "down", "left");
      await browser("mouse", "up", "left");
    };
    const clickButton = async (label: string) => {
      const found = await evaluate<Box | null>(`(() => { const e = [...document.querySelectorAll("[data-pipeline-run] button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      if (!found) throw new Error(`no button "${label}" on the run bar`);
      await clickAt(found.x + found.w / 2, found.y + found.h / 2);
    };
    const fit = async () => {
      const found = await box(`button[aria-label="适合视图"]`);
      if (!found) throw new Error("no fit button");
      await clickAt(found.x + found.w / 2, found.y + found.h / 2);
      await new Promise((resolve) => setTimeout(resolve, 500));
    };
    const step = (key: string, status: string) => `document.querySelector('[data-pipeline-run] [data-run-step="${key}"][data-status="${status}"]')`;
    const steps = () => evaluate<string[]>(`[...document.querySelectorAll("[data-pipeline-run] [data-run-step]")].map((one) => one.querySelector("[data-run-label]").textContent + ":" + one.getAttribute("data-status"))`);
    const barText = () => evaluate<string>(`document.querySelector("[data-pipeline-run]")?.textContent ?? ""`);

    try {
      await browser("set", "viewport", "1440", "900");
      await browser("open", `${preview.previewUrl}?project=${encodeURIComponent(project.id)}&lang=zh`);
      await waitFor(`document.querySelector(${JSON.stringify(`[data-canvas-node=${JSON.stringify(botNodeId(copies.lead.id))}]`)})`, "the lead's node is drawn", 120_000);

      await api("POST", `/api/bots/${copies.lead.id}/messages`, { text: "写一集试播：替嫁新娘在港口逃婚。", threadId: copies.lead.threadId, sendId: crypto.randomUUID() });
      await waitFor(step("videos", "confirm"), "the run asks before the videos", 120_000);
      await fit();
      expect(await steps()).toEqual(["编剧:done", "角色设计:done", "分镜:done", "视频:confirm", "后期:waiting"]);
      expect(await barText()).toContain("2 个镜头已就绪。");
      const drawn = await snapshot();
      expect(drawn.nodes.find((node) => node.type === "text" && node.metadata?.role === "script")?.metadata?.content).toBe(SCRIPT);
      expect(drawn.nodes.filter((node) => node.type === "config" && node.metadata?.role === "creation")).toHaveLength(2);
      evidence.confirm = { steps: await steps(), run: drawn.run };
      await shot("01-asks-before-the-videos.png");
      await evaluate(`document.documentElement.dataset.skin = "midnight"`);
      await shot("02-asks-before-the-videos-midnight.png");
      await evaluate(`document.documentElement.dataset.skin = "daylight"`);
      await browser("set", "viewport", "760", "800");
      await shot("03-asks-before-the-videos-narrow.png");
      const narrow = await box("[data-pipeline-run]");
      expect(narrow!.x + narrow!.w).toBeLessThanOrEqual(760);
      await browser("set", "viewport", "1440", "900");

      await clickButton("生成 2 段视频");
      await waitFor(step("videos", "working"), "the videos are generating", 15_000);
      await shot("04-generating.png");
      await waitFor(step("videos", "failed"), "a shot ended with no video", 60_000);
      await fit();
      expect(await barText()).toContain("1 个镜头没有视频。");
      expect((await run())?.videos).toEqual({ status: "failed", shots: 2, ready: 1, failed: 1 });
      await shot("05-one-shot-failed.png");

      await clickButton("跳过它们继续");
      await waitFor(step("post", "done"), "post is done", 60_000);
      await fit();
      expect(await steps()).toEqual(["编剧:done", "角色设计:done", "分镜:done", "视频:done", "后期:done"]);
      await shot("06-the-run-ended.png");
      expect((await run())?.endedAt).toEqual(expect.any(Number));
      await settled();

      const storedRooms = JSON.parse(readFileSync(join(fixture.dataDir, "groups.json"), "utf8")) as Array<{ id: string; threadId: string }> | { groups: Array<{ id: string; threadId: string }> };
      const roomThread = (Array.isArray(storedRooms) ? storedRooms : storedRooms.groups).find((one) => one.id === project.roomId)!.threadId;
      const lines = (await api("GET", `/api/threads/${roomThread}/messages?limit=500`)).messages as Line[];
      const notes = lines.filter((line) => line.kind === "activity" && line.tool?.name.startsWith("流水线")).map((line) => line.tool!.name);
      expect(notes).toEqual(expect.arrayContaining([
        "流水线：角色设计交给了素衣。",
        "流水线：2 个镜头可以生成视频了，到画布上确认后开始。",
        "流水线：1 个镜头没有生成出视频。可以在画布上重试，或者跳过它继续。",
        "流水线：跳过 1 个没有视频的镜头，继续往下。",
        "流水线：后期已完成。",
      ]));
      expect(lines.some((line) => line.role === "user" && line.text === `@${copies.lead.name} “${PROJECT}”的流水线：这次运行已完成。请向用户汇报做了什么。`)).toBe(true);
      evidence.ended = { steps: await steps(), run: await run(), notes };
      expect(JSON.stringify((await browser("console")).messages)).not.toMatch(/Uncaught|ReferenceError|TypeError/);
    } catch (error) {
      await shot("failed.png").catch(() => {});
      throw error;
    }
  } finally {
    if (evidenceDir) writeFileSync(join(evidenceDir, "pipeline-run-ui.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    if (env) await closeBrowserSession(tools.binary, env).catch(() => false);
    await preview?.close();
    await server?.close();
    await fake?.close();
    if (root) await removeTempDir(root);
    if (home) await removeTempDir(home);
  }
}, hostTimeout(480_000));
