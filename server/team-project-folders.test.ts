import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TeamProjectMembership, TeamProjectRecord } from "../shared/team-projects.ts";
import {
  ensureTeamProjectBotFolder,
  retireTeamProjectBotFolder,
  setTeamProjectLookup,
  setTeamProjectMemberships,
  teamProjectBotFolder,
  teamProjectFilesAway,
  teamProjectFolderReady,
  teamProjectStop,
} from "./team-project-folders.ts";

let root: string;
let project: string;
let legacy: string;
let projects: Record<string, Pick<TeamProjectRecord, "folder" | "archivedAt">>;
let members: Record<string, TeamProjectMembership>;

const own = (role: string) => join(project, ".magic-team", "bots", role);
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "team-project-folders-"));
  project = join(root, "drama");
  legacy = join(root, "data", "workspaces", "bot-writer");
  mkdirSync(project);
  projects = { p1: { folder: project } };
  members = { "bot-writer": { id: "p1", role: "writer" } };
  setTeamProjectLookup((id) => projects[id]);
  setTeamProjectMemberships((botId) => members[botId]);
});

afterEach(() => {
  setTeamProjectLookup(() => undefined);
  setTeamProjectMemberships(() => undefined);
  rmSync(root, { recursive: true, force: true });
});

describe("where a project bot's own folder is", () => {
  it("is <project folder>/.magic-team/bots/<role>, and nothing for a bot in no project", () => {
    expect(teamProjectBotFolder("bot-writer")).toBe(own("writer"));
    expect(teamProjectBotFolder("bot-plain")).toBeNull();
    expect(teamProjectStop("bot-plain")).toBeNull();
    expect(teamProjectFilesAway("bot-plain")).toBe(false);
  });

  it("asks the lookup every time, so a project that moves or appears is seen at once", () => {
    members.late = { id: "p2", role: "editor" };
    expect(teamProjectBotFolder("late")).toBeNull();
    projects.p2 = { folder: join(root, "second") };
    expect(teamProjectBotFolder("late")).toBe(join(root, "second", ".magic-team", "bots", "editor"));
  });

  it.each([
    "", ".", "..", ".hidden", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "tab\there", "trailing.", "trailing ",
    "con", "NUL", "com1", "lpt9.txt", "x".repeat(201),
  ])("places no bot whose role %j cannot be one folder's name", (role) => {
    members["bot-writer"] = { id: "p1", role };
    expect(teamProjectBotFolder("bot-writer")).toBeNull();
    expect(teamProjectStop("bot-writer")).toEqual({ reason: "unknown_project" });
    expect(() => ensureTeamProjectBotFolder("bot-writer", legacy)).toThrow(/no record of this bot's project/);
    expect(readdirSync(project)).toEqual([]);
  });

  it.each(["writer", "role-2", "编剧", "Lead Writer", "a.b"])("accepts the role %j", (role) => {
    members["bot-writer"] = { id: "p1", role };
    expect(teamProjectBotFolder("bot-writer")).toBe(own(role));
  });
});

describe("whether a project folder is there", () => {
  it("is ready only when it is a folder at an absolute path", () => {
    expect(teamProjectFolderReady(project)).toBe(true);
    expect(teamProjectFolderReady(join(root, "unplugged", "drama"))).toBe(false);
    writeFileSync(join(root, "a-file"), "");
    expect(teamProjectFolderReady(join(root, "a-file"))).toBe(false);
    expect(teamProjectFolderReady("drama")).toBe(false);
    expect(teamProjectFolderReady("")).toBe(false);
  });
});

describe("why a project bot may not run now", () => {
  it("runs when its project is known, not archived, and its folder is there", () => {
    expect(teamProjectStop("bot-writer")).toBeNull();
    expect(teamProjectFilesAway("bot-writer")).toBe(false);
  });

  it("does not run when the lookup does not know its project, or no lookup was set", () => {
    members["bot-writer"] = { id: "gone", role: "writer" };
    expect(teamProjectStop("bot-writer")).toEqual({ reason: "unknown_project" });
    expect(teamProjectFilesAway("bot-writer")).toBe(true);
    members["bot-writer"] = { id: "p1", role: "writer" };
    setTeamProjectLookup(() => undefined);
    expect(teamProjectStop("bot-writer")).toEqual({ reason: "unknown_project" });
  });

  it("does not run when its project is archived, and its files stay readable", () => {
    projects.p1 = { folder: project, archivedAt: 1 };
    expect(teamProjectStop("bot-writer")).toEqual({ reason: "archived" });
    expect(teamProjectFilesAway("bot-writer")).toBe(false);
    expect(teamProjectBotFolder("bot-writer")).toBe(own("writer"));
  });

  it("does not run when its project folder is missing, and says where it should be", () => {
    rmSync(project, { recursive: true });
    expect(teamProjectStop("bot-writer")).toEqual({ reason: "folder_missing", folder: project });
    expect(teamProjectFilesAway("bot-writer")).toBe(true);
  });

  it("names an archived project before a missing folder, without looking at the disk", () => {
    projects.p1 = { folder: join(root, "unplugged", "drama"), archivedAt: 1 };
    expect(teamProjectStop("bot-writer")).toEqual({ reason: "archived" });
  });

  // A backup made on Windows and restored on a Mac keeps `C:\Users\…` as the project's folder.
  it.skipIf(isAbsolute(relative(process.cwd(), tmpdir())))(
    "reads a folder that is no absolute path here as not found, even when it leads to a real folder from where the program runs",
    () => {
      const fromHere = relative(process.cwd(), project);
      expect(statSync(fromHere).isDirectory()).toBe(true);
      projects.p1 = { folder: fromHere };
      expect(teamProjectStop("bot-writer")).toEqual({ reason: "folder_missing", folder: fromHere });
      expect(teamProjectBotFolder("bot-writer")).toBeNull();
      expect(teamProjectFilesAway("bot-writer")).toBe(true);
      expect(() => ensureTeamProjectBotFolder("bot-writer", legacy)).toThrow(`This bot's project folder was not found at ${fromHere}.`);
      retireTeamProjectBotFolder({ id: "p1", role: "writer" });
      expect(readdirSync(project)).toEqual([]);
    },
  );
});

describe("making a project bot's folder", () => {
  it("does nothing for a bot in no project", () => {
    expect(ensureTeamProjectBotFolder("bot-plain", join(root, "data", "workspaces", "bot-plain"))).toBeNull();
    expect(tree(root)).toEqual(["drama"]);
  });

  it("makes .magic-team, bots, the role and what is asked below it, each private", () => {
    expect(ensureTeamProjectBotFolder("bot-writer", legacy, ["memory", "log"])).toBe(join(own("writer"), "memory", "log"));
    expect(tree(project)).toEqual([
      ".magic-team", ".magic-team/bots", ".magic-team/bots/writer", ".magic-team/bots/writer/memory", ".magic-team/bots/writer/memory/log",
    ].map((path) => join(...path.split("/"))));
    if (process.platform !== "win32") expect(lstatSync(own("writer")).mode & 0o777).toBe(0o700);
    expect(ensureTeamProjectBotFolder("bot-writer", legacy)).toBe(own("writer"));
  });

  it("never makes the project folder again, nor anything on the way to it", () => {
    rmSync(project, { recursive: true });
    expect(() => ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"])).toThrow(/project folder was not found/);
    expect(existsSync(project)).toBe(false);
    projects.p1 = { folder: join(root, "unplugged", "volume", "drama") };
    const refusal = (() => { try { ensureTeamProjectBotFolder("bot-writer", legacy); } catch (error) { return error as Error & { status?: number; errorKey?: string; errorParams?: unknown }; } })();
    expect(refusal).toMatchObject({ status: 409, errorKey: "serverError.teamProjectBot.folderMissing", errorParams: { folder: join(root, "unplugged", "volume", "drama") } });
    expect(tree(root)).toEqual([]);
  });

  it("refuses a link or a file where one of its own levels should be, and follows none", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(project, ".magic-team"), "dir");
    expect(() => ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"])).toThrow(/is not a regular folder/);
    expect(readdirSync(elsewhere)).toEqual([]);

    rmSync(join(project, ".magic-team"));
    mkdirSync(join(project, ".magic-team", "bots"), { recursive: true });
    symlinkSync(elsewhere, own("writer"), "dir");
    const refusal = (() => { try { ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"]); } catch (error) { return error as Error & { status?: number; errorKey?: string }; } })();
    expect(refusal).toMatchObject({ status: 409, errorKey: "serverError.teamProjectBot.ownFolderBlocked" });
    expect(readdirSync(elsewhere)).toEqual([]);

    rmSync(own("writer"));
    writeFileSync(own("writer"), "not a folder");
    expect(() => ensureTeamProjectBotFolder("bot-writer", legacy)).toThrow(/is not a regular folder/);
  });

  it("works for an archived project: only new work stops, not the files", () => {
    projects.p1 = { folder: project, archivedAt: 1 };
    expect(ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"])).toBe(join(own("writer"), "memory"));
  });
});

describe("taking over what was written before the bot joined its project", () => {
  const seedLegacy = () => {
    mkdirSync(join(legacy, "memory", "log"), { recursive: true });
    writeFileSync(join(legacy, "MEMORY.md"), "- 2026-11-20 · starter fact\n");
    writeFileSync(join(legacy, "memory", "style.md"), "---\ntitle: Style\n---\nShort scenes.\n");
    utimesSync(join(legacy, "memory", "style.md"), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    writeFileSync(join(legacy, "memory", "log", "2026-11-20.md"), "- 10:00 · started\n");
    mkdirSync(join(legacy, "skills", "outline"), { recursive: true });
    writeFileSync(join(legacy, "skills", "outline", "SKILL.md"), "---\nname: outline\n---\n");
    writeFileSync(join(legacy, "skills", "outline", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  };

  it("moves memory and skills into the project folder and leaves nothing of them behind", () => {
    seedLegacy();
    expect(ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"])).toBe(join(own("writer"), "memory"));
    expect(readFileSync(join(own("writer"), "MEMORY.md"), "utf8")).toBe("- 2026-11-20 · starter fact\n");
    expect(readFileSync(join(own("writer"), "memory", "log", "2026-11-20.md"), "utf8")).toBe("- 10:00 · started\n");
    expect(readFileSync(join(own("writer"), "skills", "outline", "SKILL.md"), "utf8")).toContain("name: outline");
    expect(Math.trunc(lstatSync(join(own("writer"), "memory", "style.md")).mtimeMs)).toBe(1_700_000_000_000);
    if (process.platform !== "win32") expect(lstatSync(join(own("writer"), "skills", "outline", "run.sh")).mode & 0o111).not.toBe(0);
    expect(existsSync(legacy)).toBe(false);
    expect(readdirSync(join(project, ".magic-team", "bots"))).toEqual(["writer"]);
  });

  it("keeps secret files and kept tools in the data folder, and drops the app's own skill links", () => {
    seedLegacy();
    mkdirSync(join(legacy, ".magicbot-secrets", "thread-1"), { recursive: true });
    writeFileSync(join(legacy, ".magicbot-secrets", "thread-1", "key.pem"), "secret");
    mkdirSync(join(legacy, ".openmausbot-secrets"));
    writeFileSync(join(legacy, ".openmausbot-secrets", "old.pem"), "secret");
    mkdirSync(join(legacy, "tools", "weather"), { recursive: true });
    writeFileSync(join(legacy, "tools", "weather", "server.js"), "// kept");
    mkdirSync(join(legacy, ".claude", "skills"), { recursive: true });
    symlinkSync(join(legacy, "skills", "outline"), join(legacy, ".claude", "skills", "outline"), "dir");
    writeFileSync(join(legacy, ".claude", "settings.json"), "{}");
    symlinkSync("MEMORY.md", join(legacy, "notes-link.md"));

    ensureTeamProjectBotFolder("bot-writer", legacy);

    expect(tree(legacy)).toEqual([
      ".magicbot-secrets", ".magicbot-secrets/thread-1", ".magicbot-secrets/thread-1/key.pem", ".openmausbot-secrets", ".openmausbot-secrets/old.pem",
      "tools", "tools/weather", "tools/weather/server.js",
    ].map((path) => join(...path.split("/"))));
    expect(existsSync(join(own("writer"), ".magicbot-secrets"))).toBe(false);
    expect(existsSync(join(own("writer"), ".openmausbot-secrets"))).toBe(false);
    expect(existsSync(join(own("writer"), "tools"))).toBe(false);
    expect(readdirSync(join(own("writer"), ".claude", "skills"))).toEqual([]);
    expect(readFileSync(join(own("writer"), ".claude", "settings.json"), "utf8")).toBe("{}");
    expect(readlinkSync(join(own("writer"), "notes-link.md"))).toBe("MEMORY.md");
  });

  it("leaves both alone when the project already holds the bot's folder", () => {
    seedLegacy();
    mkdirSync(own("writer"), { recursive: true });
    writeFileSync(join(own("writer"), "MEMORY.md"), "- already here\n");
    ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"]);
    expect(readFileSync(join(own("writer"), "MEMORY.md"), "utf8")).toBe("- already here\n");
    expect(readFileSync(join(legacy, "MEMORY.md"), "utf8")).toBe("- 2026-11-20 · starter fact\n");
  });

  it("starts over after a take-over that stopped half-way, losing nothing", () => {
    seedLegacy();
    mkdirSync(join(project, ".magic-team", "bots", ".adopting", "writer"), { recursive: true });
    writeFileSync(join(project, ".magic-team", "bots", ".adopting", "writer", "MEMORY.md"), "half a copy");
    ensureTeamProjectBotFolder("bot-writer", legacy);
    expect(readFileSync(join(own("writer"), "MEMORY.md"), "utf8")).toBe("- 2026-11-20 · starter fact\n");
    expect(readdirSync(join(project, ".magic-team", "bots"))).toEqual(["writer"]);
  });

  it("takes over nothing while the project folder is missing", () => {
    seedLegacy();
    rmSync(project, { recursive: true });
    expect(() => ensureTeamProjectBotFolder("bot-writer", legacy)).toThrow(/project folder was not found/);
    expect(readFileSync(join(legacy, "MEMORY.md"), "utf8")).toBe("- 2026-11-20 · starter fact\n");
    expect(existsSync(project)).toBe(false);
  });
});

describe("a deleted project bot's folder", () => {
  const at = new Date("2026-11-20T21:30:05.123Z");

  it("is moved aside inside the project, with everything in it, and its role is free again", () => {
    ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"]);
    writeFileSync(join(own("writer"), "MEMORY.md"), "- kept\n");
    retireTeamProjectBotFolder(members["bot-writer"]!, at);
    expect(existsSync(own("writer"))).toBe(false);
    const kept = join(project, ".magic-team", "bots", ".deleted", "writer-20261120T213005Z");
    expect(readFileSync(join(kept, "MEMORY.md"), "utf8")).toBe("- kept\n");

    ensureTeamProjectBotFolder("bot-writer", legacy, ["memory"]);
    writeFileSync(join(own("writer"), "MEMORY.md"), "- second bot\n");
    retireTeamProjectBotFolder(members["bot-writer"]!, at);
    expect(readdirSync(join(project, ".magic-team", "bots", ".deleted")).sort()).toEqual(["writer-20261120T213005Z", "writer-20261120T213005Z-2"]);
    expect(readFileSync(join(kept, "MEMORY.md"), "utf8")).toBe("- kept\n");
  });

  it("touches nothing when the project folder is missing, the project unknown, or the folder is a link", () => {
    retireTeamProjectBotFolder({ id: "gone", role: "writer" }, at);
    expect(readdirSync(project)).toEqual([]);

    rmSync(project, { recursive: true });
    retireTeamProjectBotFolder(members["bot-writer"]!, at);
    expect(existsSync(project)).toBe(false);

    mkdirSync(join(project, ".magic-team", "bots"), { recursive: true });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, own("writer"), "dir");
    retireTeamProjectBotFolder(members["bot-writer"]!, at);
    expect(readdirSync(join(project, ".magic-team", "bots"))).toEqual(["writer"]);
  });
});
