import { describe, expect, it } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import { keywordStages } from "./keywords.ts";

const member = (title: string, extra: { name?: string; description?: string; soul?: string } = {}) =>
  ({ name: extra.name ?? "云舟", title, description: extra.description ?? "", soul: extra.soul ?? "" });

describe("stages by keyword", () => {
  it.each<[string, FlowStage[]]>([
    ["编剧", ["script"]],
    ["剧本策划", ["script"]],
    ["短剧脚本", ["script"]],
    ["Screenwriter", ["script"]],
    ["Script Writer", ["script"]],
    ["Writer", ["script"]],
    ["角色设计", ["character"]],
    ["人设与美术", ["character"]],
    ["美術設計", ["character"]],
    ["Character Designer", ["character"]],
    ["Concept Artist", ["character"]],
    ["Art Director", ["character"]],
    ["分镜师", ["storyboard"]],
    ["分鏡", ["storyboard"]],
    ["Storyboard Artist", ["storyboard"]],
    ["后期合成", ["post"]],
    ["剪辑师", ["post"]],
    ["後期剪輯", ["post"]],
    ["Video Editor", ["post"]],
    ["Post-production", ["post"]],
    ["分镜与美术设计", ["character", "storyboard"]],
    ["编剧兼分镜", ["script", "storyboard"]],
    ["Storyboard and editing", ["storyboard", "post"]],
  ])("reads the title %s", (title, stages) => {
    expect(keywordStages(member(title))).toEqual(stages);
  });

  it.each(["运营", "配音", "语音合成", "研究员", "工程师", "界面设计师", "Copywriter", "Researcher", "Engineer", "Postmaster", ""])(
    "gives %s no stage of the pipeline",
    (title) => {
      expect(keywordStages(member(title))).toEqual(["other"]);
    },
  );

  it("reads the name when it says what the member does", () => {
    expect(keywordStages(member("", { name: "分镜" }))).toEqual(["storyboard"]);
  });

  it("goes by the title alone once it names a stage, whatever the rest mentions", () => {
    expect(keywordStages(member("编剧", { description: "写完剧本后交给分镜师和后期", soul: "你是编剧。剧本定稿后由角色设计和分镜接手。" }))).toEqual(["script"]);
  });

  it("falls back to the description, then to how the soul opens", () => {
    expect(keywordStages(member("创作成员", { description: "负责把剧本拆成分镜" }))).toEqual(["storyboard"]);
    expect(keywordStages(member("创作成员", { description: "负责撰写剧本和对白" }))).toEqual(["script"]);
    expect(keywordStages(member("Member", { description: "Designs the characters and their reference art." }))).toEqual(["character"]);
    expect(keywordStages(member("创作成员", { soul: "你是一名资深剪辑师，负责成片。\n\n合作方式：收到分镜后开始工作。" }))).toEqual(["post"]);
    expect(keywordStages(member("Member", { soul: `You keep the books.\n${"Keep answers short. ".repeat(20)}Never touch the storyboard.` }))).toEqual(["other"]);
  });

  it("takes general words only from the title", () => {
    expect(keywordStages(member("研究员", { soul: "你的角色是严谨的研究员，人设是冷静的学者。" }))).toEqual(["other"]);
    expect(keywordStages(member("Researcher", { description: "Finds sources, then will edit and post a summary for the writer." }))).toEqual(["other"]);
  });
});
