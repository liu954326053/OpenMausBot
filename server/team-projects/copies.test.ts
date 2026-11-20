import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TeamProjectRecord } from "../../shared/team-projects.ts";
import type { BotRecord } from "../store.ts";
import { renderTeamProjectCopies, writeTeamProjectCopies, type TeamProjectCopySources } from "./copies.ts";

let base: string;
let folder: string;

const project = (patch: Partial<TeamProjectRecord> = {}): TeamProjectRecord => ({
  id: "p1", name: "Stand-in bride", folder, section: "Stand-in bride",
  template: { id: "t1", name: "Short drama crew", version: 3 }, leadBotId: "b-lead", createdAt: 1_700_000_000_000, ...patch,
});

function bot(id: string, role: string, patch: Partial<BotRecord> = {}): BotRecord {
  return {
    id, threadId: `${id}-thread`, name: id, title: "", description: "", soul: "", notifications: true, color: "blue", unread: false,
    modelSelection: { instanceId: "claude", model: "opus" }, resumeCursors: {}, createdAt: 1, section: "Stand-in bride",
    teamProject: { id: "p1", role }, ...patch,
  } as BotRecord;
}

const lead = () => bot("b-lead", "producer", {
  name: "Producer", title: "Runs the show", description: "Plans every episode.", soul: "You keep the schedule.\nNever skip review.",
  chiefOfStaff: true, modelSelection: { instanceId: "claude", model: "opus", effort: "high" }, assignedSkills: ["beat-sheet", "casting"], mcpServers: ["drive"],
});
const writer = () => bot("b-writer", "writer", { name: "编剧", title: "写剧本", soul: "你负责写每一集的剧本。" });

function sources(patch: Partial<TeamProjectCopySources> = {}): TeamProjectCopySources {
  return {
    bots: () => [writer(), lead()],
    context: () => "Vertical short drama, 80 episodes.",
    memory: () => [
      { kind: "person", name: "Gu Yan", detail: "The male lead, 35.", aliases: ["Mr Gu"], status: "accepted" },
      { kind: "term", name: "Hook", detail: "The last ten seconds of an episode.", aliases: [], status: "accepted" },
      { kind: "decision", name: "Maybe a sequel", detail: "Not agreed yet.", aliases: [], status: "proposed" },
    ],
    ...patch,
  };
}

const home = () => join(folder, ".magic-team");
const read = (path: string) => readFileSync(join(home(), path), "utf8");

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-copies-")));
  folder = join(base, "Stand-in bride");
  mkdirSync(folder);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("what a project's copies say", () => {
  it("copies the project's record, and nothing the server keeps to itself", () => {
    const files = renderTeamProjectCopies({ ...project({ archivedAt: 9 }), pausedRoutineIds: ["r1"] } as TeamProjectRecord, sources());
    expect(JSON.parse(files["project.json"]!)).toEqual(project({ archivedAt: 9 }));
  });

  it("lists the team with the lead first, and names only for model, library skills and MCP servers", () => {
    const team = JSON.parse(renderTeamProjectCopies(project(), sources())["team/team.json"]!);
    expect(team).toEqual({
      department: "Stand-in bride",
      lead: "producer",
      bots: [
        { role: "producer", name: "Producer", title: "Runs the show", description: "Plans every episode.",
          model: { instanceId: "claude", model: "opus", effort: "high" }, librarySkills: ["beat-sheet", "casting"], mcpServers: ["drive"] },
        { role: "writer", name: "编剧", title: "写剧本", description: "", model: { instanceId: "claude", model: "opus" }, librarySkills: [] },
      ],
    });
  });

  it("has no lead when the lead bot is gone", () => {
    const team = JSON.parse(renderTeamProjectCopies(project(), sources({ bots: () => [writer()] }))["team/team.json"]!);
    expect(team.lead).toBeNull();
    expect(team.bots.map((member: { role: string }) => member.role)).toEqual(["writer"]);
  });

  it("copies each bot's persona under its role, the context, and the team memory that was accepted", () => {
    const files = renderTeamProjectCopies(project(), sources());
    expect(files["team/personas/producer.md"]).toBe("# Producer\n\nRuns the show\n\nPlans every episode.\n\nYou keep the schedule.\nNever skip review.\n");
    expect(files["team/personas/writer.md"]).toBe("# 编剧\n\n写剧本\n\n你负责写每一集的剧本。\n");
    expect(files["team/context.md"]).toBe("Vertical short drama, 80 episodes.\n");
    expect(files["team/memory.md"]).toBe("- **Gu Yan** (person; Mr Gu): The male lead, 35.\n- **Hook** (term): The last ten seconds of an episode.\n");
    expect(Object.keys(files).sort()).toEqual(["project.json", "team/context.md", "team/memory.md", "team/personas/producer.md", "team/personas/writer.md", "team/team.json"]);
  });

  it("keeps empty files for a team with no context and no memory, so an old copy never outlives its source", () => {
    const files = renderTeamProjectCopies(project(), sources({ context: () => "", memory: () => [] }));
    expect(files["team/context.md"]).toBe("");
    expect(files["team/memory.md"]).toBe("");
  });

  it("leaves out a bot whose role cannot be a file's name", () => {
    const files = renderTeamProjectCopies(project(), sources({ bots: () => [lead(), bot("b-odd", "../../escape"), bot("b-dev", "nul")] }));
    expect(Object.keys(files).filter((path) => path.startsWith("team/personas/"))).toEqual(["team/personas/producer.md"]);
    expect(JSON.parse(files["team/team.json"]!).bots).toHaveLength(1);
  });
});

