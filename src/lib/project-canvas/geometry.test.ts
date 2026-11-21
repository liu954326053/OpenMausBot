import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../../../shared/project-canvas";
import {
  applyGroupSelection,
  applyUngroupSelection,
  canGroupSelection,
  canUngroupSelection,
  connectionCurve,
  connectionDropTarget,
  curveInView,
  focusViewportForNode,
  gridBackground,
  groupWrapRect,
  intersects,
  normalizeConnection,
  resizeFrame,
  screenToWorld,
  settleDraggedNodes,
  visibleBounds,
  zoomAroundCenter,
  zoomAtPoint,
} from "./geometry";

const node = (id: string, x: number, y: number, over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "text", title: id, position: { x, y }, width: 100, height: 80, ...over });

describe("the viewport", () => {
  it("zooms about the pointer, the world point under it staying put, within 5% and 500%", () => {
    const viewport = { x: 40, y: 20, k: 1 };
    const pointer = { x: 300, y: 200 };
    const zoomed = zoomAtPoint(viewport, pointer, -100);
    expect(zoomed.k).toBeCloseTo(1.1);
    expect(screenToWorld(zoomed, pointer).x).toBeCloseTo(screenToWorld(viewport, pointer).x);
    expect(screenToWorld(zoomed, pointer).y).toBeCloseTo(screenToWorld(viewport, pointer).y);
    expect(zoomAtPoint({ x: 0, y: 0, k: 4.9 }, pointer, -1000).k).toBe(5);
    expect(zoomAtPoint({ x: 0, y: 0, k: 0.06 }, pointer, 1000).k).toBe(0.05);
  });

  it("sets a zoom from the controls about the middle of the canvas", () => {
    const size = { width: 1000, height: 600 };
    const viewport = { x: 100, y: 50, k: 1 };
    const zoomed = zoomAroundCenter(viewport, size, 2);
    expect(screenToWorld(zoomed, { x: 500, y: 300 })).toEqual(screenToWorld(viewport, { x: 500, y: 300 }));
    expect(zoomAroundCenter(viewport, size, 9).k).toBe(5);
  });

  it("draws the grid every 48 world units, with smaller dots far out", () => {
    expect(gridBackground({ x: 100, y: -10, k: 1 })).toEqual({ size: 48, x: 4, y: -10, dot: 1.15 });
    expect(gridBackground({ x: 0, y: 0, k: 0.1 }).dot).toBe(0.8);
  });

  it("culls what lies outside the view and its margin", () => {
    const bounds = visibleBounds({ x: 0, y: 0, k: 1 }, { width: 800, height: 600 });
    expect(bounds).toEqual({ left: -280, top: -280, right: 1080, bottom: 880 });
    expect(intersects(node("a", 1000, 100), bounds)).toBe(true);
    expect(intersects(node("a", 1100, 100), bounds)).toBe(false);
  });
});

describe("connections", () => {
  it("curves from the right middle of one node to the left middle of the other", () => {
    const curve = connectionCurve(node("a", 0, 0), node("b", 300, 100));
    expect(curve.path).toBe("M 100 40 C 200 40, 200 140, 300 140");
    expect(connectionCurve(node("a", 0, 0), node("b", 120, 0)).curvature).toBe(50);
    expect(curveInView(curve, { left: 150, top: 0, right: 250, bottom: 200 })).toBe(true);
    expect(curveInView(curve, { left: 500, top: 0, right: 600, bottom: 200 })).toBe(false);
  });

  it("runs from the node dragged from its right dot, into it from its left dot, and always into a config", () => {
    const text = node("t", 0, 0);
    const image = node("i", 200, 0, { type: "image" });
    const config = node("c", 400, 0, { type: "config" });
    expect(normalizeConnection(text, image, "source")).toEqual({ fromNodeId: "t", toNodeId: "i" });
    expect(normalizeConnection(text, image, "target")).toEqual({ fromNodeId: "i", toNodeId: "t" });
    expect(normalizeConnection(text, config, "target")).toEqual({ fromNodeId: "t", toNodeId: "c" });
    expect(normalizeConnection(config, text, "target")).toEqual({ fromNodeId: "t", toNodeId: "c" });
  });

  it("never connects into a group, between two configs, between two bots, or a node to itself", () => {
    const group = node("g", 0, 0, { type: "group" });
    const text = node("t", 0, 0);
    expect(normalizeConnection(text, group, "source")).toBeNull();
    expect(normalizeConnection(group, text, "source")).toEqual({ fromNodeId: "g", toNodeId: "t" });
    expect(normalizeConnection(node("c1", 0, 0, { type: "config" }), node("c2", 0, 0, { type: "config" }), "target")).toBeNull();
    expect(normalizeConnection(node("bot:a", 0, 0, { type: "bot" }), node("bot:b", 0, 0, { type: "bot" }), "source")).toBeNull();
    expect(normalizeConnection(text, text, "source")).toBeNull();
  });

  it("lands on the node under the pointer before one whose dot or margin is near", () => {
    const from = node("a", 0, 0);
    const near = node("b", 300, 0);
    const under = node("c", 300, 200);
    const nodes = [from, near, under];
    expect(connectionDropTarget(nodes, from, "source", { x: 350, y: 240 }, 1)).toEqual({ nodeId: "c", nearNode: true });
    expect(connectionDropTarget(nodes, from, "source", { x: 290, y: 40 }, 1)).toEqual({ nodeId: "b", nearNode: true });
    expect(connectionDropTarget(nodes, from, "source", { x: 900, y: 900 }, 1)).toEqual({ nodeId: null, nearNode: false });
    expect(connectionDropTarget(nodes, from, "source", { x: 50, y: 40 }, 1)).toEqual({ nodeId: null, nearNode: true });
  });
});

