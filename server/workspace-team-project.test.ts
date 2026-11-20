import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TeamProjectMembership, TeamProjectRecord } from "../shared/team-projects.ts";
import { BOTS_DIR, soulFile, writeSoulMirror } from "./bot-folder.ts";
import { DATA_DIR } from "./config.ts";
import { beginMemoryTurn, endMemoryTurn, readMemoryJournal, resetMemoryJournalState } from "./memory-journal.ts";
import { deleteMemoryDoc, memoryOverview, readMemoryDoc, resolveMemoryPath, writeMemoryDoc } from "./memory-store.ts";
import { closeMessageDb, indexedMemoryFiles } from "./message-db.ts";
import { SECTION_CONTEXTS_FILE } from "./section-context.ts";
import {
  appendMemoryLog,
  ensureWorkspace,
  ensureWorkspaceFolder,
  listMemoryLogs,
  listMemoryTopics,
  loadMemory,
  memoryRulesPrompt,
  memorySystemPrompt,
  prepareOwnFolder,
  privateBotFolder,
  readMemoryFile,
  readMemoryTopic,
  retireWorkspace,
  searchMemoryFiles,
  setTeamProjectLookup,
  setTeamProjectMemberships,
  syncMemoryIndex,
  TASK_WORKSPACES_DIR,
  teamProjectFolderReady,
  teamProjectStop,
  updateMemory,
  workspaceDir,
  workspaceLocationsPrompt,
  WORKSPACES_DIR,
  writeMemoryFile,
  writeMemoryLog,
  writeMemoryTopic,
} from "./workspace.ts";

const WRITER = "bot-project-writer";
const PLAIN = "bot-plain";

let root: string;
let project: string;
let projects: Record<string, Pick<TeamProjectRecord, "folder" | "archivedAt">>;
let members: Record<string, TeamProjectMembership>;

const own = (...parts: string[]) => join(project, ".magic-team", "bots", "writer", ...parts);
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as Error & { status?: number; errorKey?: string };
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  closeMessageDb();
  resetMemoryJournalState();
  rmSync(DATA_DIR, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), "workspace-team-project-"));
  project = join(root, "drama");
  mkdirSync(project);
  projects = { p1: { folder: project } };
  members = { [WRITER]: { id: "p1", role: "writer" } };
  setTeamProjectLookup((id) => projects[id]);
  setTeamProjectMemberships((botId) => members[botId]);
});

afterEach(() => {
  setTeamProjectLookup(() => undefined);
  setTeamProjectMemberships(() => undefined);
  closeMessageDb();
  rmSync(root, { recursive: true, force: true });
});

describe("a project bot's own folder", () => {
  it("is in its project folder, while its folder in the data folder stays where every bot's is", () => {
    expect(workspaceDir(WRITER)).toBe(own());
    expect(privateBotFolder(WRITER)).toBe(join(WORKSPACES_DIR, WRITER));
    expect(teamProjectFolderReady(project)).toBe(true);
    expect(teamProjectStop(WRITER)).toBeNull();
  });

  it("leaves a bot in no project exactly where it was", () => {
    expect(workspaceDir(PLAIN)).toBe(join(WORKSPACES_DIR, PLAIN));
    expect(privateBotFolder(PLAIN)).toBe(join(WORKSPACES_DIR, PLAIN));
    expect(ensureWorkspace(PLAIN, "en")).toBe(join(WORKSPACES_DIR, PLAIN));
    expect(readdirSync(join(WORKSPACES_DIR, PLAIN)).sort()).toEqual(["MEMORY.md", "memory"]);
    expect(ensureWorkspaceFolder(PLAIN, "memory", "log")).toBe(join(WORKSPACES_DIR, PLAIN, "memory", "log"));
    expect(prepareOwnFolder("bot-never-made")).toBeNull();
    expect(existsSync(join(WORKSPACES_DIR, "bot-never-made"))).toBe(false);
    if (process.platform !== "win32") expect(lstatSync(join(WORKSPACES_DIR, PLAIN, "memory")).mode & 0o777).toBe(0o700);
    expect(readdirSync(project)).toEqual([]);
    expect(workspaceLocationsPrompt(PLAIN, "/work")).not.toContain(".magic-team");
    expect(memoryRulesPrompt(PLAIN)).toContain("separate from any custom project folder");
  });

  it("treats an id that names no bot, such as a memory layer, as outside every project", () => {
    expect(workspaceDir(`${WRITER}--room-abc`)).toBe(join(WORKSPACES_DIR, `${WRITER}--room-abc`));
  });

  it("has the folders inside it made one level at a time, and none once the project folder is away", () => {
    const makeFolder = prepareOwnFolder(WRITER)!;
    expect(readdirSync(own())).toEqual([]);
    makeFolder(own("templates", "writer", "skills", "beat-sheet"));
    makeFolder(own("templates", "writer", "skills", "beat-sheet"));
    expect(readdirSync(own("templates", "writer", "skills"))).toEqual(["beat-sheet"]);
    if (process.platform !== "win32") expect(lstatSync(own("templates", "writer")).mode & 0o777).toBe(0o700);

    expect(() => makeFolder(join(project, "elsewhere"))).toThrow(/is not inside/);
    expect(() => makeFolder(join(own(), "..", "director", "templates"))).toThrow(/is not inside/);
    expect(readdirSync(project)).toEqual([".magic-team"]);
    expect(readdirSync(join(project, ".magic-team", "bots"))).toEqual(["writer"]);

    writeFileSync(own("notes"), "a file where a folder is asked for");
    expect(refusal(() => makeFolder(own("notes", "drafts")))).toMatchObject({ status: 409, errorKey: "serverError.teamProjectBot.ownFolderBlocked" });

    const kept = join(root, "drama-unplugged");
    renameSync(project, kept);
    expect(refusal(() => makeFolder(own("templates", "writer", "avatars")))).toMatchObject({ status: 409, errorKey: "serverError.teamProjectBot.folderMissing" });
    expect(existsSync(project)).toBe(false);
    expect(readdirSync(join(kept, ".magic-team", "bots", "writer", "templates", "writer"))).toEqual(["skills"]);
  });
});

