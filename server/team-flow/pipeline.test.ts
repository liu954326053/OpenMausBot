import { describe, expect, it } from "vitest";

import type { FlowLineWire, FlowStage } from "../../shared/team-pipeline.ts";
import { lineProblem, memberStages, parentsOf, pipelineLines, placeIn, projectPipelineOf } from "./pipeline.ts";

const arrows = (lines: readonly FlowLineWire[]) => lines.map(({ from, to }) => `${from}>${to}`);
const line = (arrow: string): FlowLineWire => ({ from: arrow.split(">")[0]!, to: arrow.split(">")[1]! });

interface Drawn { stages?: Record<string, FlowStage[]>; added?: string[]; removed?: string[] }
const team = (members: string[], { stages = {}, added = [], removed = [] }: Drawn = {}) =>
  arrows(pipelineLines({ chiefId: "lead", members: ["lead", ...members], stages, added: added.map(line), removed: removed.map(line) }));

describe("the stages a member is recorded with", () => {
  it("keeps the pipeline's stages once each, in the pipeline's order", () => {
    expect(memberStages(["storyboard", "character", "storyboard"])).toEqual(["character", "storyboard"]);
  });

  it("leaves a member with a pipeline stage out of other, and never makes one the lead", () => {
    expect(memberStages(["other", "post"])).toEqual(["post"]);
    expect(memberStages(["lead", "script"])).toEqual(["script"]);
    expect(memberStages(["lead"])).toEqual(["other"]);
  });

  it("counts a member with no stage this version knows as other", () => {
    expect(memberStages([])).toEqual(["other"]);
    expect(memberStages(["dubbing", 7, null])).toEqual(["other"]);
  });
});

describe("a team's lines", () => {
  const drama = { 云舟: ["lead"], 砚青: ["script"], 墨白: ["character", "storyboard"], 青禾: ["post"] } satisfies Record<string, FlowStage[]>;

  it("runs the design's team 云舟, 砚青, 墨白, 青禾 in one line", () => {
    const lines = pipelineLines({ chiefId: "云舟", members: ["云舟", "砚青", "墨白", "青禾"], stages: drama, added: [], removed: [] });
    expect(arrows(lines)).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾"]);
  });

  it("adds the lines drawn by hand after the ones the stages give, and leaves out the ones removed by hand", () => {
    const stages: Record<string, FlowStage[]> = { w: ["script"], s: ["storyboard"], ops: ["other"] };
    expect(team(["w", "s", "ops"], { stages })).toEqual(["lead>w", "w>s", "lead>ops"]);
    expect(team(["w", "s", "ops"], { stages, added: ["s>ops", "lead>s"], removed: ["lead>ops"] })).toEqual(["lead>w", "w>s", "s>ops", "lead>s"]);
  });

  it("keeps a line drawn by hand in the stages' place when the stages give it too", () => {
    expect(team(["w", "s"], { stages: { w: ["script"], s: ["storyboard"] }, added: ["w>s"] })).toEqual(["lead>w", "w>s"]);
    expect(team(["w", "s"], { stages: { w: ["script"], s: ["storyboard"] }, added: ["w>s"], removed: ["w>s"] })).toEqual(["lead>w", "w>s"]);
  });

  it("draws no line to a bot outside the team, to itself or into the Chief", () => {
    expect(team(["a", "b"], { added: ["a>gone", "gone>b", "a>a", "a>lead", "a>b"] })).toEqual(["lead>a", "lead>b", "a>b"]);
  });

  it("never closes a loop: a line drawn by hand stays, and a stage's line that would close it is left out", () => {
    expect(team(["w", "s"], { stages: { w: ["script"], s: ["storyboard"] }, added: ["s>w"], removed: [] })).toEqual(["lead>w", "s>w"]);
    expect(team(["a", "b", "c"], { added: ["a>b", "b>c", "c>a"] })).toEqual(["lead>a", "lead>b", "lead>c", "a>b", "b>c"]);
  });

  it("leaves out the second of two stage lines that would loop between a member with two stages and the one between them", () => {
    expect(team(["w", "c"], { stages: { w: ["script", "storyboard"], c: ["character"] } })).toEqual(["lead>w", "w>c"]);
  });
});

describe("why a line cannot be drawn", () => {
  const lines = ["lead>w", "w>c", "c>s"].map(line);

  it("refuses a line to itself, into the Chief, and one that closes a loop", () => {
    expect(lineProblem(lines, "lead", "w", "w")).toBe("self");
    expect(lineProblem(lines, "lead", "s", "lead")).toBe("chief");
    expect(lineProblem(lines, "lead", "s", "w")).toBe("loop");
    expect(lineProblem(lines, "lead", "c", "w")).toBe("loop");
  });

  it("lets a second upstream be drawn", () => {
    expect(lineProblem(lines, "lead", "w", "s")).toBeNull();
    expect(lineProblem(lines, "lead", "lead", "s")).toBeNull();
  });
});