describe("groups", () => {
  it("wraps members with room for the title above", () => {
    expect(groupWrapRect([node("a", 0, 0), node("b", 200, 100)])).toEqual({ x: -24, y: -52, width: 348, height: 256 });
  });

  it("groups two or more nodes that are not already one group, never a bot", () => {
    const nodes = [node("a", 0, 0), node("b", 200, 0), node("bot:x", 0, 300, { type: "bot" })];
    expect(canGroupSelection(new Set(["a", "b"]), nodes)).toBe(true);
    expect(canGroupSelection(new Set(["a", "bot:x"]), nodes)).toBe(false);
    const grouped = applyGroupSelection(new Set(["a", "b"]), nodes, node("g", -24, -52, { type: "group" }))!;
    expect(grouped.selectedIds).toEqual(["g"]);
    expect(grouped.nodes.map((item) => [item.id, item.groupId])).toEqual([["g", undefined], ["a", "g"], ["b", "g"], ["bot:x", undefined]]);
    expect(canGroupSelection(new Set(["a", "b"]), grouped.nodes)).toBe(false);
  });

  it("flattens a selected group into the new one and drops groups left empty", () => {
    const nodes = [node("g1", 0, 0, { type: "group" }), node("a", 0, 0, { groupId: "g1" }), node("b", 0, 0, { groupId: "g1" }), node("c", 0, 0)];
    const grouped = applyGroupSelection(new Set(["g1", "c"]), nodes, node("g2", 0, 0, { type: "group" }))!;
    expect(grouped.nodes.map((item) => [item.id, item.groupId])).toEqual([["g2", undefined], ["a", "g2"], ["b", "g2"], ["c", "g2"]]);
  });

  it("ungroups a selected group or member, and drops the group once empty", () => {
    const nodes = [node("g", 0, 0, { type: "group" }), node("a", 0, 0, { groupId: "g" }), node("b", 0, 0, { groupId: "g" })];
    expect(canUngroupSelection(new Set(["a"]), nodes)).toBe(true);
    expect(canUngroupSelection(new Set(["x"]), nodes)).toBe(false);
    const all = applyUngroupSelection(new Set(["g"]), nodes)!;
    expect(all.nodes.map((item) => [item.id, item.groupId])).toEqual([["a", undefined], ["b", undefined]]);
    expect(all.selectedIds).toEqual(["a", "b"]);
    const one = applyUngroupSelection(new Set(["a"]), nodes)!;
    expect(one.nodes.map((item) => [item.id, item.groupId])).toEqual([["g", undefined], ["a", undefined], ["b", "g"]]);
  });

  it("snaps nodes dropped on a group inside its padding, and lets a node leave a group by moving out", () => {
    const group = node("g", 0, 0, { type: "group", width: 400, height: 300 });
    const dropped = settleDraggedNodes(new Set(["a"]), [group, node("a", 340, 100)]);
    expect(dropped[1]).toMatchObject({ groupId: "g", position: { x: 276, y: 100 } });
    const left = settleDraggedNodes(new Set(["a"]), [group, node("a", 900, 100, { groupId: "g" })]);
    expect(left[1]!.groupId).toBeUndefined();
    const bot = settleDraggedNodes(new Set(["bot:x"]), [group, node("bot:x", 100, 100, { type: "bot" })]);
    expect(bot[1]!.groupId).toBeUndefined();
  });
});

describe("resizing", () => {
  const start = { corner: "bottom-right" as const, left: 0, top: 0, width: 400, height: 300, ratio: null };

  it("never goes under 220 by 160", () => {
    expect(resizeFrame(start, -1000, -1000)).toEqual({ width: 220, height: 160, position: { x: 0, y: 0 } });
  });

  it("keeps the opposite corner still when dragged from the top left", () => {
    expect(resizeFrame({ ...start, corner: "top-left" }, 100, 50)).toEqual({ width: 300, height: 250, position: { x: 100, y: 50 } });
  });

  it("keeps an image's ratio", () => {
    const frame = resizeFrame({ ...start, ratio: 2 }, 200, 10);
    expect(frame.width).toBe(600);
    expect(frame.height).toBe(300);
  });
});

describe("focusing a node", () => {
  it("centres it at no more than 100%, its panel below nearer the bottom", () => {
    const target = focusViewportForNode(node("a", 1000, 500), { width: 1000, height: 800 });
    expect(target.k).toBe(1);
    expect(target.x).toBe(1000 / 2 - 1050);
    const withPanel = focusViewportForNode(node("a", 0, 0), { width: 1000, height: 800 }, { below: 200, bottomInset: 80 });
    expect(withPanel.k).toBe(1);
    expect(withPanel.y).toBeGreaterThan(focusViewportForNode(node("a", 0, 0), { width: 1000, height: 800 }).y - 200);
  });
});
