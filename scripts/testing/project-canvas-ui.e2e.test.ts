// The project canvas in a real browser on a disposable server with the scripted fake engine and generation's test MCP
// server, inside the app's store: the snapshot draws the project's bots, a change survives a reload, an upload lands in
// 素材, a task takes what is connected to the bot, live events update the open canvas, opening a chat and Stop go
// through the app, a node generates a picture and stops a generation, a config node generates from its inputs on a
// page in Chinese, its references numbered in Chinese and its failure said in Chinese, a task asked from a text node
// writes its reply there, and undo gives a deleted bot node back to its bot. Then in the app itself: the sidebar's
// project row opens the canvas, its top bar reaches the project's group chats and team changes, a bot who joins is
// drawn clear of the others, and a project archived while open gives way to the main bot.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { botNodeId, dispatchConnectionId, type CanvasNode, type CanvasOpsRequest, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { GenerationJob } from "../../shared/project-generation.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { closeBrowserSession, resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { startFakeGenerationMcp } from "../../server/testing/fake-generation-mcp-server.ts";
import { hostTimeout } from "../../server/testing/host-timeout.ts";
import { GENERATION_KEY } from "../../server/testing/project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "../../server/testing/restartable-server.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv, UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
if (!enabled) console.info("skipping the project canvas UI e2e: set OMB_UI_E2E=1 to install the pinned browser");
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

const TEAM = "Canvas crew";
const BRIEF = "Episode one: the bride is swapped at the altar.";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };
type Bot = { id: string; name: string; title?: string; color: string; threadId: string; mainThreadId?: string; busy?: boolean; defaultBot?: object; tasks?: Array<{ threadId: string; busy?: boolean }> };
type Line = { id: string; role?: string; kind?: string; text?: string };
type Box = { x: number; y: number; w: number; h: number };

