import { describe, expect, it } from "vitest";

import { judgedStages } from "./stages.ts";

describe("the stages a judge may give a member", () => {
  it("keeps the pipeline's stages, once each and in pipeline order", () => {
    expect(judgedStages(["storyboard", "character"])).toEqual(["character", "storyboard"]);
    expect(judgedStages(["post", "script", "post"])).toEqual(["script", "post"]);
  });

  it("is other when no pipeline stage is named", () => {
    expect(judgedStages([])).toEqual(["other"]);
    expect(judgedStages(["other"])).toEqual(["other"]);
    expect(judgedStages(["director", 3, null])).toEqual(["other"]);
    expect(judgedStages("script")).toEqual(["other"]);
    expect(judgedStages(undefined)).toEqual(["other"]);
  });

  it("never gives lead, and drops other beside a pipeline stage", () => {
    expect(judgedStages(["lead"])).toEqual(["other"]);
    expect(judgedStages(["lead", "script", "other"])).toEqual(["script"]);
  });
});
