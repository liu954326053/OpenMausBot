// 对照的「不算浏览器」的一半：元素对照表、两组测量的比较、差距分、报告和拼图页。
// scripts/board-visual-audit.ts 负责开无头 Chrome 采集，再把结果交给这里。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const SECTIONS = ["cards", "chrome", "panels"] as const;
export type Section = (typeof SECTIONS)[number];

export interface AuditElement {
  id: string;
  name: string;
  section: Section;
  /** 效果图的 CSS 选择器。 */
  mockup: string;
  /** 效果图里代表这张卡/这个面板的节点 id；有它时先把这个节点移到画面中央再量。 */
  mockupNode?: string;
  /** 量之前先在效果图里打开的浮层：对话窗或详情弹窗。 */
  mockupOpen?: { chat?: string; modal?: string };
  /** 我方看板的 CSS 选择器。 */
  app: string;
  /** 我方看板上要的一张卡：`data-board-card` 的值（episodeStack、generic 用卡片类型）。量之前先把它移到画面中央。 */
  appCardKind?: string;
  /** 量之前先在我方看板里点的卡片（打开对话窗或详情弹窗）。 */
  appClick?: string;
}

export interface AuditMap {
  note?: string;
  elements: AuditElement[];
}

export interface Options {
  viewport: { width: number; height: number };
  out: string;
  only: Section[] | null;
  mockup: string | null;
  mockupPort: number;
  appPort: number;
  appUrl: string | null;
  skin: string;
  lang: string;
  episodes: number;
  scale: number;
  help: boolean;
}

export interface Rgba { r: number; g: number; b: number; a: number }

export interface Facts {
  width: number;
  height: number;
  radius: [number, number, number, number];
  background: Rgba;
  borderWidth: number;
  borderStyle: string;
  borderColor: Rgba;
  shadow: string;
  shadowLayers: number[][];
  fontSize: number;
  lineHeight: number;
  padding: [number, number, number, number];
  raw: Record<string, string>;
}

export interface Captured {
  selector: string;
  found: boolean;
  reason?: string;
  sample?: string;
  rect?: { x: number; y: number; width: number; height: number };
  style?: Facts;
  scale?: number;
  visible?: boolean;
  count?: number;
  shot?: string;
  shotPx?: { width: number; height: number };
  cropped?: boolean;
}

export type Verdict = "same" | "close" | "differs" | "missing";

export interface DiffRow {
  property: string;
  label: string;
  mockup: string;
  app: string;
  delta: number;
  weight: number;
  verdict: Verdict;
}

export interface ElementParity {
  id: string;
  name: string;
  section: Section;
  mockup: Captured;
  app: Captured;
  score: number;
  rows: DiffRow[];
  biggest: string;
  pair: string;
}

export interface BoardPair {
  id: string;
  label: string;
  mockup?: string;
  app?: string;
  pair: string;
  mockupSize?: string;
  appSize?: string;
  note?: string;
}

export interface ReportMeta {
  generatedAt: string;
  commit: string;
  viewport: string;
  skin: string;
  lang: string;
  mockup: string;
  app: string;
  appSource: string;
  command: string;
}

export class AuditError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "AuditError";
    this.hint = hint;
  }
}

const VIEWPORT_MIN = 320;
const VIEWPORT_MAX = 8192;
const FLAGS = new Set(["viewport", "only", "out", "mockup", "mockup-port", "app-port", "app-url", "skin", "lang", "episodes", "scale", "help"]);

function positiveInt(name: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new AuditError(`${name} 要是整数，收到 ${JSON.stringify(raw)}`);
  const value = Number(raw);
  if (value < min || value > max) throw new AuditError(`${name} 要在 ${min}–${max} 之间，收到 ${value}`);
  return value;
}

