import { describe, expect, it } from "vitest";

import type { TeamFlowWire } from "../../shared/team-flow";
import { CARD_HEIGHT, CARD_WIDTH, GAP, HEADER_HEIGHT, TEAM_PADDING, teamSize } from "./team-canvas";
import { FLOW_COLUMN_GAP, flowLayout, flowShape, removableLines } from "./team-flow";

const flow = (parents: Record<string, string>): TeamFlowWire => ({ section: "Studio", chiefId: "sol", parents, placed: [] });
const bots = (...ids: string[]) => ids.map((id) => ({ id, name: id }));
const column = (depth: number) => TEAM_PADDING + depth * (CARD_WIDTH + FLOW_COLUMN_GAP);
const row = (index: number) => HEADER_HEIGHT + index * (CARD_HEIGHT + GAP);

describe("the tree a team's flow draws", () => {
  it("puts the Chief on the left and every member one column right of its superior, in the order given", () => {
    const layout = flowLayout(bots("sol", "story", "board", "video"), flow({ story: "sol", board: "sol", video: "board" }))!;
    expect(layout.cards).toEqual(expect.arrayContaining([
      { botId: "story", x: column(1), y: row(0) },
      { botId: "video", x: column(2), y: row(1) },
      { botId: "board", x: column(1), y: row(1) },
      { botId: "sol", x: column(0), y: row(0.5) },
    ]));
    expect(layout.width).toBe(TEAM_PADDING * 2 + 3 * CARD_WIDTH + 2 * FLOW_COLUMN_GAP);
    expect(layout.height).toBe(HEADER_HEIGHT + TEAM_PADDING + 2 * (CARD_HEIGHT + GAP) - GAP);
  });

  it("draws one line from each superior's right edge to its subordinate's left edge", () => {
    const layout = flowLayout(bots("sol", "story", "board", "video"), flow({ story: "sol", board: "sol", video: "board" }))!;
    const video = layout.links.find((link) => link.botId === "video")!;
    expect(video.superiorId).toBe("board");
    expect(video.points[0]).toEqual({ x: column(1) + CARD_WIDTH, y: row(1) + CARD_HEIGHT / 2 });
    expect(video.points.at(-1)).toEqual({ x: column(2), y: row(1) + CARD_HEIGHT / 2 });
    expect(layout.links.map((link) => link.botId).sort()).toEqual(["board", "story", "video"]);
  });

  it("keeps a team with no lines drawn as tall as the map drew it before, every member beside its Chief", () => {
    const layout = flowLayout(bots("sol", "a", "b", "c"), flow({ a: "sol", b: "sol", c: "sol" }))!;
    expect(layout.height).toBe(teamSize({ key: "Studio", name: "Studio", chiefs: bots("sol"), members: bots("a", "b", "c") }).height);
    expect(layout.cards.filter((card) => card.x === column(1)).map((card) => card.botId)).toEqual(["a", "b", "c"]);
  });

  it("puts a member the flow does not name, or whose superior is not on the map, under the Chief", () => {
    const layout = flowLayout(bots("sol", "new", "orphan"), flow({ orphan: "gone" }))!;
    expect(layout.links.map(({ botId, superiorId }) => [botId, superiorId])).toEqual([["new", "sol"], ["orphan", "sol"]]);
  });

  it("draws nothing for a team whose Chief is not on the map", () => {
    expect(flowLayout(bots("story"), flow({ story: "sol" }))).toBeNull();
  });

  it("never loops, even on lines that would", () => {
    const layout = flowLayout(bots("sol", "a", "b"), flow({ a: "b", b: "a" }))!;
    expect(layout.cards).toHaveLength(3);
    expect(new Set(layout.links.map((link) => link.botId))).toEqual(new Set(["a", "b"]));
  });

  it("lets the person remove only a line that does not come from the Chief", () => {
    const layout = flowLayout(bots("sol", "story", "board", "video"), flow({ story: "sol", board: "sol", video: "board" }))!;
    expect(removableLines(layout, "sol").map((link) => link.botId)).toEqual(["video"]);
  });

  it("changes its shape key when a team gains a member or a Chief, and not when nothing changes", () => {
    const before = flowShape([{ key: "Studio", chiefs: [{ id: "sol" }], members: [{ id: "a" }] }]);
    expect(flowShape([{ key: "Studio", chiefs: [{ id: "sol" }], members: [{ id: "a" }] }])).toBe(before);
    expect(flowShape([{ key: "Studio", chiefs: [{ id: "sol" }], members: [{ id: "a" }, { id: "b" }] }])).not.toBe(before);
    expect(flowShape([{ key: "Studio", chiefs: [{ id: "a" }], members: [{ id: "sol" }] }])).not.toBe(before);
  });
});