(enabled ? it : it.skip)("draws a project's canvas from the server, keeps its changes, and follows its bots live", async () => {
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
    const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages`)).messages as Line[];

    await api("PUT", "/api/team-projects/root", { path: root });
    const member = async (name: string, title: string, color: string) => {
      const made = (await api("POST", "/api/bots", { name, section: TEAM })).bot as Bot;
      await api("PATCH", `/api/bots/${made.id}`, { title, color });
      return made;
    };
    const director = await member("Director", "Runs the production", "purple");
    await member("Writer", "Writes the episodes", "teal");
    await api("PATCH", `/api/bots/${director.id}`, { chiefOfStaff: true });
    await settled();
    const project = (await api("POST", "/api/team-projects", { name: "Canvas drama", team: TEAM })).project as TeamProjectWire;
    await settled();
    const leadId = project.leadBotId;
    const writerId = project.botIds.find((id) => id !== leadId)!;
    const all = await bots();
    const lead = all.find((one) => one.id === leadId)!;
    const writer = all.find((one) => one.id === writerId)!;
    expect([lead.color, writer.color]).toEqual(["purple", "teal"]);
    const canvasPath = `/api/team-projects/${project.id}/canvas`;
    const snapshot = async () => await api("GET", canvasPath) as CanvasSnapshot;
    const gate = join(fixture.dataDir, "gate-scene");
    const plan = (script: unknown[]) => writeFileSync(fixture.planPath, JSON.stringify({ [writer.id]: { script } }));
    const mcp = fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 2_000 });
    await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: mcp.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } });
    await api("PATCH", "/api/mcp/servers/gen", { enabled: true });
    await api("PUT", `/api/team-projects/${project.id}/generation/settings`, { image: IMAGE, video: VIDEO });
    const results = async (id: string): Promise<CanvasNode[]> => {
      const read = await snapshot();
      const to = new Set(read.connections.filter((one) => one.fromNodeId === id && one.kind === "content").map((one) => one.toNodeId));
      return read.nodes.filter((one) => to.has(one.id));
    };
    const jobs = async () => (await api("GET", `/api/team-projects/${project.id}/generation/jobs`)).jobs as GenerationJob[];

    preview = await mountPreview({ info: { url: fixture.url } }, { entry: "/scripts/testing/project-canvas-server-preview.tsx", route: "/__project-canvas.html", title: "Project canvas on a server", logLevel: "warn" });
    const pageUrl = `${preview.previewUrl}?project=${encodeURIComponent(project.id)}`;

    const waitFor = (js: string, message: string, timeout = 30_000) =>
      expect.poll(() => evaluate<boolean>(`Boolean(${js})`), { timeout, interval: 250, message }).toBe(true);
    const node = (id: string) => `[data-canvas-node=${JSON.stringify(id)}]`;
    const text = (selector: string) => evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
    const box = (selector: string) => evaluate<Box | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const centre = (found: Box) => ({ x: found.x + found.w / 2, y: found.y + found.h / 2 });
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
      const found = await evaluate<Box | null>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      if (!found) throw new Error(`no button "${label}" in ${scope}`);
      const point = centre(found);
      await clickAt(point.x, point.y);
    };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await move(from.x, from.y);
      await browser("mouse", "down", "left");
      for (let step = 1; step <= 8; step += 1) await move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
      await browser("mouse", "up", "left");
    };
    const emptySpot = (from: "top" | "bottom" = "top") => evaluate<{ x: number; y: number } | null>(`(() => {
      const stage = document.querySelector("[data-project-canvas-stage]").getBoundingClientRect();
      const rows = [];
      for (let y = stage.top + 80; y < stage.bottom - 140; y += 40) rows.push(y);
      if (${JSON.stringify(from)} === "bottom") rows.reverse();
      for (const y of rows) for (let x = stage.left + 300; x < stage.right - 300; x += 40) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest("[data-project-canvas-stage]") && !hit.closest("[data-canvas-node], [data-node-panel], button, input, [role=toolbar], [data-kind], aside")) return { x, y };
      }
      return null;
    })()`);
    const revealPanelEnd = async () => {
      const height = await evaluate<number>("window.innerHeight");
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const shown = await box("[data-node-panel]");
        const overflow = shown ? shown.y + shown.h - (height - 60) : 0;
        if (overflow <= 0) return;
        const spot = await emptySpot("bottom");
        if (!spot) throw new Error("no empty canvas to pan from");
        await drag(spot, { x: spot.x, y: spot.y - Math.min(overflow, spot.y - 20) });
      }
    };
    const clickEmpty = async () => {
      const spot = await emptySpot();
      if (!spot) throw new Error("no empty canvas to click");
      await clickAt(spot.x, spot.y);
    };
    const fit = async (label = "Fit to view") => {
      await clickEmpty();
      await clickSelector(`button[aria-label="${label}"]`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    };
    const openPage = async () => {
      await browser("open", pageUrl);
      await waitFor(`document.querySelector(${JSON.stringify(node(botNodeId(writer.id)))})`, "the writer's node is drawn", 120_000);
      await fit();
    };
    const drawnIds = () => evaluate<string[]>("[...document.querySelectorAll('[data-canvas-node]')].map((one) => one.getAttribute('data-canvas-node'))");
    const sentOps = () => evaluate<CanvasOpsRequest[]>("window.canvasOpsSent ?? []");
    const recordOps = () => evaluate(`(() => {
      window.canvasOpsSent = [];
      const send = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input).endsWith("/canvas/ops")) window.canvasOpsSent.push(JSON.parse(init.body));
        return send(input, init);
      };
      return true;
    })()`);

    try {
      await browser("set", "viewport", "1440", "900");
      await openPage();

      const leadNode = node(botNodeId(lead.id));
      const writerNode = node(botNodeId(writer.id));
      const middleStop = (selector: string) => evaluate<string | null>(`document.querySelector(${JSON.stringify(`${selector} stop[offset="55%"]`)})?.getAttribute("stop-color") ?? null`);
      evidence.bots = {
        lead: { text: await text(leadNode), crown: await evaluate(`Boolean(document.querySelector(${JSON.stringify(`${leadNode} [aria-label="Lead"]`)}))`), fill: await middleStop(leadNode), color: lead.color },
        writer: { text: await text(writerNode), fill: await middleStop(writerNode), color: writer.color },
        dispatch: await evaluate(`document.querySelector('[data-connection=${JSON.stringify(dispatchConnectionId(lead.id, writer.id))}]')?.getAttribute("data-kind") ?? null`),
      };
      expect(evidence.bots).toMatchObject({
        lead: { text: expect.stringContaining("Runs the production"), crown: true, fill: expect.any(String), color: "purple" },
        writer: { text: expect.stringContaining("Writes the episodes"), fill: expect.any(String), color: "teal" },
        dispatch: "dispatch",
      });
      const fills = evidence.bots as { lead: { fill: string }; writer: { fill: string } };
      expect(fills.lead.fill).not.toBe(fills.writer.fill);
      expect(await text(leadNode)).toContain(lead.name);
      expect(await text(writerNode)).toContain(writer.name);
      await shot("01-bots-from-the-snapshot.png");

      await recordOps();
      const before = await drawnIds();
      await clickSelector('button[aria-label="Add text"]');
      await expect.poll(async () => (await drawnIds()).filter((id) => !before.includes(id)).length, { message: "a new text node" }).toBe(1);
      const textId = (await drawnIds()).find((id) => !before.includes(id))!;
      await browser("dblclick", `${node(textId)} .whitespace-pre-wrap`);
      await waitFor(`document.querySelector('textarea[aria-label="Text"]')`, "the text node's editor");
      await browser("find", "role", "textbox", "fill", BRIEF, "--name", "Text", "--exact");
      await clickEmpty();
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === textId)?.metadata?.content, { timeout: 15_000 }).toBe(BRIEF);
      await fit();
      const placed = (await snapshot()).nodes.find((one) => one.id === textId)!.position;
      const shown = await box(node(textId));
      await drag({ x: shown!.x + shown!.w / 2, y: shown!.y + 24 }, { x: shown!.x + shown!.w / 2, y: shown!.y + 344 });
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === textId)!.position.y, { timeout: 15_000 }).toBeGreaterThan(placed.y);
      const moved = (await snapshot()).nodes.find((one) => one.id === textId)!.position;
      const sent = await sentOps();
      evidence.opsSent = sent;
      const contentChange = sent.find((request) => request.ops.some((op) => op.type === "update_node" && op.id === textId && op.metadata?.content === BRIEF));
      const moveChange = sent.find((request) => request.ops.some((op) => op.type === "update_node" && op.id === textId && op.patch?.position));
      expect(contentChange?.baseRevision).toEqual(expect.any(Number));
      expect(moveChange).toBeDefined();
      expect(moveChange).not.toHaveProperty("baseRevision");
      await openPage();
      await waitFor(`document.querySelector(${JSON.stringify(node(textId))})?.textContent.includes(${JSON.stringify(BRIEF)})`, "the text node after a reload");
      expect((await snapshot()).nodes.find((one) => one.id === textId)).toMatchObject({ type: "text", position: moved, metadata: { content: BRIEF }, createdBy: { kind: "person" } });
      evidence.afterReload = { textId, placed, moved };
      await shot("02-text-node-after-a-reload.png");

      const bytes = await evaluate<number>(`(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d");
        const sky = context.createLinearGradient(0, 0, 0, 180);
        sky.addColorStop(0, "#1d2b53");
        sky.addColorStop(1, "#ff77a8");
        context.fillStyle = sky;
        context.fillRect(0, 0, 320, 180);
        context.fillStyle = "#fff1e8";
        context.font = "28px sans-serif";
        context.fillText("Altar, night", 24, 100);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], "board.png", { type: "image/png" }));
        const input = document.querySelector('input[type="file"]');
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return blob.size;
      })()`);
      await expect.poll(async () => (await snapshot()).nodes.some((one) => one.metadata?.file?.path === "素材/board.png"), { timeout: 15_000 }).toBe(true);
      const upload = (await snapshot()).nodes.find((one) => one.metadata?.file?.path === "素材/board.png")!;
      const onDisk = join(project.folder, "素材", "board.png");
      expect(existsSync(onDisk) && readFileSync(onDisk).length).toBe(bytes);
      await waitFor(`(() => { const image = document.querySelector(${JSON.stringify(`${node(upload.id)} img`)}); return image && image.complete && image.naturalWidth === 320; })()`, "the uploaded image loads from the server");
      evidence.upload = { node: upload, bytes, src: await evaluate(`document.querySelector(${JSON.stringify(`${node(upload.id)} img`)}).getAttribute("src")`) };
      expect(upload).toMatchObject({ type: "image", createdBy: { kind: "person" }, metadata: { file: { path: "素材/board.png", mime: "image/png", bytes } } });
      await fit();
      await shot("03-upload-in-sucai.png");

      const connectInto = async (fromId: string, toId = botNodeId(writer.id)) => {
        await clickEmpty();
        const from = await box(node(fromId));
        await move(from!.x + from!.w / 2, from!.y + from!.h / 2);
        await waitFor(`document.querySelector(${JSON.stringify(`${node(fromId)} [data-handle="source"]`)})`, `${fromId}'s handle`);
        const handle = await box(`${node(fromId)} [data-handle="source"]`);
        const target = await box(node(toId));
        await drag(centre(handle!), centre(target!));
        await expect.poll(async () => (await snapshot()).connections.some((one) => one.fromNodeId === fromId && one.toNodeId === toId), { timeout: 15_000, message: `${fromId} connected into ${toId}` }).toBe(true);
      };
      await connectInto(textId);
      await connectInto(upload.id);

      plan([{ key: "task", match: ["Write the opening scene"], gateFile: gate, reply: "SCENE WRITTEN: the bride runs from the altar." }]);
      await clickEmpty();
      const writerBox = await box(writerNode);
      await clickAt(writerBox!.x + writerBox!.w / 2, writerBox!.y + 30);
      await waitFor("document.querySelector('[data-node-panel]')", "the writer's panel");
      await browser("find", "role", "textbox", "fill", "Write the opening scene", "--name", `Message to ${writer.name}`, "--exact");
      await clickButton("Send", "[data-node-panel]");
      await waitFor(`document.querySelector(${JSON.stringify(writerNode)})?.textContent.includes("Working")`, "the writer at work on the open canvas");
      await shot("04-writer-at-work.png");
      writeFileSync(gate, "go");
      await waitFor(`document.querySelector(${JSON.stringify(writerNode)})?.textContent.includes("SCENE WRITTEN")`, "the writer's reply on the open canvas");
      await settled();
      const conversation = writer.mainThreadId ?? writer.threadId;
      const asked = (await messages(conversation)).find((line) => line.role === "user" && line.text?.startsWith("Write the opening scene"))!;
      const turns = readFileSync(`${fixture.planPath}.evidence.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { botId: string; planKey?: string; prompt: unknown });
      const prompt = turns.find((turn) => turn.botId === writer.id && turn.planKey === "task")!.prompt as { message?: { content?: unknown } };
      const blocks = Array.isArray(prompt.message?.content) ? prompt.message.content as Array<{ type?: string; text?: string; source?: { data?: string } }> : [];
      const image = blocks.find((block) => block.type === "image");
      evidence.task = {
        asked,
        promptText: blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n").slice(0, 3000),
        promptImage: image ? { sameBytesAsTheUpload: image.source?.data === readFileSync(onDisk).toString("base64") } : null,
      };
      expect(asked.text).toMatch(/^Write the opening scene\n\nConnected to your node on the project's canvas:\n\n/);
      expect(asked.text).toContain(`Text 1:\n\n> ${BRIEF}`);
      expect(asked.text).toContain('Image 1 "board.png":');
      expect(JSON.stringify(blocks)).toContain(BRIEF);
      expect(image).toBeDefined();
      await shot("05-writer-replied.png");

      await clickButton("Conversation", "[data-node-panel]");
      await waitFor(`(() => { const panel = document.querySelector("[data-node-panel]")?.textContent ?? ""; return panel.includes("Write the opening scene") && panel.includes("SCENE WRITTEN"); })()`, "the latest exchange in the panel");
      await shot("06-latest-exchange.png");
      await revealPanelEnd();
      await clickButton("Open the full chat", "[data-node-panel]");
      const opened = await evaluate<{ view: string; selected: string | null }>("(() => { const state = window.canvasStore.state(); return { view: state.activeView, selected: state.selectedId }; })()");
      evidence.openedChat = opened;
      expect(opened.selected).toBe(writer.id);

      const outside = await api("POST", `${canvasPath}/ops`, { ops: [{ type: "add_node", nodeType: "text", title: "From the director", position: { x: moved.x, y: moved.y + 280 }, metadata: { content: "Keep the rain in every scene." } }] });
      const outsideId = outside.nodeIds[0] as string;
      await expect.poll(async () => {
        await fit();
        return text(node(outsideId));
      }, { timeout: 20_000, message: "a change made elsewhere on the open canvas" }).toContain("Keep the rain in every scene.");
      await shot("07-change-from-elsewhere.png");

      plan([{ key: "season", match: ["Write the whole season"], gateFile: join(fixture.dataDir, "gate-season"), reply: "SEASON WRITTEN" }]);
      await clickEmpty();
      const again = await box(writerNode);
      await clickAt(again!.x + again!.w / 2, again!.y + 30);
      await waitFor("document.querySelector('[data-node-panel]')", "the writer's panel again");
      await browser("find", "role", "textbox", "fill", "Write the whole season", "--name", `Message to ${writer.name}`, "--exact");
      await clickButton("Send", "[data-node-panel]");
      await waitFor(`document.querySelector(${JSON.stringify(writerNode)})?.textContent.includes("Working")`, "the writer at work again");
      await clickButton("Stop", "[data-node-panel]");
      await settled();
      await waitFor(`!document.querySelector(${JSON.stringify(writerNode)})?.textContent.includes("Working")`, "the writer stopped on the open canvas");
      expect((await messages(conversation)).some((line) => line.text === "SEASON WRITTEN")).toBe(false);
      await shot("08-writer-stopped.png");

      const beforeImage = await drawnIds();
      await clickEmpty();
      await clickSelector('button[aria-label="Add image"]');
      await expect.poll(async () => (await drawnIds()).filter((id) => !beforeImage.includes(id)).length, { message: "a new image node" }).toBe(1);
      const imageId = (await drawnIds()).find((id) => !beforeImage.includes(id))!;
      const openImagePanel = async () => {
        await clickEmpty();
        const shown = await box(node(imageId));
        await clickAt(shown!.x + shown!.w / 2, shown!.y + 30);
        await waitFor("document.querySelector('[data-node-panel]')", "the image node's panel");
      };
      const generateFromPanel = async (prompt: string) => {
        await browser("find", "role", "textbox", "fill", prompt, "--name", "Prompt", "--exact");
        await clickButton("Generate", "[data-node-panel]");
        await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === imageId)?.metadata?.status, { timeout: 15_000, message: `${imageId} generating` }).toBe("loading");
        await waitFor(`[...document.querySelectorAll("[data-node-panel] button")].some((button) => button.textContent.trim() === "Stop")`, "the running generation on the open canvas");
      };
      await openImagePanel();
      await generateFromPanel("The bride at the altar, night rain");
      await shot("09-generating.png");
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === imageId)?.metadata?.file, { timeout: 30_000, message: "the generated picture in its own empty node" }).toBeTruthy();
      const made = (await snapshot()).nodes.find((one) => one.id === imageId)!;
      expect(made).toMatchObject({ type: "image", createdBy: { kind: "person" }, metadata: { prompt: "The bride at the altar, night rain", status: "success", file: { mime: "image/png" } } });
      expect(existsSync(join(project.folder, ...made.metadata!.file!.path.split("/")))).toBe(true);
      expect(await results(imageId)).toEqual([]);
      await waitFor(`(() => { const image = document.querySelector(${JSON.stringify(`${node(imageId)} img`)}); return image && image.complete && image.naturalWidth > 0; })()`, "the generated picture loads in its node on the open canvas");
      await fit();
      await shot("10-generated.png");

      await openImagePanel();
      await generateFromPanel("[task][hold] The groom waits in the rain");
      await clickButton("Stop", "[data-node-panel]");
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === imageId)?.metadata?.status, { timeout: 15_000, message: "the stopped generation leaves its node" }).toBe("idle");
      const held = (await jobs()).find((job) => job.nodeId === imageId && job.prompt.includes("[task][hold] The groom waits in the rain"));
      expect(held?.status).toBe("cancelled");
      expect(held?.references.images).toEqual([made.metadata!.file!.path]);
      expect(await results(imageId)).toEqual([]);
      evidence.generation = { made, held: held && { id: held.id, status: held.status }, calls: mcp.calls.map((call) => call.tool) };
      await waitFor(`[...document.querySelectorAll("[data-node-panel] button")].some((button) => button.textContent.trim() === "Generate")`, "the panel ready to generate again");
      await shot("11-generation-stopped.png");

      const fitZh = "适合视图";
      await browser("open", `${pageUrl}&lang=zh`);
      await waitFor(`document.querySelector(${JSON.stringify(writerNode)}) && document.querySelector('button[aria-label="${fitZh}"]')`, "the canvas in Chinese", 120_000);
      const laidOut = await snapshot();
      const configAt = { x: Math.max(...laidOut.nodes.map((one) => one.position.x + one.width)) + 160, y: Math.min(...laidOut.nodes.map((one) => one.position.y)) };
      const configId = (await api("POST", `${canvasPath}/ops`, { ops: [{ type: "add_node", nodeType: "config", title: "Dawn look", position: configAt, metadata: { generationMode: "image" } }] })).nodeIds[0] as string;
      await waitFor(`document.querySelector(${JSON.stringify(node(configId))})`, "the config node on the open canvas");
      await fit(fitZh);
      await connectInto(upload.id, configId);
      const openConfigPanel = async () => {
        await clickEmpty();
        const shown = await box(node(configId));
        await clickAt(shown!.x + shown!.w / 2, shown!.y + 30);
        await waitFor("document.querySelector('[data-node-panel]')", "the config node's panel");
      };
      const generateConfig = async (prompt: string) => {
        await browser("find", "role", "textbox", "fill", prompt, "--name", "提示词", "--exact");
        await revealPanelEnd();
        await clickButton("生成", "[data-node-panel]");
      };
      await openConfigPanel();
      await waitFor(`document.querySelector("[data-node-panel]")?.textContent.includes("图片 1")`, "the board named 图片 1 among the config's references");
      const dawn = "黎明时分重画图片 1，雨停了";
      await generateConfig(dawn);
      await expect.poll(async () => (await results(configId)).length, { timeout: 30_000, message: "the config's picture on the canvas" }).toBe(1);
      const [fromConfig] = await results(configId);
      const config = (await snapshot()).nodes.find((one) => one.id === configId)!;
      expect(config.metadata).toMatchObject({ prompt: dawn, status: "success" });
      expect(fromConfig).toMatchObject({ type: "image", createdBy: { kind: "person" }, metadata: { file: { mime: "image/png" } } });
      expect(fromConfig!.position.x).toBeGreaterThanOrEqual(config.position.x + config.width);
      const configCall = mcp.calls.filter((call) => call.tool === "generate_image").at(-1)!;
      expect(configCall.arguments.prompt).toBe(`参考图片编号：图片 1。请按这些编号理解提示词中的图片引用。\n\n${dawn}`);
      expect(configCall.arguments.referenceImages).toEqual([expect.objectContaining({ sha256: createHash("sha256").update(readFileSync(onDisk)).digest("hex") })]);
      await fit(fitZh);
      await shot("12-config-generates-in-chinese.png");

      await openConfigPanel();
      await generateConfig(`[task][fail:没有灵感] ${dawn}`);
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === configId)?.metadata?.status, { timeout: 30_000, message: "the config's generation fails" }).toBe("error");
      const failed = (await snapshot()).nodes.find((one) => one.id === configId)!;
      expect(failed.metadata).toMatchObject({ errorDetails: "gen couldn't make it: 没有灵感", errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "没有灵感" } });
      const configAlert = `${node(configId)} [role="alert"]`;
      await waitFor(`document.querySelector(${JSON.stringify(configAlert)})?.textContent.includes("gen 没能生成：没有灵感")`, "the config's failure in Chinese on the open canvas");
      expect(await text(configAlert)).not.toContain("couldn't make it");
      evidence.config = { node: failed, made: fromConfig, prompt: configCall.arguments.prompt, referenceImages: configCall.arguments.referenceImages, failureShown: await text(configAlert) };
      await shot("13-config-failure-in-chinese.png");
      await openPage();

      const noteGate = join(fixture.dataDir, "gate-note");
      const rule = "RULE: rain falls in every scene, even indoors.";
      plan([{ key: "note", match: ["Turn the note into a rule"], gateFile: noteGate, reply: rule }]);
      await clickEmpty();
      const note = await box(node(outsideId));
      await clickAt(note!.x + note!.w / 2, note!.y + 30);
      const writtenBy = '[data-node-panel] select[aria-label="Written by"]';
      await waitFor(`document.querySelector(${JSON.stringify(writtenBy)})`, "the note's panel");
      await browser("select", writtenBy, writer.id);
      await browser("find", "role", "textbox", "fill", "Turn the note into a rule", "--name", "What to write", "--exact");
      await revealPanelEnd();
      await clickButton(`Ask ${writer.name}`, "[data-node-panel]");
      await waitFor(`document.querySelector(${JSON.stringify(node(outsideId))})?.textContent.includes("is writing")`, "the writer writing into the note on the open canvas");
      const writingInto = (await snapshot()).bots[writer.id]!.writingInto;
      expect(writingInto).toEqual([outsideId]);
      await shot("14-writing-into-a-text-node.png");
      writeFileSync(noteGate, "go");
      await waitFor(`document.querySelector(${JSON.stringify(node(outsideId))})?.textContent.includes(${JSON.stringify(rule)})`, "the reply in the note on the open canvas");
      await settled();
      const filled = await snapshot();
      expect(filled.nodes.find((one) => one.id === outsideId)).toMatchObject({ type: "text", createdBy: { kind: "person" }, metadata: { content: rule } });
      expect(filled.bots[writer.id]!.writingInto).toBeUndefined();
      evidence.reply = { writingInto, node: filled.nodes.find((one) => one.id === outsideId) };
      await shot("15-reply-in-the-text-node.png");

      const writersShot = async () => (await snapshot()).nodes.find((one) => one.type === "shot" && one.createdBy?.kind === "bot");
      plan([{ key: "shot", match: ["ADD-SHOT"], reply: "SHOT ADDED", steps: [
        { tool: "canvas_apply_ops", arguments: { ops: [{ type: "add_node", nodeType: "shot", title: "Opening shot", metadata: { prompt: "A bride alone at the altar" } }] } },
      ] }]);
      await api("POST", `${canvasPath}/tasks`, { botId: writer.id, text: "ADD-SHOT" });
      await expect.poll(writersShot, { timeout: 30_000, message: "the writer's shot" }).toBeDefined();
      await settled();
      const botShot = (await writersShot())!;
      expect(botShot.createdBy).toEqual({ kind: "bot", botId: writer.id });
      await fit();
      await waitFor(`document.querySelector(${JSON.stringify(node(botShot.id))})`, "the writer's shot on the open canvas");
      await clickEmpty();
      const shotBox = await box(node(botShot.id));
      await clickAt(shotBox!.x + shotBox!.w / 2, shotBox!.y + 30);
      await clickSelector('button[aria-label="Delete"]');
      await expect.poll(async () => (await snapshot()).nodes.some((one) => one.id === botShot.id), { timeout: 15_000, message: "the writer's shot deleted" }).toBe(false);
      await clickSelector('button[aria-label="Undo"]');
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === botShot.id)?.createdBy, { timeout: 15_000, message: "the shot back as the writer's" }).toEqual({ kind: "bot", botId: writer.id });
      expect((await snapshot()).connections).toContainEqual(expect.objectContaining({ fromNodeId: botNodeId(writer.id), toNodeId: botShot.id, kind: "content" }));
      const rewritten = "A bride alone at the altar, rain on the windows";
      plan([{ key: "shot-again", match: ["CHANGE-SHOT"], reply: "SHOT CHANGED", steps: [
        { tool: "canvas_apply_ops", arguments: { ops: [{ type: "update_node", id: botShot.id, metadata: { prompt: rewritten } }] } },
      ] }]);
      await api("POST", `${canvasPath}/tasks`, { botId: writer.id, text: "CHANGE-SHOT" });
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === botShot.id)?.metadata?.prompt, { timeout: 30_000, message: "the writer changes its shot again" }).toBe(rewritten);
      await settled();
      evidence.undo = { shot: (await snapshot()).nodes.find((one) => one.id === botShot.id) };
      await fit();
      await shot("16-bot-shot-back-after-undo.png");

      evidence.console = (await browser("console")).messages;
      expect(evidence.console).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "error" })]));

      const main = (await bots()).find((one) => one.defaultBot)!;
      await api("PATCH", `/api/bots/${main.id}`, { welcomed: true });
      const room = (await api("POST", "/api/groups", { name: "Table read", memberIds: [lead.id, writer.id], section: project.section })).group as { id: string };
      await api("PATCH", `/api/groups/${room.id}/setup`, { action: "complete", bulletin: "", defaultResponder: { kind: "member", botId: lead.id } });
      await member("Colorist", "Grades the picture", "orange");
      await settled();
      await preview.close();
      preview = await mountPreview({ info: { url: fixture.url } }, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Projects in the app", logLevel: "warn" });
      await browser("open", preview.previewUrl);
      const projectRow = `[data-sidebar-project-row=${JSON.stringify(project.id)}]`;
      const view = `[data-project-view=${JSON.stringify(project.id)}]`;
      const slot = `${view} [data-project-canvas-slot]`;
      const mainOpen = `[data-sidebar-bot-row=${JSON.stringify(main.id)}][aria-current="page"]`;
      const openProject = async () => {
        await waitFor(`document.querySelector(${JSON.stringify(projectRow)})`, "the project in the sidebar", 120_000);
        await clickSelector(projectRow);
        await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerNode}`)})`, "the project's canvas in the app");
      };
      const mainInstead = (message: string) => waitFor(`!document.querySelector(${JSON.stringify(view)}) && document.querySelector(${JSON.stringify(mainOpen)})`, message);
      await openProject();
      expect(await text(`${slot} [data-project-folder]`)).toBe(project.folder);
      await waitFor(`document.querySelector(${JSON.stringify(`${slot} [data-project-team-changes]`)})`, "the team's change in the top bar");
      await shot("17-project-row-opens-its-canvas.png");

      await clickSelector(`${slot} button[aria-label="Group chats"]`);
      const roomItem = `[role="menu"] [data-menu-key=${JSON.stringify(room.id)}]`;
      await waitFor(`document.querySelector(${JSON.stringify(roomItem)})`, "the project's group chat in the top bar's menu");
      await shot("18-group-chats-menu.png");
      await clickSelector(roomItem);
      await waitFor(`!document.querySelector(${JSON.stringify(view)}) && !document.querySelector('[role="menu"]') && document.body.innerText.includes("Table read")`, "the group chat open");

      await openProject();
      await clickSelector(`${slot} [data-project-team-changes]`);
      await waitFor(`document.querySelector("[data-team-changes] [data-team-changes-apply]")`, "the team's changes to review");
      await clickSelector("[data-team-changes] [data-team-changes-apply]");
      const botNodes = `${view} [data-canvas-node^="bot:"]`;
      await waitFor(`document.querySelectorAll(${JSON.stringify(botNodes)}).length === 3 && !document.querySelector(${JSON.stringify(`${slot} [data-project-team-changes]`)})`, "the colorist's copy on the canvas");
      const joined = await snapshot();
      const colorist = joined.nodes.find((one) => one.type === "bot" && one.id !== botNodeId(lead.id) && one.id !== botNodeId(writer.id))!;
      const covers = (a: CanvasNode, b: CanvasNode) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
      const under = joined.nodes.filter((one) => one.id !== colorist.id && one.type !== "group" && covers(one, colorist)).map((one) => one.id);
      evidence.colorist = { node: colorist, under };
      expect(under).toEqual([]);
      await fit();
      await shot("19-team-change-adds-a-bot.png");

      await api("POST", `/api/team-projects/${project.id}/archive`);
      await evaluate("window.dispatchEvent(new Event('focus')); true");
      await mainInstead("the main bot in place of the project archived elsewhere");
      await shot("21-archived-elsewhere-opens-the-main-bot.png");
      await api("POST", `/api/team-projects/${project.id}/restore`);
      await evaluate("window.dispatchEvent(new Event('focus')); true");
      await openProject();
      const row = (await box(projectRow))!;
      await evaluate(`document.querySelector(${JSON.stringify(projectRow)}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: ${Math.round(row.x + 40)}, clientY: ${Math.round(row.y + row.h / 2)} })); true`);
      await waitFor(`document.querySelector("[data-team-project-archive]")`, "the project's menu in the sidebar");
      await clickSelector("[data-team-project-archive]");
      await mainInstead("the main bot in place of the project archived from the sidebar");
      const listed = (await api("GET", "/api/team-projects")).projects as TeamProjectWire[];
      expect(listed.find((one) => one.id === project.id)?.archivedAt).toEqual(expect.any(Number));
      await shot("22-archived-from-the-sidebar-opens-the-main-bot.png");
      evidence.app = { main: main.id, room: room.id, folder: project.folder, bots: (await snapshot()).nodes.filter((one) => one.type === "bot").map((one) => one.id) };
      expect(JSON.stringify((await browser("console")).messages)).not.toMatch(/Uncaught|ReferenceError|TypeError/);
    } catch (error) {
      await shot("failed.png").catch(() => {});
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
}, hostTimeout(480_000));