describe("a project bot's memory", () => {
  it("is seeded, written and read in the project folder, and nothing of it is in the data folder", () => {
    expect(ensureWorkspace(WRITER, "en")).toBe(own());
    expect(readFileSync(own("MEMORY.md"), "utf8")).toContain("# Memory");

    writeMemoryFile(WRITER, "- 2026-11-20 · The heroine is called Lin.\n");
    expect(updateMemory(WRITER, { action: "append", text: "Episodes run ninety seconds." })).toMatchObject({ ok: true });
    writeMemoryTopic(WRITER, "style.md", "---\ntitle: Style\n---\nShort scenes, hard cuts.\n");
    expect(appendMemoryLog(WRITER, "Drafted episode one.", { now: new Date(2026, 10, 20, 9, 5) })).toMatchObject({ ok: true, file: "memory/log/2026-11-20.md" });
    writeMemoryLog(WRITER, "2026-11-19.md", "- 08:00 · Read the brief.\n");
    writeMemoryDoc(WRITER, "memory/log/2026-11-18.md", "- 07:00 · Joined the project.\n");

    expect(readFileSync(own("MEMORY.md"), "utf8")).toContain("Episodes run ninety seconds.");
    expect(readFileSync(own("memory", "style.md"), "utf8")).toContain("hard cuts");
    expect(readdirSync(own("memory", "log")).sort()).toEqual(["2026-11-18.md", "2026-11-19.md", "2026-11-20.md"]);

    expect(readMemoryFile(WRITER).text).toContain("The heroine is called Lin.");
    expect(loadMemory(WRITER)?.text).toContain("Episodes run ninety seconds.");
    expect(listMemoryTopics(WRITER).map((topic) => topic.name)).toEqual(["style.md"]);
    expect(readMemoryTopic(WRITER, "style.md")).toContain("hard cuts");
    expect(listMemoryLogs(WRITER)).toEqual(["2026-11-18.md", "2026-11-19.md", "2026-11-20.md"]);
    expect(memoryOverview(WRITER)).toMatchObject({ workspacePath: own(), topics: [{ path: "memory/style.md" }] });
    expect(readMemoryDoc(WRITER, "memory/style.md").text).toContain("hard cuts");
    expect(resolveMemoryPath(WRITER, "memory/style.md").endsWith(join("writer", "memory", "style.md"))).toBe(true);
    expect(memorySystemPrompt(WRITER)).toContain(JSON.stringify(own("MEMORY.md")));

    expect(readdirSync(privateBotFolder(WRITER))).toEqual([]);
    if (process.platform !== "win32") expect(lstatSync(privateBotFolder(WRITER)).mode & 0o777).toBe(0o700);
  });

  it("is found through the index, which stays in the data folder", () => {
    writeMemoryTopic(WRITER, "villain.md", "The villain owns a shipping company in Ningbo.\n");
    expect(searchMemoryFiles(WRITER, "shipping Ningbo").map((hit) => hit.file)).toEqual(["memory/villain.md"]);

    writeFileSync(own("memory", "by-hand.md"), "The finale is filmed at the lighthouse.\n");
    expect(searchMemoryFiles(WRITER, "lighthouse").map((hit) => hit.file)).toEqual(["memory/by-hand.md"]);

    deleteMemoryDoc(WRITER, "memory/by-hand.md");
    expect(searchMemoryFiles(WRITER, "lighthouse")).toEqual([]);
    expect(readdirSync(project)).toEqual([".magic-team"]);
  });

  it("keeps what the index knows while the project folder is away, and writes nothing", () => {
    writeMemoryTopic(WRITER, "villain.md", "The villain owns a shipping company in Ningbo.\n");
    syncMemoryIndex(WRITER);
    const indexed = indexedMemoryFiles(WRITER).map((file) => file.path).sort();
    expect(indexed).toContain("memory/villain.md");
    const kept = join(root, "drama-unplugged");
    rmSync(kept, { recursive: true, force: true });
    mkdirSync(kept);
    rmSync(project, { recursive: true });

    syncMemoryIndex(WRITER);
    expect(indexedMemoryFiles(WRITER).map((file) => file.path).sort()).toEqual(indexed);
    expect(searchMemoryFiles(WRITER, "shipping Ningbo").map((hit) => hit.file)).toEqual(["memory/villain.md"]);
    expect(readMemoryFile(WRITER)).toEqual({ text: "", truncated: false });
    expect(listMemoryTopics(WRITER)).toEqual([]);

    for (const write of [
      () => ensureWorkspace(WRITER),
      () => writeMemoryFile(WRITER, "lost"),
      () => updateMemory(WRITER, { action: "append", text: "lost" }),
      () => writeMemoryTopic(WRITER, "lost.md", "lost"),
      () => appendMemoryLog(WRITER, "lost"),
      () => writeMemoryLog(WRITER, "2026-11-20.md", "lost"),
      () => writeMemoryDoc(WRITER, "memory/log/2026-11-20.md", "lost"),
      () => ensureWorkspaceFolder(WRITER, "skills"),
      () => prepareOwnFolder(WRITER),
    ]) {
      expect(refusal(write)).toMatchObject({ status: 409, errorKey: "serverError.teamProjectBot.folderMissing" });
    }
    expect(existsSync(project)).toBe(false);
    expect(readdirSync(privateBotFolder(WRITER))).toEqual([]);
    expect(readdirSync(root).sort()).toEqual(["drama-unplugged"]);
  });

  it("records no change while the project folder is away, and none when it is back unchanged", () => {
    writeMemoryFile(WRITER, "- 2026-11-20 · The heroine is called Lin.\n");
    beginMemoryTurn(WRITER, "thread-1");
    expect(endMemoryTurn("thread-1")).toEqual([]);

    const parked = join(root, "parked");
    mkdirSync(parked);
    renameSync(project, join(parked, "drama"));
    beginMemoryTurn(WRITER, "thread-2");
    expect(endMemoryTurn("thread-2")).toEqual([]);
    renameSync(join(parked, "drama"), project);
    beginMemoryTurn(WRITER, "thread-3");
    expect(endMemoryTurn("thread-3")).toEqual([]);
    expect(readMemoryJournal(WRITER)).toEqual([]);
  });

  it("refuses to write when the lookup does not know the project, and never falls back to the data folder", () => {
    setTeamProjectLookup(() => undefined);
    expect(teamProjectStop(WRITER)).toEqual({ reason: "unknown_project" });
    expect(refusal(() => ensureWorkspace(WRITER))).toMatchObject({ status: 409, errorKey: "serverError.teamProjectBot.unknown" });
    expect(refusal(() => writeMemoryFile(WRITER, "lost"))).toMatchObject({ errorKey: "serverError.teamProjectBot.unknown" });
    expect(existsSync(join(WORKSPACES_DIR, WRITER))).toBe(false);
    expect(readdirSync(project)).toEqual([]);
  });

  it("takes over the starter memory written before the bot joined its project", () => {
    members = {};
    writeMemoryFile(WRITER, "- 2026-11-20 · Starter fact from the template.\n");
    writeMemoryTopic(WRITER, "bible.md", "The series bible.\n");
    expect(existsSync(join(WORKSPACES_DIR, WRITER, "MEMORY.md"))).toBe(true);

    members = { [WRITER]: { id: "p1", role: "writer" } };
    ensureWorkspace(WRITER);
    expect(readMemoryFile(WRITER).text).toContain("Starter fact from the template.");
    expect(readFileSync(own("memory", "bible.md"), "utf8")).toBe("The series bible.\n");
    expect(readdirSync(privateBotFolder(WRITER))).toEqual([]);
    expect(searchMemoryFiles(WRITER, "series bible").map((hit) => hit.file)).toEqual(["memory/bible.md"]);
  });
});

