import { describe, expect, it } from "vitest";

import { CANVAS_MAX_NODES, CANVAS_MAX_OPS, CANVAS_TEXT_MAX_HEIGHT, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasOp } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import { applyCanvasOps, CanvasOpRefusal, opTargets, parseCanvasOps, type OpsContext } from "./ops.ts";

const PERSON: CanvasNodeCreator = { kind: "person" };
const WRITER: CanvasNodeCreator = { kind: "bot", botId: "writer" };
const BOARDS: CanvasNodeCreator = { kind: "bot", botId: "boards" };

function node(id: string, patch: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type: "text", title: id, position: { x: 0, y: 0 }, width: 340, height: 240, createdBy: PERSON, ...patch };
}

function canvas(): CanvasDocument {
  return {
    projectId: "p1",
    revision: 4,
    nodes: [
      node("bot:lead", { type: "bot", title: "", createdBy: undefined, position: { x: 0, y: 0 }, width: 300, height: 180 }),
      node("brief", { metadata: { content: "A bride swaps places", fontSize: 16 } }),
      node("shot-1", { type: "shot", createdBy: WRITER, metadata: { prompt: "Wide, dawn light", settings: { seconds: 5 } } }),
      node("cover", { type: "image", metadata: { file: { path: "素材/cover.png", mime: "image/png", bytes: 3, name: "cover.png" } } }),
      node("box", { type: "group", width: 760, height: 480 }),
      node("in-box", { groupId: "box" }),
    ],
    connections: [
      { id: "c-brief", fromNodeId: "brief", toNodeId: "shot-1", kind: "content" },
      { id: "c-writer", fromNodeId: "bot:writer", toNodeId: "shot-1", kind: "content" },
    ],
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: "dots",
  };
}

const frame = (x: number, y: number) => ({ position: { x, y }, width: 300, height: 180 });

function context(actor: CanvasNodeCreator = PERSON): OpsContext {
  let n = 0;
  return {
    actor,
    bots: new Map([["bot:lead", frame(0, 0)], ["bot:writer", frame(880, 0)], ["bot:boards", frame(880, 400)]]),
    newId: () => `new-${++n}`,
    place: () => ({ x: 900, y: 420 }),
  };
}

function refused(run: () => unknown): CanvasOpRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof CanvasOpRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

const find = (document: CanvasDocument, id: string) => document.nodes.find((one) => one.id === id);

