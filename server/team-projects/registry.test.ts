import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TeamProjectRegistry, type StoredTeamProject } from "./registry.ts";

let dir: string;
let file: string;
let logged: string[];

const registry = () => new TeamProjectRegistry(file, (line) => logged.push(line));

function project(patch: Partial<StoredTeamProject> = {}): StoredTeamProject {
  return {
    id: "p1", name: "Stand-in bride", folder: "/dramas/Stand-in bride", section: "Stand-in bride",
    team: { key: "team:writers", name: "Writers" }, leadBotId: "bot-lead", createdAt: 1_700_000_000_000, ...patch,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-team-projects-"));
  file = join(dir, "projects.json");
  logged = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the list of projects on disk", () => {
  it("is empty, with no root, when nothing was saved yet, and writes no file for that", () => {
    const fresh = registry();
    expect(fresh.readable).toBe(true);
    expect(fresh.root()).toBeNull();
    expect(fresh.projects()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("keeps the root and every project across a restart", () => {
    const first = registry();
    first.setRoot("/dramas");
    first.add(project());
    first.add(project({ id: "p2", name: "Second", folder: "/dramas/Second", section: "Second", archivedAt: 5, pausedRoutineIds: ["r1"] }));

    const second = registry();
    expect(second.root()).toBe("/dramas");
    expect(second.projects()).toEqual([project(), project({ id: "p2", name: "Second", folder: "/dramas/Second", section: "Second", archivedAt: 5, pausedRoutineIds: ["r1"] })]);
    expect(second.find("p2")?.archivedAt).toBe(5);
    expect(second.find("nope")).toBeUndefined();
  });

  it("saves owner-only, whole, and leaves no temporary file beside it", () => {
    const saved = registry();
    saved.add(project());
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, projects: [project()] });
    expect(readdirSync(dir)).toEqual(["projects.json"]);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("reads a project made from a team template instead of a team, and keeps it as it was", () => {
    const { team: _team, ...older } = project({ template: { id: "t1", name: "Short drama crew", version: 3 } });
    writeFileSync(file, JSON.stringify({ version: 1, root: "/dramas", projects: [older] }));
    const saved = registry();
    expect(saved.readable).toBe(true);
    expect(saved.projects()).toEqual([older]);
    saved.add(project({ id: "p2" }));
    expect(registry().projects()).toEqual([older, project({ id: "p2" })]);
  });

  it("replaces and removes a project by id", () => {
    const saved = registry();
    saved.add(project());
    saved.add(project({ id: "p2" }));
    expect(saved.replace(project({ archivedAt: 9 }))).toBe(true);
    expect(saved.replace(project({ id: "gone" }))).toBe(false);
    saved.remove("p2");
    expect(registry().projects()).toEqual([project({ archivedAt: 9 })]);
  });

  it("hands out copies, so a caller cannot change the list without saving", () => {
    const saved = registry();
    saved.add(project({ pausedRoutineIds: ["r1"] }));
    saved.projects()[0]!.name = "changed";
    saved.find("p1")!.pausedRoutineIds!.push("r2");
    expect(saved.find("p1")).toEqual(project({ pausedRoutineIds: ["r1"] }));
  });

  it("never writes a list it could not read back", () => {
    const saved = registry();
    saved.setRoot("/dramas");
    saved.add(project());
    const before = readFileSync(file, "utf8");
    const broken = [
      project({ id: "p2", template: { id: "t1", name: "Short drama crew", version: Number.NaN } }),
      project({ id: "p2", team: { key: "", name: "Writers" } }),
      project({ id: "p2", createdAt: Number.POSITIVE_INFINITY }),
      project({ id: "p2", folder: "" }),
      { ...project({ id: "p2" }), leadBotId: undefined } as unknown as StoredTeamProject,
    ];
    for (const record of broken) expect(() => saved.add(record)).toThrow();
    expect(() => saved.replace(project({ name: "" }))).toThrow();
    expect(() => saved.setRoot("")).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(saved.projects()).toEqual([project()]);
    expect(registry().projects()).toEqual([project()]);
    expect(registry().root()).toBe("/dramas");
  });

  it("keeps what it holds when a save fails", () => {
    const saved = registry();
    saved.add(project());
    rmSync(file);
    mkdirSync(file);
    writeFileSync(join(file, "blocker"), "x");
    expect(() => saved.add(project({ id: "p2" }))).toThrow();
    expect(() => saved.setRoot("/elsewhere")).toThrow();
    expect(saved.projects()).toEqual([project()]);
    expect(saved.root()).toBeNull();
  });
});

describe("a list of projects that cannot be read", () => {
  const damaged: Array<[string, string]> = [
    ["cut off mid-write", '{"version":1,"projects":[{"id":"p1","na'],
    ["not JSON at all", "these are not the projects you are looking for"],
    ["an empty file", ""],
    ["a list instead of the saved shape", "[]"],
    ["a version this program does not know", JSON.stringify({ version: 2, projects: [] })],
    ["a project missing its folder", JSON.stringify({ version: 1, projects: [{ ...project(), folder: undefined }] })],
  ];

  for (const [what, text] of damaged) {
    it(`is not taken for no projects, and is never written over: ${what}`, () => {
      writeFileSync(file, text);
      const broken = registry();
      expect(broken.readable).toBe(false);
      expect(() => broken.projects()).toThrow(/couldn't be read/);
      expect(() => broken.root()).toThrow(/couldn't be read/);
      expect(broken.find("p1")).toBeUndefined();
      expect(() => broken.add(project())).toThrow(/couldn't be read/);
      expect(() => broken.setRoot("/dramas")).toThrow(/couldn't be read/);
      expect(() => broken.replace(project())).toThrow(/couldn't be read/);
      expect(() => broken.remove("p1")).toThrow(/couldn't be read/);
      expect(readFileSync(file, "utf8")).toBe(text);
      expect(readdirSync(dir)).toEqual(["projects.json"]);
    });
  }

  it("says so as a line a person can read, with a status the route answers", () => {
    writeFileSync(file, "{");
    let thrown: unknown;
    try { registry().projects(); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ status: 500, errorKey: "serverError.teamProject.unreadable" });
  });

  it("logs once where the file is and why, never what it holds", () => {
    writeFileSync(file, '{"version":1,"root":"/secret/place","projects":[');
    const broken = registry();
    for (let i = 0; i < 3; i++) expect(() => broken.projects()).toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(file);
    expect(logged[0]).not.toContain("/secret/place");
  });

  it("is not readable when the file is there but may not be opened", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    writeFileSync(file, JSON.stringify({ version: 1, projects: [project()] }));
    chmodSync(file, 0o000);
    try {
      const locked = registry();
      expect(locked.readable).toBe(false);
      expect(() => locked.add(project({ id: "p2" }))).toThrow(/couldn't be read/);
    } finally {
      chmodSync(file, 0o600);
    }
    expect(JSON.parse(readFileSync(file, "utf8")).projects).toHaveLength(1);
  });

  it("works again, without a restart, once the file is repaired", () => {
    writeFileSync(file, "{");
    const healing = registry();
    expect(() => healing.projects()).toThrow();
    writeFileSync(file, JSON.stringify({ version: 1, root: "/dramas", projects: [project()] }));
    expect(healing.projects()).toEqual([project()]);
    expect(healing.root()).toBe("/dramas");
    expect(healing.readable).toBe(true);
    healing.add(project({ id: "p2" }));
    expect(registry().projects()).toHaveLength(2);
  });
});