describe("what a project bot is told about its folders", () => {
  it("names its own folder and says that inside .magic-team it may change only that folder", () => {
    ensureWorkspace(WRITER);
    const prompt = workspaceLocationsPrompt(WRITER, project, project);
    expect(prompt).toContain(`"sharedBotFolder":${JSON.stringify(own())}`);
    expect(prompt).toContain("sharedBotFolder is your own folder inside this project's .magic-team folder");
    expect(prompt).toContain("Inside .magic-team, change only that folder.");
    expect(prompt).toContain("leave it out of any search-and-replace");
    expect(prompt).toContain(JSON.stringify(join(TASK_WORKSPACES_DIR, WRITER)));
    expect(memoryRulesPrompt(WRITER)).toContain(`${JSON.stringify(own("MEMORY.md"))}, in your own folder inside this project's .magic-team folder and`);
    expect(memoryRulesPrompt(WRITER)).not.toContain("separate from any custom project folder");
  });
});

describe("deleting a bot", () => {
  it("moves a project bot's folder aside in the project and removes its folder in the data folder", () => {
    ensureWorkspace(WRITER);
    writeMemoryFile(WRITER, "- 2026-11-20 · Kept after the bot is gone.\n");
    mkdirSync(join(privateBotFolder(WRITER), ".magicbot-secrets", "thread-1"), { recursive: true });
    writeFileSync(join(privateBotFolder(WRITER), ".magicbot-secrets", "thread-1", "token"), "secret");

    retireWorkspace({ id: WRITER, teamProject: members[WRITER] });

    expect(existsSync(own())).toBe(false);
    expect(existsSync(privateBotFolder(WRITER))).toBe(false);
    const [kept] = readdirSync(join(project, ".magic-team", "bots", ".deleted"));
    expect(kept).toMatch(/^writer-\d{8}T\d{6}Z$/);
    expect(readFileSync(join(project, ".magic-team", "bots", ".deleted", kept!, "MEMORY.md"), "utf8")).toContain("Kept after the bot is gone.");
  });

  it("removes the folder of a bot in no project, as before", () => {
    ensureWorkspace(PLAIN);
    retireWorkspace({ id: PLAIN });
    expect(existsSync(join(WORKSPACES_DIR, PLAIN))).toBe(false);
    retireWorkspace({ id: "bot-never-made" });
  });

  it("touches nothing in a project whose folder is away, and still removes the folder in the data folder", () => {
    mkdirSync(privateBotFolder(WRITER), { recursive: true });
    rmSync(project, { recursive: true });
    retireWorkspace({ id: WRITER, teamProject: members[WRITER] });
    expect(existsSync(project)).toBe(false);
    expect(existsSync(privateBotFolder(WRITER))).toBe(false);
  });
});

describe("what stays in the app's data folder for a project bot", () => {
  it("keeps the persona, the department context and the memory index out of the project folder", () => {
    ensureWorkspace(WRITER);
    writeSoulMirror(WRITER, "You write tight cold opens.");
    expect(soulFile(WRITER)).toBe(join(BOTS_DIR, WRITER, "SOUL.md"));
    expect(readFileSync(soulFile(WRITER), "utf8")).toContain("tight cold opens");
    expect(BOTS_DIR).toBe(join(DATA_DIR, "bots"));
    expect(SECTION_CONTEXTS_FILE).toBe(join(DATA_DIR, "section-contexts.json"));
    writeMemoryTopic(WRITER, "style.md", "Short scenes.\n");
    expect(readdirSync(own(), { recursive: true }).map(String).sort()).toEqual(["MEMORY.md", "memory", join("memory", "style.md")]);
    expect(readdirSync(join(project, ".magic-team")).sort()).toEqual(["bots"]);
  });
});
