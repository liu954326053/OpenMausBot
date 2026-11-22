import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFlowFile, storedPipeline, writeFlowFile, type StoredPipeline } from "./file.ts";

let dir = "";
let file = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-flow-file-"));
  file = join(dir, "data", "team-flows.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const studio: StoredPipeline = {
  stages: { w: ["script"], art: ["character", "storyboard"], ops: ["other"] },
  judged: { w: "f1", art: "f2", ops: "f3" },
  manual: ["ops"],
  added: [{ from: "art", to: "ops" }],
  removed: [{ from: "chief", to: "ops" }],
};

describe("team-flows.json", () => {
  it("reads a file that is not there as no team's pipeline, and writes over nothing", () => {
    expect(readFlowFile(file)).toEqual({ readable: true, teams: {}, upgraded: false, text: null });
  });

  it("reads back what it wrote, as version 2, in a file only its owner reads", () => {
    const text = writeFlowFile(file, { key: studio });
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(JSON.parse(text)).toEqual({ version: 2, teams: { key: studio } });
    expect(readFlowFile(file)).toEqual({ readable: true, teams: { key: studio }, upgraded: false, text });
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "data")).mode & 0o777).toBe(0o700);
    }
  });

  it("takes a team with nothing but stages, and leaves the rest empty", () => {
    expect(storedPipeline({ stages: { w: ["post"] } })).toEqual({ stages: { w: ["post"] }, judged: {}, manual: [], added: [], removed: [] });
  });

  it("upgrades version 1: a member placed under a superior keeps that line as one drawn by hand and is manual", () => {
    const text = JSON.stringify({ version: 1, teams: { key: { video: "board", sound: "board" }, empty: {} } });
    writeFileSync(join(dir, "old.json"), text);
    expect(readFlowFile(join(dir, "old.json"))).toEqual({
      readable: true, upgraded: true, text,
      teams: {
        key: { stages: {}, judged: {}, manual: ["video", "sound"], added: [{ from: "board", to: "video" }, { from: "board", to: "sound" }], removed: [] },
        empty: { stages: {}, judged: {}, manual: [], added: [], removed: [] },
      },
    });
  });

  it.each([
    ["text that is not JSON", "{ not json"],
    ["a version it does not know", JSON.stringify({ version: 3, teams: {} })],
    ["a stage it does not know", JSON.stringify({ version: 2, teams: { key: { stages: { w: ["dubbing"] } } } })],
    ["the lead as a member's stage", JSON.stringify({ version: 2, teams: { key: { stages: { w: ["lead"] } } } })],
    ["a line without an end", JSON.stringify({ version: 2, teams: { key: { added: [{ from: "a" }] } } })],
    ["a member list that is not a list", JSON.stringify({ version: 2, teams: { key: { manual: "w" } } })],
    ["a version 1 line to nobody", JSON.stringify({ version: 1, teams: { key: { video: "" } } })],
  ])("cannot read %s, and keeps the text it found", (_what, text) => {
    writeFileSync(join(dir, "bad.json"), text);
    expect(readFlowFile(join(dir, "bad.json"))).toEqual({ readable: false, problem: expect.any(String), text });
  });
});
