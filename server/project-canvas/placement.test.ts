import { describe, expect, it } from "vitest";

import type { CanvasDocument, CanvasNode, CanvasNodeCreator } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { CanvasFlow } from "./flow.ts";
import type { CanvasFrame } from "./ops.ts";
import { COLUMN_GAP, defaultBotFrames, LANE_GAP, NODE_GAP, placeAfter, placeForActor } from "./placement.ts";

const WRITER: CanvasNodeCreator = { kind: "bot", botId: "writer" };

function node(id: string, x: number, y: number, patch: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: "text", title: id, position: { x, y }, width: 340, height: 240, createdBy: { kind: "person" }, ...patch };
}

function canvas(nodes: CanvasNode[] = [], connections: CanvasDocument["connections"] = []): CanvasDocument {
  return { projectId: "p1", revision: 1, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" };
}

describe("where bots sit when nobody placed them", () => {
  const flow = (stages: Record<string, FlowStage[]>, leadBotId = "lead"): CanvasFlow => ({ botIds: Object.keys(stages), leadBotId, stages, lines: [] });
  const at = (frames: Map<string, CanvasFrame>, id: string) => frames.get(`bot:${id}`)!.position;

  it("is a column for each stage that has a bot, from the lead to post, the bots of one stage one below the other", () => {
    const frames = defaultBotFrames(flow({ lead: ["lead"], editor: ["post"], writer: ["script"], faces: ["character"], boards: ["storyboard"], frames: ["storyboard"] }));
    expect(at(frames, "lead")).toEqual({ x: 0, y: 0 });
    const columns = ["lead", "writer", "faces", "boards", "editor"].map((id) => at(frames, id).x);
    expect(columns).toEqual([...columns].sort((a, b) => a - b));
    expect(new Set(columns).size).toBe(5);
    expect(["writer", "faces", "boards", "editor"].map((id) => at(frames, id).y)).toEqual([0, 0, 0, 0]);
    expect(at(frames, "frames")).toEqual({ x: at(frames, "boards").x, y: 180 + 60 });
    expect(frames.get("bot:lead")).toMatchObject({ width: 300, height: 180 });
  });

  it("stands the columns of a project that has made nothing yet close together", () => {
    const frames = defaultBotFrames(flow({ lead: ["lead"], writer: ["script"], faces: ["character"], boards: ["storyboard"], editor: ["post"] }));
    expect(["lead", "writer", "faces", "boards", "editor"].map((id) => at(frames, id).x)).toEqual([0, 1, 2, 3, 4].map((column) => column * (300 + COLUMN_GAP)));
  });

  it("puts a bot with several stages in the column of its first, and skips a stage nobody has", () => {
    const frames = defaultBotFrames(flow({ lead: ["lead"], boards: ["character", "storyboard"], editor: ["post"] }));
    expect(at(frames, "boards")).toEqual({ x: 300 + COLUMN_GAP, y: 0 });
    expect(at(frames, "editor")).toEqual({ x: 2 * (300 + COLUMN_GAP), y: 0 });
  });

  it("moves a column right past what the bots before it made: the script, a shot's row of the shot, its creation node and its take", () => {
    const stages = { lead: ["lead"], writer: ["script"], boards: ["storyboard"], editor: ["post"] } satisfies Record<string, FlowStage[]>;
    const writerX = 300 + COLUMN_GAP;
    const script = node("script", writerX + 300 + LANE_GAP, 0, { createdBy: WRITER });
    const boardsX = script.position.x + 340 + COLUMN_GAP;
    const shot = node("shot", boardsX + 300 + LANE_GAP, 0, { type: "shot", createdBy: { kind: "bot", botId: "boards" } });
    const creation = node("make", shot.position.x + 340 + LANE_GAP, 0, { type: "config", metadata: { role: "creation", shotId: "shot" } });
    const take = node("take", creation.position.x + 340 + LANE_GAP, 0, { type: "video", width: 420, metadata: { role: "take", shotId: "shot" } });
    const frames = defaultBotFrames(flow(stages), canvas([script, shot, creation, take]));
    expect(at(frames, "writer").x).toBe(writerX);
    expect(at(frames, "boards").x).toBe(boardsX);
    expect(at(frames, "editor").x).toBe(take.position.x + 420 + COLUMN_GAP);
  });

  it("counts a node the pipeline links from a bot, and a group by the bot that made it, in that bot's lane", () => {
    const writerX = 300 + COLUMN_GAP;
    const linked = node("linked", writerX + 300 + LANE_GAP, 0);
    const group = node("group", writerX + 300 + LANE_GAP, 300, { type: "group", width: 900, createdBy: WRITER });
    const member = node("member", writerX + 300 + LANE_GAP + 24, 352, { groupId: "group" });
    const lanes = canvas([linked, group, member], [{ id: "c1", fromNodeId: "bot:writer", toNodeId: "linked", kind: "content", pipeline: true }]);
    const frames = defaultBotFrames(flow({ lead: ["lead"], writer: ["script"], editor: ["post"] }), lanes);
    expect(at(frames, "editor").x).toBe(group.position.x + 900 + COLUMN_GAP);
  });

  it("puts the bots outside the pipeline in the lead's column, below it", () => {
    const frames = defaultBotFrames(flow({ lead: ["lead"], writer: ["script"], voice: ["other"], ops: ["other"] }));
    expect(at(frames, "voice")).toEqual({ x: 0, y: 240 });
    expect(at(frames, "ops")).toEqual({ x: 0, y: 480 });
    expect(at(frames, "writer").y).toBe(0);
  });

  it("starts the first column at the top when the lead left", () => {
    const frames = defaultBotFrames(flow({ writer: ["other"], boards: ["other"] }, "gone"));
    expect(at(frames, "writer")).toEqual({ x: 0, y: 0 });
    expect(at(frames, "boards")).toEqual({ x: 0, y: 240 });
  });
});

describe("where a node a bot adds lands", () => {
  const bot = { position: { x: 0, y: 100 }, width: 300, height: 180 };
  const laneX = 300 + LANE_GAP;

  it("is to the right of the bot's node, level with it at first", () => {
    const placed = placeForActor(canvas(), node("new", 0, 0), WRITER, new Map([["bot:writer", bot]]));
    expect(placed).toEqual({ x: laneX, y: 100 });
  });

  it("is below what the bot already made there, and not below what was moved away", () => {
    const made = node("one", laneX, 100, { createdBy: WRITER });
    const movedAway = node("far", 3000, 2000, { createdBy: WRITER });
    const placed = placeForActor(canvas([made, movedAway]), node("new", 0, 0), WRITER, new Map([["bot:writer", bot]]));
    expect(placed).toEqual({ x: laneX, y: 100 + 240 + NODE_GAP });
  });

  it("goes past a node in the way and past a placed bot's node, but over the place of a later bot nobody placed, which moves right", () => {
    const blocker = node("theirs", laneX + 20, 120);
    const other = { position: { x: laneX, y: 100 + 240 + NODE_GAP }, width: 300, height: 180 };
    const placedBot = node("bot:boards", other.position.x, other.position.y, { type: "bot", width: 300, height: 180 });
    const pastPlaced = placeForActor(canvas([blocker, placedBot]), node("new", 0, 0), WRITER, new Map([["bot:writer", bot], ["bot:boards", other]]));
    expect(pastPlaced.x).toBe(laneX);
    expect(pastPlaced.y).toBeGreaterThanOrEqual(other.position.y + other.height + NODE_GAP);
    const overDefault = placeForActor(canvas([blocker]), node("new", 0, 0), WRITER, new Map([["bot:writer", bot], ["bot:boards", other]]));
    expect(overDefault).toEqual({ x: laneX, y: 120 + 240 + NODE_GAP });
  });

  it("is at the right of everything for the person", () => {
    const placed = placeForActor(canvas([node("a", 0, 50), node("b", 500, -20)]), node("new", 0, 0), { kind: "person" }, new Map([["bot:lead", { position: { x: 900, y: 0 }, width: 300, height: 180 }]]));
    expect(placed).toEqual({ x: 1200 + LANE_GAP, y: -20 });
  });

  it("keeps clear of the frames of nodes still to come, for the bot and for the person", () => {
    const coming = { position: { x: laneX, y: 100 }, width: 340, height: 240 };
    expect(placeForActor(canvas(), node("new", 0, 0), WRITER, new Map([["bot:writer", bot]]), [coming])).toEqual({ x: laneX, y: 100 + 240 + NODE_GAP });
    expect(placeForActor(canvas([node("a", 0, 50)]), node("new", 0, 0), { kind: "person" }, new Map(), [coming])).toEqual({ x: laneX + 340 + LANE_GAP, y: 50 });
  });
});

describe("where a generated result lands", () => {
  it("is to the right of its source, below the results already connected from it", () => {
    const shot = node("shot", 0, 0, { type: "shot" });
    const first = node("video-1", 340 + LANE_GAP, 0, { type: "video", height: 236 });
    const document = canvas([shot, first], [{ id: "c1", fromNodeId: "shot", toNodeId: "video-1", kind: "content" }]);
    expect(placeAfter(document, shot, node("video-2", 0, 0, { type: "video", height: 236 }), new Map())).toEqual({ x: 340 + LANE_GAP, y: 236 + NODE_GAP });
  });

  it("is below the frames of results still to come from its source, as replies being written", () => {
    const logline = node("logline", 0, 0);
    const coming = [{ position: { x: 340 + LANE_GAP, y: 0 }, width: 340, height: 240 }, { position: { x: 340 + LANE_GAP, y: 240 + NODE_GAP }, width: 340, height: 240 }];
    expect(placeAfter(canvas([logline]), logline, { width: 340, height: 240 }, new Map(), coming)).toEqual({ x: 340 + LANE_GAP, y: 2 * (240 + NODE_GAP) });
  });
});
