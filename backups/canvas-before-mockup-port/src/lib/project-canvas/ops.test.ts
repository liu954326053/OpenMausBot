import { describe, expect, it } from "vitest";
import { CANVAS_TEXT_MAX_HEIGHT, type CanvasConnection, type CanvasDocument, type CanvasNode } from "../../../shared/project-canvas";
import { applyCanvasOps } from "./ops";

const node = (id: string, over: Partial<CanvasNode> = {}): CanvasNode => ({
  id, type: "text", title: id, position: { x: 0, y: 0 }, width: 340, height: 240, createdBy: { kind: "person" }, ...over,
});
const link = (id: string, fromNodeId: string, toNodeId: string, kind: CanvasConnection["kind"] = "content"): CanvasConnection => ({ id, fromNodeId, toNodeId, kind });
const doc = (nodes: CanvasNode[], connections: CanvasConnection[] = []): CanvasDocument => ({
  projectId: "p", revision: 3, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots",
});

describe("applyCanvasOps", () => {
  it("adds a node made by the person, with the type's size when none is given, and never a second one with the same id", () => {
    const next = applyCanvasOps(doc([node("a")]), [
      { type: "add_node", id: "b", nodeType: "video", title: "Clip", position: { x: 10, y: 20 } },
      { type: "add_node", id: "a", nodeType: "image", title: "Again" },
    ]);
    expect(next.nodes.map((item) => item.id)).toEqual(["a", "b"]);
    expect(next.nodes[1]).toEqual({ id: "b", type: "video", title: "Clip", position: { x: 10, y: 20 }, width: 420, height: 236, createdBy: { kind: "person" } });
    expect(next.nodes[0]!.title).toBe("a");
  });

  it("keeps a text node no taller than a text node may be, as the server does, and any other node as tall as asked", () => {
    const next = applyCanvasOps(doc([node("a"), node("pic", { type: "image" })]), [
      { type: "add_node", id: "long", nodeType: "text", height: 2_000 },
      { type: "update_node", id: "a", patch: { height: 900 } },
      { type: "update_node", id: "pic", patch: { height: 900 } },
    ]);
    expect(next.nodes.map((item) => [item.id, item.height])).toEqual([["a", CANVAS_TEXT_MAX_HEIGHT], ["pic", 900], ["long", CANVAS_TEXT_MAX_HEIGHT]]);
  });

  it("patches a node's frame, a node moved then the person's to place, and merges its metadata, a null removing the key and the group", () => {
    const start = doc([node("g", { type: "group" }), node("a", { groupId: "g", metadata: { content: "hi", fontSize: 14, settings: { model: "m1", aspect: "1:1" } } })]);
    const next = applyCanvasOps(start, [
      { type: "update_node", id: "a", patch: { title: "A", position: { x: 5, y: 6 }, groupId: null }, metadata: { fontSize: null, settings: { model: "m2" } } },
      { type: "update_node", id: "g", patch: { width: 500 } },
      { type: "update_node", id: "missing", patch: { title: "nobody" } },
    ]);
    expect(next.nodes[1]).toEqual(node("a", { title: "A", position: { x: 5, y: 6 }, arranged: true, metadata: { content: "hi", settings: { model: "m2" } } }));
    expect(next.nodes[0]).toEqual(node("g", { type: "group", width: 500 }));
    expect(next.nodes).toHaveLength(2);
  });

  it("lets a bot node only move and resize", () => {
    const bot = node("bot:b1", { type: "bot", title: "", createdBy: undefined });
    const next = applyCanvasOps(doc([bot]), [{ type: "update_node", id: "bot:b1", patch: { title: "X", position: { x: 1, y: 2 }, width: 400, groupId: "g" }, metadata: { content: "x" } }]);
    expect(next.nodes[0]).toEqual({ ...bot, position: { x: 1, y: 2 }, width: 400, arranged: true });
  });

  it("deletes nodes with their connections and ungroups what a deleted group held, but never a bot node", () => {
    const start = doc(
      [node("g", { type: "group" }), node("a", { groupId: "g" }), node("b"), node("bot:x", { type: "bot", createdBy: undefined })],
      [link("c1", "a", "b"), link("c2", "b", "bot:x"), link("d", "bot:x", "bot:y", "dispatch")],
    );
    const next = applyCanvasOps(start, [{ type: "delete_node", ids: ["g", "b", "bot:x"] }]);
    expect(next.nodes.map((item) => item.id)).toEqual(["a", "bot:x"]);
    expect(next.nodes[0]!.groupId).toBeUndefined();
    expect(next.connections.map((item) => item.id)).toEqual(["d"]);
    expect(applyCanvasOps(start, [{ type: "delete_node", id: "a" }]).nodes.map((item) => item.id)).toEqual(["g", "b", "bot:x"]);
  });

  it("connects two nodes once, never a node to itself or to one that is not there", () => {
    const start = doc([node("a"), node("b")]);
    const next = applyCanvasOps(start, [
      { type: "connect_nodes", id: "c1", fromNodeId: "a", toNodeId: "b" },
      { type: "connect_nodes", id: "c2", fromNodeId: "a", toNodeId: "b" },
      { type: "connect_nodes", id: "c3", fromNodeId: "a", toNodeId: "a" },
      { type: "connect_nodes", id: "c4", fromNodeId: "a", toNodeId: "z" },
    ]);
    expect(next.connections).toEqual([link("c1", "a", "b")]);
  });

  it("deletes content connections, never a dispatch connection", () => {
    const start = doc([node("a"), node("b")], [link("c1", "a", "b"), link("d", "a", "b", "dispatch")]);
    expect(applyCanvasOps(start, [{ type: "delete_connections", ids: ["c1", "d"] }]).connections).toEqual([link("d", "a", "b", "dispatch")]);
    expect(applyCanvasOps(start, [{ type: "delete_connections", id: "c1" }]).connections).toEqual([link("d", "a", "b", "dispatch")]);
  });

  it("sets the viewport and the background, and keeps the rest of a snapshot as it is", () => {
    const start = { ...doc([]), bots: { b1: "kept" } };
    const next = applyCanvasOps(start, [{ type: "set_viewport", viewport: { x: 4, y: 5, k: 2 } }, { type: "set_background", backgroundMode: "blank" }]);
    expect(next).toEqual({ ...start, viewport: { x: 4, y: 5, k: 2 }, backgroundMode: "blank" });
  });
});
