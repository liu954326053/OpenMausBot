import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { takeMainBotOutOfDepartments } from "./main-bot-department.ts";

const NOW = new Date(Date.UTC(2026, 10, 21, 8, 13, 37));
const BACKUP = "bots.json.bak.20261121T081337Z";

let dir: string;
let file: string;
let lines: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-main-bot-"));
  file = join(dir, "bots.json");
  lines = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const save = (bots: unknown[]) => writeFileSync(file, JSON.stringify(bots), { mode: 0o600 });
const saved = () => JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
const run = (write?: (path: string, text: string) => void) =>
  takeMainBotOutOfDepartments({ file, log: (line) => lines.push(line), now: () => NOW, ...(write ? { write } : {}) });

const main = { id: "main", name: "MagicBot", defaultBot: {}, section: "Sales", chiefOfStaff: true, managedSections: ["Marketing"], soul: "Help." };
const ada = { id: "ada", name: "Ada", section: "Sales", soul: "Sell.", tasks: [{ id: "t1", title: "Quotes" }] };
const scout = { id: "scout", name: "Scout", section: "Research" };

describe("taking the main bot out of a department when the server starts", () => {
  it("moves it to no department, keeps it the Chief where no other Chief is, and leaves everything else as it was", () => {
    save([main, ada, scout]);
    run();
    expect(saved()).toEqual([{ id: "main", name: "MagicBot", defaultBot: {}, chiefOfStaff: true, managedSections: ["Marketing"], soul: "Help." }, ada, scout]);
    expect(lines).toEqual([`main bot: MagicBot left the department Sales; bots.json was backed up to ${BACKUP}`]);
  });

  it("backs the file up first, as it was, readable by its owner alone", () => {
    save([main, ada]);
    const before = readFileSync(file, "utf8");
    run();
    expect(readFileSync(join(dir, BACKUP), "utf8")).toBe(before);
    expect(statSync(join(dir, BACKUP)).mode & 0o777).toBe(0o600);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("leaves the general area's own Chief as it is, and the main bot gives up being a Chief there", () => {
    const general = { id: "boss", name: "Boss", chiefOfStaff: true };
    save([main, general, ada]);
    run();
    expect(saved()).toEqual([{ id: "main", name: "MagicBot", defaultBot: {}, chiefOfStaff: false, soul: "Help." }, general, ada]);
    expect(lines).toEqual([`main bot: MagicBot left the department Sales and is no longer a Chief of Staff, since Boss already leads the general area; bots.json was backed up to ${BACKUP}`]);
  });

  it("counts only Chiefs of the general area: a department's Chief, or a Chief someone owns, stays out of it", () => {
    save([main, { id: "lead", name: "Lead", section: "Research", chiefOfStaff: true }, { id: "own", name: "Own", chiefOfStaff: true, createdBy: "kim@example.com" }]);
    run();
    expect(saved()[0]).toMatchObject({ chiefOfStaff: true, managedSections: ["Marketing"] });
  });

  it("does nothing, and says nothing, when the main bot is in no department", () => {
    save([{ ...main, section: undefined }, ada]);
    const before = readFileSync(file, "utf8");
    run();
    expect([readFileSync(file, "utf8"), readdirSync(dir), lines]).toEqual([before, ["bots.json"], []]);
  });

  it("does nothing, and says nothing, without a bots file", () => {
    run();
    expect([readdirSync(dir), lines]).toEqual([[], []]);
  });

  it("changes nothing when the new file cannot be written, says so, and does it at the next start", () => {
    save([main, ada]);
    const before = readFileSync(file, "utf8");
    run((path, text) => {
      if (path === file) throw new Error("the disk is full");
      writeFileSync(path, text, { mode: 0o600 });
    });
    expect([readFileSync(file, "utf8"), readdirSync(dir)]).toEqual([before, ["bots.json"]]);
    expect(lines).toEqual(["main bot: MagicBot stays in the department Sales until the next start: the disk is full"]);
    lines = [];
    run();
    expect(saved()[0]).not.toHaveProperty("section");
    expect(lines).toHaveLength(1);
  });

  it("changes nothing when the backup cannot be made", () => {
    save([main, ada]);
    const before = readFileSync(file, "utf8");
    run(() => { throw new Error("no room for the backup"); });
    expect([readFileSync(file, "utf8"), readdirSync(dir)]).toEqual([before, ["bots.json"]]);
    expect(lines).toEqual(["main bot: MagicBot stays in the department Sales until the next start: no room for the backup"]);
  });

  it("leaves a bots file it cannot read for the app to report, and says why it did not look", () => {
    writeFileSync(file, "{ not a list");
    run();
    expect([readFileSync(file, "utf8"), readdirSync(dir)]).toEqual(["{ not a list", ["bots.json"]]);
    expect(lines).toEqual([expect.stringMatching(/^main bot: bots\.json could not be read, so the main bot was not checked: /)]);
  });

  it("leaves a project's bots alone", () => {
    const copy = { id: "copy", name: "MagicBot copy", defaultBot: {}, section: "Season one", teamProject: { id: "p1", role: "lead" } };
    save([copy]);
    run();
    expect([saved(), lines]).toEqual([[copy], []]);
  });
});
