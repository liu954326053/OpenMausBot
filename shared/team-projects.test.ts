import { describe, expect, it } from "vitest";

import { TEAM_PROJECT_NAME_MAX, isTeamProjectName } from "./team-projects.ts";

describe("a project's name", () => {
  it("takes names a person would give a drama, in any script", () => {
    for (const name of ["霸总的替身新娘", "Season 2 - pilot", "第 3 集（重拍）", "a", "x".repeat(TEAM_PROJECT_NAME_MAX), "CONcert", "nulls", "com10", "v1.2 draft"]) {
      expect(isTeamProjectName(name), name).toBe(true);
    }
  });

  it("refuses what cannot be one folder's name on every platform", () => {
    for (const name of ["", " ", "a/b", "a\\b", "..", ".", ".hidden", "ends.", "what?", "a:b", "a*b", "\"q\"", "<a>", "a|b", "line\nbreak", "tab\there",
      "bell\u0007", "del\u007f", "c1\u0085", "sep\u2028", "x".repeat(TEAM_PROJECT_NAME_MAX + 1)]) {
      expect(isTeamProjectName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("refuses a name with spaces around it, so the folder and the department get the same name", () => {
    expect(isTeamProjectName(" drama")).toBe(false);
    expect(isTeamProjectName("drama ")).toBe(false);
  });

  it("refuses the device names Windows keeps, in any case and with an extension", () => {
    for (const name of ["CON", "con", "Prn", "AUX", "nul", "COM1", "com9", "LPT1", "lpt9", "COM¹", "NUL.txt", "con.tar.gz", "aux .md"]) {
      expect(isTeamProjectName(name), name).toBe(false);
    }
  });
});