describe("where a bot stands", () => {
  const lines = ["lead>w", "w>c", "c>s", "w>s"].map(line);
  const stages: Record<string, FlowStage[]> = { lead: ["lead"], w: ["script"], c: ["character"], s: ["storyboard"] };

  it("names its stages, its upstream and downstream in the lines' order, and the team with the lead first", () => {
    expect(placeIn({ leadId: "lead", members: ["w", "lead", "c", "s"], stages, lines }, "s"))
      .toEqual({ stages: ["storyboard"], upstream: ["c", "w"], downstream: [], team: ["lead", "w", "c", "s"] });
    expect(placeIn({ leadId: "lead", members: ["w", "lead", "c", "s"], stages, lines }, "lead"))
      .toEqual({ stages: ["lead"], upstream: [], downstream: ["w"], team: ["lead", "w", "c", "s"] });
    expect(placeIn({ leadId: "lead", members: ["lead", "w"], stages, lines }, "stranger")).toBeNull();
  });

  it("answers the old tree with the first upstream as the superior, and the Chief for a member no line reaches", () => {
    expect(parentsOf(["lead", "w", "c", "s", "loose"], "lead", lines)).toEqual({ w: "lead", c: "w", s: "c", loose: "lead" });
  });
});

describe("a project's pipeline", () => {
  const studio = {
    chiefId: "chief",
    stages: { w: ["script"], c: ["character"], s: ["storyboard"], p: ["post"], ops: ["other"] } satisfies Record<string, FlowStage[]>,
    added: [] as FlowLineWire[], removed: [] as FlowLineWire[],
  };
  const copies = [{ id: "L", source: "chief" }, { id: "W", source: "w" }, { id: "C", source: "c" }, { id: "S", source: "s" }, { id: "P", source: "p" }, { id: "O", source: "ops" }];

  it("gives each copy its source's stages and draws the team's lines between the copies, the lead in the Chief's place", () => {
    const mapped = projectPipelineOf({ leadId: "L", bots: copies, team: studio });
    expect(mapped.stages).toEqual({ L: ["lead"], W: ["script"], C: ["character"], S: ["storyboard"], P: ["post"], O: ["other"] });
    expect(arrows(mapped.lines)).toEqual(["L>W", "W>C", "C>S", "S>P", "W>S", "L>O"]);
  });

  it("carries the lines drawn and removed by hand over to the copies", () => {
    const mapped = projectPipelineOf({ leadId: "L", bots: copies, team: { ...studio, added: [line("ops>p"), line("chief>p")], removed: [line("w>s"), line("chief>ops")] } });
    expect(arrows(mapped.lines)).toEqual(["L>W", "W>C", "C>S", "S>P", "O>P", "L>P"]);
  });

  it("joins the stages on either side of a member the project has no copy of", () => {
    const mapped = projectPipelineOf({ leadId: "L", bots: copies.filter((bot) => bot.id !== "C" && bot.id !== "S"), team: studio });
    expect(arrows(mapped.lines)).toEqual(["L>W", "W>P", "L>O"]);
  });

  it("puts a bot that follows no member, a second copy of the Chief and every bot of a project without a team under the lead as other", () => {
    const mapped = projectPipelineOf({ leadId: "L", bots: [...copies.slice(0, 2), { id: "extra" }, { id: "deputy", source: "chief" }], team: studio });
    expect(mapped.stages).toEqual({ L: ["lead"], W: ["script"], extra: ["other"], deputy: ["other"] });
    expect(arrows(mapped.lines)).toEqual(["L>W", "L>extra", "L>deputy"]);

    const alone = projectPipelineOf({ leadId: "L", bots: [{ id: "L" }, { id: "a" }, { id: "b" }], team: null });
    expect(alone.stages).toEqual({ L: ["lead"], a: ["other"], b: ["other"] });
    expect(arrows(alone.lines)).toEqual(["L>a", "L>b"]);
  });

  it("lets a lead that copies a member other than the Chief lead all the same, with that member's hand-drawn lines", () => {
    const mapped = projectPipelineOf({
      leadId: "W", bots: [{ id: "W", source: "w" }, { id: "S", source: "s" }, { id: "O", source: "ops" }],
      team: { ...studio, added: [line("w>ops"), line("s>w")] },
    });
    expect(mapped.stages).toEqual({ W: ["lead"], S: ["storyboard"], O: ["other"] });
    expect(arrows(mapped.lines)).toEqual(["W>S", "W>O"]);
  });

  it("gives two copies of one member the same stages and lines", () => {
    const mapped = projectPipelineOf({ leadId: "L", bots: [{ id: "L", source: "chief" }, { id: "W1", source: "w" }, { id: "W2", source: "w" }, { id: "S", source: "s" }], team: studio });
    expect(arrows(mapped.lines)).toEqual(["L>W1", "L>W2", "W1>S", "W2>S"]);
  });
});
