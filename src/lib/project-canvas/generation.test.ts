import { describe, expect, it } from "vitest";
import type { CanvasConnection, CanvasNode } from "../../../shared/project-canvas";
import { generationInput, nextOutputFrame, OUTPUT_GAP_Y, OUTPUT_OFFSET_X, showsResultInPlace } from "./generation";

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

  it("shows the first result in an empty image or video node, and makes new nodes for the rest", () => {
    expect(showsResultInPlace(node("i", "image"))).toBe(true);
    expect(showsResultInPlace(node("i", "image", { metadata: { file: file("a.png") } }))).toBe(false);
    expect(showsResultInPlace(node("s", "shot"))).toBe(false);
  });
});

describe("where a result lands", () => {
  const shot = node("shot", "shot", { position: { x: 100, y: 50 } });

  it("puts a shot's first video to its right, level with its top", () => {
    expect(nextOutputFrame(shot, "video", [shot], [])).toEqual({ position: { x: 100 + 340 + OUTPUT_OFFSET_X, y: 50 }, width: 420, height: 236 });
  });

  it("centres an image on its source", () => {
    expect(nextOutputFrame(shot, "image", [shot], []).position).toEqual({ x: 536, y: 50 + 120 - 120 });
  });

  it("puts the next result under the lowest one made before, in its column", () => {
    const first = node("v1", "video", { position: { x: 488, y: 50 }, width: 420, height: 236 });
    const second = node("v2", "video", { position: { x: 500, y: 320 }, width: 420, height: 236 });
    const unrelated = node("v3", "video", { position: { x: 536, y: 900 } });
    expect(nextOutputFrame(shot, "video", [shot, first, second, unrelated], [link("shot", "v1"), link("shot", "v2")]).position).toEqual({ x: 500, y: 320 + 236 + OUTPUT_GAP_Y });
  });
});
