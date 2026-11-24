import { describe, expect, it } from "vitest";
import type { BoardStageState } from "./types";
import { compactStageName } from "./stages";

const states = (each: Partial<Record<"brief" | "script" | "library" | "storyboard" | "post", BoardStageState>>): Record<"brief" | "script" | "library" | "storyboard" | "post", BoardStageState> =>
  ({ brief: "wait", script: "wait", library: "wait", storyboard: "wait", post: "wait", ...each });

describe("the stage the compact bar names", () => {
  it("names the stage in view, whichever it is", () => {
    for (const stage of ["brief", "script", "library", "storyboard", "post"] as const) expect(compactStageName(states({ post: "active" }), stage)).toBe(stage);
  });

  it("names the work in progress when the view is on no stage", () => {
    expect(compactStageName(states({ script: "done", library: "active", storyboard: "active" }), undefined)).toBe("library");
    expect(compactStageName(states({ brief: "done", post: "failed" }), undefined)).toBe("post");
  });

  it("names the stage last worked on when nothing is in progress, and the first when nothing has begun", () => {
    expect(compactStageName(states({ brief: "done", script: "done", library: "done" }), undefined)).toBe("library");
    expect(compactStageName(states({}), undefined)).toBe("brief");
  });
});
