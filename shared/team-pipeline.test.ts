import { describe, expect, it } from "vitest";

import { stageLines, type FlowStage } from "./team-pipeline.ts";

const lines = (members: string[], stages: Record<string, FlowStage[]>) => stageLines("lead", ["lead", ...members], stages).map(({ from, to }) => `${from}>${to}`);

describe("the lines a team's stages give", () => {
  it("runs lead, script, character, storyboard, post, and script to storyboard too", () => {
    expect(lines(["w", "c", "s", "p"], { w: ["script"], c: ["character"], s: ["storyboard"], p: ["post"] }))
      .toEqual(["lead>w", "w>c", "c>s", "s>p", "w>s"]);
  });

  it("keeps one node for a member with two stages, and skips a stage nobody has", () => {
    expect(lines(["w", "art", "p"], { w: ["script"], art: ["character", "storyboard"], p: ["post"] })).toEqual(["lead>w", "w>art", "art>p"]);
    expect(lines(["s", "p"], { s: ["storyboard"], p: ["post"] })).toEqual(["lead>s", "s>p"]);
  });

  it("sends a stage with two members to every member of the next", () => {
    expect(lines(["w1", "w2", "s"], { w1: ["script"], w2: ["script"], s: ["storyboard"] })).toEqual(["lead>w1", "lead>w2", "w1>s", "w2>s"]);
  });

  it("puts a member outside the pipeline, judged or not, under the lead alone", () => {
    expect(lines(["w", "ops", "new"], { w: ["script"], ops: ["other"] })).toEqual(["lead>w", "lead>ops", "lead>new"]);
    expect(lines(["a", "b"], {})).toEqual(["lead>a", "lead>b"]);
  });
});
