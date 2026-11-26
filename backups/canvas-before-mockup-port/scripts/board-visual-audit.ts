// 效果图 vs 实现：把老板的静态效果图与 MagicBot 的制作看板放在同一视口下逐元素量、逐元素截，产出
// parity.json、report.md 和 side-by-side/ 拼图。改完看板重跑，差距分应当下降。
//
//   node --experimental-strip-types scripts/board-visual-audit.ts [--viewport 1440x900] [--only cards,chrome,panels]
//
// 效果图必须经 http 提供（file:// 被拒），固定 8781；看板预览从 8790 起找空闲端口，跑在隔离夹具上：临时数据
// 目录与 HOME，绝不读写 ~/.magicbot 或 ~/Library/Application Support/MagicBot。要审计已经打开在隔离夹具里的
// 真实项目看板，用 --app-url 指它的页面。
//
// 一条 UI 夹具锁贯穿整轮（/tmp/omb-ui-fixture.lock，第一行 `vis-audit <pid>`），跑完即释放。
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  AuditError,
  SECTIONS,
  composeHtml,
  composeSize,
  diffElement,
  loadMap,
  parseArgs,
  pngSize,
  rank,
  reportMarkdown,
  resolveMockupDir,
  shadowLayers,
  type AuditElement,
  type BoardPair,
  type Captured,
  type Options,
  type ReportMeta,
} from "./board-visual-compare.ts";

export * from "./board-visual-compare.ts";

const HELP = `效果图 vs 实现：制作看板的逐元素对照

  用法：pnpm vis:audit [选项]
    --viewport 1440x900        视口，默认 1440x900
    --only cards,chrome,panels 只跑这几组（chrome 含整板截图）
    --out DIR                  输出目录，默认 /tmp/omb-vis-audit
    --mockup DIR               index-v5 目录；默认先找本工作树，再找 ../../OpenMausBot
    --mockup-port 8781         效果图静态服务的端口
    --app-port 8790            看板预览的起始端口（占用就往后找 9 个）
    --app-url URL              审计已经在跑的隔离看板页面，不再自己起预览
    --skin midnight            看板皮肤（效果图是深色）
    --lang zh                  看板语言
    --episodes 4               看板样例的集数
    --scale 2                  截图设备像素比
`;

type HeadlessPage = Awaited<ReturnType<typeof import("./testing/headless-chrome.ts").openHeadlessChrome>>;
interface Fixture { info: { url: string; dataDir: string; logPath: string }; close(): Promise<void> }
interface Preview { previewUrl: string; close(): Promise<void> }
interface StaticServer { url: string; close(): Promise<void> }

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const LOCK = "/tmp/omb-ui-fixture.lock";
const OWNER = `vis-audit ${process.pid}`;

function lockOwner(): string | null {
  try {
    return readFileSync(join(LOCK, "owner"), "utf8").split("\n")[0] ?? "";
  } catch {
    return null;
  }
}

function lockIsStale(): boolean {
  const pid = lockOwner()?.trim().split(/\s+/)[1];
  if (!pid || !/^\d+$/.test(pid)) return false;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function takeLock(): Promise<void> {
  let announced = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "owner"), `${OWNER}\n`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (lockIsStale()) {
      process.stdout.write(`清掉陈旧锁：${lockOwner()}\n`);
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    if (!announced) {
      process.stdout.write(`等待 ${LOCK}（现在由 ${lockOwner() || "别人"} 占着）…\n`);
      announced = true;
    }
    await delay(5_000);
  }
}

function releaseLock(): void {
  if (lockOwner() === OWNER) rmSync(LOCK, { recursive: true, force: true });
}

