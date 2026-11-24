import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  colorDistance,
  composeHtml,
  diffElement,
  loadMap,
  parseArgs,
  parseRadius,
  pngSize,
  rank,
  reportMarkdown,
  shadowLayers,
  type AuditElement,
  type Captured,
  type Facts,
} from "../board-visual-audit.ts";

const MAP_PATH = fileURLToPath(new URL("./board-visual-map.json", import.meta.url));
const MAP = loadMap(MAP_PATH);

const facts = (overrides: Partial<Facts> = {}): Facts => ({
  width: 320,
  height: 300,
  radius: [12, 12, 12, 12],
  background: { r: 34, g: 39, b: 45, a: 1 },
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: { r: 51, g: 58, b: 66, a: 1 },
  shadow: "none",
  shadowLayers: [],
  fontSize: 13,
  lineHeight: 18,
  padding: [0, 0, 0, 0],
  raw: {},
  ...overrides,
});

const captured = (overrides: Partial<Captured> = {}): Captured => ({
  selector: ".k-bot",
  found: true,
  rect: { x: 0, y: 0, width: 320, height: 300 },
  style: facts(),
  scale: 1,
  ...overrides,
});

const entry = (id: string, name: string, section: AuditElement["section"] = "cards"): AuditElement =>
  ({ id, name, section, mockup: `.${id}`, app: `[data-board-card="${id}"]` });

describe("parseArgs", () => {
  it("uses the documented defaults", () => {
    const options = parseArgs([]);
    expect(options.viewport).toEqual({ width: 1440, height: 900 });
    expect(options.out).toBe("/tmp/omb-vis-audit");
    expect(options.mockupPort).toBe(8781);
    expect(options.appPort).toBe(8790);
    expect(options.only).toBeNull();
    expect(options.skin).toBe("midnight");
    expect(options.lang).toBe("zh");
  });

  it("reads a viewport and a section list", () => {
    const options = parseArgs(["--viewport", "760x520", "--only", "cards,chrome"]);
    expect(options.viewport).toEqual({ width: 760, height: 520 });
    expect(options.only).toEqual(["cards", "chrome"]);
  });

  it("refuses a malformed viewport with the flag's name", () => {
    expect(() => parseArgs(["--viewport", "1440"])).toThrow(/--viewport/);
    expect(() => parseArgs(["--viewport", "0x900"])).toThrow(/--viewport/);
  });

  it("refuses an unknown section and lists the real ones", () => {
    expect(() => parseArgs(["--only", "cards,pages"])).toThrow(/pages.*cards.*chrome.*panels/s);
  });

  it("refuses unknown flags", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/--nope/);
  });
});

