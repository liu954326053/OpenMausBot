import { describe, expect, it } from "vitest";

import { CANVAS_MAX_NODES, CANVAS_MAX_OPS, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasOp } from "../../shared/project-canvas.ts";
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

  it("stops at the most nodes a canvas holds", () => {
    const full = canvas();
    full.nodes = Array.from({ length: CANVAS_MAX_NODES }, (_, index) => node(`n${index}`));
    expect(refused(() => applyCanvasOps(full, [{ type: "add_node", nodeType: "text" }], context())).code).toBe("limit");
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
    expect(find(moved.document, "bot:writer")).toEqual({ id: "bot:writer", type: "bot", title: "", position: { x: 880, y: 0 }, width: 320, height: 180 });
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "bot:lead", patch: { title: "Boss" } }], context())).code).toBe("invalid_op");
    expect(refused(() => applyCanvasOps(canvas(), [{ type: "update_node", id: "bot:gone", patch: { width: 300 } }], context())).code).toBe("not_found");
  });

  it("takes a node out of its group with a null group", () => {
    const result = applyCanvasOps(canvas(), [{ type: "update_node", id: "in-box", patch: { groupId: null } }], context());
    expect(find(result.document, "in-box")).not.toHaveProperty("groupId");
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
