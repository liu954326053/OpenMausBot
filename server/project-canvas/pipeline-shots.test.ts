import { describe, expect, it } from "vitest";

import type { CanvasDocument, CanvasNode, CanvasNodeMetadata } from "../../shared/project-canvas.ts";
import { listShots } from "./pipeline-shots.ts";

const node = (id: string, type: CanvasNode["type"], metadata?: CanvasNodeMetadata): CanvasNode =>
  ({ id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, ...(metadata ? { metadata } : {}) });
const canvas = (nodes: CanvasNode[]): CanvasDocument =>
  ({ projectId: "p1", revision: 1, nodes, connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" });
const clip = (name: string) => ({ path: `产出/${name}`, mime: "video/mp4", bytes: 3, name });

describe("the shots the pipeline lists", () => {
  it("go episode by episode in the order they were added, each with its first creation node and its first selected take that has a file", () => {
    const document = canvas([
      node("make-2b", "config", { role: "creation", shotId: "shot-2", status: "error" }),
      node("shot-2", "shot", { episode: 2, prompt: "Ring" }),
      node("take-2a", "video", { role: "take", shotId: "shot-2", selected: true }),
      node("shot-0", "shot", { prompt: "Rain" }),
      node("shot-1", "shot", { episode: 1 }),
      node("make-2a", "config", { role: "creation", shotId: "shot-2", status: "success" }),
      node("take-2b", "video", { role: "take", shotId: "shot-2", selected: true, file: clip("b.mp4"), durationMs: 4000, naturalWidth: 1280, naturalHeight: 720 }),
      node("take-2c", "video", { role: "take", shotId: "shot-2", selected: true, file: clip("c.mp4") }),
      node("shot-3", "shot", { episode: 2, prompt: "Veil" }),
      node("make-3", "config", { role: "creation", shotId: "shot-3", status: "loading" }),
      node("take-3", "video", { role: "take", shotId: "shot-3", file: clip("d.mp4") }),
      node("take-9", "video", { role: "take", shotId: "gone", selected: true, file: clip("e.mp4") }),
    ]);
    expect(listShots(document)).toEqual([
      { shotId: "shot-0", title: "shot-0", prompt: "Rain", creationNodeId: null, status: "idle", takes: 0, take: null },
      { shotId: "shot-1", episode: 1, title: "shot-1", prompt: "", creationNodeId: null, status: "idle", takes: 0, take: null },
      {
        shotId: "shot-2", episode: 2, title: "shot-2", prompt: "Ring", creationNodeId: "make-2b", status: "error", takes: 3,
        take: { nodeId: "take-2b", title: "take-2b", file: clip("b.mp4"), durationMs: 4000, width: 1280, height: 720 },
      },
      { shotId: "shot-3", episode: 2, title: "shot-3", prompt: "Veil", creationNodeId: "make-3", status: "loading", takes: 1, take: null },
    ]);
  });
});
