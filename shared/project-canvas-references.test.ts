import { describe, expect, it } from "vitest";

import type { CanvasConnection, CanvasNode } from "./project-canvas.ts";
import {
  connectedReferences,
  generationInputs,
  generationReferences,
  isReferenceNode,
  mentionReferences,
  referenceCounts,
  referenceLabel,
  resourceKind,
} from "./project-canvas-references.ts";

const file = (path: string, mime: string) => ({ path, mime, bytes: 10, name: path.split("/").pop()! });
const node = (id: string, type: CanvasNode["type"], over: Partial<CanvasNode> = {}): CanvasNode => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 80, ...over });
const link = (fromNodeId: string, toNodeId: string, kind: CanvasConnection["kind"] = "content"): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind });

const nodes = [
  node("img1", "image", { metadata: { file: file("素材/a.png", "image/png") } }),
  node("img2", "image", { metadata: { file: file("素材/b.png", "image/png") }, groupId: "g" }),
  node("song", "audio", { metadata: { file: file("素材/s.mp3", "audio/mpeg") }, groupId: "g" }),
  node("note", "text", { metadata: { content: "A rainy street" } }),
  node("empty", "image"),
  node("g", "group"),
  node("shot", "shot"),
  node("cfg", "config"),
  node("out", "image"),
  node("bot:b1", "bot"),
];

describe("the numbering of a canvas's references", () => {
  it("counts an image, video or audio with a file and a text with words as resources", () => {
    expect(nodes.map((item) => resourceKind(item))).toEqual(["image", "image", "audio", "text", null, null, null, null, null, null]);
    expect(isReferenceNode(nodes[5]!, nodes)).toBe(true);
    expect(isReferenceNode(nodes[4]!, nodes)).toBe(false);
  });

  it("lists what is connected in, opening groups, labelled by kind and order", () => {
    const connections = [link("img1", "shot"), link("g", "shot"), link("note", "shot"), link("empty", "shot"), link("bot:b1", "shot", "dispatch")];
    expect(connectedReferences("shot", nodes, connections).map((reference) => [reference.nodeId, reference.sourceNodeId, reference.kind, reference.index])).toEqual([
      ["img1", "img1", "image", 1],
      ["img2", "g", "image", 2],
      ["song", "g", "audio", 1],
      ["note", "note", "text", 1],
    ]);
  });

  it("lists a node connected in twice, directly and in a group, once", () => {
    const connections = [link("g", "shot"), link("img2", "shot")];
    expect(connectedReferences("shot", nodes, connections).map((reference) => [reference.nodeId, reference.sourceNodeId])).toEqual([["img2", "g"], ["song", "g"]]);
  });

  it("names a reference by its kind's word in the person's language and its number", () => {
    const words: Record<string, string> = { "server.projectCanvas.reference.image": "图片" };
    const [, second] = connectedReferences("shot", nodes, [link("img1", "shot"), link("g", "shot")]);
    expect(referenceLabel(second!, (key) => words[key] ?? key)).toBe("图片 2");
    expect(referenceLabel({ kind: "audio", index: 1 }, (key) => key)).toBe("server.projectCanvas.reference.audio 1");
  });

  it("hands a generation the image and audio files connected in, and its text with it", () => {
    const connections = [link("img1", "shot"), link("g", "shot"), link("note", "shot")];
    expect(generationReferences("shot", nodes, connections)).toEqual({ images: ["素材/a.png", "素材/b.png"], audio: ["素材/s.mp3"] });
    expect(generationInputs("shot", nodes, connections).filter((reference) => reference.kind === "text")).toEqual([
      { nodeId: "note", sourceNodeId: "note", kind: "text", index: 1, title: "note", text: "A rainy street" },
    ]);
    expect(referenceCounts(generationReferences("shot", nodes, connections))).toEqual({ images: 2, audio: 1 });
  });

  it("gives a config its own inputs, and a node feeding a config the config's other inputs", () => {
    const connections = [link("img1", "cfg"), link("note", "cfg"), link("out", "cfg")];
    expect(generationInputs("cfg", nodes, connections).map((reference) => reference.nodeId)).toEqual(["img1", "note"]);
    expect(mentionReferences("out", nodes, connections).map((reference) => reference.nodeId)).toEqual(["img1", "note"]);
    expect(generationReferences("out", nodes, connections)).toEqual({ images: ["素材/a.png"], audio: [] });
  });

  it("names the node itself when nothing is connected in", () => {
    expect(mentionReferences("img1", nodes, []).map((reference) => reference.nodeId)).toEqual(["img1"]);
    expect(mentionReferences("empty", nodes, [])).toEqual([]);
  });
});