describe("adding a node", () => {
  it("gives the person's node an id, the type's size and the person as its maker", () => {
    const result = applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", title: "Logline", metadata: { content: "Swap" } }], context());
    expect(result.nodeIds).toEqual(["new-1"]);
    expect(find(result.document, "new-1")).toEqual({
      id: "new-1", type: "text", title: "Logline", position: { x: 900, y: 420 }, width: 340, height: 240, metadata: { content: "Swap" }, createdBy: PERSON,
    });
    expect(result.changed.nodes).toEqual(["new-1"]);
  });

  it("keeps an id and position it was given", () => {
    const result = applyCanvasOps(canvas(), [{ type: "add_node", id: "mine", nodeType: "video", position: { x: -40, y: 12 } }], context());
    expect(find(result.document, "mine")).toMatchObject({ position: { x: -40, y: 12 }, width: 420, height: 236 });
  });

  it("makes a text node no taller than a text node may be, whoever asks for more, and any other node as tall as asked", () => {
    const added = applyCanvasOps(canvas(), [
      { type: "add_node", id: "long", nodeType: "text", height: 2_000 },
      { type: "add_node", id: "short", nodeType: "text", height: 300 },
      { type: "add_node", id: "tall", nodeType: "image", height: 2_000 },
    ], context());
    expect(["long", "short", "tall"].map((id) => find(added.document, id)?.height)).toEqual([CANVAS_TEXT_MAX_HEIGHT, 300, 2_000]);
    const grown = applyCanvasOps(added.document, [{ type: "update_node", id: "short", patch: { height: 900 } }], context());
    expect(find(grown.document, "short")?.height).toBe(CANVAS_TEXT_MAX_HEIGHT);
    const byBot = applyCanvasOps(canvas(), [{ type: "add_node", id: "script", nodeType: "text", height: 1_600 }], context(WRITER));
    expect(find(byBot.document, "script")?.height).toBe(CANVAS_TEXT_MAX_HEIGHT);
  });

  it("refuses a bot node, an id in use, a key the type does not take and text over the limit", () => {
    expect(refused(() => parseCanvasOps([{ type: "add_node", nodeType: "bot" }])).code).toBe("invalid_op");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", id: "brief", nodeType: "text" }], context())).message).toMatch(/brief.*already/);
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", metadata: { prompt: "no" } }], context())).message).toMatch(/text.*prompt/);
    expect(refused(() => parseCanvasOps([{ type: "add_node", nodeType: "text", metadata: { content: "x".repeat(20_001) } }])).code).toBe("invalid_op");
  });

  it("lets a bot add only text and shots, connected from its own node", () => {
    const result = applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "shot", title: "Shot 2", metadata: { prompt: "Close, veil" } }], context(WRITER));
    expect(find(result.document, "new-1")).toMatchObject({ type: "shot", createdBy: WRITER, position: { x: 900, y: 420 } });
    expect(result.document.connections.at(-1)).toEqual({ id: "new-2", fromNodeId: "bot:writer", toNodeId: "new-1", kind: "content" });
    expect(result.connectionIds).toEqual(["new-2"]);
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "image" }], context(WRITER))).code).toBe("not_allowed");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", groupId: "box" }], context(WRITER))).code).toBe("not_allowed");
  });

  it("puts a node in a group only when the group is there", () => {
    const result = applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", groupId: "box" }], context());
    expect(find(result.document, "new-1")?.groupId).toBe("box");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", groupId: "brief" }], context())).code).toBe("not_found");
  });

  it("gives a deleted node the person adds back its maker, when it comes back as the same type", () => {
    const removed = (id: string) => (id === "shot-9" ? { type: "shot" as const, createdBy: WRITER } : undefined);
    const back = (type: "shot" | "text", actor: CanvasNodeCreator = PERSON) =>
      find(applyCanvasOps(canvas(), [{ type: "add_node", id: "shot-9", nodeType: type }], { ...context(actor), removed }).document, "shot-9")?.createdBy;
    expect(back("shot")).toEqual(WRITER);
    expect(back("text")).toEqual(PERSON);
    expect(back("shot", BOARDS)).toEqual(BOARDS);
    expect(find(applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "shot" }], { ...context(), removed }).document, "new-1")?.createdBy).toEqual(PERSON);
  });

  it("stops at the most nodes a canvas holds", () => {
    const full = canvas();
    full.nodes = Array.from({ length: CANVAS_MAX_NODES }, (_, index) => node(`n${index}`));
    expect(refused(() => applyCanvasOps(full, [{ type: "add_node", nodeType: "text" }], context())).code).toBe("limit");
  });
});

describe("a node's error", () => {
  it("comes with a node added with it, and names only a generation or canvas line, on a node that generates", () => {
    const error = { status: "error", errorDetails: "That generation is no longer there.", errorKey: "serverError.projectGeneration.jobGone", errorParams: { server: "gen" } } as const;
    const added = applyCanvasOps(canvas(), parseCanvasOps([{ type: "add_node", nodeType: "shot", metadata: { prompt: "Rain", ...error } }]), context());
    expect(find(added.document, "new-1")?.metadata).toEqual({ prompt: "Rain", ...error });
    expect(refused(() => parseCanvasOps([{ type: "add_node", nodeType: "shot", metadata: { ...error, errorKey: "approval.held.outbound" } }])).message)
      .toMatch(/errorKey is a serverError\.projectGeneration or serverError\.projectCanvas key/);
    expect(refused(() => parseCanvasOps([{ type: "add_node", nodeType: "shot", metadata: { errorParams: { "a b": "x" } } }])).code).toBe("invalid_op");
    expect(refused(() => applyCanvasOps(canvas(), parseCanvasOps([{ type: "add_node", nodeType: "text", metadata: { errorKey: "serverError.projectCanvas.noPrompt" } }]), context())).message)
      .toMatch(/a text node takes no errorKey/);
  });
});

describe("a scene's camera positions", () => {
  const hall = (cameras: number) => [{ type: "add_node", id: "hall", nodeType: "text", title: "Hall", metadata: { content: "A hall.", card: { cameras } } }];

  it("are kept on its card as a whole number from 1 to 99", () => {
    const { document } = applyCanvasOps(canvas(), parseCanvasOps(hall(3)), context());
    expect(find(document, "hall")?.metadata?.card).toEqual({ cameras: 3 });
  });

  it("are refused as a fraction, as zero and past 99", () => {
    for (const cameras of [0, 1.5, 100]) {
      expect(refused(() => parseCanvasOps(hall(cameras)))).toMatchObject({ code: "invalid_op" });
    }
  });
});