function serveStatic(mockupDir: string, outDir: string, port: number): Promise<StaticServer> {
  const send = (response: ServerResponse, status: number, text: string) => {
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end(text);
  };
  const answer = (request: IncomingMessage, response: ServerResponse) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent((request.url ?? "/").split("?")[0]!);
    } catch {
      send(response, 400, "bad path");
      return;
    }
    const underOut = pathname.startsWith("/__out/");
    const root = underOut ? outDir : mockupDir;
    const relative = underOut ? pathname.slice("/__out/".length) : pathname === "/" ? "index.html" : pathname.slice(1);
    const file = resolve(root, relative);
    const base = resolve(root);
    if (file !== base && !file.startsWith(base + sep)) { send(response, 403, "forbidden"); return; }
    let info;
    try {
      info = statSync(file);
    } catch {
      send(response, 404, "not found");
      return;
    }
    const target = info.isDirectory() ? join(file, "index.html") : file;
    response.writeHead(200, { "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(target).on("error", () => response.end()).pipe(response);
  };
  const server = createServer(answer);
  server.on("clientError", (_error, socket) => socket.destroy());
  return new Promise((done, fail) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") fail(new AuditError(`端口 ${port} 被占用（效果图静态服务）`, "关掉占用它的程序，或用 --mockup-port 换一个端口"));
      else fail(new AuditError(`静态服务起不来：${error.message}`));
    };
    const onListening = () => {
      server.off("error", onError);
      done({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((closed) => server.close(() => closed())) });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function freePort(from: number, to: number): Promise<number> {
  for (let port = from; port <= to; port += 1) if (await canListen(port)) return port;
  throw new AuditError(`端口 ${from}–${to} 都被占用（看板预览）`, "用 --app-port 指定一个空闲端口，或关掉占着它们的程序");
}

const measureScript = (selector: string): string => `(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  if (!all.length) return { found: false, reason: "没有元素匹配 " + ${JSON.stringify(selector)} };
  const inView = (r) => r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  const target = all.find((one) => inView(one.getBoundingClientRect())) ?? all[0];
  const rect = target.getBoundingClientRect();
  const cs = getComputedStyle(target);
  const scaleOf = (element) => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const transform = getComputedStyle(node).transform;
      if (!transform || transform === "none") continue;
      const matrix = new DOMMatrixReadOnly(transform);
      if (matrix.a && Number.isFinite(matrix.a)) return matrix.a;
    }
    return 1;
  };
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (value) => {
    if (!value || value === "none" || value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    context.fillStyle = "#010203";
    context.fillStyle = value;
    if (context.fillStyle === "#010203" && value.replace(/\\s/g, "").toLowerCase() !== "#010203") return null;
    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: Math.round((data[3] / 255) * 1000) / 1000 };
  };
  const px = (value) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : 0; };
  const corners = cs.borderRadius.split(/\\s+/).filter(Boolean).map(px);
  const radius = corners.length === 0 ? [0, 0, 0, 0]
    : corners.length === 1 ? [corners[0], corners[0], corners[0], corners[0]]
    : corners.length === 2 ? [corners[0], corners[1], corners[0], corners[1]]
    : corners.length === 3 ? [corners[0], corners[1], corners[2], corners[1]]
    : corners.slice(0, 4);
  const scale = scaleOf(target);
  return {
    found: true,
    count: all.length,
    visible: inView(rect),
    sample: (target.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80),
    scale: Math.round(scale * 1000) / 1000,
    rect: {
      x: Math.round(rect.x * 10) / 10,
      y: Math.round(rect.y * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    },
    style: {
      width: Math.round((rect.width / scale) * 10) / 10,
      height: Math.round((rect.height / scale) * 10) / 10,
      radius: radius.map((one) => Math.round(one * 10) / 10),
      background: rgba(cs.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 },
      borderWidth: px(cs.borderTopWidth),
      borderStyle: cs.borderTopStyle,
      borderColor: rgba(cs.borderTopColor) ?? { r: 0, g: 0, b: 0, a: 0 },
      shadow: cs.boxShadow,
      fontSize: px(cs.fontSize),
      lineHeight: cs.lineHeight === "normal" ? Math.round(px(cs.fontSize) * 1.2 * 10) / 10 : px(cs.lineHeight),
      padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
      raw: {
        width: cs.width,
        height: cs.height,
        borderRadius: cs.borderRadius,
        backgroundColor: cs.backgroundColor,
        borderTop: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor,
        boxShadow: cs.boxShadow,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        padding: cs.padding,
        color: cs.color,
      },
    },
  };
})()`;

const SETTLE = `(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve()
    : new Promise((done) => {
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    })));
  return true;
})()`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function prepare(page: HeadlessPage, options: Options): Promise<void> {
  await page.send("Emulation.setDeviceMetricsOverride", { width: options.viewport.width, height: options.viewport.height, deviceScaleFactor: options.scale, mobile: false });
  // 两边都按「不要动效」渲染：入场位移和淡出会让截图落在半路上。
  await page.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await page.send("Network.enable");
  // 效果图引了 Google Fonts；这台机器不联网，拦住它，别让首屏等一个注定失败的请求。
  await page.send("Network.setBlockedURLs", { urls: ["*://fonts.googleapis.com/*", "*://fonts.gstatic.com/*"] });
}

async function navigate(page: HeadlessPage, url: string): Promise<void> {
  await page.send("Page.navigate", { url });
  await page.until("document.readyState === 'complete'", 30_000);
  await page.evaluate(SETTLE);
  await delay(150);
}

let outputDir = "";

async function shoot(page: HeadlessPage, relative: string, clip?: { x: number; y: number; width: number; height: number }): Promise<{ width: number; height: number }> {
  const png = await page.capture(clip);
  const file = join(outputDir, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  return pngSize(png);
}

function toCaptured(selector: string, measured: any): Captured {
  if (!measured?.found) return { selector, found: false, reason: String(measured?.reason ?? "没有匹配的元素") };
  const style = measured.style;
  return {
    selector,
    found: true,
    sample: measured.sample,
    rect: measured.rect,
    scale: measured.scale,
    visible: measured.visible,
    count: measured.count,
    style: {
      width: style.width,
      height: style.height,
      radius: style.radius,
      background: style.background,
      borderWidth: style.borderWidth,
      borderStyle: style.borderStyle,
      borderColor: style.borderColor,
      shadow: style.shadow,
      shadowLayers: shadowLayers(style.shadow),
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      padding: style.padding,
      raw: style.raw,
    },
  };
}

async function measure(page: HeadlessPage, selector: string): Promise<Captured> {
  return toCaptured(selector, await page.evaluate(measureScript(selector)));
}

/** Clicks a selector the way `appClick` does, reporting whether anything was there to click. */
async function press(page: HeadlessPage, selector: string): Promise<boolean> {
  return Boolean(await page.evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    target?.click();
    return Boolean(target);
  })()`));
}

/** An element the board keeps folded until it is asked for: the reveal switch is pressed once, then it is measured again. */
async function measureRevealed(page: HeadlessPage, element: AuditElement): Promise<Captured> {
  const measured = await measure(page, element.app);
  if (measured.found || !element.appReveal) return measured;
  if (!(await press(page, element.appReveal))) return measured;
  await delay(200);
  return measure(page, element.app);
}

async function shootElement(page: HeadlessPage, captured: Captured, relative: string, viewport: Options["viewport"]): Promise<void> {
  const rect = captured.rect;
  if (!captured.found || !rect) return;
  const margin = 6;
  const x = Math.max(0, Math.round(rect.x - margin));
  const y = Math.max(0, Math.round(rect.y - margin));
  const width = Math.min(viewport.width - x, Math.round(rect.width + (rect.x - x) + margin));
  const height = Math.min(viewport.height - y, Math.round(rect.height + (rect.y - y) + margin));
  if (width < 4 || height < 4) {
    captured.reason = "元素不在视口里";
    return;
  }
  captured.cropped = width + 0.5 < rect.width || height + 0.5 < rect.height;
  captured.shotPx = await shoot(page, relative, { x, y, width, height });
  captured.shot = relative;
}

async function auditMockup(page: HeadlessPage, baseUrl: string, elements: AuditElement[], options: Options): Promise<{ elements: Record<string, Captured>; openScale: number; fitScale: number; stageScale: number }> {
  await navigate(page, `${baseUrl}/index.html`);
  await page.until("window.MJ && window.MJ.app && window.MJ.ui && document.querySelectorAll('#nodes .node').length > 30", 30_000);
  await page.evaluate("(async () => { await document.fonts.ready; return true; })()");
  await delay(400);
  const captured: Record<string, Captured> = {};

  const openScale = Number(await page.evaluate("window.MJ?.app?.cam?.z ?? 1")) || 1;
  await shoot(page, "mockup/board-open.png");
  await page.evaluate("document.querySelector('[data-act=\"fit-all\"]')?.click(); true");
  await delay(200);
  const fitScale = Number(await page.evaluate("window.MJ?.app?.cam?.z ?? 1")) || 1;
  await shoot(page, "mockup/board.png");
  await page.evaluate("document.querySelector('[data-act=\"stage\"][data-id=\"0\"]')?.click(); true");
  await delay(1_100);
  const stageScale = Number(await page.evaluate("window.MJ?.app?.cam?.z ?? 1")) || 1;
  await shoot(page, "mockup/board-stage1.png");

  for (const element of elements) {
    if (element.section !== "chrome") continue;
    const measured = await measure(page, element.mockup);
    if (!measured.found) throw new AuditError(`效果图里找不到 ${element.name}（${element.mockup}）`, "改 scripts/testing/board-visual-map.json 的选择器");
    await shootElement(page, measured, `mockup/${element.section}/${element.id}.png`, options.viewport);
    captured[element.id] = measured;
  }

  for (const element of elements) {
    if (element.section !== "cards") continue;
    if (!element.mockupNode) throw new AuditError(`${element.name}（${element.id}）没有写 mockupNode`, "在对照表里给出效果图的代表节点 id");
    const moved = await page.evaluate(`(() => {
      const node = window.MJ.byId[${JSON.stringify(element.mockupNode)}];
      if (!node) return null;
      const zoom = Math.max(0.2, Math.min(1, (innerWidth - 120) / Math.max(1, node.w), (innerHeight - 200) / Math.max(1, node.h)));
      window.MJ.app.animateTo({ z: zoom, x: innerWidth / 2 - (node.x + node.w / 2) * zoom, y: innerHeight / 2 - (node.y + node.h / 2) * zoom }, 0);
      return node.id;
    })()`);
    if (!moved) throw new AuditError(`效果图里找不到代表节点 ${element.mockupNode}（${element.name}）`);
    await delay(80);
    const selector = `${element.mockup}[data-id="${element.mockupNode}"]`;
    const measured = await measure(page, selector);
    if (!measured.found) throw new AuditError(`效果图里找不到 ${element.name}（${selector}）`);
    await shootElement(page, measured, `mockup/${element.section}/${element.id}.png`, options.viewport);
    captured[element.id] = measured;
  }

  for (const element of elements) {
    if (element.section !== "panels") continue;
    if (element.mockupOpen?.chat) {
      await page.evaluate(`window.MJ.ui.openChat(${JSON.stringify(element.mockupOpen.chat)}); document.activeElement?.blur?.(); true`);
      await delay(150);
    }
    if (element.mockupOpen?.modal) {
      await page.evaluate(`window.MJ.ui.openModal(${JSON.stringify(element.mockupOpen.modal)}); document.activeElement?.blur?.(); true`);
      await delay(150);
    }
    const measured = await measure(page, element.mockup);
    if (!measured.found) throw new AuditError(`效果图里打不开或找不到 ${element.name}（${element.mockup}）`);
    await shootElement(page, measured, `mockup/${element.section}/${element.id}.png`, options.viewport);
    captured[element.id] = measured;
    await page.evaluate("window.MJ.ui.closeChat(); window.MJ.ui.closeModal(); true");
    await delay(100);
  }

  return { elements: captured, openScale, fitScale, stageScale };
}

const closeOverlay = `(() => {
  const panel = document.querySelector("[data-board-chat], [data-board-asset]");
  const close = panel?.querySelector("button[aria-label]") ?? panel?.querySelector("button");
  close?.click();
  return Boolean(close);
})()`;

const VIEW = `(() => {
  const world = document.querySelector("[data-board-world]");
  const transform = world && getComputedStyle(world).transform;
  if (!transform || transform === "none") return { x: 0, y: 0, k: 1 };
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.e, y: matrix.f, k: matrix.a || 1 };
})()`;

const KEY_SPECS: Record<string, { code: string; vk: number }> = {
  "0": { code: "Digit0", vk: 48 },
  "1": { code: "Digit1", vk: 49 },
  "2": { code: "Digit2", vk: 50 },
  "3": { code: "Digit3", vk: 51 },
  "4": { code: "Digit4", vk: 52 },
  "5": { code: "Digit5", vk: 53 },
  "=": { code: "Equal", vk: 187 },
  "-": { code: "Minus", vk: 189 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
};

/** A key the page takes as the person's own: the board ignores untrusted KeyboardEvents once another listener has
 * called preventDefault on them. */
async function pressReal(page: HeadlessPage, key: string): Promise<void> {
  const spec = KEY_SPECS[key] ?? { code: `Digit${key}`, vk: 48 + Number(key) };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: spec.code, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: spec.code, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk });
}

const STAGE_OF_KIND: Record<string, string> = {
  bot: "1", brief: "1", plan: "1",
  episode: "2", episodeStack: "2",
  character: "3", scene: "3",
  shot: "4", result: "4",
  final: "5", generic: "5",
};

const CARD_LAYOUT = (kind: string) => `(async () => {
  const live = window.projectCanvasBackend && typeof window.projectCanvasBackend.current === "function" ? window.projectCanvasBackend.current() : null;
  const [boardModule, layoutModule, sizesModule, sampleModule] = await Promise.all([
    import("/src/lib/production-board/board.ts"),
    import("/src/lib/production-board/layout.ts"),
    import("/src/components/production-board/cards/sizes.ts"),
    import("/src/testing/production-board-sample.ts"),
  ]);
  const params = new URLSearchParams(location.search);
  const snapshot = sampleModule.productionBoardSample({ episodes: Number(params.get("episodes") ?? 60) });
  if (!live || live.projectId !== snapshot.projectId) return { ok: false, fallback: true, reason: "这不是样例看板" };
  const board = boardModule.buildBoard(snapshot, { opened: new Set() });
  const sizeOf = (card) => sizesModule.BOARD_CARD_SIZES[card.kind === "stack" ? "episodeStack" : card.kind === "other" ? "generic" : card.kind];
  const layout = layoutModule.layoutBoard(board, sizeOf);
  const card = board.cards.find((one) => one.kind === ${JSON.stringify(kind === "episodeStack" ? "stack" : kind === "generic" ? "other" : kind)});
  if (!card) return { ok: false, reason: "样例里没有这种卡片" };
  const rect = layout.rects.get(card.id);
  if (!rect) return { ok: false, reason: "布局里没有这张卡" };
  const world = document.querySelector("[data-board-world]");
  const transform = world && getComputedStyle(world).transform;
  const matrix = transform && transform !== "none" ? new DOMMatrixReadOnly(transform) : new DOMMatrixReadOnly();
  return { ok: true, id: card.id, rect, view: { x: matrix.e, y: matrix.f, k: matrix.a || 1 } };
})()`;

/** Zoom around the centre and pan by the board's own 80 px steps until the first card of `kind` is centred. The
 * world position comes from the same modules the board lays out with, so this needs the sample drama. Keys are sent
 * in batches: the renderer processes input a beat after the DevTools reply, so each batch is followed by a wait. */
async function focusCard(page: HeadlessPage, kind: string, viewport: Options["viewport"]): Promise<{ ok: boolean; fallback?: boolean; reason?: string }> {
  const info = await page.evaluate(CARD_LAYOUT(kind));
  if (!info?.ok) return info ?? { ok: false, reason: "定位脚本没有结果" };
  await page.evaluate("document.querySelector('[data-production-board]')?.focus?.({ preventScroll: true }); true");
  await delay(80);
  const targetK = Math.min(1, (viewport.width - 80) / Math.max(1, info.rect.width), (viewport.height - 160) / Math.max(1, info.rect.height));
  const ratio = targetK / Math.max(0.001, info.view.k);
  const steps = ratio > 1 ? Math.floor(Math.log(ratio) / Math.log(1.2)) : -Math.ceil(Math.log(1 / ratio) / Math.log(1.2));
  const send = async (count: number, key: string) => {
    for (let at = 0; at < count; at += 1) await pressReal(page, key);
  };
  await send(Math.abs(steps), steps > 0 ? "=" : "-");
  await delay(250);
  let view: { x: number; y: number; k: number } = await page.evaluate(VIEW);
  const wantX = viewport.width / 2 - (info.rect.x + info.rect.width / 2) * view.k;
  const wantY = viewport.height / 2 - (info.rect.y + info.rect.height / 2) * view.k;
  await send(Math.min(140, Math.round(Math.abs(wantX - view.x) / 80)), wantX > view.x ? "ArrowLeft" : "ArrowRight");
  await send(Math.min(140, Math.round(Math.abs(wantY - view.y) / 80)), wantY > view.y ? "ArrowUp" : "ArrowDown");
  await delay(250);
  view = await page.evaluate(VIEW);
  const fixX = Math.round((wantX - view.x) / 80);
  const fixY = Math.round((wantY - view.y) / 80);
  if (fixX) await send(Math.min(3, Math.abs(fixX)), fixX > 0 ? "ArrowLeft" : "ArrowRight");
  if (fixY) await send(Math.min(3, Math.abs(fixY)), fixY > 0 ? "ArrowUp" : "ArrowDown");
  await delay(120);
  return { ok: true };
}

async function auditApp(page: HeadlessPage, appUrl: string, elements: AuditElement[], options: Options): Promise<{ elements: Record<string, Captured>; openScale: number; fitScale: number; stageScale: number }> {
  await navigate(page, appUrl);
  await page.until("document.querySelector('[data-production-board]') && document.querySelectorAll('[data-board-card]').length > 0", 60_000);
  await delay(300);
  const captured: Record<string, Captured> = {};
  await page.evaluate("document.querySelector('[data-production-board]')?.focus?.({ preventScroll: true }); true");

  const openScale = (await page.evaluate(VIEW)).k;
  await shoot(page, "app/board-open.png");
  await pressReal(page, "0");
  await delay(250);
  const fitScale = (await page.evaluate(VIEW)).k;
  await shoot(page, "app/board.png");
  await pressReal(page, "1");
  await delay(250);
  const stageScale = (await page.evaluate(VIEW)).k;
  await shoot(page, "app/board-stage1.png");

  for (const element of elements) {
    if (element.section !== "chrome") continue;
    const measured = await measureRevealed(page, element);
    if (measured.found) await shootElement(page, measured, `app/${element.section}/${element.id}.png`, options.viewport);
    captured[element.id] = measured;
  }

  for (const element of elements) {
    if (element.section === "chrome") continue;
    if (element.appCardKind) {
      const focused = await focusCard(page, element.appCardKind, options.viewport);
      if (!focused.ok && !focused.fallback) {
        captured[element.id] = { selector: element.app, found: false, reason: focused.reason ?? "定位不到这张卡" };
        continue;
      }
      if (focused.fallback) {
        await pressReal(page, STAGE_OF_KIND[element.appCardKind] ?? "0");
        await delay(150);
        for (let tries = 0; tries < 3; tries += 1) {
          const scale = await page.evaluate(VIEW);
          if (typeof scale.k !== "number" || scale.k >= 0.62) break;
          await pressReal(page, "=");
          await delay(120);
        }
      }
    }
    if (element.appClick) {
      const clicked = await page.evaluate(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(element.appClick)})];
        const inView = (r) => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        const target = all.find((one) => inView(one.getBoundingClientRect())) ?? all[0];
        target?.click();
        return Boolean(target);
      })()`);
      if (!clicked) {
        captured[element.id] = { selector: element.app, found: false, reason: `点不到 ${element.appClick}` };
        continue;
      }
      await page.until(`Boolean(document.querySelector(${JSON.stringify(element.app)}))`, 8_000).catch(() => {});
      await delay(250);
    }
    const measured = await measureRevealed(page, element);
    if (!measured.found) {
      captured[element.id] = { ...measured, reason: `看板里没有 ${element.app}${element.appCardKind ? `（把 ${element.appCardKind} 卡片移到中央后仍没有）` : ""}` };
      continue;
    }
    await shootElement(page, measured, `app/${element.section}/${element.id}.png`, options.viewport);
    captured[element.id] = measured;
    if (element.appClick) {
      await page.evaluate(closeOverlay);
      await delay(150);
    }
  }
  return { elements: captured, openScale, fitScale, stageScale };
}

