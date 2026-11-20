import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "../server-line-packs.ts";
import { serverLine } from "../server-lines.ts";
import type { TeamProjectStop } from "../team-project-folders.ts";
import { createBotHolds } from "./bot-holds.ts";
import { withTeamProjectStops } from "./team-project-stops.ts";

const BOTS = [
  { id: "writer", name: "Writer", color: "#123456", section: "Drama" },
  { id: "editor", name: "Editor", color: "#654321", section: "Drama" },
  { id: "plain", name: "Plain", color: "#abcdef" },
];

let dataDir: string;
let stops: Record<string, TeamProjectStop>;
let notes: Array<{ threadId: string; botId: string; line: string }>;

const build = () =>
  withTeamProjectStops(
    createBotHolds({ dataDir, bots: () => BOTS, line: (language, key, params) => serverLine(language, key, params), changed: () => {} }),
    {
      bot: (botId) => BOTS.find((bot) => bot.id === botId),
      note: (threadId, bot, line) => notes.push({ threadId, botId: bot.id, line }),
      stop: (botId) => stops[botId] ?? null,
    },
  );

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "team-project-stops-"));
  stops = {};
  notes = [];
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a project bot that may not run now", () => {
  it("takes no new work, and the person is told why in one plain line", () => {
    const holds = build();
    expect(holds.held("writer")).toBe(false);
    expect(holds.text("writer")).toBeNull();
    expect(holds.handoff("writer")).toBeNull();

    stops = { writer: { reason: "folder_missing", folder: "/Volumes/Work/drama" } };
    expect(holds.held("writer")).toBe(true);
    expect(holds.text("writer")).toBe(
      "Writer can't work right now: its project folder was not found at /Volumes/Work/drama. Reconnect the drive or put the folder back, then try again.",
    );
    expect(holds.text("writer", "zh-CN")).toBe("Writer 现在没法工作：在 /Volumes/Work/drama 找不到它的项目文件夹。请接上硬盘或把文件夹放回原处，然后再试一次。");

    stops = { writer: { reason: "archived" } };
    expect(holds.text("writer")).toBe("Writer takes no new work because its project is archived. Restore the project in Settings → Data, then try again.");

    stops = { writer: { reason: "unknown_project" } };
    expect(holds.text("writer")).toBe("Writer can't work right now: MagicBot has no record of its project. Restore projects.json in MagicBot's data folder from a backup, then try again.");
    expect(holds.text("writer", "zh-CN")).toBe("Writer 现在没法工作：MagicBot 里找不到它所属的项目。请从备份里恢复 MagicBot 数据文件夹中的 projects.json，然后再试一次。");

    expect(holds.held("editor")).toBe(false);
    expect(holds.held("plain")).toBe(false);
  });

  it("tells a bot that hands it work what happened and what to tell the person", () => {
    const holds = build();
    stops = { writer: { reason: "folder_missing", folder: "/Volumes/Work/drama" } };
    expect(holds.handoff("writer")).toMatch(/^@Writer can't take work right now: the folder of the project it belongs to was not found at \/Volumes\/Work\/drama, so nothing was handed to it\./);
    stops = { writer: { reason: "archived" } };
    expect(holds.handoff("writer")).toContain("is archived, so nothing was handed to it. Tell the person in one line that they can restore the project in Settings → Data.");
    stops = { writer: { reason: "unknown_project" } };
    expect(holds.handoff("writer")).toContain("MagicBot has no record of the project it belongs to, so nothing was handed to it. Tell the person in one line that projects.json in MagicBot's data folder has to be restored from a backup.");
    for (const reason of [{ reason: "archived" }, { reason: "unknown_project" }, { reason: "folder_missing", folder: "/x" }] as TeamProjectStop[]) {
      stops = { writer: reason };
      expect(holds.handoff("writer")).toMatch(/Do not retry, and do not hand this to another bot to work around it\.$/);
    }
  });

  it("is not listed among the bots the person paused, and pausing still works as before", () => {
    const holds = build();
    stops = { writer: { reason: "archived" } };
    expect(holds.heldBots()).toEqual([]);
    expect(holds.state()).toEqual({ bots: [], departments: [] });

    expect(holds.set("bot", "plain", true)).toEqual({ state: { bots: ["plain"], departments: [] }, newlyHeld: ["plain"] });
    expect(holds.heldBots()).toEqual(["plain"]);
    expect(holds.held("plain")).toBe(true);
    expect(holds.text("plain")).toBe(serverLine(undefined, "server.botHeld", { bot: "Plain" }));
    expect(holds.handoff("plain")).toContain("is paused by the person");

    expect(holds.set("department", "Drama", true).newlyHeld).toEqual(["writer", "editor"]);
    holds.rename("Drama", "Series");
    expect(holds.state().departments).toEqual(["Series"]);
    holds.forget("department", "Series");
    holds.forget("bot", "plain");
    expect(holds.state()).toEqual({ bots: [], departments: [] });
    expect(build().state()).toEqual({ bots: [], departments: [] });
  });

  it("gives the project's reason before the person's pause, which a restored project's bot still has", () => {
    const holds = build();
    holds.set("bot", "writer", true);
    stops = { writer: { reason: "archived" } };
    expect(holds.text("writer")).toContain("its project is archived");
    expect(holds.handoff("writer")).toContain("is archived");
    stops = {};
    expect(holds.held("writer")).toBe(true);
    expect(holds.text("writer")).toBe(serverLine(undefined, "server.botHeld", { bot: "Writer" }));
  });

  it("says so in a room once per conversation and reason, and again after the bot could run in between", () => {
    const holds = build();
    holds.noteRoomSkip("writer", "thread-1");
    expect(notes).toEqual([]);

    stops = { writer: { reason: "folder_missing", folder: "/Volumes/Work/drama" } };
    holds.noteRoomSkip("writer", "thread-1");
    holds.noteRoomSkip("writer", "thread-1");
    holds.noteRoomSkip("writer", "thread-2", "zh-CN");
    expect(notes).toEqual([
      { threadId: "thread-1", botId: "writer", line: holds.text("writer") },
      { threadId: "thread-2", botId: "writer", line: holds.text("writer", "zh-CN") },
    ]);

    stops = { writer: { reason: "archived" } };
    holds.noteRoomSkip("writer", "thread-1");
    expect(notes).toHaveLength(3);
    expect(notes[2]).toEqual({ threadId: "thread-1", botId: "writer", line: holds.text("writer") });

    stops = {};
    expect(holds.held("writer")).toBe(false);
    stops = { writer: { reason: "archived" } };
    holds.noteRoomSkip("writer", "thread-1");
    holds.noteRoomSkip("writer", "thread-1");
    expect(notes).toHaveLength(4);
  });

  it("says nothing for a bot the person paused or a bot that is gone", () => {
    const holds = build();
    holds.set("bot", "plain", true);
    holds.noteRoomSkip("plain", "thread-1");
    stops = { gone: { reason: "archived" } };
    holds.noteRoomSkip("gone", "thread-1");
    expect(holds.text("gone")).toBeNull();
    expect(holds.handoff("gone")).toBeNull();
    expect(notes).toEqual([]);
  });
});