describe("the shipped map", () => {
  it("covers every element of the first version", () => {
    const ids = MAP.elements.map((element) => element.id);
    expect(ids).toEqual([
      "stagebar", "toolbar", "minimap",
      "k-bot", "k-brief", "k-tasks", "k-ep", "k-epmore", "k-shot", "k-char", "k-scene", "k-result", "k-final",
      "bchat", "dm-box",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps one section per group and a selector on both sides", () => {
    for (const element of MAP.elements) {
      expect(["chrome", "cards", "panels"]).toContain(element.section);
      expect(element.mockup.trim()).not.toBe("");
      expect(element.app.trim()).not.toBe("");
      expect(element.name.trim()).not.toBe("");
    }
    expect(MAP.elements.filter((element) => element.section === "cards")).toHaveLength(10);
    expect(MAP.elements.filter((element) => element.section === "panels")).toHaveLength(2);
  });

  it("points the panels at a card to click and the cards at a card to centre", () => {
    const chat = MAP.elements.find((element) => element.id === "bchat")!;
    const details = MAP.elements.find((element) => element.id === "dm-box")!;
    expect(chat.appClick).toBe('[data-board-card="bot"]');
    expect(details.appClick).toBe('[data-board-card="character"]');
    for (const element of MAP.elements.filter((one) => one.section === "cards")) expect(element.appCardKind).toBeTruthy();
  });

  it("rejects a duplicate id or an empty card kind", () => {
    expect(() => loadMap(MAP_PATH, [
      { id: "x", name: "X", section: "cards", mockup: ".x", app: ".x" },
      { id: "x", name: "X", section: "cards", mockup: ".x", app: ".x" },
    ])).toThrow(/x/);
    expect(() => loadMap(MAP_PATH, [
      { id: "x", name: "X", section: "cards", mockup: ".x", app: ".x", appCardKind: "" },
    ])).toThrow(/appCardKind/);
  });
});

describe("numbers and colours", () => {
  it("reads one to four radii", () => {
    expect(parseRadius("12px")).toEqual([12, 12, 12, 12]);
    expect(parseRadius("14px 14px 0px 0px")).toEqual([14, 14, 0, 0]);
    expect(parseRadius("50%")).toEqual([50, 50, 50, 50]);
  });

  it("measures colour distance from 0 to 1", () => {
    expect(colorDistance({ r: 1, g: 2, b: 3, a: 1 }, { r: 1, g: 2, b: 3, a: 1 })).toBe(0);
    expect(colorDistance({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
    expect(colorDistance({ r: 0, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0, a: 0 })).toBeCloseTo(0.5, 5);
  });

  it("takes the numbers of each shadow layer, not the colour's", () => {
    expect(shadowLayers("none")).toEqual([]);
    expect(shadowLayers("rgba(0, 0, 0, 0.4) 0px 12px 32px 0px")).toEqual([[0, 12, 32, 0]]);
    expect(shadowLayers("0 0 0 1px red, 0 12px 32px rgba(0, 0, 0, 0.4)")).toEqual([[0, 0, 0, 1], [0, 12, 32]]);
  });

  it("reads a PNG's size without inflating it", () => {
    const png = readFileSync(fileURLToPath(new URL("../../server/testing/fixtures/banner-metadata.png", import.meta.url)));
    const size = pngSize(png);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});

describe("diffElement", () => {
  it("scores an identical pair zero and says so", () => {
    const parity = diffElement(entry("k-bot", "智能体卡片"), captured(), captured());
    expect(parity.score).toBe(0);
    expect(parity.rows.every((row) => row.verdict === "same")).toBe(true);
    expect(parity.biggest).toBe("无");
  });

  it("scores a size, colour and shadow gap higher than a size gap alone", () => {
    const sizeOnly = diffElement(entry("a", "A"), captured({ style: facts({ width: 380 }) }), captured());
    const more = diffElement(entry("b", "B"), captured({ style: facts({ width: 380, background: { r: 200, g: 200, b: 200, a: 1 }, shadow: "0 12px 32px rgba(0,0,0,.4)", shadowLayers: [[0, 12, 32, 0]] }) }), captured());
    expect(sizeOnly.score).toBeGreaterThan(0);
    expect(more.score).toBeGreaterThan(sizeOnly.score);
  });

  it("puts a missing element at the top with a reason", () => {
    const parity = diffElement(entry("k-final", "成片"), captured(), captured({ found: false, reason: "看板没有画这张卡", style: undefined }));
    expect(parity.score).toBe(100);
    expect(parity.rows[0]).toMatchObject({ verdict: "missing" });
    expect(parity.biggest).toContain("找不到");
  });

  it("mentions the pixel and colour values in its rows", () => {
    const parity = diffElement(entry("k-bot", "智能体卡片"), captured({ style: facts({ width: 380 }) }), captured());
    const width = parity.rows.find((row) => row.property === "width")!;
    expect(width.mockup).toContain("380");
    expect(width.app).toContain("320");
    const background = parity.rows.find((row) => row.property === "background")!;
    expect(background.mockup).toMatch(/rgba?\(|#/);
  });
});

describe("rank and report", () => {
  const ranked = [
    diffElement(entry("k-brief", "需求单"), captured(), captured()),
    diffElement(entry("k-final", "成片"), captured(), captured({ found: false, style: undefined })),
    diffElement(entry("k-shot", "镜头"), captured({ style: facts({ width: 470, height: 400 }) }), captured()),
  ];

  it("orders the largest gap first and keeps ties in the map's order", () => {
    expect(rank(ranked).map((one) => one.id)).toEqual(["k-final", "k-shot", "k-brief"]);
  });

  it("writes every element with its own picture path and the board pair", () => {
    const markdown = reportMarkdown({
      meta: {
        generatedAt: "2026-11-24 16:00", commit: "abc1234", viewport: "1440×900", skin: "midnight", lang: "zh",
        mockup: "/mockup", app: "http://127.0.0.1:8790/__production-board.html", appSource: "样例看板", command: "pnpm vis:audit",
      },
      elements: rank(ranked),
      boards: [{ id: "board", label: "全局", mockup: "mockup/board.png", app: "app/board.png", pair: "side-by-side/board.png" }],
      map: MAP.elements,
    });
    expect(markdown).toContain("side-by-side/board.png");
    expect(markdown).toContain("side-by-side/k-final.png");
    expect(markdown).toContain("side-by-side/k-shot.png");
    expect(markdown.indexOf("### 1. 成片")).toBeLessThan(markdown.indexOf("### 2. 镜头"));
    expect(markdown).toContain("| k-bot |");
  });
});

describe("composeHtml", () => {
  it("draws both sides as data URLs with labels and one height", () => {
    const html = composeHtml({
      left: { src: "data:image/png;base64,bGVmdA==", width: 380, height: 300 },
      right: { src: "data:image/png;base64,cmlnaHQ=", width: 240, height: 300 },
      leftLabel: "效果图",
      rightLabel: "实现",
      title: "智能体卡片",
    });
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(html).toContain("效果图");
    expect(html).toContain("实现");
    expect(html).toContain("智能体卡片");
    expect(html).toContain("height: 300px");
  });
});