describe("writing a project's copies", () => {
  it("writes them under .magic-team in the project folder", () => {
    expect(writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()))).toBe("written");
    expect(JSON.parse(read("project.json")).name).toBe("Stand-in bride");
    expect(read("team/context.md")).toBe("Vertical short drama, 80 episodes.\n");
    expect(readdirSync(join(home(), "team", "personas")).sort()).toEqual(["producer.md", "writer.md"]);
    expect(readdirSync(join(home(), "team")).sort()).toEqual(["context.md", "memory.md", "personas", "team.json"]);
  });

  it("does not write a file again when it already says the same", () => {
    const files = renderTeamProjectCopies(project(), sources());
    writeTeamProjectCopies(folder, files);
    const old = new Date(1_600_000_000_000);
    for (const path of Object.keys(files)) utimesSync(join(home(), path), old, old);
    expect(writeTeamProjectCopies(folder, { ...files, "team/context.md": "Changed.\n" })).toBe("written");
    expect(statSync(join(home(), "team/team.json")).mtimeMs).toBe(old.getTime());
    expect(statSync(join(home(), "team/context.md")).mtimeMs).not.toBe(old.getTime());
    expect(read("team/context.md")).toBe("Changed.\n");
  });

  it("removes the persona of a bot that left, and nothing else in that folder", () => {
    writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()));
    writeFileSync(join(home(), "team", "personas", "My notes.txt"), "mine");
    mkdirSync(join(home(), "bots", "writer"), { recursive: true });
    writeFileSync(join(home(), "bots", "writer", "MEMORY.md"), "real data");
    writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources({ bots: () => [lead()] })));
    expect(readdirSync(join(home(), "team", "personas")).sort()).toEqual(["My notes.txt", "producer.md"]);
    expect(readFileSync(join(home(), "bots", "writer", "MEMORY.md"), "utf8")).toBe("real data");
  });

  it("does not make the project folder again when it is gone", () => {
    rmSync(folder, { recursive: true });
    expect(writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()))).toBe("missing");
    expect(existsSync(folder)).toBe(false);
  });

  it("makes .magic-team again when only that was removed", () => {
    expect(writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()))).toBe("written");
    rmSync(home(), { recursive: true });
    expect(writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()))).toBe("written");
    expect(read("team/context.md")).toBe("Vertical short drama, 80 episodes.\n");
  });

  for (const planted of [".magic-team", ".magic-team/team", ".magic-team/team/personas"]) {
    it(`writes nothing through a link planted at ${planted}`, () => {
      if (process.platform === "win32") return;
      const elsewhere = join(base, "elsewhere");
      mkdirSync(elsewhere);
      const at = join(folder, planted);
      mkdirSync(join(at, ".."), { recursive: true });
      symlinkSync(elsewhere, at);
      expect(writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()))).toBe("refused");
      expect(readdirSync(elsewhere)).toEqual([]);
    });
  }

  it("replaces a link planted where a copy goes instead of writing through it", () => {
    if (process.platform === "win32") return;
    writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()));
    const target = join(base, "target.txt");
    writeFileSync(target, "untouched");
    rmSync(join(home(), "team", "context.md"));
    symlinkSync(target, join(home(), "team", "context.md"));
    writeTeamProjectCopies(folder, renderTeamProjectCopies(project(), sources()));
    expect(readFileSync(target, "utf8")).toBe("untouched");
    expect(read("team/context.md")).toBe("Vertical short drama, 80 episodes.\n");
  });
});
