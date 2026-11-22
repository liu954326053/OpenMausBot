import { describe, expect, it } from "vitest";
import { botNodeId, dispatchConnectionId, type CanvasBotState, type CanvasConnection, type CanvasNode, type CanvasNodeMetadata } from "../../../shared/project-canvas";
import type { FlowStage } from "../../../shared/team-pipeline";
import { nextOutputFrame } from "./generation";
import { BOT_GAP_Y, LANE_GAP_X, LANE_GAP_Y, layoutPipeline } from "./stage-layout";

const BOT = { width: 300, height: 180 };
const SHOT = { width: 340, height: 240 };
const TAKE = { width: 420, height: 236 };

const bot = (id: string, x = 0, y = 0): CanvasNode => ({ id: botNodeId(id), type: "bot", title: id, position: { x, y }, ...BOT });
const made = (id: string, by: string | null, over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "shot", title: id, position: { x: 5000, y: 5000 }, ...SHOT, createdBy: by ? { kind: "bot", botId: by } : { kind: "person" }, ...over });
const creation = (shotId: string, over: Partial<CanvasNode> = {}): CanvasNode => made(`${shotId}-creation`, null, { type: "config", metadata: { role: "creation", shotId, generationMode: "video" }, ...over });
const take = (shotId: string, index: number, metadata: CanvasNodeMetadata = {}): CanvasNode => made(`${shotId}-take-${index}`, null, { type: "video", ...TAKE, metadata: { role: "take", shotId, ...metadata } });
const dispatch = (from: string, to: string): CanvasConnection => ({ id: dispatchConnectionId(from, to), fromNodeId: botNodeId(from), toNodeId: botNodeId(to), kind: "dispatch" });
const link = (fromNodeId: string, toNodeId: string, pipeline = false): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content", ...(pipeline ? { pipeline: true as const } : {}) });
const state = (botId: string, ...stages: FlowStage[]): CanvasBotState => ({ botId, name: botId, title: "", lead: stages.includes("lead"), stages, status: "idle", placed: true });
const team = (...states: CanvasBotState[]) => Object.fromEntries(states.map((one) => [one.botId, one]));

const column = (index: number, widths: number[] = []) => 100 + Array.from({ length: index }, (_, at) => (widths[at] ?? BOT.width) + LANE_GAP_X).reduce((sum, width) => sum + width, 0);

describe("bots in stage columns", () => {
  const five = team(state("lead", "lead"), state("writer", "script"), state("designer", "character"), state("boarder", "storyboard"), state("editor", "post"));
  const lines = [dispatch("lead", "writer"), dispatch("writer", "designer"), dispatch("designer", "boarder"), dispatch("writer", "boarder"), dispatch("boarder", "editor")];

  it("stands the stages left to right from the lead, which keeps its place, whatever order the bots come in", () => {
    const nodes = [bot("editor"), bot("boarder", 900, 40), bot("lead", 100, 200), bot("designer"), bot("writer")];
    const positions = layoutPipeline({ nodes, connections: lines, bots: five });
    expect(["lead", "writer", "designer", "boarder", "editor"].map((id) => positions.get(botNodeId(id)))).toEqual([0, 1, 2, 3, 4].map((index) => ({ x: column(index), y: 200 })));
  });

  it("takes a bot with several stages into the column of its first, and gives a stage nobody has no column", () => {
    const bots = team(state("lead", "lead"), state("writer", "script"), state("artist", "character", "storyboard"), state("editor", "post"));
    const positions = layoutPipeline({ nodes: [bot("lead", 100, 200), bot("writer"), bot("artist"), bot("editor")], connections: [], bots });
    expect(["lead", "writer", "artist", "editor"].map((id) => positions.get(botNodeId(id)))).toEqual([0, 1, 2, 3].map((index) => ({ x: column(index), y: 200 })));
  });

  it("stacks two bots of one stage top to bottom, the second clear of what the first made", () => {
    const bots = team(state("lead", "lead"), state("w1", "script"), state("w2", "script"), state("boarder", "storyboard"));
    const nodes = [bot("lead", 100, 200), bot("w1"), bot("w2"), bot("boarder"), made("draft-1", "w1", { type: "text", height: 300 }), made("draft-2", "w1", { type: "text", position: { x: 5000, y: 5200 } })];
    const positions = layoutPipeline({ nodes, connections: [dispatch("lead", "w1"), dispatch("lead", "w2"), dispatch("w1", "boarder"), dispatch("w2", "boarder")], bots });
    expect(positions.get(botNodeId("w1"))).toEqual({ x: column(1), y: 200 });
    expect(positions.get(botNodeId("w2"))).toEqual({ x: column(1), y: 200 + 300 + LANE_GAP_Y + 240 + BOT_GAP_Y });
  });

  it("stands the bots outside the pipeline below the lead, in its column, and a bot the snapshot knows nothing of with them", () => {
    const bots = team(state("lead", "lead"), state("writer", "script"), state("voice", "other"), state("ops", "other"));
    const nodes = [bot("voice"), bot("lead", 100, 200), bot("writer"), bot("ops"), bot("gone")];
    const positions = layoutPipeline({ nodes, connections: [dispatch("lead", "writer"), dispatch("lead", "voice"), dispatch("lead", "ops")], bots });
    const step = BOT.height + BOT_GAP_Y;
    expect(["lead", "voice", "ops", "gone"].map((id) => positions.get(botNodeId(id)))).toEqual([0, 1, 2, 3].map((index) => ({ x: 100, y: 200 + index * step })));
    expect(positions.get(botNodeId("writer"))).toEqual({ x: column(1), y: 200 });
  });

  it("lays a team with no pipeline as the lead with everyone else below it", () => {
    const bots = team(state("lead", "lead"), state("a", "other"), state("b", "other"));
    const positions = layoutPipeline({ nodes: [bot("lead"), bot("a"), bot("b")], connections: [dispatch("lead", "a"), dispatch("lead", "b")], bots });
    expect(["lead", "a", "b"].map((id) => positions.get(botNodeId(id))!.y)).toEqual([0, 240, 480]);
  });

  it("places by stage alone, so several lines into one bot change nothing", () => {
    const nodes = ["lead", "writer", "designer", "boarder", "editor"].map((id) => bot(id));
    expect(layoutPipeline({ nodes, connections: lines, bots: five })).toEqual(layoutPipeline({ nodes, connections: [], bots: five }));
  });
});

