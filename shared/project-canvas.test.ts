import { describe, expect, it } from "vitest";

import { generationKindOf, type CanvasNode } from "./project-canvas.ts";

const node = (type: CanvasNode["type"], metadata?: CanvasNode["metadata"]): CanvasNode => ({ id: type, type, title: "", position: { x: 0, y: 0 }, width: 340, height: 240, ...(metadata ? { metadata } : {}) });

describe("what generating a canvas node makes", () => {
  it("is a picture for an image node, a clip for a video node or a shot, and what a config node is set to", () => {
    expect(generationKindOf(node("image"))).toBe("image");
    expect(generationKindOf(node("video"))).toBe("video");
    expect(generationKindOf(node("shot"))).toBe("video");
    expect(generationKindOf(node("config", { generationMode: "video" }))).toBe("video");
    expect(generationKindOf(node("config"))).toBe("image");
    expect(["text", "audio", "file", "group", "bot"].map((type) => generationKindOf(node(type as CanvasNode["type"])))).toEqual([null, null, null, null, null]);
  });
});
