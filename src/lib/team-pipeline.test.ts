import { describe, expect, it } from "vitest";

import { stageLines, type FlowLineWire, type FlowStage, type TeamPipelineWire } from "../../shared/team-pipeline";
import { CARD_HEIGHT, CARD_WIDTH, GAP, HEADER_HEIGHT, TEAM_PADDING } from "./team-canvas";
import { OTHER_INDENT, PIPELINE_COLUMN_GAP, cardStages, columnMates, laneIndexAmong, pipelineLayout, pipelineShape } from "./team-pipeline";

const bots = (...ids: string[]) => ids.map((id) => ({ id }));
const pipeline = (stages: Record<string, FlowStage[]>, lines?: FlowLineWire[], extra: Partial<TeamPipelineWire> = {}): TeamPipelineWire => ({
  section: "Studio", chiefId: "lead", stages: { lead: ["lead"], ...stages }, pending: [], manual: [],
  lines: lines ?? stageLines("lead", ["lead", ...Object.keys(stages)], stages), ...extra,
});
const row = (index: number) => HEADER_HEIGHT + index * (CARD_HEIGHT + GAP);
/** The left edge of a stage column; `indent` when `other` members stand under the lead. */
const column = (index: number, indent = 0) => TEAM_PADDING + indent + index * (CARD_WIDTH + PIPELINE_COLUMN_GAP);
const middle = (y: number) => y + CARD_HEIGHT / 2;
const place = (layout: NonNullable<ReturnType<typeof pipelineLayout>>, id: string) => {
  const { x, y, column: stands } = layout.cards.find((card) => card.botId === id)!;
  return { x, y, column: stands };
};
const lineOf = (layout: NonNullable<ReturnType<typeof pipelineLayout>>, from: string, to: string) => layout.lines.find((line) => line.from === from && line.to === to)!;

describe("the columns a team's pipeline stands in", () => {
  const drama = pipeline({ script: ["script"], art: ["character", "storyboard"], post: ["post"] });

  it("puts the lead first and every member in the column of its first stage, left to right, with no column for a stage nobody has", () => {
    const layout = pipelineLayout(bots("lead", "script", "art", "post"), drama)!;
    expect(place(layout, "lead")).toEqual({ x: column(0), y: row(0), column: "lead" });
    expect(place(layout, "script")).toEqual({ x: column(1), y: row(0), column: "script" });
    expect(place(layout, "art")).toEqual({ x: column(2), y: row(0), column: "character" });
    expect(place(layout, "post")).toEqual({ x: column(3), y: row(0), column: "post" });
    expect(layout.width).toBe(TEAM_PADDING * 2 + 4 * CARD_WIDTH + 3 * PIPELINE_COLUMN_GAP);
    expect(layout.height).toBe(HEADER_HEIGHT + TEAM_PADDING + CARD_HEIGHT);
  });

  it("stacks the members of one stage from the top, in the order the person keeps their cards", () => {
    const stages = { a: ["script"], b: ["character"], c: ["character"], d: ["character"] } satisfies Record<string, FlowStage[]>;
    const layout = pipelineLayout(bots("lead", "d", "a", "b", "c"), pipeline(stages))!;
    expect(["d", "b", "c"].map((id) => place(layout, id))).toEqual([0, 1, 2].map((index) => ({ x: column(2), y: row(index), column: "character" })));
    expect(place(layout, "a").y).toBe(row(0));
    expect(layout.height).toBe(HEADER_HEIGHT + TEAM_PADDING + 3 * (CARD_HEIGHT + GAP) - GAP);
    expect(columnMates(layout, "b")).toEqual(["d", "b", "c"]);
    expect(columnMates(layout, "lead")).toEqual(["lead"]);
  });

  it("stands `other` members under the lead, set in from it, and moves the stages clear of them", () => {
    const layout = pipelineLayout(bots("lead", "script", "ops", "voice"), pipeline({ script: ["script"], ops: ["other"], voice: ["other"] }))!;
    expect(place(layout, "ops")).toEqual({ x: TEAM_PADDING + OTHER_INDENT, y: row(1), column: "other" });
    expect(place(layout, "voice")).toEqual({ x: TEAM_PADDING + OTHER_INDENT, y: row(2), column: "other" });
    expect(place(layout, "script")).toEqual({ x: column(1, OTHER_INDENT), y: row(0), column: "script" });
    expect(layout.width).toBe(TEAM_PADDING * 2 + OTHER_INDENT + 2 * CARD_WIDTH + PIPELINE_COLUMN_GAP);
    expect(layout.height).toBe(HEADER_HEIGHT + TEAM_PADDING + 3 * (CARD_HEIGHT + GAP) - GAP);
  });

  it("treats a member the pipeline does not name as `other`, and draws nothing for a team whose lead is not on the map", () => {
    const layout = pipelineLayout(bots("lead", "new"), pipeline({}, []))!;
    expect(place(layout, "new").column).toBe("other");
    expect(pipelineLayout(bots("script"), drama)).toBeNull();
  });

  it("names the stages a card shows: the lead's, a member's in pipeline order, and nothing for `other`", () => {
    expect(cardStages(drama, "lead")).toEqual(["lead"]);
    expect(cardStages(pipeline({ art: ["storyboard", "other", "character"] }), "art")).toEqual(["character", "storyboard"]);
    expect(cardStages(pipeline({ ops: ["other"] }), "ops")).toEqual([]);
    expect(cardStages(drama, "stranger")).toEqual([]);
  });
});

