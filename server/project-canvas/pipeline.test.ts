import { describe, expect, it } from "vitest";

import type { CanvasConnection, CanvasDocument, CanvasNode, CanvasNodeCreator, CanvasNodeMetadata } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { CanvasFrame } from "./ops.ts";
import { settlePipeline, type SettleInput } from "./pipeline.ts";
import { LANE_GAP, NODE_GAP } from "./placement.ts";

const PERSON: CanvasNodeCreator = { kind: "person" };
const by = (botId: string): CanvasNodeCreator => ({ kind: "bot", botId });
const SIZE: Partial<Record<CanvasNode["type"], { width: number; height: number }>> = { video: { width: 420, height: 236 }, group: { width: 760, height: 480 } };

function node(id: string, type: CanvasNode["type"], at: [number, number], metadata?: CanvasNodeMetadata, createdBy: CanvasNodeCreator = PERSON, groupId?: string): CanvasNode {
  return { id, type, title: id, position: { x: at[0], y: at[1] }, ...(SIZE[type] ?? { width: 340, height: 240 }), createdBy, ...(metadata ? { metadata } : {}), ...(groupId ? { groupId } : {}) };
}
const link = (fromNodeId: string, toNodeId: string, pipeline = false): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content", ...(pipeline ? { pipeline: true as const } : {}) });
const canvas = (nodes: CanvasNode[] = [], connections: CanvasConnection[] = []): CanvasDocument =>
  ({ projectId: "p1", revision: 1, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" });
const file = (name: string, mime = "video/mp4") => ({ path: `产出/${name}`, mime, bytes: 3, name });

const TEAM: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["script"], faces: ["character"], boards: ["storyboard"], editor: ["post"] };
const BOTS = new Map<string, CanvasFrame>(Object.keys(TEAM).map((id, index) => [`bot:${id}`, { position: { x: -400, y: index * 240 }, width: 300, height: 180 }]));

function settle(before: CanvasDocument, change: (after: CanvasDocument) => void, patch: Partial<SettleInput> = {}) {
  const after = structuredClone(before);
  change(after);
  const taken = new Set([...before.nodes, ...before.connections, ...after.nodes, ...after.connections].map((one) => one.id));
  let n = 0;
  const newId = () => {
    do n += 1; while (taken.has(`new-${n}`));
    return `new-${n}`;
  };
  const result = settlePipeline({ before, after, beforeStages: TEAM, stages: TEAM, bots: BOTS, reserved: [], newId, ...patch });
  const find = (id: string) => after.nodes.find((one) => one.id === id);
  const links = () => after.connections.map((one) => `${one.fromNodeId} ${one.pipeline ? "=>" : "->"} ${one.toNodeId}`);
  return { after, find, links, ...result };
}

describe("a shot's creation node", () => {
  const shot = (id: string, maker: CanvasNodeCreator, y = 0) => node(id, "shot", [0, y], { prompt: "Veil, dawn", settings: { seconds: 10 } }, maker);

  it("is made for a shot a storyboard bot adds: a video config to its right with the shot's settings, joined from the shot", () => {
    const { after, find, links, changed, events } = settle(canvas(), (document) => {
      document.nodes.push(shot("shot-1", by("boards")));
      document.connections.push(link("bot:boards", "shot-1"));
    }, { actor: by("boards") });
    expect(find("new-1")).toEqual({
      id: "new-1", type: "config", title: "shot-1", position: { x: 340 + LANE_GAP, y: 0 }, width: 340, height: 240, createdBy: by("boards"),
      metadata: { generationMode: "video", role: "creation", shotId: "shot-1", settings: { seconds: 10 } },
    });
    expect(links()).toEqual(["bot:boards => shot-1", "shot-1 => new-1"]);
    expect(after.nodes).toHaveLength(2);
    expect(changed).toEqual({ nodes: ["new-1"], connections: ["bot:boards>shot-1", "new-2"] });
    expect(events).toEqual([{ kind: "role", role: "creation", nodeId: "new-1", shotId: "shot-1" }]);
  });

  it("is made for a shot the person adds, below what stands to the shot's right, and for no shot of a bot outside the storyboard stage", () => {
    const blocker = node("note", "text", [340 + LANE_GAP + 10, 20]);
    const { find, after } = settle(canvas([blocker]), (document) => {
      document.nodes.push(shot("mine", PERSON), shot("theirs", by("writer"), 600));
    }, { actor: PERSON });
    expect(after.nodes.map((one) => one.id)).toEqual(["note", "mine", "theirs", "new-1"]);
    expect(find("new-1")).toMatchObject({ position: { x: 340 + LANE_GAP, y: 20 + 240 + NODE_GAP }, createdBy: PERSON, metadata: { shotId: "mine" } });
  });

  it("is not made again for a shot that comes back beside the one it had", () => {
    const kept = node("make-1", "config", [420, 0], { role: "creation", shotId: "shot-1", generationMode: "video" });
    const { after, links } = settle(canvas([kept]), (document) => {
      document.nodes.push(shot("shot-1", PERSON));
    }, { actor: PERSON });
    expect(after.nodes.map((one) => one.id)).toEqual(["make-1", "shot-1"]);
    expect(links()).toEqual(["shot-1 => make-1"]);
  });

  it("goes with its shot when a bot deletes the shot, and stays when the person does", () => {
    const before = canvas([shot("shot-1", by("boards")), node("make-1", "config", [420, 0], { role: "creation", shotId: "shot-1" }, by("boards")), node("take-1", "video", [840, 0], { role: "take", shotId: "shot-1", file: file("a.mp4") }, by("boards"))],
      [link("shot-1", "make-1", true), link("make-1", "take-1", true)]);
    const remove = (document: CanvasDocument) => {
      document.nodes = document.nodes.filter((one) => one.id !== "shot-1");
      document.connections = document.connections.filter((one) => one.fromNodeId !== "shot-1");
    };
    const byBot = settle(before, remove, { actor: by("boards") });
    expect(byBot.after.nodes.map((one) => one.id)).toEqual(["take-1"]);
    expect(byBot.after.connections).toEqual([]);
    expect(byBot.changed).toEqual({ nodes: ["make-1"], connections: ["make-1>take-1"] });
    const byPerson = settle(before, remove, { actor: PERSON });
    expect(byPerson.after.nodes.map((one) => one.id)).toEqual(["make-1", "take-1"]);
    expect(byPerson.links()).toEqual(["make-1 => take-1"]);
  });

  it("takes in the images connected into its shot, and stays in step when one is connected or taken away", () => {
    const before = canvas([shot("shot-1", by("boards")), node("make-1", "config", [420, 0], { role: "creation", shotId: "shot-1" }, by("boards")), node("face", "image", [0, 400], { file: file("face.png", "image/png") })],
      [link("shot-1", "make-1", true)]);
    const joined = settle(before, (document) => document.connections.push(link("face", "shot-1")));
    expect(joined.links()).toEqual(["shot-1 => make-1", "face -> shot-1", "face => make-1"]);
    const parted = settle(joined.after, (document) => {
      document.connections = document.connections.filter((one) => one.id !== "face>shot-1");
    });
    expect(parted.links()).toEqual(["shot-1 => make-1"]);
    expect(parted.changed.connections).toEqual(["new-1"]);
  });

  it("stays without a link the person deleted, whatever else changes", () => {
    const before = canvas([shot("shot-1", by("boards")), node("make-1", "config", [420, 0], { role: "creation", shotId: "shot-1" }, by("boards"))], []);
    const { links, changed } = settle(before, (document) => document.nodes.push(node("note", "text", [0, 900])), { actor: PERSON });
    expect(links()).toEqual([]);
    expect(changed).toEqual({ nodes: [], connections: [] });
  });
});

describe("a shot's takes", () => {
  const row = (takes: CanvasNode[], prompt = "Veil, dawn") => canvas([
    node("shot-1", "shot", [0, 0], { prompt }, by("boards")), node("make-1", "config", [420, 0], { role: "creation", shotId: "shot-1" }, by("boards")), ...takes,
  ], [link("bot:boards", "shot-1", true), link("shot-1", "make-1", true), ...takes.map((one) => link("make-1", one.id, true))]);
  const ROW = ["bot:boards => shot-1", "shot-1 => make-1"];
  const take = (id: string, metadata: CanvasNodeMetadata = {}) => node(id, "video", [840, 0], { role: "take", shotId: "shot-1", file: file(`${id}.mp4`), ...metadata }, by("boards"));
  const reword = (prompt: string) => (document: CanvasDocument) => {
    document.nodes[0]!.metadata = { ...document.nodes[0]!.metadata, prompt };
  };

  it("and its creation node are stale once the shot's prompt changes, and not while the shot has no take", () => {
    const { find, changed } = settle(row([take("take-1", { selected: true }), take("take-2")]), reword("Veil, dusk"));
    expect([find("make-1"), find("take-1"), find("take-2")].map((one) => one?.metadata?.stale)).toEqual([true, true, true]);
    expect(changed.nodes).toEqual(["make-1", "take-1", "take-2"]);
    const none = settle(row([]), reword("Veil, dusk"));
    expect(none.find("make-1")?.metadata).not.toHaveProperty("stale");
    expect(settle(row([take("take-1")]), reword("  Veil, dawn ")).changed.nodes).toEqual([]);
  });

  it("send the selected one on to every post bot, and stop when it loses the mark", () => {
    const selected = settle(row([take("take-1"), take("take-2")]), (document) => {
      document.nodes[3]!.metadata = { ...document.nodes[3]!.metadata, selected: true };
    }, { stages: { ...TEAM, cutter: ["post"] }, beforeStages: { ...TEAM, cutter: ["post"] } });
    expect(selected.links()).toEqual([...ROW, "make-1 => take-1", "make-1 => take-2", "take-2 => bot:editor", "take-2 => bot:cutter"]);
    expect(selected.events).toEqual([{ kind: "selected", shotId: "shot-1", nodeId: "take-2" }]);
    const moved = settle(selected.after, (document) => {
      delete document.nodes[3]!.metadata!.selected;
      document.nodes[2]!.metadata = { ...document.nodes[2]!.metadata, selected: true };
    }, { stages: { ...TEAM, cutter: ["post"] }, beforeStages: { ...TEAM, cutter: ["post"] } });
    expect(moved.links()).toEqual([...ROW, "make-1 => take-1", "make-1 => take-2", "take-1 => bot:editor", "take-1 => bot:cutter"]);
    expect(moved.events).toEqual([{ kind: "selected", shotId: "shot-1", nodeId: "take-1" }]);
  });

  it("say so when the selected one is deleted and the shot is left with none", () => {
    const { events } = settle(row([take("take-1", { selected: true })]), (document) => {
      document.nodes = document.nodes.filter((one) => one.id !== "take-1");
    });
    expect(events).toEqual([{ kind: "selected", shotId: "shot-1", nodeId: null }]);
  });

  it("keep one selected when a deleted take comes back selected beside the one selected since", () => {
    const { find, events } = settle(row([take("take-2", { selected: true })]), (document) => {
      document.nodes.push(take("take-1", { selected: true }));
    }, { actor: PERSON });
    expect(find("take-1")?.metadata).not.toHaveProperty("selected");
    expect(find("take-2")?.metadata?.selected).toBe(true);
    expect(events).toEqual([{ kind: "role", role: "take", nodeId: "take-1", shotId: "shot-1" }]);
  });

  it("follow the pipeline when its bots change: a post bot that leaves loses the link, one that joins gets it", () => {
    const before = row([take("take-1", { selected: true })]);
    before.connections.push(link("take-1", "bot:editor", true));
    const { links } = settle(before, () => undefined, { stages: { lead: ["lead"], boards: ["storyboard"], cutter: ["post"] } });
    expect(links()).toEqual([...ROW, "make-1 => take-1", "take-1 => bot:cutter"]);
  });
});

describe("a character's group", () => {
  const profile = (id: string, y: number, maker = "faces") => node(id, "text", [0, y], { content: "The bride", role: "character" }, by(maker));

  it("is made around a character a bot adds, titled after it and the bot's, the character joined from the bot and on to every storyboard bot", () => {
    const { find, links, changed, events } = settle(canvas(), (document) => {
      document.nodes.push({ ...profile("mei", 0), title: "Mei" });
      document.connections.push(link("bot:faces", "mei"));
    }, { actor: by("faces"), stages: { ...TEAM, frames: ["storyboard"] } });
    expect(find("new-1")).toEqual({ id: "new-1", type: "group", title: "Mei", position: { x: -24, y: -52 }, width: 340 + 48, height: 240 + 52 + 24, createdBy: by("faces") });
    expect(find("mei")?.groupId).toBe("new-1");
    expect(links()).toEqual(["bot:faces => mei", "mei => bot:boards", "mei => bot:frames"]);
    expect(changed.nodes).toEqual(["new-1", "mei"]);
    expect(events).toEqual([{ kind: "role", role: "character", nodeId: "mei" }]);
  });

  it("stands clear of the group above it", () => {
    const first = settle(canvas(), (document) => document.nodes.push(profile("mei", 0)));
    const second = settle(first.after, (document) => document.nodes.push(profile("lin", 240 + NODE_GAP)));
    const top = 240 + 24 + NODE_GAP;
    expect(second.find("lin")).toMatchObject({ position: { x: 0, y: top + 52 } });
    expect(second.find(second.find("lin")!.groupId!)).toMatchObject({ type: "group", position: { x: -24, y: top }, height: 316 });
    expect(second.find("mei")).toMatchObject({ position: { x: 0, y: 0 }, groupId: "new-1" });
  });

  it("takes in a picture connected from the character, to its right, and a picture generated from one in the group, and grows around them", () => {
    const made = settle(canvas([node("face", "image", [0, 900], { file: file("face.png", "image/png") }, by("faces"))]), (document) => document.nodes.push(profile("mei", 0)));
    const joined = settle(made.after, (document) => document.connections.push(link("mei", "face")), { actor: by("faces") });
    expect(joined.find("face")).toMatchObject({ groupId: "new-1", position: { x: 340 + NODE_GAP, y: 0 } });
    expect(joined.find("new-1")).toMatchObject({ position: { x: -24, y: -52 }, width: 2 * 340 + NODE_GAP + 48, height: 316 });
    expect(joined.changed.nodes).toEqual(["face", "new-1"]);
    const grown = settle(joined.after, (document) => {
      document.nodes.push(node("side", "image", [2000, 2000], { file: file("side.png", "image/png") }, by("faces")), node("clip", "video", [2000, 2400], { file: file("clip.mp4") }, by("faces")));
      document.connections.push(link("face", "side"), link("face", "clip"));
    });
    expect(grown.find("side")).toMatchObject({ groupId: "new-1", position: { x: 2 * (340 + NODE_GAP), y: 0 } });
    expect(grown.find("clip")).not.toHaveProperty("groupId");
    expect(grown.find("new-1")?.width).toBe(3 * 340 + 2 * NODE_GAP + 48);
  });

  it("leaves a picture in the group it is in, and a text connected from the character where it is", () => {
    const made = settle(canvas([node("box", "group", [900, 900]), node("face", "image", [924, 960], { file: file("face.png", "image/png") }, PERSON, "box"), node("note", "text", [0, 900])]),
      (document) => document.nodes.push(profile("mei", 0)));
    const { find, changed } = settle(made.after, (document) => document.connections.push(link("mei", "face"), link("mei", "note")));
    expect(find("face")).toMatchObject({ groupId: "box", position: { x: 924, y: 960 } });
    expect(find("note")).not.toHaveProperty("groupId");
    expect(changed.nodes).toEqual([]);
  });

  it("is renamed with its character while it carries the character's name", () => {
    const made = settle(canvas(), (document) => document.nodes.push(profile("mei", 0)));
    const renamed = settle(made.after, (document) => {
      document.nodes.find((one) => one.id === "mei")!.title = "Mei Lin";
    });
    expect(renamed.find("new-1")?.title).toBe("Mei Lin");
    const own = settle(renamed.after, (document) => {
      document.nodes.find((one) => one.id === "new-1")!.title = "Leads";
      document.nodes.find((one) => one.id === "mei")!.title = "Mei";
    });
    expect(own.find("new-1")?.title).toBe("Leads");
  });

  it("is not made again for a character that comes back into its group", () => {
    const made = settle(canvas(), (document) => document.nodes.push(profile("mei", 0)));
    const gone = settle(made.after, (document) => {
      document.nodes = document.nodes.filter((one) => one.id !== "mei");
    }, { actor: PERSON });
    const back = settle(gone.after, (document) => document.nodes.push({ ...profile("mei", 0), groupId: "new-1" }), { actor: PERSON });
    expect(back.after.nodes.map((one) => one.id)).toEqual(["new-1", "mei"]);
  });
});

describe("what the pipeline tells of a change", () => {
  it("is each node that newly has a role, the script included", () => {
    const { events, links } = settle(canvas([node("draft", "text", [0, 0], { content: "Act one" }, by("writer"))]), (document) => {
      document.nodes[0]!.metadata = { ...document.nodes[0]!.metadata, role: "script" };
    });
    expect(events).toEqual([{ kind: "role", role: "script", nodeId: "draft" }]);
    expect(links()).toEqual(["bot:writer => draft", "draft => bot:faces", "draft => bot:boards"]);
  });

  it("is nothing for a change that touches no role", () => {
    const { events, changed } = settle(canvas([node("draft", "text", [0, 0], { role: "script" })], [link("bot:writer", "draft", true), link("draft", "bot:faces", true), link("draft", "bot:boards", true)]), (document) => {
      document.nodes[0]!.title = "Act one";
    });
    expect(events).toEqual([]);
    expect(changed).toEqual({ nodes: [], connections: [] });
  });
});