describe("changing a node", () => {
  it("patches the frame and merges the metadata, a null taking a key away", () => {
    const result = applyCanvasOps(canvas(), [
      { type: "update_node", id: "brief", patch: { title: "Brief", position: { x: 5, y: 6 } }, metadata: { content: "Two brides", fontSize: null } },
    ], context());
    expect(find(result.document, "brief")).toMatchObject({ title: "Brief", position: { x: 5, y: 6 }, metadata: { content: "Two brides" } });
    expect(find(result.document, "brief")?.metadata).not.toHaveProperty("fontSize");
    expect(result.changed.nodes).toEqual(["brief"]);
  });

  it("moves and sizes a bot node and nothing else of it", () => {
    const moved = applyCanvasOps(canvas(), [{ type: "update_node", id: "bot:writer", patch: { position: { x: 880, y: 0 }, width: 320 } }], context());
    expect(find(moved.document, "bot:writer")).toEqual({ id: "bot:writer", type: "bot", title: "", position: { x: 880, y: 0 }, width: 320, height: 180, arranged: true });
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "bot:lead", patch: { title: "Boss" } }], context())).code).toBe("invalid_op");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "bot:gone", patch: { width: 300 } }], context())).code).toBe("not_found");
  });

  it("marks a node the person moves as arranged for good, which sizing it or a bot moving its own does not do", () => {
    const moved = applyCanvasOps(canvas(), [
      { type: "update_node", id: "brief", patch: { position: { x: 5, y: 6 } } },
      { type: "update_node", id: "cover", patch: { width: 400 } },
      { type: "update_node", id: "bot:writer", patch: { width: 320 } },
    ], context());
    expect(find(moved.document, "brief")?.arranged).toBe(true);
    expect(find(moved.document, "cover")).not.toHaveProperty("arranged");
    expect(find(moved.document, "bot:writer")).not.toHaveProperty("arranged");
    const placed = applyCanvasOps(moved.document, [{ type: "update_node", id: "bot:writer", patch: { position: { x: 1, y: 2 } } }], context());
    const resized = applyCanvasOps(placed.document, [{ type: "update_node", id: "bot:writer", patch: { width: 300 } }], context());
    expect(find(resized.document, "bot:writer")).toMatchObject({ position: { x: 1, y: 2 }, width: 300, arranged: true });
    const byBot = applyCanvasOps(canvas(), [{ type: "update_node", id: "shot-1", patch: { position: { x: 9, y: 9 } } }], context(WRITER));
    expect(find(byBot.document, "shot-1")).not.toHaveProperty("arranged");
  });

  it("takes a node out of its group with a null group", () => {
    const result = applyCanvasOps(canvas(), [{ type: "update_node", id: "in-box", patch: { groupId: null } }], context());
    expect(find(result.document, "in-box")).not.toHaveProperty("groupId");
  });

  it("changes a node's error whole: a patch naming any of its fields drops the ones it leaves out", () => {
    const failed = node("storm", { type: "shot", metadata: {
      prompt: "Rain", status: "error", errorDetails: "gen couldn't make it: no faces", errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "no faces" },
    } });
    const start: CanvasDocument = { ...canvas(), nodes: [...canvas().nodes, failed] };
    const reworded = applyCanvasOps(start, [{ type: "update_node", id: "storm", metadata: { errorDetails: "Try a calmer sky." } }], context());
    expect(find(reworded.document, "storm")?.metadata).toEqual({ prompt: "Rain", status: "error", errorDetails: "Try a calmer sky." });
    const cleared = applyCanvasOps(start, [{ type: "update_node", id: "storm", metadata: { status: "idle", errorDetails: null } }], context());
    expect(find(cleared.document, "storm")?.metadata).toEqual({ prompt: "Rain", status: "idle" });
    const moved = applyCanvasOps(start, [{ type: "update_node", id: "storm", patch: { position: { x: 1, y: 2 } }, metadata: { prompt: "Hail" } }], context());
    expect(find(moved.document, "storm")?.metadata).toEqual({ ...failed.metadata, prompt: "Hail" });
  });

  it("lets a bot change its own node and refuses one another made, naming it", () => {
    const own = applyCanvasOps(canvas(), [{ type: "update_node", id: "shot-1", metadata: { prompt: "Wide, dusk" } }], context(WRITER));
    expect(find(own.document, "shot-1")?.metadata?.prompt).toBe("Wide, dusk");
    const theirs = refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "brief", metadata: { content: "Mine now" } }], context(WRITER)));
    expect(theirs.code).toBe("not_yours");
    expect(theirs.nodeId).toBe("brief");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "shot-1", patch: { title: "x" } }], context(BOARDS))).code).toBe("not_yours");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "bot:writer", patch: { width: 400 } }], context(WRITER))).code).toBe("not_yours");
  });
});

