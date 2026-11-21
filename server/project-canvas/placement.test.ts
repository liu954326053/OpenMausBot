import { describe, expect, it } from "vitest";

import type { CanvasDocument, CanvasNode, CanvasNodeCreator } from "../../shared/project-canvas.ts";
import { defaultBotFrames, LANE_GAP, NODE_GAP, placeAfter, placeForActor } from "./placement.ts";

const WRITER: CanvasNodeCreator = { kind: "bot", botId: "writer" };

function node(id: string, x: number, y: number, patch: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: "text", title: id, position: { x, y }, width: 340, height: 240, createdBy: { kind: "person" }, ...patch };
}

function canvas(nodes: CanvasNode[] = [], connections: CanvasDocument["connections"] = []): CanvasDocument {
  return { projectId: "p1", revision: 1, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" };
}

describe("where bots sit when nobody placed them", () => {
  it("is the flow's tree from left to right, the lead first and each subtree in its own band", () => {
    const parents: Record<string, string> = { writer: "lead", boards: "lead", editor: "boards" };
    const frames = defaultBotFrames({ botIds: ["lead", "writer", "boards", "editor"], leadBotId: "lead", parentOf: (id) => parents[id] });
    const at = (id: string) => frames.get(`bot:${id}`)!.position;
    expect(at("lead")).toEqual({ x: 0, y: 0 });
    expect(at("writer").x).toBeGreaterThan(300 + LANE_GAP);
    expect(at("writer").y).toBe(0);
    expect(at("boards").x).toBe(at("writer").x);
    expect(at("boards").y).toBeGreaterThanOrEqual(180);
    expect(at("editor")).toEqual({ x: 2 * at("writer").x, y: at("boards").y });
    expect(frames.get("bot:lead")).toMatchObject({ width: 300, height: 180 });
  });

  it("puts a bot whose superior is not in the project, or that sits in a loop, under the lead", () => {
    const parents: Record<string, string> = { a: "b", b: "a", stray: "elsewhere" };
    const frames = defaultBotFrames({ botIds: ["lead", "a", "b", "stray"], leadBotId: "lead", parentOf: (id) => parents[id] });
    expect(new Set([...frames.values()].map((frame) => frame.position.x))).toEqual(new Set([0, frames.get("bot:a")!.position.x]));
    expect(frames.size).toBe(4);
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

  it("goes past a node in the way, and past another bot's node", () => {
    const blocker = node("theirs", laneX + 20, 120);
    const other = { position: { x: laneX, y: 100 + 240 + NODE_GAP }, width: 300, height: 180 };
    const placed = placeForActor(canvas([blocker]), node("new", 0, 0), WRITER, new Map([["bot:writer", bot], ["bot:boards", other]]));
    expect(placed.x).toBe(laneX);
    expect(placed.y).toBeGreaterThanOrEqual(other.position.y + other.height + NODE_GAP);
  });

  it("is at the right of everything for the person", () => {
    const placed = placeForActor(canvas([node("a", 0, 50), node("b", 500, -20)]), node("new", 0, 0), { kind: "person" }, new Map([["bot:lead", { position: { x: 900, y: 0 }, width: 300, height: 180 }]]));
    expect(placed).toEqual({ x: 1200 + LANE_GAP, y: -20 });
  });
});

describe("where a generated result lands", () => {
  it("is to the right of its source, below the results already connected from it", () => {
    const shot = node("shot", 0, 0, { type: "shot" });
    const first = node("video-1", 340 + LANE_GAP, 0, { type: "video", height: 236 });
    const document = canvas([shot, first], [{ id: "c1", fromNodeId: "shot", toNodeId: "video-1", kind: "content" }]);
    expect(placeAfter(document, shot, node("video-2", 0, 0, { type: "video", height: 236 }), new Map())).toEqual({ x: 340 + LANE_GAP, y: 236 + NODE_GAP });
  });
});
