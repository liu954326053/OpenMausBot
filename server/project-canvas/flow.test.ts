import { describe, expect, it } from "vitest";

import { botsAt, canvasFlow } from "./flow.ts";

const project = { botIds: ["lead", "writer", "boards", "editor", "voice"], leadBotId: "lead" };

describe("a project's bots as its pipeline has them", () => {
  it("gives every bot the pipeline's stages and keeps the lines between the project's bots, several into one bot", () => {
    const flow = canvasFlow(project, {
      stages: { lead: ["lead"], writer: ["script"], boards: ["character", "storyboard"], editor: ["post"], voice: ["other"], elsewhere: ["script"] },
      lines: [
        { from: "lead", to: "writer" }, { from: "writer", to: "boards" }, { from: "boards", to: "editor" }, { from: "writer", to: "editor" },
        { from: "lead", to: "voice" }, { from: "elsewhere", to: "boards" }, { from: "writer", to: "writer" }, { from: "lead", to: "writer" },
      ],
    });
    expect(flow.stages).toEqual({ lead: ["lead"], writer: ["script"], boards: ["character", "storyboard"], editor: ["post"], voice: ["other"] });
    expect(flow.lines).toEqual([
      { from: "lead", to: "writer" }, { from: "writer", to: "boards" }, { from: "boards", to: "editor" }, { from: "writer", to: "editor" }, { from: "lead", to: "voice" },
    ]);
    expect(botsAt(flow, "storyboard")).toEqual(["boards"]);
    expect(botsAt(flow, "post")).toEqual(["editor"]);
  });

  it("has a bot the pipeline does not know as other, under the lead, and the lead as the lead whatever the pipeline says", () => {
    const flow = canvasFlow(project, { stages: { lead: ["script"], writer: ["script", "lead"] }, lines: [{ from: "writer", to: "lead" }] });
    expect(flow.stages).toEqual({ lead: ["lead"], writer: ["script"], boards: ["other"], editor: ["other"], voice: ["other"] });
    expect(flow.lines).toEqual([{ from: "lead", to: "boards" }, { from: "lead", to: "editor" }, { from: "lead", to: "voice" }]);
  });

  it("draws no line from a lead that left the project", () => {
    const flow = canvasFlow({ botIds: ["writer", "boards"], leadBotId: "lead" }, { stages: {}, lines: [] });
    expect(flow.stages).toEqual({ writer: ["other"], boards: ["other"] });
    expect(flow.lines).toEqual([]);
  });
});