describe("what a bot made", () => {
  const bots = team(state("lead", "lead"), state("writer", "script"), state("boarder", "storyboard"), state("editor", "post"));
  const botNodes = () => [bot("lead", 100, 200), bot("writer"), bot("boarder"), bot("editor")];

  it("stands to the bot's right, one node a row, and the next column starts past the widest of them", () => {
    const nodes = [...botNodes(), made("script", "writer", { type: "text", width: 500, metadata: { role: "script" } }), made("notes", "writer", { type: "text", position: { x: 5000, y: 6000 } })];
    const positions = layoutPipeline({ nodes, connections: [], bots });
    const laneX = column(1) + BOT.width + LANE_GAP_X;
    expect(positions.get("script")).toEqual({ x: laneX, y: 200 });
    expect(positions.get("notes")).toEqual({ x: laneX, y: 200 + 240 + LANE_GAP_Y });
    expect(positions.get(botNodeId("boarder"))).toEqual({ x: column(2, [BOT.width, BOT.width + LANE_GAP_X + 500]), y: 200 });
  });

  it("takes a node the server linked from the bot as its own, whoever is down as its maker, and leaves a person's node where it is", () => {
    const nodes = [...botNodes(), made("film", null, { type: "video", ...TAKE, metadata: { role: "final" } }), made("mine", null, { type: "text" })];
    const positions = layoutPipeline({ nodes, connections: [link(botNodeId("editor"), "film", true), link("mine", botNodeId("editor"))], bots });
    expect(positions.get("film")).toEqual({ x: column(3) + BOT.width + LANE_GAP_X, y: 200 });
    expect(positions.has("mine")).toBe(false);
  });

  it("moves a character's group as one block, its profile and pictures keeping their places in it", () => {
    const withDesigner = { ...bots, designer: state("designer", "character") };
    const group = made("hero", "designer", { type: "group", position: { x: 1000, y: 1000 }, width: 760, height: 480 });
    const profile = made("hero-profile", "designer", { type: "text", groupId: "hero", position: { x: 1024, y: 1052 }, metadata: { role: "character" } });
    const picture = made("hero-picture", null, { type: "image", groupId: "hero", position: { x: 1400, y: 1052 } });
    const positions = layoutPipeline({ nodes: [...botNodes(), bot("designer"), group, profile, picture], connections: [link("hero-profile", "hero-picture")], bots: withDesigner });
    const at = { x: column(2) + BOT.width + LANE_GAP_X, y: 200 };
    expect(positions.get("hero")).toEqual(at);
    expect(positions.get("hero-profile")).toEqual({ x: at.x + 24, y: at.y + 52 });
    expect(positions.get("hero-picture")).toEqual({ x: at.x + 400, y: at.y + 52 });
  });

  it("puts a picture or clip fed only from a bot's node in the next cell of that node's row, as before the pipeline", () => {
    const nodes = [...botNodes(), made("s1", "boarder"), made("s2", "boarder", { position: { x: 5000, y: 5400 } }), made("v1", null, { type: "video", ...TAKE }), made("mixed", null, { type: "video", ...TAKE }), made("mine", null, { type: "text" })];
    const positions = layoutPipeline({ nodes, connections: [link("s2", "v1"), link("s1", "mixed"), link("mine", "mixed")], bots });
    const laneX = column(2) + BOT.width + LANE_GAP_X;
    expect(positions.get("s2")).toEqual({ x: laneX, y: 200 + SHOT.height + LANE_GAP_Y });
    expect(positions.get("v1")).toEqual({ x: laneX + SHOT.width + LANE_GAP_X, y: 200 + SHOT.height + LANE_GAP_Y });
    expect(positions.has("mixed")).toBe(false);
  });
});

