import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkTeamProjectsRoot, isInsideFolder } from "./root.ts";

let base: string;
let dataDir: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "omb-projects-root-")));
  dataDir = join(base, "app-data");
  mkdirSync(dataDir);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the folder a person chooses for their projects", () => {
  it("is taken when it is an existing folder outside the app's data, as its full path", () => {
    const dramas = join(base, "dramas");
    mkdirSync(dramas);
    expect(checkTeamProjectsRoot(dramas, dataDir)).toEqual({ ok: true, root: dramas });
    expect(checkTeamProjectsRoot(`${dramas}/`, dataDir)).toEqual({ ok: true, root: dramas });
    expect(checkTeamProjectsRoot(`  ${join(dramas, "..", "dramas")} `, dataDir)).toEqual({ ok: true, root: dramas });
  });

  it("must be a full path", () => {
    for (const path of ["dramas", "./dramas", "~/dramas", "", "   ", null, 7, undefined, { path: "/x" }]) {
      expect(checkTeamProjectsRoot(path, dataDir), JSON.stringify(path)).toEqual({ ok: false, error: "serverError.teamProject.rootNotAbsolute" });
    }
  });

  it("must be there, and be a folder", () => {
    expect(checkTeamProjectsRoot(join(base, "nowhere"), dataDir)).toEqual({ ok: false, error: "serverError.teamProject.rootNotFolder" });
    const file = join(base, "notes.txt");
    writeFileSync(file, "x");
    expect(checkTeamProjectsRoot(file, dataDir)).toEqual({ ok: false, error: "serverError.teamProject.rootNotFolder" });
  });

  it("must be one the app can save into", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const locked = join(base, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      expect(checkTeamProjectsRoot(locked, dataDir)).toEqual({ ok: false, error: "serverError.teamProject.rootReadOnly" });
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it("may not be the app's data folder or anything inside it", () => {
    const inside = join(dataDir, "workspaces", "bot-1");
    mkdirSync(inside, { recursive: true });
    for (const path of [dataDir, `${dataDir}/`, inside, join(dataDir, "workspaces", "..", "workspaces")]) {
      expect(checkTeamProjectsRoot(path, dataDir), path).toEqual({ ok: false, error: "serverError.teamProject.rootInData" });
    }
  });

  it("may not be a link that leads into the app's data folder", () => {
    if (process.platform === "win32") return;
    mkdirSync(join(dataDir, "workspaces"));
    const link = join(base, "looks-harmless");
    symlinkSync(join(dataDir, "workspaces"), link);
    expect(checkTeamProjectsRoot(link, dataDir)).toEqual({ ok: false, error: "serverError.teamProject.rootInData" });
  });

  it("is checked against where the app's data really is, when that is reached through a link", () => {
    if (process.platform === "win32") return;
    const alias = join(base, "data-alias");
    symlinkSync(dataDir, alias);
    const inside = join(dataDir, "workspaces");
    mkdirSync(inside);
    expect(checkTeamProjectsRoot(inside, alias)).toEqual({ ok: false, error: "serverError.teamProject.rootInData" });
  });

  it("may sit next to the data folder, even with a name that starts the same", () => {
    const sibling = join(base, "app-data-projects");
    mkdirSync(sibling);
    expect(checkTeamProjectsRoot(sibling, dataDir)).toEqual({ ok: true, root: sibling });
  });

  it("may hold the data folder: only the other way round is refused", () => {
    expect(checkTeamProjectsRoot(base, dataDir)).toEqual({ ok: true, root: base });
  });
});

describe("isInsideFolder", () => {
  it("counts the folder itself and what is under it, and nothing beside it", () => {
    expect(isInsideFolder("/a/b", "/a/b")).toBe(true);
    expect(isInsideFolder("/a/b/c/d", "/a/b")).toBe(true);
    expect(isInsideFolder("/a/bc", "/a/b")).toBe(false);
    expect(isInsideFolder("/a", "/a/b")).toBe(false);
    expect(isInsideFolder("/x/y", "/a/b")).toBe(false);
  });
});