describe("deleting nodes", () => {
  it("takes their connections with them and ungroups what a deleted group held", () => {
    const result = applyCanvasOps(canvas(), [{ type: "delete_node", ids: ["shot-1", "box"] }], context());
    expect(result.document.nodes.map((one) => one.id)).toEqual(["bot:lead", "brief", "cover", "in-box"]);
    expect(result.document.connections).toEqual([]);
    expect(find(result.document, "in-box")).not.toHaveProperty("groupId");
    expect(new Set(result.changed.nodes)).toEqual(new Set(["shot-1", "box", "in-box"]));
    expect(new Set(result.changed.connections)).toEqual(new Set(["c-brief", "c-writer"]));
  });

  it("never deletes a bot node, and lets a bot delete only what it made", () => {
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "delete_node", id: "bot:lead" }], context())).code).toBe("invalid_op");
    expect(applyCanvasOps(canvas(), [{ type: "delete_node", id: "shot-1" }], context(WRITER)).document.nodes.some((one) => one.id === "shot-1")).toBe(false);
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "delete_node", id: "cover" }], context(WRITER))).code).toBe("not_yours");
  });
});

describe("connections", () => {
  it("adds a content connection once", () => {
    const first = applyCanvasOps(canvas(), [{ type: "connect_nodes", fromNodeId: "cover", toNodeId: "bot:lead" }], context());
    expect(first.document.connections.at(-1)).toEqual({ id: "new-1", fromNodeId: "cover", toNodeId: "bot:lead", kind: "content" });
    const again = applyCanvasOps(first.document, [{ type: "connect_nodes", fromNodeId: "cover", toNodeId: "bot:lead" }], context());
    expect(again.document.connections).toHaveLength(first.document.connections.length);
    expect(again.connectionIds).toEqual(["new-1"]);
  });

  it("refuses a missing end, a node to itself and two bots", () => {
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "connect_nodes", fromNodeId: "cover", toNodeId: "nowhere" }], context())).code).toBe("not_found");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "connect_nodes", fromNodeId: "cover", toNodeId: "cover" }], context())).code).toBe("invalid_op");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "connect_nodes", fromNodeId: "bot:lead", toNodeId: "bot:writer" }], context())).code).toBe("invalid_op");
  });

  it("lets a bot connect only where one end is its own", () => {
    const into = applyCanvasOps(canvas(), [{ type: "connect_nodes", fromNodeId: "cover", toNodeId: "shot-1" }], context(WRITER));
    expect(into.document.connections.at(-1)).toMatchObject({ fromNodeId: "cover", toNodeId: "shot-1" });
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "connect_nodes", fromNodeId: "cover", toNodeId: "brief" }], context(WRITER))).code).toBe("not_yours");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "delete_connections", id: "c-brief" }], context(BOARDS))).code).toBe("not_yours");
    expect(applyCanvasOps(canvas(), [{ type: "delete_connections", id: "c-brief" }], context(WRITER)).document.connections.map((one) => one.id)).toEqual(["c-writer"]);
  });

  it("finds no stored dispatch connection to delete", () => {
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "delete_connections", id: "dispatch:lead:writer" }], context())).code).toBe("not_found");
  });
});