export function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]!;
    if (!arg.startsWith("--")) throw new AuditError(`多了一个参数 ${JSON.stringify(arg)}`, "参数都写成 --名字 值 或 --名字=值");
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (!FLAGS.has(name)) throw new AuditError(`不认识的参数 --${name}`, `可用的参数：${[...FLAGS].map((one) => `--${one}`).join("、")}`);
    if (name === "help") { flags.add(name); continue; }
    const value = equals === -1 ? argv[at + 1] : arg.slice(equals + 1);
    if (value === undefined || (equals === -1 && value.startsWith("--"))) throw new AuditError(`--${name} 缺少值`);
    if (equals === -1) at += 1;
    values.set(name, value);
  }

  const viewportRaw = values.get("viewport") ?? "1440x900";
  const viewport = /^(\d{2,5})x(\d{2,5})$/.exec(viewportRaw);
  if (!viewport) throw new AuditError(`--viewport 要写成 宽x高（例如 1440x900），收到 ${JSON.stringify(viewportRaw)}`);
  const width = Number(viewport[1]);
  const height = Number(viewport[2]);
  if (width < VIEWPORT_MIN || width > VIEWPORT_MAX || height < VIEWPORT_MIN || height > VIEWPORT_MAX) {
    throw new AuditError(`--viewport 的宽高要在 ${VIEWPORT_MIN}–${VIEWPORT_MAX} 之间，收到 ${width}x${height}`);
  }

  let only: Section[] | null = null;
  const onlyRaw = values.get("only");
  if (onlyRaw !== undefined) {
    const names = onlyRaw.split(",").map((one) => one.trim()).filter(Boolean);
    if (!names.length) throw new AuditError("--only 至少要写一组", `可选：${SECTIONS.join("、")}`);
    const unknown = names.filter((name) => !(SECTIONS as readonly string[]).includes(name));
    if (unknown.length) throw new AuditError(`--only 里有不认识的分组：${unknown.join("、")}（可选：${SECTIONS.join("、")}）`, `可选：${SECTIONS.join("、")}`);
    only = [...new Set(names)] as Section[];
  }

  const appUrl = values.get("app-url") ?? null;
  if (appUrl && !/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}(\/|$)/.test(appUrl)) {
    throw new AuditError(`--app-url 要指向本机（http://127.0.0.1:端口/…），收到 ${JSON.stringify(appUrl)}`);
  }

  return {
    viewport: { width, height },
    out: values.get("out") ?? "/tmp/omb-vis-audit",
    only,
    mockup: values.get("mockup") ?? null,
    mockupPort: positiveInt("--mockup-port", values.get("mockup-port") ?? "8781", 1024, 65535),
    appPort: positiveInt("--app-port", values.get("app-port") ?? "8790", 1024, 65535),
    appUrl,
    skin: values.get("skin") ?? "midnight",
    lang: values.get("lang") ?? "zh",
    episodes: positiveInt("--episodes", values.get("episodes") ?? "4", 1, 60),
    scale: positiveInt("--scale", values.get("scale") ?? "2", 1, 3),
    help: flags.has("help"),
  };
}

function textOf(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AuditError(`${where} 缺少文字`);
  return value.trim();
}

