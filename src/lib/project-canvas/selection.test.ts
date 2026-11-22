import { describe, expect, it } from "vitest";
import type { CanvasConnection, CanvasNode } from "../../../shared/project-canvas";
import { clickSelection, copySelection, dragNodeIds, duplicateNode, nodesInRect, pasteClipboard, rectFromPoints } from "./selection";

const node = (id: string, x: number, y: number, over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "text", title: id, position: { x, y }, width: 100, height: 80, ...over });
const link = (id: string, fromNodeId: string, toNodeId: string, kind: CanvasConnection["kind"] = "content"): CanvasConnection => ({ id, fromNodeId, toNodeId, kind });

describe("selecting", () => {
  it("selects what a marquee touches, drawn either way", () => {
    const nodes = [node("a", 0, 0), node("b", 200, 0), node("c", 0, 300)];
    expect(nodesInRect(nodes, rectFromPoints({ x: 250, y: 50 }, { x: 50, y: 10 }))).toEqual(["a", "b"]);
    expect(nodesInRect(nodes, rectFromPoints({ x: 120, y: 100 }, { x: 180, y: 200 }))).toEqual([]);
  });

  it("selects a clicked node alone, keeps a selection clicked inside it, and toggles with a modifier", () => {
    expect([...clickSelection(new Set(["a", "b"]), "c", false)]).toEqual(["c"]);
    expect([...clickSelection(new Set(["a", "b"]), "a", false)]).toEqual(["a", "b"]);
    expect([...clickSelection(new Set(["a", "b"]), "a", true)]).toEqual(["b"]);
    expect([...clickSelection(new Set(["a"]), "c", true)]).toEqual(["a", "c"]);
  });

  it("drags a selected group with its members", () => {
    const nodes = [node("g", 0, 0, { type: "group" }), node("a", 0, 0, { groupId: "g" }), node("b", 0, 0)];
    expect([...dragNodeIds(new Set(["g"]), nodes)].sort()).toEqual(["a", "g"]);
  });
});

describe("copy and paste", () => {
  const nodes = [
    node("g", 0, 0, { type: "group", width: 300, height: 200 }),
    node("a", 20, 50, { groupId: "g", metadata: { content: "hi", status: "loading", jobId: "job1" }, createdBy: { kind: "bot", botId: "b1" } }),
    node("b", 400, 50, { groupId: "g" }),
    node("bot:b1", 0, 400, { type: "bot" }),
  ];
  const connections = [link("c1", "a", "b"), link("c2", "bot:b1", "a"), link("d", "bot:b1", "bot:b2", "dispatch")];
  let counter = 0;
  const options = { newId: () => `n${++counter}`, copyTitle: (title: string) => `${title} Copy` };

  it("copies content nodes with what leads into them, never a bot node or a dispatch line", () => {
    const clipboard = copySelection(new Set(["a", "b", "bot:b1"]), nodes, connections)!;
    expect(clipboard.nodes.map((item) => item.id)).toEqual(["a", "b"]);
    expect(clipboard.connections.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(copySelection(new Set(["bot:b1"]), nodes, connections)).toBeNull();
  });

  it("pastes centred on a point with new ids, copy titles and the connections remapped", () => {
    counter = 0;
    const clipboard = copySelection(new Set(["a", "b"]), nodes, connections)!;
    const pasted = pasteClipboard(clipboard, { ...options, center: { x: 1000, y: 1000 } });
    expect(pasted.nodes.map((item) => [item.id, item.title, item.position, item.groupId])).toEqual([
      ["n1", "a Copy", { x: 760, y: 960 }, undefined],
      ["n2", "b Copy", { x: 1140, y: 960 }, undefined],
    ]);
    expect(pasted.nodes[0]!.metadata).toEqual({ content: "hi" });
    expect(pasted.nodes[0]!.createdBy).toBeUndefined();
    expect(pasted.connections).toEqual([link("n3", "n1", "n2"), link("n4", "bot:b1", "n1")]);
  });

  it("copies a node of the pipeline as a plain node, leaving the marks only the server sets", () => {
    counter = 0;
    const take: CanvasNode = { ...nodes[1]!, id: "take", metadata: { role: "take", shotId: "s", selected: true, stale: true, durationMs: 5000 } };
    const pasted = pasteClipboard({ nodes: [take], connections: [{ id: "c", fromNodeId: "a", toNodeId: "take", kind: "content", pipeline: true }] }, { ...options, center: { x: 0, y: 0 } });
    expect(pasted.nodes[0]!.metadata).toEqual({ durationMs: 5000 });
    expect(pasted.connections).toEqual([link("n2", "a", "n1")]);
  });

  it("keeps a member in its group when the group is pasted too", () => {
    counter = 0;
    const pasted = pasteClipboard(copySelection(new Set(["g", "a"]), nodes, connections)!, { ...options, center: { x: 0, y: 0 } });
    expect(pasted.nodes.map((item) => [item.id, item.groupId])).toEqual([["n1", undefined], ["n2", "n1"]]);
  });

  it("duplicates one node beside itself with its references", () => {
    counter = 0;
    const copy = duplicateNode(nodes[1]!, connections, options);
    expect(copy.nodes[0]!.position).toEqual({ x: 56, y: 86 });
    expect(copy.connections).toEqual([link("n2", "bot:b1", "n1")]);
  });
});