describe("a shot's row", () => {
  const bots = team(state("lead", "lead"), state("boarder", "storyboard"), state("editor", "post"));

  it("holds the shot, its creation node and its takes, a later take below the earlier ones, twelve shots top to bottom", () => {
    const takesOf = (index: number) => 1 + (index % 3);
    const shots = Array.from({ length: 12 }, (_, index) => made(`shot-${index + 1}`, "boarder", { position: { x: 5000, y: 5000 + index * 10 } }));
    const rest = shots.flatMap((shot, index) => [creation(shot.id), ...Array.from({ length: takesOf(index) }, (_, at) => take(shot.id, at + 1, at === takesOf(index) - 1 ? { selected: true } : {}))]);
    const connections = shots.flatMap((shot, index) => [
      link(botNodeId("boarder"), shot.id, true),
      link(shot.id, `${shot.id}-creation`, true),
      ...Array.from({ length: takesOf(index) }, (_, at) => link(`${shot.id}-creation`, `${shot.id}-take-${at + 1}`, true)),
      link(`${shot.id}-take-${takesOf(index)}`, botNodeId("editor"), true),
    ]);
    const positions = layoutPipeline({ nodes: [bot("lead", 100, 200), bot("boarder"), bot("editor"), ...rest, ...shots], connections, bots });

    const shotX = column(1) + BOT.width + LANE_GAP_X;
    const creationX = shotX + SHOT.width + LANE_GAP_X;
    const takeX = creationX + SHOT.width + LANE_GAP_X;
    let top = 200;
    shots.forEach((shot, index) => {
      expect(positions.get(shot.id), shot.id).toEqual({ x: shotX, y: top });
      expect(positions.get(`${shot.id}-creation`), shot.id).toEqual({ x: creationX, y: top });
      const takes = Array.from({ length: takesOf(index) }, (_, at) => positions.get(`${shot.id}-take-${at + 1}`));
      expect(takes, shot.id).toEqual(takes.map((_, at) => ({ x: takeX, y: top + at * (TAKE.height + LANE_GAP_Y) })));
      top += Math.max(SHOT.height, takesOf(index) * TAKE.height + (takesOf(index) - 1) * LANE_GAP_Y) + LANE_GAP_Y;
    });
    expect(positions.get(botNodeId("editor"))).toEqual({ x: takeX + TAKE.width + LANE_GAP_X, y: 200 });
  });

  it("keeps the takes in the order they were made, wherever they stand now", () => {
    const nodes = [bot("lead"), bot("boarder"), made("s", "boarder"), creation("s"), take("s", 1), take("s", 2)];
    nodes[4] = { ...nodes[4]!, position: { x: 0, y: 9000 } };
    const positions = layoutPipeline({ nodes, connections: [], bots });
    expect(positions.get("s-take-2")!.y - positions.get("s-take-1")!.y).toBe(TAKE.height + LANE_GAP_Y);
  });

  it("stands the cells as far apart as the server lands a result from its source, so a take that just landed stays where it is", () => {
    const connections = [link("s", "s-creation", true), link("s-creation", "s-take-1", true), link("s-creation", "s-take-2", true)];
    const before = [bot("lead"), bot("boarder"), made("s", "boarder"), creation("s"), take("s", 1)];
    const tidy = (nodes: CanvasNode[]) => {
      const positions = layoutPipeline({ nodes, connections, bots });
      return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
    };
    const tidied = tidy(before);
    const landed = nextOutputFrame(tidied.find((node) => node.id === "s-creation")!, "video", tidied, connections);
    const after = tidy([...tidied, { ...take("s", 2), position: landed.position }]);
    expect(after.find((node) => node.id === "s-take-2")!.position).toEqual(landed.position);
    expect(after.slice(0, tidied.length)).toEqual(tidied);
  });

  it("puts a take whose shot has no creation node in the cell beside the shot", () => {
    const nodes = [bot("lead"), bot("boarder"), made("s", "boarder"), take("s", 1)];
    const positions = layoutPipeline({ nodes, connections: [], bots });
    expect(positions.get("s-take-1")).toEqual({ x: positions.get("s")!.x + SHOT.width + LANE_GAP_X, y: positions.get("s")!.y });
  });

  it("leaves a shot a person added where it is, and lines its creation node and takes up to its right", () => {
    const nodes = [bot("lead"), bot("boarder"), made("own", null, { position: { x: 3000, y: 700 } }), creation("own"), take("own", 1), take("own", 2)];
    const positions = layoutPipeline({ nodes, connections: [], bots });
    expect(positions.has("own")).toBe(false);
    expect(positions.get("own-creation")).toEqual({ x: 3000 + SHOT.width + LANE_GAP_X, y: 700 });
    expect(positions.get("own-take-1")).toEqual({ x: 3000 + (SHOT.width + LANE_GAP_X) * 2, y: 700 });
    expect(positions.get("own-take-2")).toEqual({ x: 3000 + (SHOT.width + LANE_GAP_X) * 2, y: 700 + TAKE.height + LANE_GAP_Y });
  });
});
