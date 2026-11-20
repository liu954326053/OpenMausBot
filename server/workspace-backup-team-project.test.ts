import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { indexMemoryFile } from "./message-db.ts";
import { applyPendingWorkspaceRestore, commitPendingWorkspaceRestore, createWorkspaceBackup, stageWorkspaceBackup } from "./workspace-backup.ts";
import {
  ensureWorkspace, privateBotFolder, readMemoryFile, searchMemoryFiles, setTeamProjectLookup, setTeamProjectMemberships, teamProjectStop, workspaceDir,
} from "./workspace.ts";

const PASSWORD = "correct horse battery staple";
const PROJECT = "project-night-shift";
const SKILL = "---\nname: beat-sheet\ndescription: Lays out the beats of an episode.\n---\n\n# beat-sheet\n";

const scratch: string[] = [];
const bots: string[] = [];
function directory(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "omb-backup-project-")));
  scratch.push(path);
  return path;
}
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
/** Every entry below `dir` with what tells a change: its kind, its bytes and when it was last written. */
const state = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort().map((entry) => {
  const stat = lstatSync(join(dir, entry));
  return stat.isFile() ? `${entry} ${readFileSync(join(dir, entry), "utf8")} @${stat.mtimeMs}` : `${entry}/`;
});
const filesBelow = (dir: string) => readdirSync(dir, { recursive: true }).map(String).filter((entry) => statSync(join(dir, entry)).isFile());

/** A data folder with one bot in a project and one in none, and the project folder the first one's files are in. */
function installation() {
  const data = directory();
  const project = join(directory(), "Night Shift");
  const bot = `writer-${Math.random().toString(36).slice(2, 10)}`;
  bots.push(bot);
  const own = join(project, ".magic-team", "bots", "writer");
  mkdirSync(join(own, "memory"), { recursive: true });
  mkdirSync(join(own, "skills", "beat-sheet"), { recursive: true });
  writeFileSync(join(project, "script.md"), "# Night Shift\n");
  writeFileSync(join(own, "MEMORY.md"), "- 2026-11-20 · The pilot is set in Lisbon\n");
  writeFileSync(join(own, "memory", "cast.md"), "Marta plays the night nurse.\n");
  writeFileSync(join(own, "skills", "beat-sheet", "SKILL.md"), SKILL);
  mkdirSync(join(project, ".magic-team", "team"));
  writeFileSync(join(project, ".magic-team", "project.json"), "{}\n");

  const work = join(data, "task-workspaces", bot, "task");
  json(join(data, "bots.json"), [
    { id: bot, threadId: "thread", cwd: project, teamProject: { id: PROJECT, role: "writer" }, soul: "You write the episodes.", tasks: [{ threadId: "task", cwd: work }] },
    { id: "plain", threadId: "plain-thread", soul: "You keep the books." },
  ]);
  json(join(data, "projects.json"), { projects: [{ id: PROJECT, folder: project }] });
  mkdirSync(join(data, "workspaces", bot), { recursive: true });
  mkdirSync(join(data, "workspaces", "plain"), { recursive: true });
  writeFileSync(join(data, "workspaces", "plain", "MEMORY.md"), "- 2026-11-20 · The books close on Friday\n");
  mkdirSync(join(data, "bots", bot), { recursive: true });
  writeFileSync(join(data, "bots", bot, "SOUL.md"), "You write the episodes.");
  mkdirSync(join(work, ".claude", "skills"), { recursive: true });
  writeFileSync(join(work, "draft.md"), "INT. WARD - NIGHT\n");
  symlinkSync(join(own, "skills", "beat-sheet"), join(work, ".claude", "skills", "beat-sheet"), process.platform === "win32" ? "junction" : "dir");
  return { data, project, own, bot, work };
}

/** What the server does with restored records: the bot store tells who is in a project, the registry where it is. */
function followRestored(data: string): void {
  const restored: Array<{ id: string; teamProject?: { id: string; role: string } }> = readJson(join(data, "bots.json"));
  const projects: Array<{ id: string; folder: string }> = readJson(join(data, "projects.json")).projects;
  setTeamProjectMemberships((botId) => restored.find((entry) => entry.id === botId)?.teamProject);
  setTeamProjectLookup((id) => projects.find((entry) => entry.id === id));
}

afterEach(() => {
  setTeamProjectMemberships(() => undefined);
  setTeamProjectLookup(() => undefined);
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const bot of bots.splice(0)) rmSync(privateBotFolder(bot), { recursive: true, force: true });
});

