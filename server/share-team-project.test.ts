import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCommunityPublisher } from "./share-publish.ts";
import { createShareHost, writeFolder, type ShareHostDeps } from "./share.ts";
import type { BotRecord } from "./store.ts";
import { prepareOwnFolder, privateBotFolder, setTeamProjectLookup, setTeamProjectMemberships, workspaceDir } from "./workspace.ts";

const PROJECT = "project-1";
const BEAT_SHEET = {
  name: "beat-sheet", description: "Lay out an episode's beats.", enabled: true,
  instructions: "---\nname: beat-sheet\ndescription: Lay out an episode's beats.\n---\n\nOpen cold, then one turn a minute.\n",
};

describe("making a template of a project bot", () => {
  let scratch: string;
  let project: string;
  let writer: BotRecord;
  let plain: BotRecord;

  const record = (id: string, name: string): BotRecord =>
    ({ id, name, title: "Writes", description: "Writes the episodes.", soul: "Be brief.", color: "blue", section: "Night Shift" }) as BotRecord;
  /** The share host as the server builds it: templates go to the bot's own folder, made ready first. */
  const share = (prepareBotFolder: ShareHostDeps["prepareBotFolder"] = prepareOwnFolder) => createShareHost({
    dataDir: join(scratch, "data"), bots: () => [writer, plain], groups: () => [], routines: () => [], brief: () => undefined,
    collectTeamSkills: (list) => ({ ok: true, skipped: [], skillsByBot: new Map(list.map((each) => [each.id, [BEAT_SHEET]])) }),
    picture: () => undefined, botFolder: workspaceDir, prepareBotFolder,
    publisher: createCommunityPublisher({ access: () => null }), patch: () => {},
  });

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "omb-share-project-")));
    project = join(scratch, "Night Shift");
    renameSync(mkdtempSync(join(scratch, "made-")), project);
    const suffix = Math.random().toString(36).slice(2, 10);
    writer = record(`writer-${suffix}`, "Writer");
    plain = record(`plain-${suffix}`, "Plain");
    setTeamProjectMemberships((botId) => (botId === writer.id ? { id: PROJECT, role: "writer" } : undefined));
    setTeamProjectLookup((id) => (id === PROJECT ? { folder: project } : undefined));
  });

  afterEach(() => {
    setTeamProjectMemberships(() => undefined);
    setTeamProjectLookup(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
    for (const bot of [writer, plain]) rmSync(privateBotFolder(bot.id), { recursive: true, force: true });
  });

  it("writes it into the bot's own folder in the project, and into the data folder for a bot in no project", () => {
    const made = share().export({ scope: "bot", bot: writer }, []);
    expect(made.dir).toBe(join(project, ".magic-team", "bots", "writer", "templates", "writer"));
    expect(readFileSync(join(made.dir, "bot.md"), "utf8")).toContain("Writer");
    expect(readFileSync(join(made.dir, "skills", "beat-sheet", "SKILL.md"), "utf8")).toContain("Open cold");
    expect(existsSync(join(privateBotFolder(writer.id), "templates"))).toBe(false);

    const other = share().export({ scope: "bot", bot: plain }, []);
    expect(other.dir).toBe(join(privateBotFolder(plain.id), "templates", "plain"));
    expect(existsSync(join(other.dir, "bot.md"))).toBe(true);
    expect(existsSync(join(other.dir, "skills", "beat-sheet", "SKILL.md"))).toBe(true);
  });

  it("is refused in plain words while the project folder is away, and makes nothing", () => {
    const unplugged = `${project} (unplugged)`;
    renameSync(project, unplugged);
    expect(() => share().export({ scope: "bot", bot: writer }, [])).toThrow(
      expect.objectContaining({
        message: `This bot's project folder was not found at ${project}. Reconnect the drive or put the folder back, then try again.`,
        errorKey: "serverError.teamProjectBot.folderMissing", status: 409,
      }),
    );
    expect(existsSync(project)).toBe(false);
    expect(existsSync(privateBotFolder(writer.id))).toBe(false);
  });

  it("is refused in plain words when the project folder goes away after it was checked, and makes nothing again", () => {
    const unplugged = `${project} (unplugged)`;
    const goesAwayOnceChecked = (botId: string) => {
      const makeFolder = prepareOwnFolder(botId);
      renameSync(project, unplugged);
      return makeFolder;
    };
    expect(() => share(goesAwayOnceChecked).export({ scope: "bot", bot: writer }, [])).toThrow(
      expect.objectContaining({ errorKey: "serverError.teamProjectBot.folderMissing", status: 409 }),
    );
    expect(existsSync(project)).toBe(false);
    expect(readdirSync(join(unplugged, ".magic-team", "bots", "writer"))).toEqual([]);
  });
});

describe("writing a template's folder", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "omb-share-folder-")));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("makes every folder through the maker it is handed", () => {
    const dir = join(scratch, "templates", "writer");
    const asked: string[] = [];
    writeFolder(dir, { "bot.md": "Writer", "skills/beat-sheet/notes/outline.md": "Cold open" }, (path) => {
      asked.push(path);
      mkdirSync(path, { recursive: true });
    });
    expect(asked).toEqual([dir, dir, join(dir, "skills", "beat-sheet", "notes")]);
    expect(readFileSync(join(dir, "bot.md"), "utf8")).toBe("Writer");
    expect(readFileSync(join(dir, "skills", "beat-sheet", "notes", "outline.md"), "utf8")).toBe("Cold open");
  });

  it("makes every level of a folder when it is handed no maker, as it always did", () => {
    const dir = join(scratch, "share", "id", "writer");
    writeFolder(dir, { "skills/beat-sheet/SKILL.md": "Beats" });
    expect(readFileSync(join(dir, "skills", "beat-sheet", "SKILL.md"), "utf8")).toBe("Beats");
  });
});
