import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BOTS_DIR, soulFile } from "./bot-folder.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";
import { appendMemoryLog, ensureWorkspace, privateBotFolder, readMemoryFile, setTeamProjectLookup, teamProjectStop, workspaceDir, writeMemoryFile } from "./workspace.ts";

const PROJECT = "project-1";
const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("a project bot in the bot store", () => {
  let project: string;
  let store: Store;
  const own = (role: string) => join(project, ".magic-team", "bots", role);
  const join_ = (name: string, role: string) => {
    const bot = store.createBot({ name });
    store.patchBot(bot.id, { teamProject: { id: PROJECT, role }, cwd: project });
    return bot;
  };

  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    project = realpathSync(mkdtempSync(join(tmpdir(), "omb-store-project-")));
    writeFileSync(join(project, "script.md"), "# Night Shift\n");
    setTeamProjectLookup((id) => (id === PROJECT ? { folder: project } : undefined));
    store = new Store(selection);
  });

  afterEach(() => {
    setTeamProjectLookup(() => undefined);
    rmSync(project, { recursive: true, force: true });
  });

  it("finds its own folder from its record, from the moment it joins and after a restart", () => {
    const plain = store.createBot({ name: "Plain" });
    const writer = store.createBot({ name: "Writer" });
    expect(workspaceDir(writer.id)).toBe(privateBotFolder(writer.id));

    store.patchBot(writer.id, { teamProject: { id: PROJECT, role: "writer" }, cwd: project });
    expect(workspaceDir(writer.id)).toBe(own("writer"));
    expect(teamProjectStop(writer.id)).toBeNull();
    expect([workspaceDir(plain.id), teamProjectStop(plain.id)]).toEqual([privateBotFolder(plain.id), null]);

    store = new Store(selection);
    expect(store.bot(writer.id)?.teamProject).toEqual({ id: PROJECT, role: "writer" });
    expect(workspaceDir(writer.id)).toBe(own("writer"));
    expect(workspaceDir(plain.id)).toBe(privateBotFolder(plain.id));
  });

  it("is deleted with its folder moved aside in the project, and only what is in the data folder removed", () => {
    const writer = join_("Writer", "writer");
    const editor = join_("Editor", "editor");
    for (const bot of [writer, editor]) {
      ensureWorkspace(bot.id);
      writeMemoryFile(bot.id, `- 2026-11-20 · ${bot.name} knows the pilot is set in Lisbon\n`);
      appendMemoryLog(bot.id, `${bot.name} started`);
    }
    expect(existsSync(soulFile(writer.id))).toBe(true);

    expect(store.deleteBot(writer.id)).toBe(true);

    expect(existsSync(own("writer"))).toBe(false);
    const aside = readdirSync(join(project, ".magic-team", "bots", ".deleted"));
    expect(aside).toEqual([expect.stringMatching(/^writer-\d{8}T\d{6}Z$/)]);
    expect(readFileSync(join(project, ".magic-team", "bots", ".deleted", aside[0]!, "MEMORY.md"), "utf8")).toContain("Writer knows the pilot is set in Lisbon");
    expect(readdirSync(join(project, ".magic-team", "bots", ".deleted", aside[0]!, "memory", "log"))).toHaveLength(1);
    expect([existsSync(privateBotFolder(writer.id)), existsSync(join(BOTS_DIR, writer.id))]).toEqual([false, false]);
    expect(readMemoryFile(editor.id).text).toContain("Editor knows the pilot is set in Lisbon");
    expect(readdirSync(project).sort()).toEqual([".magic-team", "script.md"]);
    expect(readdirSync(join(project, ".magic-team", "bots")).sort()).toEqual([".deleted", "editor"]);

    const next = join_("Writer", "writer");
    ensureWorkspace(next.id);
    expect(readMemoryFile(next.id).text).not.toContain("Lisbon");
    expect(readdirSync(join(project, ".magic-team", "bots", ".deleted"))).toEqual(aside);
  });

  it("is deleted while its project folder is away without making anything, and its folder is there when the project is back", () => {
    const writer = join_("Writer", "writer");
    ensureWorkspace(writer.id);
    writeMemoryFile(writer.id, "- 2026-11-20 · The pilot is set in Lisbon\n");
    const unplugged = `${project}-unplugged`;
    renameSync(project, unplugged);
    try {
      expect(store.deleteBot(writer.id)).toBe(true);
      expect(existsSync(project)).toBe(false);
      expect(existsSync(privateBotFolder(writer.id))).toBe(false);
    } finally {
      renameSync(unplugged, project);
    }
    expect(readFileSync(join(own("writer"), "MEMORY.md"), "utf8")).toContain("The pilot is set in Lisbon");
  });

  it("leaves a bot in no project exactly as deleting always was", () => {
    const plain = store.createBot({ name: "Plain" });
    ensureWorkspace(plain.id);
    expect(existsSync(join(privateBotFolder(plain.id), "MEMORY.md"))).toBe(true);
    expect(store.deleteBot(plain.id)).toBe(true);
    expect(existsSync(privateBotFolder(plain.id))).toBe(false);
    expect(readdirSync(project)).toEqual(["script.md"]);
  });
});
