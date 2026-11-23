import { describe, expect, it } from "vitest";

import { CANVAS_MAX_CONNECTIONS, type CanvasConnection, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasNodeMetadata } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import { settleLinks, wantedLinks, type BotEpisodes, type PipelineLink } from "./pipeline-links.ts";

const by = (botId: string): CanvasNodeCreator => ({ kind: "bot", botId });
const node = (id: string, type: CanvasNode["type"], metadata?: CanvasNodeMetadata, createdBy: CanvasNodeCreator = { kind: "person" }): CanvasNode =>
  ({ id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, createdBy, ...(metadata ? { metadata } : {}) });
const link = (fromNodeId: string, toNodeId: string, pipeline = false): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content", ...(pipeline ? { pipeline: true as const } : {}) });
const canvas = (nodes: CanvasNode[], connections: CanvasConnection[] = []): CanvasDocument =>
  ({ projectId: "p1", revision: 1, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" });
const file = { path: "产出/a", mime: "image/png", bytes: 1, name: "a" };

const TEAM: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["script"], faces: ["character"], boards: ["storyboard"], editor: ["post"], voice: ["other"] };
const wanted = (document: CanvasDocument, stages: Record<string, FlowStage[]> = TEAM, botEpisodes: BotEpisodes = {}) =>
  wantedLinks(document, stages, botEpisodes).map(({ from, to }) => `${from} > ${to}`);

/** A drama of episodes: the first two have a storyboard bot and a post bot of their own. */
const DRAMA: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["script"], faces: ["character"], sets: ["scene"], "boards-1": ["storyboard"], "boards-2": ["storyboard"], "editor-1": ["post"], "editor-2": ["post"] };
const OWN: BotEpisodes = { "boards-1": 1, "boards-2": 2, "editor-1": 1, "editor-2": 2 };

describe("the links the pipeline wants", () => {
  it("joins the brief and the lead's split of the work from the lead, and the brief on to every script bot", () => {
    const document = canvas([node("brief", "text", { role: "brief" }, by("lead")), node("split", "text", { role: "plan" }, by("lead"))]);
    expect(wanted(document, { ...TEAM, pen: ["script"] })).toEqual(["bot:lead > brief", "brief > bot:writer", "brief > bot:pen", "bot:lead > split"]);
  });

  it("joins an episode's script from the bot that made it and on to the episode's own storyboard bot, to nobody while it has none", () => {
    const document = canvas([
      node("ep-1", "text", { role: "episode", episode: 1 }, by("writer")), node("ep-2", "text", { role: "episode", episode: 2 }, by("writer")),
      node("ep-3", "text", { role: "episode", episode: 3 }, by("writer")), node("loose", "text", { role: "episode" }, by("writer")),
    ]);
    expect(wanted(document, DRAMA, OWN)).toEqual(["bot:writer > ep-1", "ep-1 > bot:boards-1", "bot:writer > ep-2", "ep-2 > bot:boards-2", "bot:writer > ep-3"]);
  });

  it("joins a script written before episodes from every script bot and on to every storyboard bot that is no episode's own", () => {
    const document = canvas([node("script", "text", { content: "Act one", role: "script" }, by("writer"))]);
    expect(wanted(document, { ...TEAM, pen: ["script"], frames: ["storyboard"] })).toEqual(["bot:writer > script", "bot:pen > script", "script > bot:boards", "script > bot:frames"]);
    expect(wanted(document, { ...DRAMA, boards: ["storyboard"] }, OWN)).toEqual(["bot:writer > script", "script > bot:boards"]);
  });

  it("does not send that script back to a bot that is also of the script stage", () => {
    const document = canvas([node("script", "text", { role: "script" })]);
    expect(wanted(document, { lead: ["lead"], solo: ["script", "character", "storyboard"], boards: ["storyboard"] })).toEqual(["bot:solo > script", "script > bot:boards"]);
  });

  it("joins a character and a scene from the bot that made it", () => {
    const document = canvas([node("mei", "text", { role: "character" }, by("faces")), node("hall", "text", { role: "scene" }, by("sets")), node("lin", "text", { role: "character" })]);
    expect(wanted(document, DRAMA, OWN)).toEqual(["bot:faces > mei", "bot:sets > hall"]);
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

  it("sends an episode's selected take to that episode's post bot alone, and its finished film comes from that bot", () => {
    const document = canvas([
      node("shot-1", "shot", { episode: 2 }), node("make-1", "config", { role: "creation", shotId: "shot-1", episode: 2 }),
      node("take-1", "video", { role: "take", shotId: "shot-1", episode: 2, selected: true }),
      node("film-1", "video", { role: "final", episode: 1, file }), node("film-2", "video", { role: "final", episode: 2, file }), node("film-3", "video", { role: "final", episode: 3, file }),
    ]);
    expect(wanted(document, DRAMA, OWN)).toEqual(["shot-1 > make-1", "make-1 > take-1", "take-1 > bot:editor-2", "bot:editor-1 > film-1", "bot:editor-2 > film-2"]);
  });

  it("joins the finished film of a drama made before episodes from every post bot, and from nobody in a project without one", () => {
    const document = canvas([node("film", "video", { role: "final", file })]);
    expect(wanted(document, { ...TEAM, cutter: ["post"] })).toEqual(["bot:editor > film", "bot:cutter > film"]);
    expect(wanted(document, { lead: ["lead"], writer: ["script"] })).toEqual([]);
  });

  it("wants nothing from a bot that is not of the project", () => {
    const document = canvas([node("shot-1", "shot", {}, by("left")), node("mei", "text", { role: "character" }, by("left")), node("ep-1", "text", { role: "episode", episode: 1 }, by("left"))]);
    expect(wanted(document)).toEqual([]);
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
