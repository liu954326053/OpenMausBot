// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { AVATAR_MAX_BYTES } from "../../shared/package-format";
import type { BotTemplateInput, TeamTemplateInput } from "../../shared/template-library";

const sent: Array<{ path: string; method: string; body?: unknown }> = [];
let answer: () => Promise<unknown> = async () => ({});
vi.mock("@/state/api", () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly body?: Record<string, unknown>) { super(message); }
  }
  return {
    ApiError,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      sent.push({ path, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}) });
      return answer();
    }),
  };
});
const { ApiError } = await import("@/state/api");
const {
  listTemplates, readBotTemplate, readTeamTemplate, removeTemplate, restoreTemplate, saveBotAsTemplate, saveBotTemplate, saveDepartmentAsTemplate,
  saveTeamTemplate, templateFailure, templatePicture,
} = await import("./template-library");
const { setLocale, t } = await import("./i18n");

afterEach(() => { sent.length = 0; answer = async () => ({}); });

const BOT_INPUT = { role: { key: "writer", name: "Script writer" }, skills: [] } as unknown as BotTemplateInput;
const TEAM_INPUT = { name: "Urban crew", lead: "director", roles: [], skills: [] } as unknown as TeamTemplateInput;

describe("the Templates page's requests", () => {
  it("reads the list, and one whole template of either kind", async () => {
    answer = async () => ({ bots: [], teams: [] });
    expect(await listTemplates()).toEqual({ bots: [], teams: [] });
    answer = async () => ({ template: { id: "tm_1" } });
    expect(await readTeamTemplate("tm_1")).toEqual({ id: "tm_1" });
    expect(await readBotTemplate("bt 1/x")).toEqual({ id: "tm_1" });
    expect(sent).toEqual([
      { path: "/api/template-library", method: "GET" },
      { path: "/api/template-library/teams/tm_1", method: "GET" },
      { path: "/api/template-library/bots/bt%201%2Fx", method: "GET" },
    ]);
  });

  it("makes a new template, and saves one that exists as its next version", async () => {
    answer = async () => ({ template: { id: "new", version: 1 } });
    expect(await saveBotTemplate(BOT_INPUT)).toEqual({ id: "new", version: 1 });
    expect(await saveTeamTemplate(TEAM_INPUT)).toEqual({ id: "new", version: 1 });
    await saveBotTemplate(BOT_INPUT, "bt_1");
    await saveTeamTemplate(TEAM_INPUT, "tm_1");
    expect(sent).toEqual([
      { path: "/api/template-library/bots", method: "POST", body: BOT_INPUT },
      { path: "/api/template-library/teams", method: "POST", body: TEAM_INPUT },
      { path: "/api/template-library/bots/bt_1", method: "PUT", body: BOT_INPUT },
      { path: "/api/template-library/teams/tm_1", method: "PUT", body: TEAM_INPUT },
    ]);
  });

  it("deletes a template and hands back what Undo needs, then puts it back with that", async () => {
    answer = async () => ({ ok: true, undo: "teams-tm_1-99" });
    const undo = await removeTemplate("team", "tm_1");
    await removeTemplate("bot", "bt_1");
    await restoreTemplate(undo);
    expect(sent).toEqual([
      { path: "/api/template-library/teams/tm_1", method: "DELETE" },
      { path: "/api/template-library/bots/bt_1", method: "DELETE" },
      { path: "/api/template-library/restore", method: "POST", body: { undo: "teams-tm_1-99" } },
    ]);
  });

  it("saves a bot and a department that exist as templates", async () => {
    answer = async () => ({ template: { id: "made" } });
    expect(await saveBotAsTemplate("bot-7")).toEqual({ id: "made" });
    expect(await saveDepartmentAsTemplate("Drama 部")).toEqual({ id: "made" });
    expect(sent).toEqual([
      { path: "/api/template-library/bots/from-bot", method: "POST", body: { botId: "bot-7" } },
      { path: "/api/template-library/teams/from-department", method: "POST", body: { department: "Drama 部" } },
    ]);
  });

  it("says a refusal in the app's own sentence, and anything else as a plain line", async () => {
    setLocale("en");
    answer = async () => { throw new ApiError("A template called Urban crew already exists. Choose another name.", 409); };
    const refused = await saveTeamTemplate(TEAM_INPUT).catch(templateFailure);
    expect(refused).toBe("A template called Urban crew already exists. Choose another name.");
    expect(templateFailure(new TypeError("Failed to fetch"))).toBe(t("templateLibrary.failed"));
  });
});

describe("a picture chosen for a role", () => {
  const PNG_HEAD = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const file = (head: Uint8Array) => new Blob([new Uint8Array(head), new Uint8Array(2048)]);
  function tools(sizeOf: (quality: number) => number, width = 2048, height = 1024) {
    const drawn: Array<{ width: number; height: number }> = [];
    return {
      drawn,
      read: async () => ({ width, height, close() {} }) as never,
      canvas: (w: number, h: number) => ({
        context: { drawImage() {}, fillRect() {}, fillStyle: "", imageSmoothingQuality: "low" } as unknown as CanvasRenderingContext2D,
        encode: async (type: string, quality: number) => { drawn.push({ width: w, height: h }); return new Blob([new Uint8Array(sizeOf(quality))], { type }); },
      }),
    };
  }

  it("is drawn again at most 512 px across and kept as a data: URL the template folder can hold", async () => {
    const fake = tools(() => 1200);
    const picture = await templatePicture(file(PNG_HEAD), fake);
    expect(picture).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
    expect(atob(picture!.split(",")[1]!)).toHaveLength(1200);
    expect(fake.drawn.at(-1)).toEqual({ width: 512, height: 256 });
  });

  it("is made softer and smaller until it is under 64 KB", async () => {
    const fake = tools((quality) => (quality > 0.7 ? AVATAR_MAX_BYTES + 1 : AVATAR_MAX_BYTES));
    const picture = await templatePicture(file(PNG_HEAD), fake);
    expect(atob(picture!.split(",")[1]!)).toHaveLength(AVATAR_MAX_BYTES);
    expect(fake.drawn.length).toBeGreaterThan(1);
  });

  it("of a GIF is the still picture the page draws of it, since a template folder holds no GIF", async () => {
    for (const head of ["GIF89a", "GIF87a"]) {
      const gif = tools(() => 900, 300, 300);
      expect(await templatePicture(file(new TextEncoder().encode(head)), gif)).toMatch(/^data:image\/webp;base64,/);
      expect(gif.drawn).toEqual([{ width: 300, height: 300 }]);
    }
  });

  it("is refused when it is no picture a role can wear, or cannot be made small enough", async () => {
    for (const head of ["<svg xmlns=", "GIF90a", "BM"]) {
      const fake = tools(() => 1200);
      expect(await templatePicture(file(new TextEncoder().encode(head)), fake), head).toBeNull();
      expect(fake.drawn).toEqual([]);
    }
    expect(await templatePicture(file(PNG_HEAD), tools(() => AVATAR_MAX_BYTES + 1))).toBeNull();
  });
});
