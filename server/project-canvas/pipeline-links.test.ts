import { describe, expect, it } from "vitest";

import { CANVAS_MAX_CONNECTIONS, type CanvasConnection, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasNodeMetadata } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import { settleLinks, wantedLinks, type PipelineLink } from "./pipeline-links.ts";

const by = (botId: string): CanvasNodeCreator => ({ kind: "bot", botId });
const node = (id: string, type: CanvasNode["type"], metadata?: CanvasNodeMetadata, createdBy: CanvasNodeCreator = { kind: "person" }): CanvasNode =>
  ({ id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, createdBy, ...(metadata ? { metadata } : {}) });
const link = (fromNodeId: string, toNodeId: string, pipeline = false): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content", ...(pipeline ? { pipeline: true as const } : {}) });
const canvas = (nodes: CanvasNode[], connections: CanvasConnection[] = []): CanvasDocument =>
  ({ projectId: "p1", revision: 1, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" });
const file = { path: "产出/a", mime: "image/png", bytes: 1, name: "a" };

const TEAM: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["script"], faces: ["character"], boards: ["storyboard"], editor: ["post"], voice: ["other"] };
const wanted = (document: CanvasDocument, stages: Record<string, FlowStage[]> = TEAM) => wantedLinks(document, stages).map(({ from, to }) => `${from} > ${to}`);

describe("the links the pipeline wants", () => {
  it("joins the script from every script bot and on to every character and storyboard bot", () => {
    const document = canvas([node("script", "text", { content: "Act one", role: "script" }, by("writer"))]);
    expect(wanted(document, { ...TEAM, pen: ["script"], frames: ["storyboard"] })).toEqual([
      "bot:writer > script", "bot:pen > script", "script > bot:faces", "script > bot:boards", "script > bot:frames",
    ]);
  });

  it("does not send the script back to a bot that is also of the script stage", () => {
    const document = canvas([node("script", "text", { role: "script" })]);
    expect(wanted(document, { lead: ["lead"], solo: ["script", "character", "storyboard"], boards: ["storyboard"] })).toEqual(["bot:solo > script", "script > bot:boards"]);
  });

  it("joins a character from the bot that made it and on to every storyboard bot but that one", () => {
    const document = canvas([node("mei", "text", { role: "character" }, by("faces")), node("lin", "text", { role: "character" }, by("boards"))]);
    expect(wanted(document, { ...TEAM, boards: ["character", "storyboard"], frames: ["storyboard"] })).toEqual([
      "bot:faces > mei", "mei > bot:boards", "mei > bot:frames", "bot:boards > lin", "lin > bot:frames",
    ]);
  });

  it("joins a shot from the bot that made it, on to its creation node, and the images connected into the shot into that node too", () => {
    const document = canvas([
      node("shot-1", "shot", { prompt: "Veil" }, by("boards")),
      node("make-1", "config", { role: "creation", shotId: "shot-1", generationMode: "video" }, by("boards")),
      node("face", "image", { file }), node("empty", "image"), node("note", "text", { content: "Slow" }), node("hum", "audio", { file }),
      node("shot-2", "shot", { prompt: "Ring" }),
    ], [link("face", "shot-1"), link("empty", "shot-1"), link("note", "shot-1"), link("hum", "shot-1"), link("bot:boards", "shot-1"), link("face", "shot-2")]);
    expect(wanted(document)).toEqual(["bot:boards > shot-1", "shot-1 > make-1", "face > make-1", "empty > make-1"]);
  });

  it("joins a take from its shot's creation node, and the selected take of a shot that is there on to every post bot", () => {
    const document = canvas([
      node("shot-1", "shot"), node("make-1", "config", { role: "creation", shotId: "shot-1" }),
      node("take-1", "video", { role: "take", shotId: "shot-1" }), node("take-2", "video", { role: "take", shotId: "shot-1", selected: true }),
      node("make-9", "config", { role: "creation", shotId: "gone" }), node("take-9", "video", { role: "take", shotId: "gone", selected: true }),
    ]);
    expect(wanted(document, { ...TEAM, cutter: ["post"] })).toEqual([
      "shot-1 > make-1", "make-1 > take-1", "make-1 > take-2", "take-2 > bot:editor", "take-2 > bot:cutter", "make-9 > take-9",
    ]);
    expect(wanted(document, { lead: ["lead"], boards: ["storyboard"] })).toEqual(["shot-1 > make-1", "make-1 > take-1", "make-1 > take-2", "make-9 > take-9"]);
  });

  it("joins the finished film from every post bot, and from nobody in a project without one", () => {
    const document = canvas([node("film", "video", { role: "final", file })]);
    expect(wanted(document, { ...TEAM, cutter: ["post"] })).toEqual(["bot:editor > film", "bot:cutter > film"]);
    expect(wanted(document, { lead: ["lead"], writer: ["script"] })).toEqual([]);
  });

  it("wants nothing from a bot that is not of the project", () => {
    const document = canvas([node("shot-1", "shot", {}, by("left")), node("mei", "text", { role: "character" }, by("left"))]);
    expect(wanted(document)).toEqual(["mei > bot:boards"]);
  });
});

describe("settling the links of a canvas", () => {
  const links = (...pairs: Array<[string, string]>): PipelineLink[] => pairs.map(([from, to]) => ({ from, to }));
  const ids = () => {
    let n = 0;
    return () => `link-${++n}`;
  };

  it("adds each link newly wanted as the pipeline's, and marks a connection already there as the pipeline's", () => {
    const document = canvas([node("shot-1", "shot"), node("make-1", "config")], [link("bot:boards", "shot-1")]);
    const changed = settleLinks(document, [], links(["bot:boards", "shot-1"], ["shot-1", "make-1"]), ids());
    expect(document.connections).toEqual([
      { id: "bot:boards>shot-1", fromNodeId: "bot:boards", toNodeId: "shot-1", kind: "content", pipeline: true },
      { id: "link-1", fromNodeId: "shot-1", toNodeId: "make-1", kind: "content", pipeline: true },
    ]);
    expect(changed).toEqual(["bot:boards>shot-1", "link-1"]);
  });

  it("takes away the pipeline's link that is no longer wanted, and leaves a connection somebody else made", () => {
    const document = canvas([], [link("take-1", "bot:editor", true), link("face", "make-1")]);
    const changed = settleLinks(document, links(["take-1", "bot:editor"], ["face", "make-1"]), [], ids());
    expect(document.connections.map((one) => one.id)).toEqual(["face>make-1"]);
    expect(changed).toEqual(["take-1>bot:editor"]);
  });

  it("does not bring back a link the person deleted while it stays wanted, and changes nothing that is as wanted", () => {
    const document = canvas([], [link("shot-1", "make-1", true)]);
    const same = links(["shot-1", "make-1"], ["script", "bot:boards"]);
    expect(settleLinks(document, same, same, ids())).toEqual([]);
    expect(document.connections.map((one) => one.id)).toEqual(["shot-1>make-1"]);
  });

  it("adds none to a canvas that holds the most connections", () => {
    const document = canvas([], Array.from({ length: CANVAS_MAX_CONNECTIONS }, (_, index) => link(`a${index}`, `b${index}`)));
    expect(settleLinks(document, [], links(["shot-1", "make-1"]), ids())).toEqual([]);
    expect(document.connections).toHaveLength(CANVAS_MAX_CONNECTIONS);
  });
});