export function loadMap(path: string, elements?: unknown): AuditMap {
  let raw: unknown = elements;
  if (raw === undefined) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new AuditError(`读不到对照表 ${path}：${(error as Error).message}`);
    }
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new AuditError(`对照表 ${path} 不是合法 JSON：${(error as Error).message}`);
    }
  }
  if (!raw || typeof raw !== "object") throw new AuditError(`对照表 ${path} 要是对象`);
  const record = Array.isArray(raw) ? { elements: raw } : raw as Record<string, unknown>;
  if (!Array.isArray(record.elements)) throw new AuditError(`对照表 ${path} 缺少 elements 数组`);
  const seen = new Set<string>();
  const parsed = record.elements.map((entry, index): AuditElement => {
    const where = `对照表第 ${index + 1} 行`;
    if (!entry || typeof entry !== "object") throw new AuditError(`${where} 要是对象`);
    const one = entry as Record<string, unknown>;
    const id = textOf(one.id, `${where} 的 id`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new AuditError(`${where} 的 id ${JSON.stringify(id)} 只能有小写字母、数字和连字符`);
    if (seen.has(id)) throw new AuditError(`对照表里 id ${JSON.stringify(id)} 出现了两次`);
    seen.add(id);
    const section = one.section;
    if (typeof section !== "string" || !(SECTIONS as readonly string[]).includes(section)) {
      throw new AuditError(`${where}（${id}）的 section 要是 ${SECTIONS.join("、")} 之一，收到 ${JSON.stringify(section)}`);
    }
    const stage = one.appCardKind;
    if (stage !== undefined && (typeof stage !== "string" || !stage.trim())) {
      throw new AuditError(`${where}（${id}）的 appCardKind 要是 data-board-card 的值（如 bot、episodeStack），收到 ${JSON.stringify(stage)}`);
    }
    const open = one.mockupOpen;
    if (open !== undefined) {
      if (!open || typeof open !== "object") throw new AuditError(`${where}（${id}）的 mockupOpen 要是对象`);
      const { chat, modal } = open as Record<string, unknown>;
      if (chat !== undefined && typeof chat !== "string") throw new AuditError(`${where}（${id}）的 mockupOpen.chat 要是节点 id`);
      if (modal !== undefined && typeof modal !== "string") throw new AuditError(`${where}（${id}）的 mockupOpen.modal 要是节点 id`);
      if (!chat && !modal) throw new AuditError(`${where}（${id}）的 mockupOpen 要写 chat 或 modal`);
      if (chat && modal) throw new AuditError(`${where}（${id}）的 mockupOpen 不能同时打开对话和详情`);
    }
    return {
      id,
      name: textOf(one.name, `${where} 的 name`),
      section: section as Section,
      mockup: textOf(one.mockup, `${where}（${id}）的 mockup 选择器`),
      ...(one.mockupNode !== undefined ? { mockupNode: textOf(one.mockupNode, `${where}（${id}）的 mockupNode`) } : {}),
      ...(open ? { mockupOpen: open as AuditElement["mockupOpen"] } : {}),
      app: textOf(one.app, `${where}（${id}）的 app 选择器`),
      ...(stage !== undefined ? { appCardKind: stage.trim() } : {}),
      ...(one.appClick !== undefined ? { appClick: textOf(one.appClick, `${where}（${id}）的 appClick`) } : {}),
    };
  });
  return { ...(typeof record.note === "string" ? { note: record.note } : {}), elements: parsed };
}

export function resolveMockupDir(repoRoot: string, given: string | null): string {
  const candidates = given
    ? [resolve(given)]
    : [
      join(repoRoot, "docs/无限画布效果图/index-v5"),
      join(repoRoot, "../../OpenMausBot/docs/无限画布效果图/index-v5"),
      ...(process.env.OMB_MOCKUP_DIR ? [resolve(process.env.OMB_MOCKUP_DIR)] : []),
    ];
  const found = candidates.find((candidate) => existsSync(join(candidate, "index.html")));
  if (!found) throw new AuditError(`找不到效果图目录，试过：${candidates.join("、")}`, "用 --mockup 指向 index-v5 目录（里面有 index.html）");
  return found;
}

