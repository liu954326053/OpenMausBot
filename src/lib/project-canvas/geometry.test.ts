import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../../../shared/project-canvas";
import {
  actualSizeViewport,
  applyGroupSelection,
  applyUngroupSelection,
  canGroupSelection,
  canUngroupSelection,
  connectionCurve,
  connectionDropTarget,
  curveInView,
  DISPATCH_CLEARANCE,
  dispatchCurve,
  fitNodeSize,
  focusViewportForNode,
  gridBackground,
  groupWrapRect,
  intersects,
  nodeBounds,
  normalizeConnection,
  panelPlacement,
  resizeFrame,
  screenToWorld,
  settleDraggedNodes,
  visibleBounds,
  zoomAroundCenter,
  zoomAtPoint,
} from "./geometry";

const node = (id: string, x: number, y: number, over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "text", title: id, position: { x, y }, width: 100, height: 80, ...over });

describe("the view a canvas opens on", () => {
  const size = { width: 1200, height: 800 };

  it("is at 100% with what fits in the middle, clear of the toolbar below", () => {
    const lead = node("lead", 500, 200, { width: 300, height: 180 });
    const view = actualSizeViewport(nodeBounds([lead]), size);
    expect(view.k).toBe(1);
    expect(view.x + lead.position.x).toBe((1200 - 300) / 2);
    expect(view.y + lead.position.y).toBe(80 + (800 - 80 - 96 - 180) / 2);
  });

  it("is at 100% from the top left of what does not fit", () => {
    const wide = [node("a", -50, 10, { width: 300 }), node("b", 2000, 900, { width: 300 })];
    expect(actualSizeViewport(nodeBounds(wide), size)).toEqual({ x: 80 + 50, y: 80 - 10, k: 1 });
  });
});

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

  it("lets a person connect into a bot but never out of one", () => {
    const bot = node("bot:a", 0, 0, { type: "bot" });
    const text = node("t", 0, 0);
    expect(normalizeConnection(text, bot, "source")).toEqual({ fromNodeId: "t", toNodeId: "bot:a" });
    expect(normalizeConnection(bot, text, "target")).toEqual({ fromNodeId: "t", toNodeId: "bot:a" });
    expect(normalizeConnection(text, bot, "target")).toBeNull();
    expect(normalizeConnection(bot, text, "source")).toBeNull();
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

  it("fits a node to its picture's shape, no larger than 640 and no smaller than a node can be resized to", () => {
    expect(fitNodeSize(320, 180)).toEqual({ width: 320, height: 180 });
    expect(fitNodeSize(2000, 1000)).toEqual({ width: 640, height: 320 });
    expect(fitNodeSize(48, 48)).toEqual({ width: 220, height: 220 });
    expect(fitNodeSize(48, 24)).toEqual({ width: 320, height: 160 });
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

describe("a node's panel", () => {
  const canvas = { width: 1200, height: 800 };
  const bot = (x: number, y: number) => node("bot", x, y, { width: 300, height: 180 });
  const still = { x: 0, y: 0, k: 1 };

  it("sits 16px under its node and centred on it, 600 wide, where the canvas has room", () => {
    expect(panelPlacement(bot(300, 100), still, 240, canvas)).toEqual({ left: 150, top: 296, width: 600, maxHeight: 768 });
  });

  it("moves along the left or right edge only as far as keeps it on the canvas", () => {
    expect(panelPlacement(bot(10, 100), still, 240, canvas)).toMatchObject({ left: 16, top: 296 });
    expect(panelPlacement(bot(-200, 100), still, 240, canvas)).toMatchObject({ left: 16, top: 296 });
    expect(panelPlacement(bot(890, 100), still, 240, canvas)).toMatchObject({ left: 1200 - 16 - 600, top: 296 });
  });

  it("goes above its node with no room under it, to the side with more room when neither has enough, and past no edge", () => {
    expect(panelPlacement(bot(300, 560), still, 240, canvas).top).toBe(560 - 28 - 16 - 240);
    expect(panelPlacement(bot(300, 300), still, 600, canvas).top).toBe(800 - 16 - 600);
    expect(panelPlacement(bot(300, 520), still, 600, canvas).top).toBe(16);
    expect(panelPlacement(bot(300, -100), still, 240, canvas).top).toBe(96);
    expect(panelPlacement(bot(300, -400), still, 240, canvas).top).toBe(16);
  });

  it("fits a canvas smaller than itself, as wide and as tall as the canvas allows", () => {
    expect(panelPlacement(bot(100, 50), still, 900, { width: 500, height: 600 })).toEqual({ left: 16, top: 16, width: 468, maxHeight: 568 });
  });

  it("keeps its size on screen at any zoom, under its node as drawn", () => {
    expect(panelPlacement(bot(400, 200), { x: 100, y: 50, k: 0.5 }, 240, canvas)).toEqual({ left: 75, top: 256, width: 600, maxHeight: 768 });
  });

  it("is wholly on the canvas wherever its node is", () => {
    const outside: unknown[] = [];
    for (let x = -600; x <= 1500; x += 75) {
      for (let y = -500; y <= 1100; y += 75) {
        for (const height of [120, 360, 700, 1200]) {
          const place = panelPlacement(bot(x, y), still, height, canvas);
          const bottom = place.top + Math.min(height, place.maxHeight);
          if (place.left < 16 || place.left + place.width > 1200 - 16 || place.top < 16 || bottom > 800 - 16) outside.push({ x, y, height, place });
        }
      }
    }
    expect(outside).toEqual([]);
  });
});

describe("the line between two bots", () => {
  const bot = (id: string, x: number, y: number): CanvasNode => ({ id, type: "bot", title: id, position: { x, y }, width: 300, height: 180 });

  it("is the plain curve to a bot on the right with nothing in between", () => {
    const from = bot("a", 0, 0);
    const to = bot("b", 420, 0);
    expect(dispatchCurve(from, to, [bot("below", 320, 400)])).toEqual(connectionCurve(from, to));
  });

  it("goes over the nodes that stand between the two bots, clear of their labels, and is in view where only its top is", () => {
    const from = bot("writer", 0, 0);
    const to = bot("boarder", 1600, 0);
    const made = node("script", 348, 0);
    const between = bot("designer", 800, -40);
    const curve = dispatchCurve(from, to, [made, between, bot("elsewhere", 800, 600)]);
    const top = -40 - DISPATCH_CLEARANCE;
    expect(curve.start).toEqual({ x: 300, y: 90 });
    expect(curve.end).toEqual({ x: 1600, y: 90 });
    expect(curve.box).toEqual({ left: 300, top, right: 1600, bottom: 90 });
    expect(curve.path).toBe(`M 300 90 C 324 90, 324 ${top}, 348 ${top} L 1552 ${top} C 1576 ${top}, 1576 90, 1600 90`);
    expect(curveInView(curve, { left: 600, top: top - 10, right: 700, bottom: top + 10 })).toBe(true);
    expect(curveInView(curve, { left: 600, top: top - 200, right: 700, bottom: top - 100 })).toBe(false);
  });

  it("leaves a bot by its left side for a bot that is not to its right, as the bots outside the pipeline stand below the lead", () => {
    const from = bot("lead", 100, 0);
    const to = bot("voice", 100, 244);
    const curve = dispatchCurve(from, to, []);
    expect(curve.start).toEqual({ x: 100, y: 90 });
    expect(curve.end).toEqual({ x: 100, y: 334 });
    expect(curve.path).toBe("M 100 90 C 39 90, 39 334, 100 334");
    expect(curveInView(curve, { left: 50, top: 150, right: 90, bottom: 250 })).toBe(true);
    expect(curveInView(curve, { left: 120, top: 150, right: 400, bottom: 250 })).toBe(false);
  });
});

