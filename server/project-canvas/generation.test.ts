import { describe, expect, it } from "vitest";

import type { CanvasReference } from "../../shared/project-canvas-references.ts";
import { addServerLinePacks } from "../server-lines.ts";
import { generationPrompt } from "./generation.ts";

const reference = (kind: CanvasReference["kind"], index: number, text?: string): CanvasReference =>
  ({ nodeId: `${kind}-${index}`, sourceNodeId: `${kind}-${index}`, kind, index, title: "", ...(text ? { text } : {}) });

const references = [reference("image", 1), reference("text", 1, "Rain on the steps.\nShe runs."), reference("image", 2), reference("audio", 1), reference("video", 1), reference("text", 2, "Dusk")];

describe("the prompt a canvas generation is sent", () => {
  it("numbers its images and audio first, then the person's prompt, then each text under its label", () => {
    expect(generationPrompt("@Image 2 walks past @Image 1", references, undefined)).toBe([
      "Reference image labels: Image 1, Image 2. Use these labels to interpret image references in the prompt.",
      "Reference audio labels: Audio 1. Use these labels to interpret audio references in the prompt.",
      "",
      "@Image 2 walks past @Image 1",
      "",
      "【Text 1】",
      "Rain on the steps.",
      "She runs.",
      "",
      "【Text 2】",
      "Dusk",
    ].join("\n"));
  });

  it("names them in the words of the person's language", () => {
    addServerLinePacks({ zh: {
      "server.projectCanvas.reference.image": "图片", "server.projectCanvas.reference.text": "文本", "server.projectCanvas.reference.separator": "、",
      "server.projectCanvas.reference.imageLine": "参考图片编号：{labels}。请按这些编号理解提示词中的图片引用。",
    } });
    expect(generationPrompt("@图片 2", references.filter((one) => one.kind !== "audio"), "zh")).toBe(
      "参考图片编号：图片 1、图片 2。请按这些编号理解提示词中的图片引用。\n\n@图片 2\n\n【文本 1】\nRain on the steps.\nShe runs.\n\n【文本 2】\nDusk",
    );
  });

  it("is the prompt alone with nothing to number", () => {
    expect(generationPrompt("A bride alone", [reference("video", 1)], undefined)).toBe("A bride alone");
  });
});