export function parseRadius(text: string): [number, number, number, number] {
  const values = text.split(/\s+/).map((one) => Number.parseFloat(one)).filter((one) => Number.isFinite(one));
  if (!values.length) return [0, 0, 0, 0];
  if (values.length === 1) return [values[0]!, values[0]!, values[0]!, values[0]!];
  if (values.length === 2) return [values[0]!, values[1]!, values[0]!, values[1]!];
  if (values.length === 3) return [values[0]!, values[1]!, values[2]!, values[1]!];
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

export function colorDistance(a: Rgba, b: Rgba): number {
  const rgb = Math.sqrt(((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / (3 * 255 * 255));
  return Math.min(1, Math.max(0, rgb + 0.5 * Math.abs(a.a - b.a)));
}

/** The numbers of each shadow layer: offsets, blur and spread, without the colour's own numbers. */
export function shadowLayers(text: string): number[][] {
  if (!text || text === "none") return [];
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) { layers.push(text.slice(start, at)); start = at + 1; }
  }
  layers.push(text.slice(start));
  return layers.map((layer) => {
    const cleaned = layer.replace(/(?:rgba?|hsla?|color|oklab|oklch|lab|lch)\([^)]*\)/gi, " ");
    return [...cleaned.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  }).filter((numbers) => numbers.length > 0);
}

export function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) throw new AuditError("不是 PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const PROPERTY_LABELS: Record<string, string> = {
  width: "宽度",
  height: "高度",
  radius: "圆角",
  background: "背景",
  border: "边框",
  shadow: "阴影",
  font: "字号与行高",
  padding: "内边距",
  missing: "元素",
};

const WEIGHTS: Record<string, number> = { width: 0.1, height: 0.1, radius: 0.08, background: 0.16, border: 0.17, shadow: 0.1, font: 0.14, padding: 0.15 };

const gap = (a: number, b: number): number => {
  const top = Math.max(Math.abs(a), Math.abs(b));
  if (top === 0) return 0;
  return Math.min(1, Math.abs(a - b) / top);
};

const round = (value: number, places = 1): number => Math.round(value * 10 ** places) / 10 ** places;

export const formatColor = (color: Rgba): string => {
  const alpha = round(color.a, 3);
  if (alpha >= 1) return `rgb(${color.r}, ${color.g}, ${color.b})`;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
};

const verdictOf = (delta: number): Verdict => (delta <= 0.02 ? "same" : delta <= 0.15 ? "close" : "differs");

