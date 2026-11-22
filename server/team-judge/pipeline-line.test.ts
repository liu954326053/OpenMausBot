import { describe, expect, it } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import { pipelineOrder } from "./pipeline-line.ts";

const order = (stages: Record<string, FlowStage[]>, chief = "lead") => pipelineOrder(chief, [chief, ...Object.keys(stages)], stages);

describe("a pipeline as one line", () => {
  it("puts the members in the order work passes through them", () => {
    expect(order({ yanqing: ["script"], mobai: ["character", "storyboard"], qinghe: ["post"] })).toEqual({ order: [["yanqing"], ["mobai"], ["qinghe"]], outside: [] });
    expect(order({ editor: ["post"], boarder: ["storyboard"], designer: ["character"], writer: ["script"] }))
      .toEqual({ order: [["writer"], ["designer"], ["boarder"], ["editor"]], outside: [] });
  });

  it("puts the members of one stage side by side, and passes over a stage nobody has", () => {
    expect(order({ ann: ["script"], bo: ["script"], cy: ["storyboard"], di: ["post"], ed: ["post"] }))
      .toEqual({ order: [["ann", "bo"], ["cy"], ["di", "ed"]], outside: [] });
  });

  it("sets apart the members with no stage of the pipeline", () => {
    expect(order({ writer: ["script"], ops: ["other"], voice: [], editor: ["post"] })).toEqual({ order: [["writer"], ["editor"]], outside: ["ops", "voice"] });
    expect(order({ research: ["other"], ops: ["other"] })).toEqual({ order: [], outside: ["research", "ops"] });
  });

  it("names every member once even when the stages send work both ways between two members", () => {
    const { order: layers, outside } = order({ ann: ["script", "storyboard"], bo: ["character"], cy: ["post"] });
    expect(layers.flat().sort()).toEqual(["ann", "bo", "cy"]);
    expect(outside).toEqual([]);
  });
});
