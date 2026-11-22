import { describe, expect, it } from "vitest";

import type { CanvasConnection, CanvasDocument, CanvasNode, CanvasNodeCreator, CanvasNodeMetadata } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import { settlePipeline } from "./pipeline.ts";
import { LANE_GAP, NODE_GAP } from "./placement.ts";

const WRITER: CanvasNodeCreator = { kind: "bot", botId: "writer" };
const SIZE: Partial<Record<CanvasNode["type"], { width: number; height: number }>> = { video: { width: 420, height: 236 } };
const node = (id: string, type: CanvasNode["type"], at: [number, number], metadata?: CanvasNodeMetadata, createdBy: CanvasNodeCreator = { kind: "person" }): CanvasNode =>
  ({ id, type, title: id, position: { x: at[0], y: at[1] }, ...(SIZE[type] ?? { width: 340, height: 240 }), createdBy, ...(metadata ? { metadata } : {}) });
const link = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content" });
const file = (name: string, mime = "video/mp4") => ({ path: `产出/${name}`, mime, bytes: 3, name });
const STAGES: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["other"], editor: ["post"] };

function upgraded(nodes: CanvasNode[], connections: CanvasConnection[]) {
  const before: CanvasDocument = { projectId: "p1", revision: 9, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" };
  const after = structuredClone(before);
  let n = 0;
  const result = settlePipeline({ before, after, beforeStages: {}, stages: STAGES, upgrade: true, bots: new Map(), reserved: [], newId: () => `new-${++n}` });
  return { after, find: (id: string) => after.nodes.find((one) => one.id === id), links: () => after.connections.map((one) => `${one.fromNodeId} ${one.pipeline ? "=>" : "->"} ${one.toNodeId}`), ...result };
}

const laneX = 340 + LANE_GAP;

describe("a canvas stored before the pipeline, brought forward", () => {
  it("gives every shot its creation node, whoever made the shot, with the settings the shot had", () => {
    const { find, links, after } = upgraded([
      node("shot-1", "shot", [0, 0], { prompt: "Veil", settings: { seconds: 10 } }, WRITER), node("shot-2", "shot", [0, 280], { prompt: "Ring" }),
    ], [link("bot:writer", "shot-1")]);
    expect(after.nodes.map((one) => one.id)).toEqual(["shot-1", "shot-2", "new-1", "new-2"]);
    expect(find("new-1")).toMatchObject({ type: "config", position: { x: laneX, y: 0 }, createdBy: WRITER, metadata: { role: "creation", shotId: "shot-1", generationMode: "video", settings: { seconds: 10 } } });
    expect(find("new-2")).toMatchObject({ position: { x: laneX, y: 280 }, createdBy: { kind: "person" }, metadata: { role: "creation", shotId: "shot-2" } });
    expect(links()).toEqual(["bot:writer => shot-1", "shot-1 => new-1", "shot-2 => new-2"]);
  });

  it("makes the videos generated from a shot its takes behind the creation node, in the order they were made, the newest selected and sent to post", () => {
    const { find, links, events, changed } = upgraded([
      node("shot-1", "shot", [0, 0], { prompt: "Veil" }, WRITER),
      node("old", "video", [laneX, 0], { file: file("old.mp4"), durationMs: 5000 }, WRITER),
      node("new", "video", [laneX, 236 + NODE_GAP], { file: file("new.mp4") }, WRITER),
      node("blank", "video", [laneX, 600], { prompt: "Later" }),
      node("poster", "image", [laneX, 900], { file: file("poster.png", "image/png") }),
    ], [link("shot-1", "old"), link("shot-1", "new"), link("shot-1", "blank"), link("shot-1", "poster")]);
    const takesX = laneX + 340 + LANE_GAP;
    expect(find("new-1")).toMatchObject({ position: { x: laneX, y: 0 }, metadata: { role: "creation", shotId: "shot-1" } });
    expect(find("old")).toMatchObject({ position: { x: takesX, y: 0 }, metadata: { role: "take", shotId: "shot-1", durationMs: 5000 } });
    expect(find("old")?.metadata).not.toHaveProperty("selected");
    expect(find("new")).toMatchObject({ position: { x: takesX, y: 236 + NODE_GAP }, metadata: { role: "take", shotId: "shot-1", selected: true } });
    expect(find("blank")?.metadata).toEqual({ prompt: "Later" });
    expect(find("poster")?.metadata).not.toHaveProperty("role");
    expect(links()).toEqual(["shot-1 -> blank", "shot-1 -> poster", "new-1 => old", "new-1 => new", "bot:writer => shot-1", "shot-1 => new-1", "new => bot:editor"]);
    expect(changed.nodes).toEqual(["new-1", "old", "new"]);
    expect(events).toEqual([
      { kind: "role", role: "take", nodeId: "old", shotId: "shot-1" }, { kind: "role", role: "take", nodeId: "new", shotId: "shot-1" },
      { kind: "role", role: "creation", nodeId: "new-1", shotId: "shot-1" }, { kind: "selected", shotId: "shot-1", nodeId: "new" },
    ]);
  });

  it("connects into the creation node what was connected into the shot, so the shot generates from what it did", () => {
    const { links } = upgraded([
      node("shot-1", "shot", [0, 0], { prompt: "Veil" }), node("face", "image", [0, 400], { file: file("face.png", "image/png") }),
      node("hum", "audio", [0, 700], { file: file("hum.mp3", "audio/mpeg") }), node("note", "text", [0, 900], { content: "Slow" }),
    ], [link("face", "shot-1"), link("hum", "shot-1"), link("note", "shot-1"), link("bot:writer", "shot-1")]);
    expect(links()).toEqual(["face -> shot-1", "hum -> shot-1", "note -> shot-1", "bot:writer -> shot-1", "hum -> new-1", "note -> new-1", "shot-1 => new-1", "face => new-1"]);
  });

  it("leaves a shot that has its creation node as it is", () => {
    const { changed } = upgraded([node("shot-1", "shot", [0, 0]), node("make-1", "config", [laneX, 0], { role: "creation", shotId: "shot-1" })], [{ ...link("shot-1", "make-1"), pipeline: true }]);
    expect(changed).toEqual({ nodes: [], connections: [] });
  });
});