export function diffElement(element: AuditElement, mockup: Captured, app: Captured): ElementParity {
  const pair = `side-by-side/${element.id}.png`;
  if (!mockup.found || !mockup.style) {
    return {
      id: element.id, name: element.name, section: element.section, mockup, app, score: 100, pair,
      rows: [{ property: "missing", label: "元素", mockup: "没有找到", app: app.style ? "有" : "没有找到", delta: 1, weight: 1, verdict: "missing" }],
      biggest: `效果图里找不到元素（${mockup.reason ?? "没有匹配的选择器"}）`,
    };
  }
  if (!app.found || !app.style) {
    return {
      id: element.id, name: element.name, section: element.section, mockup, app, score: 100, pair,
      rows: [{ property: "missing", label: "元素", mockup: "有", app: "没有找到", delta: 1, weight: 1, verdict: "missing" }],
      biggest: `找不到元素：${app.reason ?? "实现侧没有匹配的选择器"}`,
    };
  }
  const m = mockup.style;
  const a = app.style;
  const rows: DiffRow[] = [];
  const push = (property: string, mockupValue: string, appValue: string, delta: number) => rows.push({
    property, label: PROPERTY_LABELS[property] ?? property, mockup: mockupValue, app: appValue,
    delta: Math.min(1, Math.max(0, delta)), weight: WEIGHTS[property] ?? 0, verdict: verdictOf(delta),
  });

  push("width", `${round(m.width)}px`, `${round(a.width)}px`, gap(m.width, a.width));
  push("height", `${round(m.height)}px`, `${round(a.height)}px`, gap(m.height, a.height));
  const radiusDelta = m.radius.reduce((sum, corner, at) => sum + gap(corner, a.radius[at]!), 0) / 4;
  push("radius", `${m.radius.map((one) => round(one)).join(" / ")}px`, `${a.radius.map((one) => round(one)).join(" / ")}px`, radiusDelta);

  push("background", formatColor(m.background), formatColor(a.background), colorDistance(m.background, a.background));
  const borderWidthDelta = m.borderWidth === 0 && a.borderWidth === 0 ? 0
    : (m.borderStyle === "none") !== (a.borderStyle === "none") ? 1
      : gap(m.borderWidth, a.borderWidth);
  push("border", `${round(m.borderWidth)}px ${m.borderStyle} ${formatColor(m.borderColor)}`, `${round(a.borderWidth)}px ${a.borderStyle} ${formatColor(a.borderColor)}`,
    0.5 * borderWidthDelta + 0.5 * colorDistance(m.borderColor, a.borderColor));

  const shadowDelta = (() => {
    if (!m.shadowLayers.length && !a.shadowLayers.length) return 0;
    if (!m.shadowLayers.length || !a.shadowLayers.length) return 1;
    const countDelta = Math.min(0.2, Math.abs(m.shadowLayers.length - a.shadowLayers.length) * 0.2);
    const first = m.shadowLayers[0]!;
    const second = a.shadowLayers[0]!;
    const fields = Math.max(first.length, second.length, 1);
    let geometry = 0;
    for (let at = 0; at < fields; at += 1) geometry += Math.min(1, Math.abs((first[at] ?? 0) - (second[at] ?? 0)) / 40);
    return Math.min(1, countDelta + (geometry / fields) * 0.8);
  })();
  push("shadow", m.shadow === "none" ? "无" : m.shadow, a.shadow === "none" ? "无" : a.shadow, shadowDelta);

  const lineHeightDelta = m.lineHeight > 0 && a.lineHeight > 0 ? gap(m.lineHeight, a.lineHeight) : 0;
  push("font", `${round(m.fontSize)}px / ${round(m.lineHeight)}px`, `${round(a.fontSize)}px / ${round(a.lineHeight)}px`,
    0.6 * gap(m.fontSize, a.fontSize) + 0.4 * lineHeightDelta);

  const paddingDelta = m.padding.reduce((sum, edge, at) => sum + gap(edge, a.padding[at]!), 0) / 4;
  push("padding", m.padding.map((one) => round(one)).join(" / "), a.padding.map((one) => round(one)).join(" / "), paddingDelta);

  const total = rows.reduce((sum, row) => sum + row.weight * row.delta, 0);
  const weight = rows.reduce((sum, row) => sum + row.weight, 0);
  const score = round((weight ? total / weight : 0) * 100);
  const worst = [...rows].sort((one, two) => two.weight * two.delta - one.weight * one.delta)[0];
  const biggest = !worst || worst.delta <= 0.02 ? "无" : `${worst.label}（差 ${round(worst.delta * 100)}%）`;
  return { id: element.id, name: element.name, section: element.section, mockup, app, score, rows, biggest, pair };
}

export function rank(elements: ElementParity[]): ElementParity[] {
  return [...elements].sort((one, two) => two.score - one.score);
}

