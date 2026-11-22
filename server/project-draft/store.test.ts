import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { draftRefusalOf } from "./refusal.ts";
import { ProjectTimelines, type WrittenDraft } from "./store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function timelines() {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-timelines-"));
  dirs.push(dataDir);
  const lines: string[] = [];
  return { dir: join(dataDir, "project-timelines"), lines, store: new ProjectTimelines(join(dataDir, "project-timelines"), (line) => lines.push(line)) };
}

const DRAFT: WrittenDraft = {
  name: "Bride", number: 1, folder: "/drafts/Bride", draftId: "D-1", createdUs: 1_000, writtenAt: 5, firstWrittenAt: 4, fileHash: "abc", clipsHash: "def",
};

describe("a project's stored timeline", () => {
  it("is empty until something is saved, and makes no file by being read", () => {
    const { store, dir } = timelines();
    expect(store.read("p1")).toEqual({ order: [], leftOut: [] });
    expect(() => statSync(dir)).toThrow();
  });

  it("keeps the order, the shots left out and the draft written, each project in its own private file", () => {
    const { store, dir } = timelines();
    store.write("p1", { order: ["s2", "s1"], leftOut: ["s3"], draft: DRAFT });
    store.write("p2", { order: ["s9"], leftOut: [] });
    expect(new ProjectTimelines(dir, () => undefined).read("p1")).toEqual({ order: ["s2", "s1"], leftOut: ["s3"], draft: DRAFT });
    expect(store.read("p2")).toEqual({ order: ["s9"], leftOut: [] });
    if (process.platform !== "win32") expect(statSync(join(dir, "p1.json")).mode & 0o777).toBe(0o600);
  });

  it("leaves a file it cannot read as it is, and refuses to read or replace it", () => {
    const { store, dir, lines } = timelines();
    store.write("p1", { order: ["s1"], leftOut: [] });
    for (const broken of ["{ not json", JSON.stringify({ version: 1, projectId: "another", order: [], leftOut: [] }), JSON.stringify({ version: 1, projectId: "p1", order: "s1" })]) {
      writeFileSync(join(dir, "p1.json"), broken);
      expect(draftRefusalOf((() => { try { store.read("p1"); } catch (error) { return error; } })())).toMatchObject({ status: 500, body: { errorKey: "serverError.projectDraft.unreadable" } });
      expect(() => store.write("p1", { order: [], leftOut: [] })).toThrow();
      expect(readFileSync(join(dir, "p1.json"), "utf8")).toBe(broken);
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(dir);
  });

  it("answers no project for an id that could name another file", () => {
    const { store } = timelines();
    for (const id of ["../p1", "a/b", "", "p 1"]) {
      expect(draftRefusalOf((() => { try { store.read(id); } catch (error) { return error; } })()), id).toMatchObject({ status: 404 });
    }
  });
});