describe("the lines a team's pipeline draws", () => {
  it("draws each line from its sender's right edge to its receiver's left edge, so a card can take several", () => {
    const stages = { a: ["script"], b: ["script"], art: ["character"] } satisfies Record<string, FlowStage[]>;
    const layout = pipelineLayout(bots("lead", "a", "b", "art"), pipeline(stages))!;
    expect(layout.lines.map(({ from, to }) => `${from}>${to}`).sort()).toEqual(["a>art", "b>art", "lead>a", "lead>b"]);
    const into = { x: column(2), y: middle(row(0)) };
    expect(lineOf(layout, "a", "art")).toMatchObject({ start: { x: column(1) + CARD_WIDTH, y: middle(row(0)) }, end: into });
    expect(lineOf(layout, "b", "art")).toMatchObject({ start: { x: column(1) + CARD_WIDTH, y: middle(row(1)) }, end: into });
    expect(lineOf(layout, "a", "art").path).not.toBe(lineOf(layout, "b", "art").path);
    expect(lineOf(layout, "b", "art").mid).toEqual({ x: column(2) - PIPELINE_COLUMN_GAP / 2, y: (middle(row(0)) + middle(row(1))) / 2 });
  });

  it("runs a line that passes a column through the space under the cards, never across one", () => {
    const stages = { script: ["script"], art: ["character"], board: ["storyboard"] } satisfies Record<string, FlowStage[]>;
    const layout = pipelineLayout(bots("lead", "script", "art", "board"), pipeline(stages))!;
    const past = lineOf(layout, "script", "board");
    const under = row(0) + CARD_HEIGHT + GAP / 2;
    expect(past.start).toEqual({ x: column(1) + CARD_WIDTH, y: middle(row(0)) });
    expect(past.end).toEqual({ x: column(3), y: middle(row(0)) });
    expect(past.mid).toEqual({ x: (column(2) + column(2) + CARD_WIDTH) / 2, y: under });
    expect(past.path).toContain(`L ${column(2) + CARD_WIDTH} ${under}`);
  });

  it("runs a line to a card further left, or in its own column, round through the space between the rows", () => {
    const stages = { a: ["script"], b: ["script"], ops: ["other"] } satisfies Record<string, FlowStage[]>;
    const layout = pipelineLayout(bots("lead", "a", "b", "ops"), pipeline(stages, [{ from: "a", to: "b" }, { from: "b", to: "ops" }]))!;
    expect(lineOf(layout, "a", "b")).toMatchObject({
      start: { x: column(1, OTHER_INDENT) + CARD_WIDTH, y: middle(row(0)) }, end: { x: column(1, OTHER_INDENT), y: middle(row(1)) },
      mid: { x: column(1, OTHER_INDENT) + CARD_WIDTH / 2, y: row(1) - GAP / 2 },
    });
    expect(lineOf(layout, "b", "ops")).toMatchObject({ end: { x: TEAM_PADDING + OTHER_INDENT, y: middle(row(1)) }, mid: { y: row(2) - GAP / 2 } });
  });

  it("draws the lead's line to an `other` member down from the lead's foot, each with a stretch of its own to select", () => {
    const layout = pipelineLayout(bots("lead", "ops", "voice"), pipeline({ ops: ["other"], voice: ["other"] }))!;
    const trunk = TEAM_PADDING + OTHER_INDENT / 2;
    expect(lineOf(layout, "lead", "ops")).toMatchObject({ start: { x: trunk, y: row(0) + CARD_HEIGHT }, end: { x: TEAM_PADDING + OTHER_INDENT, y: middle(row(1)) } });
    expect(lineOf(layout, "lead", "voice").start).toEqual({ x: trunk, y: row(0) + CARD_HEIGHT });
    expect(lineOf(layout, "lead", "voice").hit).toBe(`M ${trunk} ${middle(row(1))} L ${trunk} ${middle(row(2))} L ${TEAM_PADDING + OTHER_INDENT} ${middle(row(2))}`);
    expect(lineOf(layout, "lead", "ops").hit).not.toBe(lineOf(layout, "lead", "voice").hit);
  });

  it("leaves out a line to or from a bot that is not on the map, and one from a bot to itself", () => {
    const layout = pipelineLayout(bots("lead", "script"), pipeline({ script: ["script"] }, [
      { from: "lead", to: "script" }, { from: "script", to: "gone" }, { from: "gone", to: "script" }, { from: "script", to: "script" },
    ]))!;
    expect(layout.lines.map(({ from, to }) => `${from}>${to}`)).toEqual(["lead>script"]);
  });
});

describe("keeping a card where the person put it in its column", () => {
  it("answers where a card goes among all the team's cards so that it takes a place among its column's, and no other card changes order", () => {
    const lane = ["x", "c", "y", "d", "e"];
    expect(laneIndexAmong(lane, ["c", "d"], "e", 0)).toBe(1);
    expect(laneIndexAmong(lane, ["c", "d"], "e", 1)).toBe(3);
    expect(laneIndexAmong(lane, ["c", "d"], "e", 2)).toBe(4);
    expect(laneIndexAmong(["n", "c", "d", "e"], ["c", "d"], "e", 1)).toBe(2);
    expect(laneIndexAmong(lane, ["d", "e"], "c", 5)).toBe(4);
    expect(laneIndexAmong(lane, [], "y", 0)).toBe(2);
  });
});

it("changes its shape key when a team gains a member or a lead, and not when nothing changes", () => {
  const before = pipelineShape([{ key: "Studio", chiefs: [{ id: "sol" }], members: [{ id: "a" }] }]);
  expect(pipelineShape([{ key: "Studio", chiefs: [{ id: "sol" }], members: [{ id: "a" }] }])).toBe(before);
  expect(pipelineShape([{ key: "Studio", chiefs: [{ id: "sol" }], members: [{ id: "a" }, { id: "b" }] }])).not.toBe(before);
  expect(pipelineShape([{ key: "Studio", chiefs: [{ id: "a" }], members: [{ id: "sol" }] }])).not.toBe(before);
});
