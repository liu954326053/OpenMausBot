import { describe, expect, it } from "vitest";
import type { CanvasConnection, CanvasNode } from "../../../shared/project-canvas";
import { generationInput, nextOutputFrame, OUTPUT_GAP_Y, OUTPUT_OFFSET_X } from "./generation";

const file = (path: string) => ({ path, mime: path.endsWith(".mp3") ? "audio/mpeg" : "image/png", bytes: 1, name: path });
const node = (id: string, type: CanvasNode["type"], over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, ...over });
const link = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content" });

describe("starting a generation", () => {
  it("hands over the prompt, only the node's overrides, its references and its title", () => {
    const shot = node("shot", "shot", { title: " Opening ", metadata: { prompt: "rain", settings: { seconds: 10, quality: "high" } } });
    const nodes = [shot, node("img", "image", { metadata: { file: file("素材/a.png") } }), node("song", "audio", { metadata: { file: file("素材/s.mp3") } })];
    expect(generationInput(shot, nodes, [link("img", "shot"), link("song", "shot")], "rain at night")).toEqual({
      kind: "video",
      nodeId: "shot",
      prompt: "rain at night",
      references: { images: ["素材/a.png"], audio: ["素材/s.mp3"] },
      overrides: { seconds: 10 },
      name: "Opening",
    });
    expect(generationInput(node("t", "text"), nodes, [], "x")).toBeNull();
    expect(generationInput(node("i", "image", { title: "" }), nodes, [], "x")).toEqual({ kind: "image", nodeId: "i", prompt: "x", references: { images: [], audio: [] } });
  });
});

describe("where a result lands", () => {
  const shot = node("shot", "shot", { position: { x: 100, y: 50 } });
  const column = 100 + 340 + OUTPUT_OFFSET_X;

  it("puts the first result to the right of its source, level with its top, whatever its kind", () => {
    expect(nextOutputFrame(shot, "video", [shot], [])).toEqual({ position: { x: column, y: 50 }, width: 420, height: 236 });
    expect(nextOutputFrame(shot, "image", [shot], []).position).toEqual({ x: column, y: 50 });
  });

  it("puts the next result under the lowest one connected from its source in that column", () => {
    const first = node("v1", "video", { position: { x: column, y: 50 }, width: 420, height: 236 });
    const second = node("v2", "video", { position: { x: column + 12, y: 320 }, width: 420, height: 236 });
    const unrelated = node("v3", "video", { position: { x: column, y: 900 } });
    const elsewhere = node("v4", "video", { position: { x: column + 900, y: 1200 } });
    const links = [link("shot", "v1"), link("shot", "v2"), link("shot", "v4")];
    expect(nextOutputFrame(shot, "video", [shot, first, second, unrelated, elsewhere], links).position).toEqual({ x: column, y: 320 + 236 + OUTPUT_GAP_Y });
  });

  it("puts the next result under the frames of results still to come in that column, and not under those elsewhere", () => {
    const first = node("v1", "video", { position: { x: column, y: 50 }, width: 420, height: 236 });
    const coming = [{ position: { x: column, y: 50 + 236 + OUTPUT_GAP_Y }, width: 340, height: 240 }, { position: { x: column + 900, y: 2000 }, width: 340, height: 240 }];
    expect(nextOutputFrame(shot, "text", [shot, first], [link("shot", "v1")], coming).position).toEqual({ x: column, y: 50 + 236 + OUTPUT_GAP_Y + 240 + OUTPUT_GAP_Y });
  });

  it("goes down past every node in its way, a bot's among them, as the server puts it, and over a group", () => {
    const note = node("note", "text", { position: { x: column + 100, y: 120 } });
    const bot = node("bot:writer", "bot", { position: { x: column - 40, y: 120 + 240 + 10 }, width: 300, height: 180 });
    const group = node("group", "group", { position: { x: column - 200, y: 0 }, width: 2000, height: 2000 });
    expect(nextOutputFrame(shot, "video", [shot, note, bot, group], []).position).toEqual({ x: column, y: 120 + 240 + 10 + 180 + OUTPUT_GAP_Y });
  });
});