describe("what a node is in the pipeline", () => {
  const FACES: CanvasNodeCreator = { kind: "bot", botId: "writer" };
  const withStages = (...stages: FlowStage[]): OpsContext => ({ ...context(FACES), stages });
  const character: CanvasOp = { type: "add_node", nodeType: "text", title: "Mei", metadata: { content: "The bride", role: "character" } };

  it("is a character for a text node a bot of the character stage adds, and for no other bot or node", () => {
    const result = applyCanvasOps(canvas(), [character], withStages("character", "storyboard"));
    expect(find(result.document, "new-1")?.metadata).toEqual({ content: "The bride", role: "character" });
    expect(refused(() => applyCanvasOps(canvas(), [character], withStages("storyboard"))).code).toBe("not_allowed");
    expect(refused(() => applyCanvasOps(canvas(), [character], context(FACES))).code).toBe("not_allowed");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "shot", metadata: { prompt: "Mei", role: "character" } }], withStages("character"))).code).toBe("not_allowed");
  });

  it("lets a bot of the character stage add the image node a character's picture is generated in, and no other bot", () => {
    const picture: CanvasOp = { type: "add_node", nodeType: "image", title: "Mei, front", metadata: { prompt: "Front view, white dress", settings: { aspect: "3:4" } } };
    const result = applyCanvasOps(canvas(), [picture], withStages("character"));
    expect(find(result.document, "new-1")).toMatchObject({ type: "image", createdBy: FACES, metadata: { prompt: "Front view, white dress", settings: { aspect: "3:4" } } });
    expect(refused(() => applyCanvasOps(canvas(), [picture], withStages("storyboard", "post"))).code).toBe("not_allowed");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "video" }], withStages("character"))).code).toBe("not_allowed");
  });

  it.each(["script", "creation", "take", "final"] as const)("is never %s because a bot says so", (role) => {
    const refusal = refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", metadata: { role } }], withStages("script", "character", "storyboard", "post")));
    expect(refusal).toMatchObject({ code: "not_allowed", index: 0 });
  });

  it("is not a bot's to say with a shot, a selection or a stale mark either", () => {
    for (const metadata of [{ shotId: "shot-1" }, { selected: true }, { stale: true }]) {
      expect(refused(() => applyCanvasOps(canvas(), [{ type: "add_node", nodeType: "text", metadata }], withStages("character"))).code).toBe("not_allowed");
    }
  });

  it("is left out of a node the person adds, as a pasted copy of a take is a plain video", () => {
    const file = { path: "产出/视频/take.mp4", mime: "video/mp4", bytes: 3, name: "take.mp4" };
    const result = applyCanvasOps(canvas(), [{ type: "add_node", id: "copy", nodeType: "video", metadata: { file, role: "take", shotId: "shot-1", selected: true, stale: true } }], context());
    expect(find(result.document, "copy")?.metadata).toEqual({ file });
    const plain = applyCanvasOps(canvas(), [{ type: "add_node", id: "note", nodeType: "text", metadata: { role: "character" } }], context());
    expect(find(plain.document, "note")).not.toHaveProperty("metadata");
  });

  it("comes back with a deleted node the person adds back, as undo does, and not with a node of another type", () => {
    const removed = (id: string) => (id === "take-9" ? { type: "video" as const, createdBy: WRITER, pipeline: { role: "take" as const, shotId: "shot-1", selected: true as const } } : undefined);
    const back = applyCanvasOps(canvas(), [{ type: "add_node", id: "take-9", nodeType: "video", metadata: { durationMs: 5000, role: "final" } }], { ...context(), removed });
    expect(find(back.document, "take-9")).toMatchObject({ createdBy: WRITER, metadata: { durationMs: 5000, role: "take", shotId: "shot-1", selected: true } });
    const other = applyCanvasOps(canvas(), [{ type: "add_node", id: "take-9", nodeType: "text" }], { ...context(), removed });
    expect(find(other.document, "take-9")).not.toHaveProperty("metadata");
  });

  it("is never changed by an operation on the node, the person's included", () => {
    for (const metadata of [{ role: "script" as const }, { role: null }, { shotId: "shot-1" }, { selected: true }, { stale: null }, { version: 9 }]) {
      expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "brief", metadata }], context())).code).toBe("not_allowed");
      expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "shot-1", metadata }], withStages("character"))).code).toBe("not_allowed");
    }
  });

  it("has no version an operation gives it: a node is added without the one named, and a deleted one comes back with its own", () => {
    const added = applyCanvasOps(canvas(), parseCanvasOps([{ type: "add_node", id: "note", nodeType: "text", metadata: { content: "Swap", version: 9 } }]), context());
    expect(find(added.document, "note")?.metadata).toEqual({ content: "Swap" });
    const byBot = applyCanvasOps(canvas(), parseCanvasOps([{ type: "add_node", nodeType: "text", title: "Mei", metadata: { content: "The bride", role: "character", version: 9 } }]), withStages("character"));
    expect(find(byBot.document, "new-1")?.metadata).toEqual({ content: "The bride", role: "character" });
    const removed = (id: string) => (id === "ep-1" ? { type: "text" as const, createdBy: WRITER, pipeline: { role: "episode" as const, episode: 1, version: 3 } } : undefined);
    const back = applyCanvasOps(canvas(), parseCanvasOps([{ type: "add_node", id: "ep-1", nodeType: "text", metadata: { content: "Scene 1", version: 9 } }]), { ...context(), removed });
    expect(find(back.document, "ep-1")?.metadata).toEqual({ content: "Scene 1", role: "episode", episode: 1, version: 3 });
  });
});