describe("a full backup when a bot's own files are in a project folder", () => {
  it("carries nothing of the project folder and leaves it as it was", async () => {
    const { data, project, bot } = installation();
    const before = state(project);

    const exported = await createWorkspaceBackup(data, { password: PASSWORD });

    expect(state(project)).toEqual(before);
    expect(exported.summary.warnings).toContain("1 symbolic link(s) in conversation work folders were omitted; what they point to is outside this backup.");
    const elsewhere = directory();
    const staged = await stageWorkspaceBackup(elsewhere, exported.path, { password: PASSWORD });
    const carried = join(elsewhere, ".backups", staged.id, "staged", "data");
    const paths: string[] = readJson(join(elsewhere, ".backups", staged.id, "staged", "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(paths.filter((path) => path.includes(".magic-team") || path.includes("Night Shift"))).toEqual([]);
    expect(paths.filter((path) => path.startsWith(`workspaces/${bot}`))).toEqual([`workspaces/${bot}`]);
    expect(paths).toEqual(expect.arrayContaining(["bots.json", "projects.json", `bots/${bot}/SOUL.md`, "workspaces/plain/MEMORY.md", `task-workspaces/${bot}/task/draft.md`]));
    expect(existsSync(join(carried, "task-workspaces", bot, "task", ".claude", "skills", "beat-sheet"))).toBe(false);
    for (const file of filesBelow(carried)) {
      expect(readFileSync(join(carried, file), "utf8"), file).not.toMatch(/Lisbon|night nurse|Lays out the beats/);
    }
  });

  it("is restored on the same computer without touching the project folder, and the bot is still in its project", async () => {
    const { data, project, own, bot } = installation();
    const exported = await createWorkspaceBackup(data, { password: PASSWORD });
    appendFileSync(join(own, "MEMORY.md"), "- 2026-11-21 · The lead is called Marta\n");
    writeFileSync(join(own, "memory", "props.md"), "A cracked wall clock.\n");
    const sinceTheBackup = state(project);

    const staged = await stageWorkspaceBackup(data, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(data, staged.id);
    const result = applyPendingWorkspaceRestore(data);

    expect(result).toMatchObject({ restored: true });
    expect(result).not.toHaveProperty("leftBehind");
    expect(state(project), "what the bot learned since the backup is not taken back").toEqual(sinceTheBackup);
    expect(readJson(join(data, "bots.json"))[0]).toMatchObject({ id: bot, cwd: project, teamProject: { id: PROJECT, role: "writer" } });
    expect(readJson(join(data, "projects.json"))).toEqual({ projects: [{ id: PROJECT, folder: project }] });
    expect(readdirSync(join(data, "workspaces", bot))).toEqual([]);
    expect(readFileSync(join(data, "bots", bot, "SOUL.md"), "utf8")).toBe("You write the episodes.");

    followRestored(data);
    expect(teamProjectStop(bot)).toBeNull();
    expect(workspaceDir(bot)).toBe(own);
    expect(readMemoryFile(bot).text).toContain("The lead is called Marta");
    // The index came back as the backup had it; the next search reads the files again.
    indexMemoryFile(bot, "MEMORY.md", "- 2026-11-20 · The pilot is set in Lisbon\n", { mtimeMs: 1, bytes: 1 });
    expect(searchMemoryFiles(bot, "Marta").map((hit) => hit.file).sort()).toEqual(["MEMORY.md", "memory/cast.md"]);
    expect(searchMemoryFiles(bot, "clock").map((hit) => hit.file)).toEqual(["memory/props.md"]);
    expect(state(project)).toEqual(sinceTheBackup);
  });

  it("is restored where the project folder is not: the bot does not run, and the folder is not made", async () => {
    const { data, project, bot } = installation();
    const exported = await createWorkspaceBackup(data, { password: PASSWORD });
    const otherComputer = directory();
    const staged = await stageWorkspaceBackup(otherComputer, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(otherComputer, staged.id);
    expect(applyPendingWorkspaceRestore(otherComputer)).toMatchObject({ restored: true });
    const unplugged = `${project} (on the other computer)`;
    renameSync(project, unplugged);

    followRestored(otherComputer);
    expect(readJson(join(otherComputer, "bots.json"))[0]).toMatchObject({ id: bot, teamProject: { id: PROJECT, role: "writer" } });
    expect(teamProjectStop(bot)).toEqual({ reason: "folder_missing", folder: project });
    expect(() => ensureWorkspace(bot)).toThrow(`This bot's project folder was not found at ${project}.`);
    expect(readMemoryFile(bot).text).toBe("");
    expect(existsSync(project)).toBe(false);
    expect(existsSync(privateBotFolder(bot))).toBe(false);
  });

  // A Windows PC's backup restored on a Mac: the project's folder is a path this computer does not have.
  it.skipIf(process.platform === "win32")("is restored from a Windows computer: the bot stays in its project, which reads as not found", async () => {
    const { data, bot } = installation();
    const windows = "C:\\Users\\Ada\\.magicbot", site = "C:\\Users\\Ada\\Projects\\Night Shift";
    const records = readJson(join(data, "bots.json"));
    records[0].cwd = site;
    delete records[0].tasks;
    json(join(data, "bots.json"), records);
    json(join(data, "projects.json"), { projects: [{ id: PROJECT, folder: site }] });
    rmSync(join(data, "task-workspaces"), { recursive: true });
    const exported = await createWorkspaceBackup(data, { password: PASSWORD });
    const mac = directory();
    const staged = await stageWorkspaceBackup(mac, exported.path, { password: PASSWORD });
    const manifest = join(mac, ".backups", staged.id, "staged", "manifest.json");
    json(manifest, { ...readJson(manifest), sourceDataDir: windows });
    commitPendingWorkspaceRestore(mac, staged.id);
    const result = applyPendingWorkspaceRestore(mac);

    expect(result.leftBehind).toEqual({ bots: 1, paths: [site] });
    const restored = readJson(join(mac, "bots.json"))[0];
    expect(restored).toMatchObject({ id: bot, teamProject: { id: PROJECT, role: "writer" } });
    expect(restored).not.toHaveProperty("cwd");
    followRestored(mac);
    expect(teamProjectStop(bot)).toEqual({ reason: "folder_missing", folder: site });
    expect(workspaceDir(bot)).toBe(privateBotFolder(bot));
    expect(() => ensureWorkspace(bot)).toThrow(`This bot's project folder was not found at ${site}.`);
    expect(existsSync(privateBotFolder(bot))).toBe(false);
    expect(readdirSync(process.cwd()).filter((entry) => entry.startsWith("C:"))).toEqual([]);
  });
});
