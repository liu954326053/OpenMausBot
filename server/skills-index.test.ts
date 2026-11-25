import { describe, expect, it } from "vitest";

import { dedupeSkillEntries, renderSkillsIndex } from "./skills-index.ts";

const entry = (name: string, source: "own" | "library" | "computer" | "project" = "library", description = `Does ${name}.`) =>
  ({ name, description, source });

describe("the skills index in a turn's prompt", () => {
  it("names each skill once, with one line of what it does and where it came from", () => {
    const text = renderSkillsIndex([entry("cut-trailer"), entry("beat-sheet", "own")]);
    expect(text).toContain("- cut-trailer (the skills library): Does cut-trailer.");
    expect(text).toContain("- beat-sheet (your own): Does beat-sheet.");
    expect(text).toContain("Read one in full with the skill tool");
  });

  it("keeps the full SKILL.md out of the prompt", () => {
    const text = renderSkillsIndex([{ ...entry("cut-trailer"), description: "Cuts a trailer." }]);
    expect(text).not.toContain("---\nname:");
    expect(text).not.toContain("Do the thing.");
  });

  it("collapses a name two sources answer to, the nearer source winning", () => {
    const entries = [entry("shared-name", "own"), entry("shared-name", "library"), entry("shared-name", "project")];
    expect(dedupeSkillEntries(entries)).toEqual([entry("shared-name", "own")]);
    expect(renderSkillsIndex(entries).match(/^- shared-name /gm)).toHaveLength(1);
  });

  it("says how many it left out, within one budget", () => {
    const many = Array.from({ length: 70 }, (_, i) => entry(`skill-${String(i).padStart(2, "0")}`, "own"));
    const text = renderSkillsIndex(many);
    expect(text.match(/^- skill-\d{2} /gm)).toHaveLength(60);
    expect(text).toContain("10 more skills are not listed here");
    expect(text).toContain("skill tool");
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(8_000);
  });

  it("adds the skills a bot's own list left out to the count", () => {
    expect(renderSkillsIndex([entry("only")], { unlisted: 3 })).toContain("3 more skills are not listed here");
    expect(renderSkillsIndex([], { unlisted: 4 })).toContain("4 more skills are not listed here");
    expect(renderSkillsIndex([], { unlisted: 1 })).toContain("1 more skill is not listed here");
  });

  it("is empty when nothing is on", () => {
    expect(renderSkillsIndex([])).toBe("");
    expect(renderSkillsIndex([], { unlisted: 0 })).toBe("");
  });

  it("truncates a long description to one bounded line", () => {
    const text = renderSkillsIndex([{ ...entry("wordy"), description: "x".repeat(900) }]);
    expect(text).toContain("- wordy (the skills library): ");
    expect(text.length).toBeLessThan(600);
    expect(text).toContain("\n\nSkills:\n");
  });
});
