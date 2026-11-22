// The project canvas in a real browser on a disposable server with the scripted fake engine and generation's test MCP
// server, inside the app's store: the snapshot draws the project's bots, a change survives a reload, an upload lands in
// 素材, a task takes what is connected to the bot, live events update the open canvas, opening a chat and Stop go
// through the app, a node generates a picture and stops a generation, a config node generates from its inputs on a
// page in Chinese, its references numbered in Chinese and its failure said in Chinese, an empty image node on that
// page generates into itself and then beside itself, its @ list starting with its own picture and naming nothing a
// generation won't take, a text node with text there names its own text first in its @, a clip too, and shows the bot
// writing its revision as a placeholder to its right, through a reload, that the revision takes and that goes when a
// revision is stopped or fails, an empty text node takes the reply itself, a bot's panel stays wholly on the canvas at
// its left edge and above the minimap, its conversation showing a sent picture and folding its references as the chat
// does, in the light skin and the dark, a note's task in English is answered in the same way beside the note, and undo
// gives a deleted bot node back to its bot. Then in the app itself: a click on the sidebar's project row opens the
// lead's conversation under the project's top bar with the lead under the row, its switch opens the canvas and goes
// back, a click on the open project folds it, the top bar reaches the project's group chats and team changes, a bot who
// joins is drawn clear of the others, a search for a part of the project's name keeps its one row, which opens the
// lead's conversation, and a
// search for the writer finds no project, a project archived while open gives way to the main bot, and the project's
// settings and a picture's preview cover the whole canvas while a terminal's sign-in card stays above them.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { botNodeId, dispatchConnectionId, replyTitle, type CanvasNode, type CanvasOpsRequest, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { GenerationJob } from "../../shared/project-generation.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
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
    const storedRooms = JSON.parse(readFileSync(join(fixture.dataDir, "groups.json"), "utf8")) as Array<{ id: string; threadId: string }> | { groups: Array<{ id: string; threadId: string }> };
    const projectRoom = (Array.isArray(storedRooms) ? storedRooms : storedRooms.groups).find((one) => one.id === project.roomId)!;
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
    const panLongerThanAClick = 12;
    const revealPanelEnd = async () => {
      const height = await evaluate<number>("window.innerHeight");
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const shown = await box("[data-node-panel]");
        const overflow = shown ? Math.ceil(shown.y + shown.h - (height - 60)) : 0;
        if (overflow <= 0) return;
        const spot = await emptySpot("bottom");
        if (!spot) throw new Error("no empty canvas to pan from");
        await drag(spot, { x: spot.x, y: spot.y - Math.min(Math.max(overflow, panLongerThanAClick), spot.y - 20) });
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
      await browser("open", pageUrl);
      await waitFor(`document.querySelector(${JSON.stringify(node(botNodeId(lead.id)))})`, "the lead's node is drawn", 120_000);
      expect(await drawnIds()).toEqual([botNodeId(lead.id)]);
      expect(await evaluate<string | null>(`document.querySelector('input[aria-label="Zoom"]')?.value ?? null`)).toBe("100");
      expect(await evaluate<boolean>(`Boolean(document.querySelector('[data-connection=${JSON.stringify(dispatchConnectionId(lead.id, writer.id))}]'))`)).toBe(false);
      await shot("00-a-new-project-shows-its-lead-alone-at-100.png");
      plan([{ key: "hello", match: ["HELLO-WRITER"], reply: "Ready to write." }]);
      await api("POST", `/api/bots/${writer.id}/messages`, { text: "HELLO-WRITER", threadId: writer.threadId, sendId: randomUUID() });
      await settled();
      await waitFor(`document.querySelector(${JSON.stringify(node(botNodeId(writer.id)))})`, "the writer's node once the work reached the writer");
      await fit();

      const leadNode = node(botNodeId(lead.id));
      const writerNode = node(botNodeId(writer.id));
      const middleStop = (selector: string) => evaluate<string | null>(`document.querySelector(${JSON.stringify(`${selector} stop[offset="55%"]`)})?.getAttribute("stop-color") ?? null`);
      evidence.bots = {
        lead: { text: await text(leadNode), crown: await evaluate(`Boolean(document.querySelector(${JSON.stringify(`${leadNode} [aria-label="Chief of Staff"]`)}))`), fill: await middleStop(leadNode), color: lead.color },
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
      const conversation = projectRoom.threadId;
      const asked = (await messages(conversation)).find((line) => line.role === "user" && line.text?.startsWith(`@${writer.name} Write the opening scene`))!;
      const turns = readFileSync(`${fixture.planPath}.evidence.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { botId: string; planKey?: string; prompt: unknown });
      const prompt = turns.find((turn) => turn.botId === writer.id && turn.planKey === "task")!.prompt as { message?: { content?: unknown } };
      const blocks = Array.isArray(prompt.message?.content) ? prompt.message.content as Array<{ type?: string; text?: string; source?: { data?: string } }> : [];
      const image = blocks.find((block) => block.type === "image");
      evidence.task = {
        asked,
        promptText: blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n").slice(0, 3000),
        promptImage: image ? { sameBytesAsTheUpload: image.source?.data === readFileSync(onDisk).toString("base64") } : null,
      };
      expect(asked.text).toMatch(new RegExp(`^@${writer.name} Write the opening scene\\n\\nConnected to your node on the project's canvas:\\n\\n`));
      expect(asked.text).toContain(`Text 1:\n\n> ${BRIEF}`);
      expect(asked.text).toContain('Image 1 "board.png"\n\n<attached-image ');
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
      expect(opened.selected).toBe(projectRoom.id);

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
      const openPanelOf = async (id: string, what: string) => {
        await clickEmpty();
        const shown = await box(node(id));
        await clickAt(shown!.x + shown!.w / 2, shown!.y + 30);
        await waitFor("document.querySelector('[data-node-panel]')", what);
      };
      const openImagePanel = () => openPanelOf(imageId, "the image node's panel");
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
      const openConfigPanel = () => openPanelOf(configId, "the config node's panel");
      const generateInChinese = async (prompt: string) => {
        await browser("find", "role", "textbox", "fill", prompt, "--name", "提示词", "--exact");
        await revealPanelEnd();
        await clickButton("生成", "[data-node-panel]");
      };
      await openConfigPanel();
      await waitFor(`document.querySelector("[data-node-panel]")?.textContent.includes("图片 1")`, "the board named 图片 1 among the config's references");
      const dawn = "黎明时分重画图片 1，雨停了";
      await generateInChinese(dawn);
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
      await generateInChinese(`[task][fail:没有灵感] ${dawn}`);
      await expect.poll(async () => (await snapshot()).nodes.find((one) => one.id === configId)?.metadata?.status, { timeout: 30_000, message: "the config's generation fails" }).toBe("error");
      const failed = (await snapshot()).nodes.find((one) => one.id === configId)!;
      expect(failed.metadata).toMatchObject({ errorDetails: "gen couldn't make it: 没有灵感", errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "没有灵感" } });
      const configAlert = `${node(configId)} [role="alert"]`;
      await waitFor(`document.querySelector(${JSON.stringify(configAlert)})?.textContent.includes("gen 没能生成：没有灵感")`, "the config's failure in Chinese on the open canvas");
      expect(await text(configAlert)).not.toContain("couldn't make it");
      evidence.config = { node: failed, made: fromConfig, prompt: configCall.arguments.prompt, referenceImages: configCall.arguments.referenceImages, failureShown: await text(configAlert) };
      await shot("13-config-failure-in-chinese.png");

      const below = await snapshot();
      const sceneAt = { x: configAt.x, y: Math.max(...below.nodes.map((one) => one.position.y + one.height)) + 160 };
      const sceneTitle = "教堂";
      const sceneId = (await api("POST", `${canvasPath}/ops`, { ops: [{ type: "add_node", nodeType: "image", title: sceneTitle, position: sceneAt }] })).nodeIds[0] as string;
      await waitFor(`document.querySelector(${JSON.stringify(node(sceneId))})`, "the empty image node on the open canvas");
      await fit(fitZh);
      const sceneNode = async () => (await snapshot()).nodes.find((one) => one.id === sceneId)!;
      const ghost = `[data-generation-ghost=${JSON.stringify(sceneId)}]`;
      const focusOn = async (title: string, labels = { list: "节点", search: "搜索节点", close: "关闭" }) => {
        const nodeList = `aside[aria-label="${labels.list}"]`;
        await clickEmpty();
        if (!(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(nodeList)}))`))) await clickSelector(`button[aria-label="${labels.list}"]`);
        await waitFor(`document.querySelector(${JSON.stringify(nodeList)})`, "the node list");
        await browser("find", "role", "searchbox", "fill", title, "--name", labels.search, "--exact");
        const entry = await evaluate<Box | null>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(`${nodeList} li button`)})].find((b) => b.querySelector("span")?.textContent === ${JSON.stringify(title)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
        if (!entry) throw new Error(`no ${title} in the node list`);
        await clickAt(centre(entry).x, centre(entry).y);
        await clickSelector(`${nodeList} button[aria-label="${labels.close}"]`);
        await new Promise((resolve) => setTimeout(resolve, 300));
      };
      const chapel = "[task][hold] 雨后的教堂，清晨";
      await openPanelOf(sceneId, "the empty image node's panel");
      await generateInChinese(chapel);
      await expect.poll(async () => (await sceneNode()).metadata?.status, { timeout: 15_000, message: "the empty image node generating" }).toBe("loading");
      await waitFor(`document.querySelector(${JSON.stringify(node(sceneId))})?.textContent.includes("生成中")`, "the empty image node generating in itself on the open canvas");
      await focusOn(sceneTitle);
      expect(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(ghost)}))`)).toBe(false);
      await shot("14-empty-image-generates-in-itself.png");
      mcp.release();
      await expect.poll(async () => (await sceneNode()).metadata?.file, { timeout: 30_000, message: "the picture in the empty image node itself" }).toBeTruthy();
      const scene = await sceneNode();
      expect(scene).toMatchObject({ type: "image", title: sceneTitle, createdBy: { kind: "person" }, metadata: { prompt: chapel, status: "success", file: { mime: "image/png" } } });
      expect(await results(sceneId)).toEqual([]);
      const scenePicture = join(project.folder, ...scene.metadata!.file!.path.split("/"));
      expect(existsSync(scenePicture)).toBe(true);
      await waitFor(`(() => { const image = document.querySelector(${JSON.stringify(`${node(sceneId)} img`)}); return image && image.complete && image.naturalWidth > 0; })()`, "the picture loads in the node it was generated in");
      await expect.poll(async () => {
        const fitted = await sceneNode();
        return { width: fitted.width, height: fitted.height };
      }, { timeout: 15_000, message: "the node fitted to its small picture, no smaller than a node can be resized to" }).toEqual({ width: 220, height: 220 });
      await focusOn(sceneTitle);
      await shot("15-empty-image-filled-itself.png");

      const clipUpload = await fetch(`${fixture.url}${canvasPath}/files?name=rain.mp4&x=${sceneAt.x - 560}&y=${sceneAt.y}`, {
        method: "POST",
        headers: { origin: fixture.url, "content-type": "video/mp4" },
        body: new Uint8Array(readFileSync(new URL("../../server/testing/fixtures/generation-sample.mp4", import.meta.url))),
      });
      expect(clipUpload.status).toBe(201);
      const clipId = ((await clipUpload.json()) as { nodeId: string }).nodeId;
      await waitFor(`document.querySelector(${JSON.stringify(node(clipId))})`, "the uploaded clip on the open canvas");
      await fit(fitZh);
      for (const fromId of [upload.id, outsideId, clipId]) await connectInto(fromId, sceneId);
      const mentionList = '[data-node-panel] [role="listbox"]';
      const mentionOptions = () => evaluate<string[][]>(`[...document.querySelectorAll(${JSON.stringify(`${mentionList} [role="option"]`)})].map((option) => [...option.querySelectorAll("span")].map((span) => span.textContent))`);
      const referenceThumbs = () => evaluate<Array<{ label: string; remove: string | null }>>(`[...document.querySelectorAll("[data-node-panel] [data-reference]")].map((thumb) => ({ label: thumb.textContent.trim(), remove: thumb.querySelector("button")?.getAttribute("aria-label") ?? null }))`);
      await focusOn(sceneTitle);
      await openPanelOf(sceneId, "the image node's panel with its references");
      await revealPanelEnd();
      await browser("find", "role", "textbox", "fill", "@", "--name", "提示词", "--exact");
      await waitFor(`document.querySelector(${JSON.stringify(mentionList)})`, "the @ list over the image node's prompt");
      const mentioned = await mentionOptions();
      expect(mentioned).toEqual([["图片 1", sceneTitle], ["图片 2", "board.png"], ["文本 1", "From the director"]]);
      const thumbs = await referenceThumbs();
      expect(thumbs).toEqual([{ label: "图片 1", remove: null }, { label: "图片 2", remove: "移除 图片 2" }, { label: "文本 1", remove: "移除 文本 1" }]);
      await shot("16-mention-list-starts-with-its-own-picture.png");

      const retake = "[task][hold] 按@图片 2 的构图重画@图片 1，雨不要停";
      await generateInChinese(retake);
      await expect.poll(async () => (await sceneNode()).metadata?.status, { timeout: 15_000, message: "the image node generating again" }).toBe("loading");
      await waitFor(`document.querySelector(${JSON.stringify(ghost)})`, "the next picture's placeholder on the open canvas");
      await focusOn(sceneTitle);
      const placeholder = await box(ghost);
      const sceneShown = await box(node(sceneId));
      expect(placeholder!.x).toBeGreaterThan(sceneShown!.x + sceneShown!.w);
      await shot("17-next-picture-placeholder-to-its-right.png");
      mcp.release();
      await expect.poll(async () => (await results(sceneId)).length, { timeout: 30_000, message: "the next picture beside the image node" }).toBe(1);
      const [beside] = await results(sceneId);
      const sceneAfter = await sceneNode();
      expect(sceneAfter.metadata).toMatchObject({ prompt: retake, status: "success", file: scene.metadata!.file });
      expect(beside).toMatchObject({ type: "image", createdBy: { kind: "person" }, metadata: { file: { mime: "image/png" } } });
      expect(beside!.position.x).toBeGreaterThanOrEqual(sceneAfter.position.x + sceneAfter.width);
      const retakeJob = (await jobs()).find((job) => job.nodeId === sceneId && job.prompt.includes(retake));
      expect(retakeJob?.references).toEqual({ images: [scene.metadata!.file!.path, "素材/board.png"], audio: [] });
      const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
      const retakeCall = mcp.calls.filter((call) => call.tool === "generate_image").at(-1)!;
      expect(retakeCall.arguments.prompt).toBe(`参考图片编号：图片 1、图片 2。请按这些编号理解提示词中的图片引用。\n\n${retake}\n\n【文本 1】\nKeep the rain in every scene.`);
      expect(retakeCall.arguments.referenceImages).toEqual([expect.objectContaining({ sha256: sha(scenePicture) }), expect.objectContaining({ sha256: sha(onDisk) })]);
      await waitFor(`(() => { const image = document.querySelector(${JSON.stringify(`${node(beside!.id)} img`)}); return image && image.complete && image.naturalWidth > 0; })()`, "the next picture loads beside the image node");
      evidence.emptyImage = { scene: sceneAfter, beside, mentioned, thumbs, prompt: retakeCall.arguments.prompt, referenceImages: retakeCall.arguments.referenceImages, references: retakeJob?.references };
      await focusOn(sceneTitle);
      await shot("18-next-picture-to-its-right.png");

      const lowestY = async () => Math.max(...(await snapshot()).nodes.map((one) => one.position.y + one.height));
      const fitUntilDrawn = (id: string, what: string) => expect.poll(async () => {
        await fit(fitZh);
        return evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(node(id))}))`);
      }, { timeout: 20_000, message: what }).toBe(true);
      const requestField = '[data-node-panel] textarea[aria-label="要写什么"]';
      const writtenByInChinese = '[data-node-panel] select[aria-label="撰写者"]';
      const placeholderForWriter = async () => {
        await browser("select", writtenByInChinese, writer.id);
        return evaluate<string>(`document.querySelector(${JSON.stringify(requestField)})?.placeholder ?? ""`);
      };
      const askInChinese = async (request: string) => {
        await browser("select", writtenByInChinese, writer.id);
        await browser("find", "role", "textbox", "fill", request, "--name", "要写什么", "--exact");
        await revealPanelEnd();
        await clickButton(`让 ${writer.name} 来写`, "[data-node-panel]");
      };
      const sentToWriter = async (marker: string) => (await messages(conversation)).find((line) => line.role === "user" && line.text?.includes(marker))?.text ?? "";

      const loglineTitle = "梗概";
      const loglineText = "雨夜，一个替身新娘在教堂台阶上回头。";
      const loglineId = (await api("POST", `${canvasPath}/ops`, { ops: [{ type: "add_node", nodeType: "text", title: loglineTitle, position: { x: sceneAt.x, y: (await lowestY()) + 160 }, metadata: { content: loglineText } }] })).nodeIds[0] as string;
      await fitUntilDrawn(loglineId, "the logline on the open canvas");
      for (const fromId of [sceneId, clipId]) await connectInto(fromId, loglineId);
      await focusOn(loglineTitle);
      await openPanelOf(loglineId, "the logline's panel");
      expect(await placeholderForWriter()).toBe(`告诉 ${writer.name} 怎么修改这段文本，改好的会放进旁边的新节点。输入 @ 引用参考。`);
      await revealPanelEnd();
      await browser("find", "role", "textbox", "fill", "@", "--name", "要写什么", "--exact");
      await waitFor(`document.querySelector(${JSON.stringify(mentionList)})`, "the @ list over the logline's request");
      const loglineMentions = await mentionOptions();
      expect(loglineMentions).toEqual([["文本 1", loglineTitle], ["图片 1", sceneTitle], ["视频 1", "rain.mp4"]]);
      const loglineThumbs = await referenceThumbs();
      expect(loglineThumbs).toEqual([{ label: "文本 1", remove: null }, { label: "图片 1", remove: "移除 图片 1" }, { label: "视频 1", remove: "移除 视频 1" }]);
      await shot("19-text-node-mention-list-starts-with-its-own-text.png");

      const reviseGate = join(fixture.dataDir, "gate-revise");
      const revised = "替身新娘在雨夜的教堂台阶上回头，戒指还攥在手里。";
      const reviseRequest = "REVISE-THE-LOGLINE 把 @文本 1 改得更紧凑，参考 @图片 1 和 @视频 1";
      plan([{ key: "revise", match: ["REVISE-THE-LOGLINE"], gateFile: reviseGate, reply: revised }]);
      await askInChinese(reviseRequest);
      const placeholders = "[data-reply-placeholder]";
      const placeholderOf = (id: string) => `[data-reply-placeholder=${JSON.stringify(id)}]`;
      const writingShown = `${writer.name} 正在写…`;
      await waitFor(`document.querySelector(${JSON.stringify(placeholders)})?.textContent === ${JSON.stringify(writingShown)}`, "the revision's placeholder beside the logline on the open canvas");
      const whileWriting = await snapshot();
      const [upcoming] = whileWriting.bots[writer.id]!.writingBeside!;
      const loglineWhileWriting = whileWriting.nodes.find((one) => one.id === loglineId)!;
      expect(whileWriting.bots[writer.id]!.writingBeside).toEqual([{ id: expect.any(String), nodeId: loglineId, position: { x: loglineWhileWriting.position.x + loglineWhileWriting.width + 80, y: expect.any(Number) }, width: 340, height: 240 }]);
      expect(upcoming!.position.y).toBeGreaterThanOrEqual(loglineWhileWriting.position.y);
      expect(whileWriting.bots[writer.id]!.writingInto).toBeUndefined();
      expect(whileWriting.nodes.some((one) => one.id === upcoming!.id)).toBe(false);
      expect(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(node(upcoming!.id))}))`)).toBe(false);
      expect(await text(node(loglineId))).not.toContain("正在写");
      const ghostLink = `[data-ghost-connection=${JSON.stringify(upcoming!.id)}]`;
      expect(await evaluate(`["fill", "stroke", "stroke-width", "stroke-dasharray"].map((name) => document.querySelector(${JSON.stringify(ghostLink)})?.getAttribute(name))`)).toEqual(["none", "var(--color-ink-tertiary)", "2", "5 5"]);
      expect(await evaluate(`(() => { const shown = document.querySelector(${JSON.stringify(placeholderOf(upcoming!.id))}); return { border: getComputedStyle(shown).borderTopStyle, spinning: Boolean(shown.querySelector("svg.animate-spin")) }; })()`)).toEqual({ border: "dashed", spinning: true });
      await focusOn(loglineTitle);
      await shot("34-revision-placeholder-beside-the-logline.png");

      await browser("open", `${pageUrl}&lang=zh`);
      await waitFor(`document.querySelector(${JSON.stringify(node(loglineId))}) && document.querySelector('button[aria-label="${fitZh}"]')`, "the canvas in Chinese after a reload", 120_000);
      await focusOn(loglineTitle);
      await waitFor(`document.querySelector(${JSON.stringify(placeholderOf(upcoming!.id))})?.textContent === ${JSON.stringify(writingShown)}`, "the revision's placeholder after a reload");
      expect(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(ghostLink)}))`)).toBe(true);
      expect((await snapshot()).bots[writer.id]!.writingBeside).toEqual([upcoming]);
      const placeholderBox = (await box(placeholderOf(upcoming!.id)))!;
      await shot("35-revision-placeholder-after-a-reload.png");

      writeFileSync(reviseGate, "go");
      await expect.poll(async () => (await results(loglineId)).map((one) => one.metadata?.content), { timeout: 30_000, message: "the revision beside the logline" }).toEqual([revised]);
      const [revision] = await results(loglineId);
      expect(revision).toMatchObject({ id: upcoming!.id, position: upcoming!.position, width: upcoming!.width, height: upcoming!.height });
      await waitFor(`document.querySelector(${JSON.stringify(node(revision!.id))}) && !document.querySelector(${JSON.stringify(placeholders)})`, "the revision drawn where its placeholder was");
      const revisionBox = (await box(node(revision!.id)))!;
      for (const side of ["x", "y", "w", "h"] as const) expect(Math.abs(revisionBox[side] - placeholderBox[side])).toBeLessThan(1);
      evidence.placeholder = { upcoming, shown: placeholderBox, revision: revisionBox };
      await fitUntilDrawn(revision!.id, "the revision on the open canvas");
      await waitFor(`document.querySelector(${JSON.stringify(node(revision!.id))})?.textContent.includes(${JSON.stringify(revised)})`, "the revision's text on the open canvas");
      await settled();
      const afterRevision = await snapshot();
      const logline = afterRevision.nodes.find((one) => one.id === loglineId)!;
      expect(logline).toMatchObject({ type: "text", title: loglineTitle, createdBy: { kind: "person" }, metadata: { content: loglineText } });
      expect(revision).toMatchObject({ type: "text", title: replyTitle(reviseRequest), createdBy: { kind: "bot", botId: writer.id }, metadata: { content: revised } });
      expect(revision!.position.x).toBeGreaterThanOrEqual(logline.position.x + logline.width);
      expect(afterRevision.bots[writer.id]!.writingInto).toBeUndefined();
      expect(afterRevision.bots[writer.id]!.writingBeside).toBeUndefined();
      const revisionAsked = await sentToWriter("REVISE-THE-LOGLINE");
      const framed = `@${writer.name} 请根据要求修改以下文本。\n\n原文：\n文本 1 "${loglineTitle}":\n\n> ${loglineText}\n\n修改要求：\n${reviseRequest}\n\n项目画布上文本节点 "${loglineTitle}" 引用的内容：\n\n图片 1 "${sceneTitle}":\n\n<attached-image `;
      expect(revisionAsked.slice(0, framed.length)).toBe(framed);
      expect(revisionAsked).toContain('\n\n视频 1 "rain.mp4"\n\n<attached-file ');
      evidence.revision = { mentions: loglineMentions, thumbs: loglineThumbs, logline, revision, asked: revisionAsked };
      await focusOn(loglineTitle);
      await shot("20-revision-in-a-new-node-to-its-right.png");

      const loglineState = async () => {
        const now = await snapshot();
        return { logline: now.nodes.find((one) => one.id === loglineId), replies: (await results(loglineId)).map((one) => one.id), nodes: now.nodes.length };
      };
      const asRevised = await loglineState();
      const askHeld = async (request: string, what: string) => {
        await openPanelOf(loglineId, `the logline's panel for ${what}`);
        await askInChinese(request);
        await waitFor(`document.querySelector(${JSON.stringify(placeholders)})?.textContent === ${JSON.stringify(writingShown)}`, `the placeholder of ${what}`);
        const pending = (await snapshot()).bots[writer.id]!.writingBeside!;
        expect(pending).toEqual([expect.objectContaining({ nodeId: loglineId, width: 340, height: 240 })]);
        return pending[0]!;
      };
      const stoppedReply = "这一句不该出现在画布上";
      plan([{ key: "stopped", match: ["STOP-THIS-REVISION"], gateFile: join(fixture.dataDir, "gate-never"), reply: stoppedReply }]);
      const stopped = await askHeld("STOP-THIS-REVISION 换一个开头", "a revision to stop");
      await waitFor(`[...document.querySelectorAll("[data-node-panel] button")].some((button) => button.textContent.trim() === "停止")`, "Stop in the logline's panel");
      await clickButton("停止", "[data-node-panel]");
      await settled();
      await waitFor(`!document.querySelector(${JSON.stringify(placeholders)}) && !document.querySelector(${JSON.stringify(`[data-ghost-connection=${JSON.stringify(stopped.id)}]`)})`, "the stopped revision's placeholder gone from the open canvas");
      expect((await snapshot()).bots[writer.id]!.writingBeside).toBeUndefined();
      expect(await loglineState()).toEqual(asRevised);
      expect((await messages(conversation)).some((line) => line.text?.includes(stoppedReply))).toBe(false);
      await focusOn(loglineTitle);
      await shot("36-stopped-revision-leaves-the-logline-as-it-was.png");

      const failGate = join(fixture.dataDir, "gate-fail-revision");
      plan([{ key: "failed", match: ["FAIL-THIS-REVISION"], gateFile: failGate, fail: true }]);
      const failing = await askHeld("FAIL-THIS-REVISION 改成第一人称", "a revision that fails");
      writeFileSync(failGate, "go");
      await settled();
      await waitFor(`!document.querySelector(${JSON.stringify(placeholders)})`, "the failed revision's placeholder gone from the open canvas");
      const afterFailure = await snapshot();
      expect(afterFailure.bots[writer.id]).toMatchObject({ status: "error" });
      expect(afterFailure.bots[writer.id]!.writingBeside).toBeUndefined();
      expect(await loglineState()).toEqual(asRevised);
      evidence.unwritten = { stopped, failing, writerAfterFailure: afterFailure.bots[writer.id], logline: asRevised };
      await focusOn(loglineTitle);
      await shot("37-failed-revision-leaves-the-logline-as-it-was.png");
      await focusOn(writer.name);
      await waitFor(`document.querySelector(${JSON.stringify(writerNode)})?.textContent.includes("出错")`, "the failed revision on the writer's node, where a failed task shows");
      await shot("38-failed-revision-shown-on-the-writer.png");

      const taglineTitle = "宣传语";
      const tagline = "雨不停，婚礼照常。";
      const taglineRequest = "WRITE-THE-TAGLINE 按 @图片 1 写一句宣传语";
      const taglineId = (await api("POST", `${canvasPath}/ops`, { ops: [{ type: "add_node", nodeType: "text", title: taglineTitle, position: { x: sceneAt.x, y: (await lowestY()) + 160 } }] })).nodeIds[0] as string;
      await fitUntilDrawn(taglineId, "the empty text node on the open canvas");
      await connectInto(sceneId, taglineId);
      plan([{ key: "tagline", match: ["WRITE-THE-TAGLINE"], reply: tagline }]);
      await focusOn(taglineTitle);
      await openPanelOf(taglineId, "the empty text node's panel");
      expect(await placeholderForWriter()).toBe(`告诉 ${writer.name} 这里写什么。输入 @ 引用参考。`);
      await askInChinese(taglineRequest);
      await waitFor(`document.querySelector(${JSON.stringify(node(taglineId))})?.textContent.includes(${JSON.stringify(tagline)})`, "the reply in the empty text node on the open canvas");
      await settled();
      const taglineNode = (await snapshot()).nodes.find((one) => one.id === taglineId)!;
      expect(taglineNode).toMatchObject({ type: "text", title: taglineTitle, createdBy: { kind: "person" }, metadata: { content: tagline } });
      expect(await results(taglineId)).toEqual([]);
      const taglineAsked = await sentToWriter("WRITE-THE-TAGLINE");
      const asWritten = `@${writer.name} ${taglineRequest}\n\n项目画布上文本节点 "${taglineTitle}" 引用的内容：\n\n图片 1 "${sceneTitle}":\n\n<attached-image `;
      expect(taglineAsked.slice(0, asWritten.length)).toBe(asWritten);
      evidence.emptyText = { node: taglineNode, asked: taglineAsked };
      await focusOn(taglineTitle);
      await shot("21-empty-text-node-filled-in-place.png");

      const twist = "再补一个反转";
      const twistReply = "反转：替身原来是新娘失散多年的妹妹。";
      plan([{ key: "twist", match: [twist], reply: twistReply }]);
      await focusOn(writer.name);
      await openPanelOf(botNodeId(writer.id), "the writer's panel in Chinese");
      await browser("find", "role", "textbox", "fill", twist, "--name", `发给 ${writer.name} 的消息`, "--exact");
      await clickButton("发送", "[data-node-panel]");
      await waitFor(`document.querySelector(${JSON.stringify(writerNode)})?.textContent.includes(${JSON.stringify(twistReply)})`, "the twist on the writer's node");
      await settled();
      const twistAsked = await sentToWriter(twist);
      expect(twistAsked.startsWith(`@${writer.name} ${twist}\n\n项目画布上连到你的节点的内容：\n\n`)).toBe(true);
      expect(twistAsked).toContain(`文本 1:\n\n> ${BRIEF}`);
      expect(twistAsked).toContain('图片 1 "board.png"\n\n<attached-image path="');
      const twistPicture = /<attached-image path="([^"]+)"/.exec(twistAsked)![1]!;
      const canvasBox = async () => (await box("[data-project-canvas-stage]"))!;
      const within = (inner: Box, outer: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
      const writerPanelAt = async (at: { x: number; y: number }, what: string) => {
        await clickEmpty();
        for (let attempt = 0; ; attempt += 1) {
          const [canvas, drawn] = [await canvasBox(), (await box(writerNode))!];
          const by = { x: canvas.x + at.x - drawn.x, y: canvas.y + at.y - drawn.y };
          if (Math.abs(by.x) <= 1.5 && Math.abs(by.y) <= 1.5) break;
          if (attempt === 6) throw new Error(`the writer's node did not reach ${at.x},${at.y} on the canvas`);
          const spot = (await emptySpot())!;
          await drag(spot, { x: Math.min(Math.max(spot.x + by.x, canvas.x + 4), canvas.x + canvas.w - 4), y: Math.min(Math.max(spot.y + by.y, canvas.y + 4), canvas.y + canvas.h - 4) });
        }
        const before = (await box(writerNode))!;
        await openPanelOf(botNodeId(writer.id), what);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await box(writerNode), `the writer's node where it was with ${what} open`).toEqual(before);
        const panelBox = (await box("[data-node-panel]"))!;
        expect(within(panelBox, await canvasBox()), `${what} wholly on the canvas`).toBe(true);
        return panelBox;
      };
      const inBothSkins = async (name: string) => {
        const surface = () => evaluate<string>(`getComputedStyle(document.querySelector("[data-node-panel] .popover-surface")).backgroundColor`);
        const light = await surface();
        await shot(`${name}.png`);
        await evaluate(`document.documentElement.dataset.skin = "midnight"`);
        await expect.poll(surface, { message: `${name} in the dark skin` }).not.toBe(light);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await shot(`${name}-dark.png`);
        await evaluate(`document.documentElement.dataset.skin = "daylight"`);
        await expect.poll(surface, { message: `${name} back in the light skin` }).toBe(light);
      };
      const minimapCover = () => evaluate<{ overlap: boolean; panelOnTop: boolean; minimapBeside: boolean }>(`(() => {
        const panel = document.querySelector("[data-node-panel]").getBoundingClientRect();
        const minimap = document.querySelector('[role="img"][aria-label="小地图"]');
        const map = minimap.getBoundingClientRect();
        const minimapBeside = minimap.contains(document.elementFromPoint(map.left + 12, (map.top + map.bottom) / 2));
        const left = Math.max(panel.left, map.left) + 8, right = Math.min(panel.right, map.right) - 8, top = Math.max(panel.top, map.top) + 8, bottom = Math.min(panel.bottom, map.bottom) - 8;
        if (left >= right || top >= bottom) return { overlap: false, panelOnTop: false, minimapBeside };
        const points = [[left, top], [right, top], [left, bottom], [right, bottom], [(left + right) / 2, (top + bottom) / 2]];
        return { overlap: true, panelOnTop: points.every(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("[data-node-panel]"))), minimapBeside };
      })()`);

      const atLeftEdge = await writerPanelAt({ x: 20, y: 40 }, "the writer's panel at the canvas's left edge");
      expect(atLeftEdge.x - (await canvasBox()).x).toBe(16);
      await inBothSkins("39-panel-at-the-left-edge");

      const minimapBox = (await box('[role="img"][aria-label="小地图"]'))!;
      const writerSize = (await box(writerNode))!;
      const besideMinimap = minimapBox.x - (await canvasBox()).x + 126 + 300 - writerSize.w / 2;
      await writerPanelAt({ x: besideMinimap, y: minimapBox.y - (await canvasBox()).y - 80 - 16 - writerSize.h }, "the writer's panel over the minimap");
      expect(await minimapCover()).toEqual({ overlap: true, panelOnTop: true, minimapBeside: true });
      await inBothSkins("40-panel-above-the-minimap");

      await writerPanelAt({ x: besideMinimap, y: 40 }, "the writer's panel for its conversation");
      await clickButton("对话", "[data-node-panel]");
      await waitFor(`document.querySelector("[data-node-panel]")?.textContent.includes(${JSON.stringify(twistReply)})`, "the twist's exchange in the panel");
      await waitFor(`(() => { const image = document.querySelector('[data-node-panel] img[src*="/api/attachments/"]'); return image && image.complete && image.naturalWidth === 320; })()`, "the sent picture in the panel's conversation");
      const panelLeaks = () => evaluate<string[]>(`(() => { const panel = document.querySelector("[data-node-panel]"); return [${JSON.stringify(twistPicture)}, ${JSON.stringify(dirname(twistPicture))}, "attached-image"].filter((raw) => panel.innerHTML.includes(raw)); })()`);
      expect(await panelLeaks()).toEqual([]);
      const sentWords = `[...document.querySelectorAll("[data-node-panel] .whitespace-pre-wrap")].find((words) => words.textContent.startsWith(${JSON.stringify(twist)}))`;
      expect(await evaluate<boolean>(`${sentWords}.classList.contains("max-h-40")`)).toBe(true);
      await evaluate(`[...document.querySelectorAll("[data-node-panel] button")].find((button) => button.textContent.trim() === "显示完整消息").scrollIntoView({ block: "nearest" })`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(within((await box("[data-node-panel]"))!, await canvasBox()), "the panel with its conversation wholly on the canvas").toBe(true);
      expect(await minimapCover()).toEqual({ overlap: true, panelOnTop: true, minimapBeside: true });
      await inBothSkins("41-picture-in-the-conversation");
      await clickButton("显示完整消息", "[data-node-panel]");
      await waitFor(`[...document.querySelectorAll("[data-node-panel] button")].some((button) => button.textContent.trim() === "收起")`, "the whole message in the panel");
      expect(await evaluate<boolean>(`${sentWords}.classList.contains("max-h-40")`)).toBe(false);
      expect(await panelLeaks()).toEqual([]);
      evidence.panelOnTheCanvas = { atLeftEdge, minimap: minimapBox, asked: twistAsked };
      await fit(fitZh);
      await expect.poll(async () => (await snapshot()).viewport.k, { timeout: 15_000, message: "the fitted view saved before the page opens again" }).toBeLessThan(1);
      await openPage();

      const noteGate = join(fixture.dataDir, "gate-note");
      const rule = "RULE: rain falls in every scene, even indoors.";
      const noteRequest = "Turn the note into a rule";
      plan([{ key: "note", match: [noteRequest], gateFile: noteGate, reply: rule }]);
      await clickEmpty();
      const note = await box(node(outsideId));
      await clickAt(note!.x + note!.w / 2, note!.y + 30);
      const writtenBy = '[data-node-panel] select[aria-label="Written by"]';
      await waitFor(`document.querySelector(${JSON.stringify(writtenBy)})`, "the note's panel");
      await browser("select", writtenBy, writer.id);
      await browser("find", "role", "textbox", "fill", noteRequest, "--name", "What to write", "--exact");
      await revealPanelEnd();
      await clickButton(`Ask ${writer.name}`, "[data-node-panel]");
      await waitFor(`document.querySelector(${JSON.stringify(placeholders)})?.textContent === ${JSON.stringify(`${writer.name} is writing…`)}`, "the reply's placeholder beside the note on the open canvas");
      const noteWriter = (await snapshot()).bots[writer.id]!;
      expect(noteWriter.writingBeside).toEqual([expect.objectContaining({ nodeId: outsideId })]);
      expect(noteWriter.writingInto).toBeUndefined();
      expect(await text(node(outsideId))).not.toContain("is writing");
      const [noteReply] = noteWriter.writingBeside!;
      await focusOn("From the director", { list: "Nodes", search: "Search nodes", close: "Close" });
      await shot("22-writing-from-a-text-node.png");
      writeFileSync(noteGate, "go");
      const ruleNode = async () => (await results(outsideId)).find((one) => one.type === "text");
      await expect.poll(async () => (await ruleNode())?.metadata?.content, { timeout: 30_000, message: "the reply beside the note" }).toBe(rule);
      const replied = (await ruleNode())!;
      await expect.poll(async () => {
        await fit();
        return text(node(replied.id));
      }, { timeout: 20_000, message: "the reply beside the note on the open canvas" }).toContain(rule);
      await settled();
      const filled = await snapshot();
      const noteAfter = filled.nodes.find((one) => one.id === outsideId)!;
      expect(noteAfter).toMatchObject({ type: "text", createdBy: { kind: "person" }, metadata: { content: "Keep the rain in every scene." } });
      expect(replied).toMatchObject({ id: noteReply!.id, type: "text", title: replyTitle(noteRequest), createdBy: { kind: "bot", botId: writer.id }, metadata: { content: rule }, position: noteReply!.position, width: noteReply!.width, height: noteReply!.height });
      expect(replied.position.x).toBeGreaterThanOrEqual(noteAfter.position.x + noteAfter.width);
      expect(filled.bots[writer.id]!.writingInto).toBeUndefined();
      expect(filled.bots[writer.id]!.writingBeside).toBeUndefined();
      evidence.reply = { placeholder: noteReply, note: noteAfter, reply: replied };
      await shot("23-reply-beside-the-text-node.png");

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
      await shot("24-bot-shot-back-after-undo.png");

      evidence.console = (await browser("console")).messages;
      expect(evidence.console).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "error" })]));

      const main = (await bots()).find((one) => one.defaultBot)!;
      await api("PATCH", `/api/bots/${main.id}`, { welcomed: true });
      const room = (await api("POST", "/api/groups", { name: "Table read", memberIds: [lead.id, writer.id], section: project.section })).group as { id: string };
      await api("PATCH", `/api/groups/${room.id}/setup`, { action: "complete", bulletin: "", defaultResponder: { kind: "member", botId: lead.id } });
      const teamColorist = await member("Colorist", "Grades the picture", "orange");
      await settled();
      await preview.close();
      preview = await mountPreview({ info: { url: fixture.url } }, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Projects in the app", logLevel: "warn" });
      await browser("open", preview.previewUrl);
      const projectRow = `[data-sidebar-project-row=${JSON.stringify(project.id)}]`;
      const roomRow = `[data-sidebar-project-room=${JSON.stringify(project.roomId)}]`;
      const botRow = (id: string) => `[data-sidebar-project-bot=${JSON.stringify(id)}]`;
      const chatBar = `[data-project-chat=${JSON.stringify(project.id)}]`;
      const view = `[data-project-view=${JSON.stringify(project.id)}]`;
      const slot = `${view} [data-project-canvas-slot]`;
      const mainOpen = `[data-sidebar-bot-row=${JSON.stringify(main.id)}][aria-current="page"]`;
      const onChat = `${chatBar} [data-project-mode-option="chat"][aria-pressed="true"]`;
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
        await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerNode}`)})`, "the project's canvas in the app");
      };
      const mainInstead = (message: string) => waitFor(`!document.querySelector(${JSON.stringify(view)}) && document.querySelector(${JSON.stringify(mainOpen)})`, message);
      await waitFor(`document.querySelector(${JSON.stringify(projectRow)})`, "the project in the sidebar", 120_000);
      expect(await evaluate(`[document.querySelector(${JSON.stringify(projectRow)}).getAttribute("aria-expanded"), Boolean(document.querySelector(${JSON.stringify(roomRow)}))]`)).toEqual(["false", false]);
      await clickSelector(projectRow);
      await roomChat("a click on the project opening its group chat");
      expect(await text(`${chatBar} h1`)).toBe(project.name);
      expect(await text(`${chatBar} [data-project-folder]`)).toBe(project.folder);
      expect(await evaluate(`document.querySelector(${JSON.stringify(`${chatBar} main[data-look="chat"]`)}) !== null`)).toBe(true);
      expect(await underProject()).toEqual(["room", lead.id, writer.id]);
      await shot("25a-project-row-opens-its-group-chat.png");
      await clickSelector(botRow(writer.id));
      await waitFor(`document.querySelector(${JSON.stringify(`${botRow(writer.id)}[aria-current="page"]`)}) && document.querySelector(${JSON.stringify(onChat)})
        && !document.querySelector(${JSON.stringify(`${roomRow}[aria-current="page"]`)})`, "the writer's own conversation under the project's top bar");
      await shot("25b-a-bot-under-the-project-opens-its-conversation.png");
      await clickSelector(`${chatBar} [data-project-mode-option="canvas"]`);
      await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerNode}`)})`, "the canvas from the project's switch");
      expect(await evaluate(`document.querySelector(${JSON.stringify(`${slot} [data-project-mode-option="canvas"]`)}).getAttribute("aria-pressed")`)).toBe("true");
      expect(await text(`${slot} [data-project-folder]`)).toBe(project.folder);
      await waitFor(`document.querySelector(${JSON.stringify(`${slot} [data-project-team-changes]`)})`, "the team's change in the top bar");
      await shot("25c-the-switch-opens-the-canvas.png");
      await clickSelector(`${slot} [data-project-mode-option="chat"]`);
      await roomChat("the switch back to the project's group chat");
      await clickSelector(projectRow);
      await waitFor(`!document.querySelector(${JSON.stringify(roomRow)}) && document.querySelector(${JSON.stringify(projectRow)}).getAttribute("aria-current") === "page"`, "the project folded, its row marked");
      await shot("25d-a-click-on-the-open-project-folds-it.png");
      await clickSelector(projectRow);
      await roomChat("the folded project opened again on its group chat");
      await clickSelector(`${chatBar} [data-project-mode-option="canvas"]`);
      await waitFor(`document.querySelector(${JSON.stringify(`${view} ${writerNode}`)})`, "the canvas again");

      await clickSelector(`${slot} button[aria-label="Group chats"]`);
      const roomItem = `[role="menu"] [data-menu-key=${JSON.stringify(room.id)}]`;
      await waitFor(`document.querySelector(${JSON.stringify(roomItem)})`, "the project's group chat in the top bar's menu");
      await shot("26-group-chats-menu.png");
      await clickSelector(roomItem);
      await waitFor(`!document.querySelector(${JSON.stringify(view)}) && !document.querySelector('[role="menu"]') && document.body.innerText.includes("Table read")`, "the group chat open");

      await openProject();
      await clickSelector(`${slot} [data-project-team-changes]`);
      await waitFor(`document.querySelector("[data-team-changes] [data-team-changes-apply]")`, "the team's changes to review");
      await clickSelector("[data-team-changes] [data-team-changes-apply]");
      const botNodes = `${view} [data-canvas-node^="bot:"]`;
      await waitFor(`!document.querySelector(${JSON.stringify(`${slot} [data-project-team-changes]`)})`, "the team's change made");
      let joinedBot: Bot | undefined;
      await expect.poll(async () => (joinedBot = (await bots()).find((one) => one.name === "Colorist" && one.id !== teamColorist.id)) !== undefined, { timeout: 15_000, message: "the colorist's copy in the project" }).toBe(true);
      expect(await evaluate<number>(`document.querySelectorAll(${JSON.stringify(botNodes)}).length`)).toBe(2);
      await api("POST", `/api/bots/${joinedBot!.id}/messages`, { text: "Grade the trailer.", threadId: joinedBot!.threadId, sendId: randomUUID() });
      await settled();
      await waitFor(`document.querySelectorAll(${JSON.stringify(botNodes)}).length === 3`, "the colorist's copy on the canvas once the work reached it");
      const joined = await snapshot();
      const colorist = joined.nodes.find((one) => one.type === "bot" && one.id !== botNodeId(lead.id) && one.id !== botNodeId(writer.id))!;
      const covers = (a: CanvasNode, b: CanvasNode) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
      const under = joined.nodes.filter((one) => one.id !== colorist.id && one.type !== "group" && covers(one, colorist)).map((one) => one.id);
      evidence.colorist = { node: colorist, under };
      expect(under).toEqual([]);
      await fit();
      await shot("27-team-change-adds-a-bot.png");

      const inSidebar = `({ projects: [...document.querySelectorAll("[data-sidebar-team-project]")].map((one) => [one.dataset.sidebarTeamProject, one.children.length]),
        bots: [...document.querySelectorAll("[data-sidebar-bot-row]")].map((one) => one.dataset.sidebarBotRow),
        noMatch: document.querySelector("[data-sidebar-no-project-match]")?.textContent ?? null })`;
      type InSidebar = { projects: Array<[string, number]>; bots: string[]; noMatch: string | null };
      await clickSelector(`[data-sidebar-bot-row=${JSON.stringify(main.id)}]`);
      await mainInstead("the main bot's chat in place of the canvas");
      const part = project.name.slice(project.name.indexOf(" ") + 1).toUpperCase();
      await expect.poll(() => evaluate<boolean>(searchSidebar(part)), { timeout: 10_000, interval: 250 }).toBe(true);
      await expect.poll(() => evaluate<InSidebar>(inSidebar), { timeout: 10_000, interval: 250 }).toEqual({ projects: [[project.id, 1]], bots: [main.id], noMatch: null });
      await shot("28a-search-finds-the-project-by-a-part-of-its-name.png");
      await clickSelector(projectRow);
      await waitFor(`document.querySelector(${JSON.stringify(projectRow)})?.getAttribute("aria-current") === "page" && document.querySelector(${JSON.stringify(`${chatBar} [data-project-mode-option="chat"][aria-pressed="true"]`)})`, "the project's group chat open from the search");
      await expect.poll(() => evaluate<boolean>(searchSidebar(writer.name)), { timeout: 10_000, interval: 250 }).toBe(true);
      await expect.poll(() => evaluate<InSidebar>(inSidebar), { timeout: 10_000, interval: 250 }).toEqual({ projects: [], bots: [main.id], noMatch: `No project matches “${writer.name}”` });
      await shot("28b-search-for-the-writer-finds-no-project.png");
      await evaluate(searchSidebar(""));
      await expect.poll(() => evaluate<InSidebar>(inSidebar), { timeout: 10_000, interval: 250 }).toEqual({ projects: [[project.id, 5]], bots: [main.id], noMatch: null });
      await clickSelector("[data-sidebar-search-toggle]");
      await waitFor(`!document.querySelector("[data-sidebar] input")`, "the search closed");
      evidence.search = { part, writer: writer.name };

      await api("POST", `/api/team-projects/${project.id}/archive`);
      await evaluate("window.dispatchEvent(new Event('focus')); true");
      await mainInstead("the main bot in place of the project archived elsewhere");
      await shot("29-archived-elsewhere-opens-the-main-bot.png");
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
      await shot("30-archived-from-the-sidebar-opens-the-main-bot.png");

      await clickButton("Undo", "[data-access-toast]");
      await openProject();
      const english = { list: "Nodes", search: "Search nodes", close: "Close" };
      await focusOn(sceneTitle, english);
      await openPanelOf(sceneId, "the image node's panel in the app");
      await revealPanelEnd();
      const banner = `${view} [role="status"].popover-surface`;
      await clickSelector('[data-node-panel] button[aria-label="Add references from the canvas"]');
      await waitFor(`document.querySelector(${JSON.stringify(banner)})?.textContent.includes("Click nodes to add them as references")`, "the picking banner over the canvas");
      const canvasLayers = {
        topBar: `${view} header`,
        nodeList: `${view} aside[aria-label="Nodes"]`,
        panel: `${view} [data-node-panel]`,
        banner,
        toolbar: `${view} [role="toolbar"][aria-label="Canvas tools"]`,
        zoom: `${view} input[aria-label="Zoom"]`,
        minimap: `${view} [role="img"][aria-label="Minimap"]`,
      };
      const openNodeList = async () => {
        await clickSelector(`${view} header button[aria-label="Nodes"]`);
        await waitFor(`document.querySelector(${JSON.stringify(canvasLayers.nodeList)})`, "the node list over the canvas");
      };
      await openNodeList();
      const coveredBy = (overlay: string) => evaluate<Record<string, boolean | "missing">>(`(() => {
        const scrim = document.querySelector(${JSON.stringify(overlay)})?.closest(".ui-scrim");
        return Object.fromEntries(Object.entries(${JSON.stringify(canvasLayers)}).map(([name, selector]) => {
          const layer = document.querySelector(selector);
          if (!layer) return [name, "missing"];
          const r = layer.getBoundingClientRect();
          return [name, Boolean(scrim && scrim.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)))];
        }));
      })()`);
      const allCovered = Object.fromEntries(Object.keys(canvasLayers).map((name) => [name, true]));
      const drawnInFull = (selector: string, what: string) => waitFor(`(() => {
        const shown = document.querySelector(${JSON.stringify(selector)});
        const root = shown?.closest(".ui-scrim") ?? shown;
        return Boolean(root) && root.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity);
      })()`, what);
      const settingsDialog = "[data-project-canvas-settings]";
      await clickSelector(`${view} header button[aria-label="Project settings"]`);
      await drawnInFull(settingsDialog, "the project settings over the canvas");
      const underSettings = await coveredBy(settingsDialog);
      expect(underSettings).toEqual(allCovered);
      await shot("31-project-settings-cover-the-canvas.png");

      const verifier = randomBytes(32).toString("base64url");
      const fromTerminal = (path: string, body: unknown) => fetch(fixture.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const signIn = await fromTerminal("/api/auth/cli-login", { label: "openmausbot CLI in the fixture", scope: "client", verifierHash: createHash("sha256").update(verifier).digest("base64url") });
      expect(signIn.status).toBe(201);
      const login = (await signIn.json()) as { id: string; code: string };
      const loginCard = "[data-notice='cli-login']";
      await waitFor(`document.querySelector(${JSON.stringify(loginCard)})?.textContent.includes(${JSON.stringify(login.code)})`, "the CLI login card over the project settings");
      expect(await evaluate<boolean>(`(() => { const card = document.querySelector(${JSON.stringify(loginCard)}); const r = card.getBoundingClientRect(); return card.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`)).toBe(true);
      await drawnInFull(loginCard, "the CLI login card drawn in full");
      await shot("32-cli-login-card-above-the-project-settings.png");
      await clickButton("Deny", loginCard);
      await waitFor(`!document.querySelector(${JSON.stringify(loginCard)})`, "the CLI login answered from its card");
      const answered = await (await fromTerminal(`/api/auth/cli-login/${login.id}`, { verifier })).json();
      expect(answered).toMatchObject({ state: "denied" });
      expect(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(settingsDialog)}))`)).toBe(true);
      await clickAt(20, 20);
      await waitFor(`!document.querySelector(${JSON.stringify(settingsDialog)})`, "the project settings closed from their scrim");
      await clickButton("Done", banner);
      await waitFor(`!document.querySelector(${JSON.stringify(banner)})`, "picking done");

      await focusOn("board.png", english);
      await openPanelOf(upload.id, "the board's panel in the app");
      await revealPanelEnd();
      await openNodeList();
      const boardShown = centre((await box(node(upload.id)))!);
      await move(boardShown.x, boardShown.y);
      await browser("mouse", "down", "right");
      await browser("mouse", "up", "right");
      await waitFor(`document.querySelector('[role="menu"]')`, "the board's menu");
      await clickButton("Copy", '[role="menu"]');
      await waitFor(`document.querySelector(${JSON.stringify(banner)})?.textContent.includes("Copied: 1")`, "the copied notice over the canvas");
      await browser("dblclick", `${node(upload.id)} img`);
      const imagePreview = '[role="dialog"][aria-label="board.png"]';
      await drawnInFull(imagePreview, "the board's picture in its preview");
      const underPreview = await coveredBy(imagePreview);
      expect(underPreview).toEqual(allCovered);
      await shot("33-image-preview-covers-the-canvas.png");
      await browser("press", "Escape");
      await waitFor(`!document.querySelector(${JSON.stringify(imagePreview)})`, "the preview closed");
      evidence.overlays = { underSettings, underPreview, cliLogin: { code: login.code, answered } };
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