const escapeCell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function reportMarkdown(input: { meta: ReportMeta; elements: ElementParity[]; boards: BoardPair[]; map: AuditElement[] }): string {
  const { meta, elements, boards, map } = input;
  const lines: string[] = [];
  lines.push("# 制作看板：效果图 vs 实现", "");
  lines.push(`> 生成 ${meta.generatedAt} · 视口 ${meta.viewport} · 皮肤 ${meta.skin} · 语言 ${meta.lang} · 提交 \`${meta.commit}\``);
  lines.push(`> 效果图：\`${meta.mockup}\``);
  lines.push(`> 实现：${meta.appSource} \`${meta.app}\``);
  lines.push(`> 命令：\`${meta.command}\``, "");
  lines.push("## 怎么读", "");
  lines.push("- **差距分**：每个属性归一成 0–1，按权重加权后乘 100。排序从差得多到差得少；两边都没有这个元素记 100 分。");
  lines.push("- 权重：尺寸 0.20、背景 0.16、边框 0.17、内边距 0.15、阴影 0.10、字号行高 0.14、圆角 0.08。");
  lines.push("- 比较用的是布局尺寸（`getComputedStyle`），不受看板缩放影响；「屏幕」一行是 `getBoundingClientRect` × 当前缩放，方便对照截图。");
  lines.push("- 颜色都归一成 RGBA 再比；阴影按第一层的偏移、模糊、扩散近似。");
  lines.push("- 设计（`docs/superpowers/specs/2026-11-24-production-board-design.md`）说颜色用程序现有皮肤、不照搬效果图的配色：纯配色的色差要结合这一条读，形态、尺寸、圆角、间距、字号仍照效果图。", "");

  lines.push("## 整板", "");
  for (const board of boards) {
    lines.push(`### ${board.label}`, "");
    if (board.pair) lines.push(`![${board.label}](${board.pair})`, "");
    const sizes = [board.mockupSize ? `效果图 ${board.mockupSize}` : null, board.appSize ? `实现 ${board.appSize}` : null].filter(Boolean);
    if (sizes.length) lines.push(`- ${sizes.join(" · ")}`);
    if (board.note) lines.push(`- ${board.note}`);
    if (board.mockup) lines.push(`- 效果图原图：\`${board.mockup}\``);
    if (board.app) lines.push(`- 实现原图：\`${board.app}\``);
    lines.push("");
  }

  lines.push("## 前 10", "");
  lines.push("| # | 元素 | 差距分 | 最大的差 | 拼图 |");
  lines.push("|---|---|---|---|---|");
  elements.slice(0, 10).forEach((element, at) => {
    lines.push(`| ${at + 1} | ${escapeCell(element.name)}（${element.id}） | ${element.score} | ${escapeCell(element.biggest)} | [${element.pair}](${element.pair}) |`);
  });
  lines.push("");

  lines.push("## 逐元素（从差得多到差得少）", "");
  elements.forEach((element, at) => {
    lines.push(`### ${at + 1}. ${element.name}（${element.id}）· 差距 ${element.score}`, "");
    lines.push(`效果图 \`${element.mockup.selector}\` ↔ 实现 \`${element.app.selector}\``, "");
    lines.push(`![${element.name} 效果图 vs 实现](${element.pair})`, "");
    const screen = (side: "效果图" | "实现", captured: Captured) => captured.rect && captured.style
      ? `${side} ${round(captured.rect.width)}×${round(captured.rect.height)}px（布局 ${round(captured.style.width)}×${round(captured.style.height)}，缩放 ${round((captured.scale ?? 1) * 100)}%）`
      : `${side} 没有找到`;
    lines.push(`- 屏幕：${screen("效果图", element.mockup)} · ${screen("实现", element.app)}`);
    for (const side of [element.mockup, element.app]) {
      if (side.shot) lines.push(`- 原图：\`${side.shot}\`${side.cropped ? "（元素比视口大，截到可见部分）" : ""}`);
    }
    lines.push("");
    if (!element.app.found) {
      lines.push(`**结论：** 实现侧找不到这个元素：${element.app.reason ?? "没有匹配的选择器"}。`, "");
      return;
    }
    if (!element.mockup.found) {
      lines.push(`**结论：** 效果图侧找不到这个元素：${element.mockup.reason ?? "没有匹配的选择器"}。`, "");
      return;
    }
    lines.push("| 属性 | 效果图 | 实现 | 差异 |");
    lines.push("|---|---|---|---|");
    for (const row of element.rows) {
      lines.push(`| ${row.label} | ${escapeCell(row.mockup)} | ${escapeCell(row.app)} | ${row.verdict === "same" ? "一致" : `${round(row.delta * 100)}%`} |`);
    }
    lines.push("");
    lines.push(`**结论：** 最大的差是 ${element.biggest}。`, "");
  });

  const missing = elements.filter((element) => !element.mockup.found || !element.app.found);
  lines.push("## 没找到的元素", "");
  if (!missing.length) lines.push("无。全部元素两侧都找到了。");
  else for (const element of missing) {
    const which = !element.mockup.found ? "效果图" : "实现";
    lines.push(`- **${element.name}（${element.id}）**：${which}侧找不到 —— ${(!element.mockup.found ? element.mockup.reason : element.app.reason) ?? "没有匹配的选择器"}`);
  }
  lines.push("");

  lines.push("## 选择器", "");
  lines.push("| id | 名称 | 分组 | 效果图 | 实现 | 先定位 | 打开浮层 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const element of map) {
    const open = element.mockupOpen ? (element.mockupOpen.chat ? `对话 ${element.mockupOpen.chat}` : `详情 ${element.mockupOpen.modal}`) : element.appClick ? `点 ${element.appClick}` : "";
    lines.push(`| ${element.id} | ${escapeCell(element.name)} | ${element.section} | ${escapeCell(element.mockup)} | ${escapeCell(element.app)} | ${element.appCardKind ?? ""} | ${escapeCell(open)} |`);
  }
  lines.push("");

  lines.push("## 这一版没量到的", "");
  lines.push("- 文字内容、层级与换行：只量根元素的字号、行高和内边距，不量卡里每一行。");
  lines.push("- 颜色语义：只比计算后的颜色，不判断它是否来自主题变量；两套皮肤各自成图。");
  lines.push("- 交互态：只比静止态，不展开 hover、focus、生成中、失败重试等状态。");
  lines.push("- 图片、视频内容与画质：只看它们占的框。");
  lines.push("- 阴影只取第一层；多层阴影的层数和层间差异记在阴影这一项里，不再细分。");
  lines.push("- 边框只量上边：宽度、样式和颜色；四条边不同的（例如卡片顶上的一条色带）只按上边算。");
  lines.push("");
  return lines.join("\n");
}