describe("a connection the server made for the pipeline", () => {
  const linked = (): CanvasDocument => {
    const document = canvas();
    document.connections.push({ id: "c-flow", fromNodeId: "shot-1", toNodeId: "brief", kind: "content", pipeline: true });
    return document;
  };

  it("is not a bot's to delete, though one end is its own", () => {
    const refusal = refused(() => applyCanvasOps(linked(), [{ type: "delete_connections", ids: ["c-writer", "c-flow"] }], context(WRITER)));
    expect(refusal).toMatchObject({ code: "not_allowed", index: 0 });
    expect(refusal.message).toMatch(/c-flow.*pipeline/);
  });

  it("is the person's to delete, and goes with a node a bot deletes", () => {
    expect(applyCanvasOps(linked(), [{ type: "delete_connections", id: "c-flow" }], context()).document.connections.map((one) => one.id)).toEqual(["c-brief", "c-writer"]);
    expect(applyCanvasOps(linked(), [{ type: "delete_node", id: "shot-1" }], context(WRITER)).document.connections).toEqual([]);
  });

  it("stays one when a bot connects the same two nodes again", () => {
    const result = applyCanvasOps(linked(), [{ type: "connect_nodes", fromNodeId: "shot-1", toNodeId: "brief" }], context(WRITER));
    expect(result.connectionIds).toEqual(["c-flow"]);
    expect(result.document.connections.at(-1)).toMatchObject({ id: "c-flow", pipeline: true });
  });
});

describe("the view", () => {
  it("is the person's to set, never a bot's", () => {
    const result = applyCanvasOps(canvas(), [{ type: "set_viewport", viewport: { x: 10, y: -4, k: 0.5 } }, { type: "set_background", backgroundMode: "blank" }], context());
    expect(result.document.viewport).toEqual({ x: 10, y: -4, k: 0.5 });
    expect(result.document.backgroundMode).toBe("blank");
    expect(result.changed).toMatchObject({ viewport: true, backgroundMode: true });
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "set_background", backgroundMode: "lines" }], context(WRITER))).code).toBe("not_allowed");
  });
});

describe("a batch", () => {
  it("applies whole or not at all, and says which operation failed", () => {
    const before = canvas();
    const snapshot = structuredClone(before);
    const failure = refused(() => applyCanvasOps(before, [
      { type: "update_node", id: "brief", patch: { title: "Changed" } },
      { type: "delete_node", id: "nowhere" },
    ], context()));
    expect(failure.index).toBe(1);
    expect(before).toEqual(snapshot);
  });

  it("is read strictly", () => {
    expect(refused(() => parseCanvasOps("add a node")).code).toBe("invalid_op");
    expect(refused(() => parseCanvasOps([{ type: "select_nodes", ids: [] }])).code).toBe("invalid_op");
    expect(refused(() => parseCanvasOps([{ type: "set_viewport", viewport: { x: 0, y: 0, k: 1 }, extra: true }])).code).toBe("invalid_op");
    expect(refused(() => parseCanvasOps([{ type: "add_node", nodeType: "text", position: { x: Number.NaN, y: 0 } }])).code).toBe("invalid_op");
    expect(refused(() => parseCanvasOps(Array.from({ length: CANVAS_MAX_OPS + 1 }, () => ({ type: "delete_node", id: "x" })))).code).toBe("limit");
    expect(parseCanvasOps([{ type: "delete_node", id: "x" }])).toEqual([{ type: "delete_node", id: "x" }]);
  });

  it("names what it touches, for merging", () => {
    const ops: CanvasOp[] = [
      { type: "add_node", nodeType: "text" },
      { type: "add_node", id: "named", nodeType: "text" },
      { type: "update_node", id: "brief", patch: { title: "x" } },
      { type: "delete_node", ids: ["cover", "box"] },
      { type: "connect_nodes", id: "c-new", fromNodeId: "brief", toNodeId: "cover" },
      { type: "delete_connections", ids: ["c-brief"] },
      { type: "set_viewport", viewport: { x: 0, y: 0, k: 1 } },
    ];
    expect(opTargets(ops)).toEqual({ nodes: ["named", "brief", "cover", "box"], connections: ["c-new", "c-brief"], viewport: true });
  });
});
