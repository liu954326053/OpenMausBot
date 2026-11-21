import { describe, expect, it } from "vitest";
import { compactLines, flowParents, lineProblem, projectFlowParents, withLine } from "./tree.ts";

describe("flowParents", () => {
  it("puts every member nobody placed under the Chief", () => {
    expect(flowParents(["chief", "a", "b"], "chief", {})).toEqual({ a: "chief", b: "chief" });
  });

  it("keeps a placed member under its superior", () => {
    expect(flowParents(["chief", "a", "b"], "chief", { b: "a" })).toEqual({ a: "chief", b: "a" });
  });

  it("follows a gone superior's own line up, and the Chief when that runs out", () => {
    const stored = { c: "b", b: "a", d: "gone" };
    expect(flowParents(["chief", "a", "c", "d"], "chief", stored)).toEqual({ a: "chief", c: "a", d: "chief" });
  });

  it("ignores the Chief's own line and lines of bots that are not members", () => {
    expect(flowParents(["chief", "a"], "chief", { chief: "a", outsider: "a" })).toEqual({ a: "chief" });
  });

  it("breaks a loop in a hand-edited file by putting the member that closes it under the Chief", () => {
    const parents = flowParents(["chief", "a", "b", "c"], "chief", { a: "b", b: "a", c: "c" });
    expect(parents.c).toBe("chief");
    expect([parents.a, parents.b].filter((superior) => superior === "chief")).toHaveLength(1);
    for (const start of ["a", "b", "c"]) {
      const seen = new Set<string>();
      for (let at: string | undefined = start; at && at !== "chief"; at = parents[at]) {
        expect(seen.has(at)).toBe(false);
        seen.add(at);
      }
    }
  });
});

describe("lineProblem", () => {
  const parents = { a: "chief", b: "a", c: "b" };

  it("allows placing a member under any member that is not below it", () => {
    expect(lineProblem(parents, "chief", "c", "a")).toBeNull();
    expect(lineProblem(parents, "chief", "a", "chief")).toBeNull();
  });

  it("refuses the Chief as anyone's subordinate", () => {
    expect(lineProblem(parents, "chief", "chief", "a")).toBe("chief");
  });

  it("refuses a bot as its own superior", () => {
    expect(lineProblem(parents, "chief", "b", "b")).toBe("self");
  });

  it("refuses a line that would make a loop", () => {
    expect(lineProblem(parents, "chief", "a", "c")).toBe("loop");
    expect(lineProblem(parents, "chief", "b", "c")).toBe("loop");
  });
});

describe("withLine", () => {
  it("replaces a member's superior", () => {
    expect(withLine({ c: "a" }, "chief", "c", "b")).toEqual({ c: "b" });
  });

  it("stores nothing for a member under the Chief, by choice or by taking its line away", () => {
    expect(withLine({ c: "a" }, "chief", "c", "chief")).toEqual({});
    expect(withLine({ c: "a", d: "c" }, "chief", "c", null)).toEqual({ d: "c" });
  });
});

describe("compactLines", () => {
  it("moves a deleted member's subordinates under its former superior", () => {
    expect(compactLines(["chief", "a", "c", "d"], "chief", { b: "a", c: "b", d: "b" })).toEqual({ c: "a", d: "a" });
  });

  it("moves them under the Chief when the member that left was under the Chief", () => {
    expect(compactLines(["chief", "c"], "chief", { c: "b" })).toEqual({});
  });

  it("drops the line of a member that became the Chief and keeps its subordinates under it", () => {
    const stored = { next: "a", x: "next", y: "a" };
    expect(compactLines(["next", "old", "a", "x", "y"], "next", stored)).toEqual({ y: "a" });
    expect(flowParents(["next", "old", "a", "x", "y"], "next", stored)).toEqual({ old: "next", a: "next", x: "next", y: "a" });
  });
});

describe("projectFlowParents", () => {
  const team = { chiefId: "chief", parents: { story: "chief", script: "story", board: "chief", video: "board" } };
  const copy = (id: string, source?: string) => ({ id, ...(source ? { source } : {}) });

  it("maps the team's flow onto the copies through each copy's source", () => {
    const bots = [copy("lead", "chief"), copy("story2", "story"), copy("script2", "script"), copy("board2", "board"), copy("video2", "video")];
    expect(projectFlowParents({ leadId: "lead", bots, team })).toEqual({
      story2: "lead", script2: "story2", board2: "lead", video2: "board2",
    });
  });

  it("skips a superior the project has no copy of and takes the nearest one above it", () => {
    const bots = [copy("lead", "chief"), copy("script2", "script"), copy("video2", "video")];
    expect(projectFlowParents({ leadId: "lead", bots, team })).toEqual({ script2: "lead", video2: "lead" });
  });

  it("puts a bot whose source is not in the flow, or that has none, under the lead", () => {
    const bots = [copy("lead", "chief"), copy("left2", "left"), copy("own")];
    expect(projectFlowParents({ leadId: "lead", bots, team })).toEqual({ left2: "lead", own: "lead" });
  });

  it("puts every bot of a project without a team under its lead", () => {
    const bots = [copy("lead"), copy("a"), copy("b", "story")];
    expect(projectFlowParents({ leadId: "lead", bots, team: null })).toEqual({ a: "lead", b: "lead" });
  });

  it("keeps the lead the root when it is not the Chief's copy", () => {
    const bots = [copy("lead", "board"), copy("chief2", "chief"), copy("video2", "video"), copy("script2", "script"), copy("story2", "story")];
    expect(projectFlowParents({ leadId: "lead", bots, team })).toEqual({
      chief2: "lead", video2: "lead", story2: "chief2", script2: "story2",
    });
  });
});
