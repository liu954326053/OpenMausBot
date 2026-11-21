import { describe, expect, it } from "vitest";
import { botNodeId, dispatchConnectionId, type CanvasBotState, type CanvasConnection, type CanvasNode } from "../../../shared/project-canvas";
import { botMadeNodes, LANE_GAP, layoutBotTree, TREE_GAP_X, TREE_GAP_Y } from "./tree-layout";

const bot = (id: string, x = 0, y = 0): CanvasNode => ({ id: botNodeId(id), type: "bot", title: id, position: { x, y }, width: 300, height: 180 });
const made = (id: string, by: string, over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "shot", title: id, position: { x: 5000, y: 5000 }, width: 340, height: 240, createdBy: { kind: "bot", botId: by }, ...over });
const dispatch = (parent: string, child: string): CanvasConnection => ({ id: dispatchConnectionId(parent, child), fromNodeId: botNodeId(parent), toNodeId: botNodeId(child), kind: "dispatch" });
const link = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content" });
const state = (botId: string, lead = false): CanvasBotState => ({ botId, name: botId, title: "", lead, status: "idle", placed: true });

describe("what each bot made", () => {
  it("takes the nodes a bot created, then the images and videos fed only from them", () => {
    const nodes = [
      bot("lead"),
      made("shot1", "lead"),
      made("clip1", "lead", { type: "video", createdBy: { kind: "person" } }),
      made("mixed", "lead", { type: "video", createdBy: { kind: "person" } }),
      made("mine", "x", { type: "text", createdBy: { kind: "person" } }),
      made("grouped", "lead", { groupId: "g" }),
    ];
    const connections = [link(botNodeId("lead"), "shot1"), link("shot1", "clip1"), link("shot1", "mixed"), link("mine", "mixed")];
    expect(botMadeNodes(nodes, connections).get(botNodeId("lead"))!.map((column) => column.map((node) => node.id))).toEqual([["shot1"], ["clip1"]]);
  });
});

describe("the bot tree", () => {
  const snapshot = (nodes: CanvasNode[], connections: CanvasConnection[]) => ({
    nodes,
    connections,
    bots: { lead: state("lead", true), a: state("a"), b: state("b"), c: state("c") },
  });

  it("puts the lead at the left where it was, its subordinates in the next column, each subtree in its own band", () => {
    const nodes = [bot("lead", 100, 200), bot("a"), bot("b"), bot("c")];
    const positions = layoutBotTree(snapshot(nodes, [dispatch("lead", "a"), dispatch("lead", "b"), dispatch("a", "c")]));
    const column1 = 100 + 300 + TREE_GAP_X;
    const column2 = column1 + 300 + TREE_GAP_X;
    expect(positions.get(botNodeId("lead"))).toEqual({ x: 100, y: 200 });
    expect(positions.get(botNodeId("a"))).toEqual({ x: column1, y: 200 });
    expect(positions.get(botNodeId("c"))).toEqual({ x: column2, y: 200 });
    expect(positions.get(botNodeId("b"))).toEqual({ x: column1, y: 200 + 180 + TREE_GAP_Y });
  });

  it("lays what a bot made to its right, widening its column and band", () => {
    const nodes = [bot("lead"), bot("a"), bot("b"), made("s1", "a"), made("s2", "a"), made("v1", "a", { type: "video", width: 420, height: 236, createdBy: { kind: "person" } })];
    const connections = [dispatch("lead", "a"), dispatch("lead", "b"), link("s1", "v1")];
    const positions = layoutBotTree(snapshot(nodes, connections));
    const aX = 300 + TREE_GAP_X;
    const laneX = aX + 300 + LANE_GAP;
    expect(positions.get("s1")).toEqual({ x: laneX, y: 0 });
    expect(positions.get("s2")).toEqual({ x: laneX, y: 240 + LANE_GAP });
    expect(positions.get("v1")).toEqual({ x: laneX + 340 + LANE_GAP, y: 0 });
    expect(positions.get(botNodeId("b"))).toEqual({ x: aX, y: 240 * 2 + LANE_GAP + TREE_GAP_Y });
  });

  it("moves nothing else, and lays a bot with no lead below the tree", () => {
    const nodes = [bot("lead"), bot("a"), made("loose", "x", { type: "text", createdBy: { kind: "person" } })];
    const positions = layoutBotTree(snapshot(nodes, []));
    expect(positions.get(botNodeId("a"))).toEqual({ x: 0, y: 180 + TREE_GAP_Y });
    expect(positions.has("loose")).toBe(false);
  });
});
