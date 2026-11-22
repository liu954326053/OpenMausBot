import { describe, expect, it } from "vitest";
import { flowParents } from "./tree.ts";

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