async function composePair(page: HeadlessPage, pair: { id: string; left: string; right: string; label: string }, baseUrl: string): Promise<void> {
  const left = { src: `/__out/${pair.left}`, ...pngSize(readFileSync(join(outputDir, pair.left))) };
  const right = { src: `/__out/${pair.right}`, ...pngSize(readFileSync(join(outputDir, pair.right))) };
  const html = composeHtml({ left, right, leftLabel: `效果图 · ${pair.left}`, rightLabel: `实现 · ${pair.right}`, title: pair.label });
  const relative = `side-by-side/${pair.id}.html`;
  writeFileSync(join(outputDir, relative), html);
  const size = composeSize({ left, right });
  await page.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
  await navigate(page, `${baseUrl}/__out/${relative}`);
  await page.until("[...document.images].every((image) => image.complete && image.naturalWidth > 0)", 15_000);
  const png = await page.capture();
  writeFileSync(join(outputDir, "side-by-side", `${pair.id}.png`), png);
}

function commitOf(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function run(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const map = loadMap(join(repoRoot, "scripts/testing/board-visual-map.json"));
  const selected = map.elements.filter((element) => !options.only || options.only.includes(element.section));
  if (!selected.length) throw new AuditError(`--only ${options.only?.join(",")} 没有选中任何元素`, `可选：${SECTIONS.join("、")}`);
  const mockupDir = resolveMockupDir(repoRoot, options.mockup);
  const outDir = resolve(options.out);
  outputDir = outDir;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "mockup"), { recursive: true });
  mkdirSync(join(outDir, "app"), { recursive: true });
  mkdirSync(join(outDir, "side-by-side"), { recursive: true });

  await takeLock();
  const profile = mkdtempSync(join("/tmp", "omb-vis-chrome-"));
  let server: StaticServer | undefined;
  let fixture: Fixture | undefined;
  let preview: Preview | undefined;
  let page: HeadlessPage | undefined;
  try {
    server = await serveStatic(mockupDir, outDir, options.mockupPort);
    let appUrl = options.appUrl;
    const appSource = appUrl ? "已经在跑的隔离看板页面（--app-url）" : "仓库看板预览 project-canvas-preview.tsx（内存样例 productionBoardSample）";
    if (!appUrl) {
      const control = await import("./control-omb.ts");
      try {
        fixture = await control.launchVerificationServer({ ...process.env, OMB_DEFAULT_LANGUAGE: options.lang });
      } catch (error) {
        throw new AuditError(`隔离夹具没起来：${messageOf(error)}`, "先单独跑 `node --experimental-strip-types scripts/control-omb.ts launch` 看它的输出");
      }
      const port = await freePort(options.appPort, options.appPort + 9);
      const fixtures = await import("./testing/preview-fixture.ts");
      preview = await fixtures.mountPreview(fixture, {
        entry: "/scripts/testing/project-canvas-preview.tsx",
        route: "/__production-board.html",
        title: "Production board visual audit",
        logLevel: "error",
        port,
      });
      appUrl = `${preview.previewUrl}?episodes=${options.episodes}&skin=${options.skin}&lang=${options.lang}`;
    }
    const headless = await import("./testing/headless-chrome.ts");
    page = await headless.openHeadlessChrome(profile);
    await prepare(page, options);

    process.stdout.write(`效果图：${mockupDir} → ${server.url}\n`);
    process.stdout.write(`看板：${appUrl}\n`);
    if (fixture) process.stdout.write(`隔离夹具：${fixture.info.dataDir}（关闭时删除），日志 ${fixture.info.logPath}\n`);
    process.stdout.write(`输出：${outDir}（视口 ${options.viewport.width}×${options.viewport.height}，皮肤 ${options.skin}，语言 ${options.lang}）\n`);
    process.stdout.write(`采集 ${selected.length} 个元素：${selected.map((element) => element.name).join("、")}\n`);

    const mockup = await auditMockup(page, server.url, selected, options);
    process.stdout.write("效果图侧采集完成\n");
    const app = await auditApp(page, appUrl, selected, options);
    process.stdout.write("实现侧采集完成\n");

    const elements = selected.map((element) => diffElement(
      element,
      mockup.elements[element.id] ?? { selector: element.mockup, found: false, reason: "没有采集到" },
      app.elements[element.id] ?? { selector: element.app, found: false, reason: "没有采集到" },
    ));
    const ranked = rank(elements);

    const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
    const boardPair = (id: string, label: string, mockupScale: number, appScale: number): BoardPair | null => {
      const mockupShot = `mockup/${id}.png`;
      const appShot = `app/${id}.png`;
      if (!existsSync(join(outDir, mockupShot)) && !existsSync(join(outDir, appShot))) return null;
      return {
        id,
        label,
        ...(existsSync(join(outDir, mockupShot)) ? { mockup: mockupShot } : {}),
        ...(existsSync(join(outDir, appShot)) ? { app: appShot } : {}),
        pair: `side-by-side/${id}.png`,
        mockupSize: `${options.viewport.width}×${options.viewport.height}`,
        appSize: `${options.viewport.width}×${options.viewport.height}`,
        note: `全局缩放：效果图 ${percent(mockupScale)} · 实现 ${percent(appScale)}${appScale <= 0.32 ? "（实现缩放 32% 以下只画标签，这一张是标签视图）" : ""}`,
      };
    };
    const boards = [
      boardPair("board-open", "打开时", mockup.openScale, app.openScale),
      boardPair("board-stage1", "阶段 1 · 需求", mockup.stageScale, app.stageScale),
      boardPair("board", "整板 · 全局（Fit）", mockup.fitScale, app.fitScale),
    ].filter((board): board is BoardPair => Boolean(board));

    const pairs = [
      ...boards.filter((board) => board.mockup && board.app).map((board) => ({ id: board.id, left: board.mockup!, right: board.app!, label: board.label })),
      ...ranked.filter((element) => element.mockup.shot && element.app.shot).map((element) => ({ id: element.id, left: element.mockup.shot!, right: element.app.shot!, label: element.name })),
    ];
    for (const pair of pairs) await composePair(page, pair, server.url);
    process.stdout.write(`拼图 ${pairs.length} 张\n`);

    const meta: ReportMeta = {
      generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      commit: commitOf(repoRoot),
      viewport: `${options.viewport.width}×${options.viewport.height}`,
      skin: options.skin,
      lang: options.lang,
      mockup: mockupDir,
      app: appUrl,
      appSource,
      command: `pnpm vis:audit${argv.length ? ` ${argv.join(" ")}` : ""}`,
    };
    writeFileSync(join(outDir, "parity.json"), `${JSON.stringify({ meta, boards, elements: ranked, map }, null, 2)}\n`);
    writeFileSync(join(outDir, "report.md"), reportMarkdown({ meta, elements: ranked, boards, map: map.elements }));
    process.stdout.write(`\n报告：${join(outDir, "report.md")}\n前 10：\n`);
    ranked.slice(0, 10).forEach((element, at) => {
      process.stdout.write(`  ${String(at + 1).padStart(2)}. ${element.score.toFixed(1).padStart(5)}  ${element.name} — ${element.biggest}\n`);
    });
  } finally {
    try {
      page?.close();
    } catch {}
    try {
      await preview?.close();
    } catch {}
    try {
      await fixture?.close();
    } catch {}
    try {
      await server?.close();
    } catch {}
    const cleanup = await import("../server/testing/cleanup.ts");
    await cleanup.removeTempDir(profile);
    releaseLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`\n对照没有跑完：${messageOf(error)}\n`);
    if (error instanceof AuditError && error.hint) process.stderr.write(`  ${error.hint}\n`);
    if (process.env.OMB_VIS_DEBUG === "1" && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 2;
  });
}