export interface ComposeImage { src: string | null; width: number; height: number }

const composeWidth = (image: ComposeImage, height: number): number =>
  (image.src ? Math.round((image.width * height) / Math.max(1, image.height)) : 480);

export function composeSize(input: { left: ComposeImage; right: ComposeImage }): { width: number; height: number } {
  const height = Math.max(1, input.left.height, input.right.height);
  return { width: 24 * 2 + composeWidth(input.left, height) + 24 + composeWidth(input.right, height), height: 24 * 2 + 30 + 22 + height };
}

export function composeHtml(input: { left: ComposeImage; right: ComposeImage; leftLabel: string; rightLabel: string; title?: string }): string {
  const height = Math.max(1, input.left.height, input.right.height);
  const figure = (image: ComposeImage, label: string) => {
    const width = composeWidth(image, height);
    const body = image.src
      ? `<img src="${image.src}" width="${width}" height="${height}" style="width: ${width}px; height: ${height}px" alt="${label}">`
      : `<div class="none" style="width:${width}px;height:${height}px">没有找到元素</div>`;
    return `<figure><figcaption>${label}</figcaption>${body}</figure>`;
  };
  const { width, height: pageHeight } = composeSize(input);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${input.title ?? "对照"}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #0b0d10; color: #e9ebed; }
  body { width: ${width}px; height: ${pageHeight}px; padding: 24px; font: 13px/1.4 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  h1 { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
  .row { display: flex; align-items: flex-start; gap: 24px; }
  figure { margin: 0; }
  figcaption { margin-bottom: 6px; font-size: 12px; color: #9aa3ad; }
  img { display: block; border: 1px solid rgba(255, 255, 255, .12); background: #11151a; }
  .none { display: grid; place-items: center; border: 1px dashed #4d5660; color: #8d969f; font-size: 13px; }
</style></head>
<body><h1>${input.title ?? ""}</h1><div class="row" id="pair">${figure(input.left, input.leftLabel)}${figure(input.right, input.rightLabel)}</div></body></html>`;
}
