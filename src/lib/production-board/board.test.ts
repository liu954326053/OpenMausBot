import { describe, expect, it } from "vitest";
import type { ProductionEpisodeWire, ProductionWire } from "../../../shared/production";
import { botNodeId, type CanvasBotState, type CanvasConnection, type CanvasNode, type CanvasSnapshot } from "../../../shared/project-canvas";
import type { FlowStage } from "../../../shared/team-pipeline";
import { buildBoard } from "./board";
import type { BoardCard, BoardEdge } from "./types";
import { visibleEdges } from "./edges";

const bot = (botId: string, stages: FlowStage[], extra: Partial<CanvasBotState> = {}): CanvasBotState => ({ botId, name: botId, title: stages[0]!, lead: stages.includes("lead"), stages, status: "idle", placed: true, ...extra });
const botNode = (botId: string): CanvasNode => ({ id: botNodeId(botId), type: "bot", title: botId, position: { x: 0, y: 0 }, width: 300, height: 180 });
const node = (id: string, type: CanvasNode["type"], extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, ...extra });
const link = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content" });
const madeBy = (botId: string) => ({ createdBy: { kind: "bot" as const, botId } });

function snapshot(bots: CanvasBotState[], nodes: CanvasNode[], extra: Partial<CanvasSnapshot> = {}): CanvasSnapshot {
  return {
    projectId: "p",
    revision: 1,
    nodes: [...bots.map((one) => botNode(one.botId)), ...nodes],
    connections: [],
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: "dots",
    project: { id: "p", name: "Drama", leadBotId: "lead", archived: false, folderState: "ready" },
    bots: Object.fromEntries(bots.map((one) => [one.botId, one])),
    ...extra,
  };
}

const episodeWire = (episode: number, status: ProductionEpisodeWire["status"], extra: Partial<ProductionEpisodeWire> = {}): ProductionEpisodeWire =>
  ({ episode, nodeId: `ep${episode}`, title: `Episode ${episode}`, status, shots: 0, ready: 0, generating: 0, failed: 0, ...extra });

/** Four episodes: EP01 generating its videos, EP02 being storyboarded, EP03 done, EP04 not started. */
function drama(change: { production?: Partial<ProductionWire>; nodes?: CanvasNode[] } = {}): CanvasSnapshot {
  const bots = [
    bot("lead", ["lead"]),
    bot("writer", ["script"]),
    bot("painter", ["character"]),
    bot("builder", ["scene"]),
    bot("boarder", ["storyboard"]),
    bot("editor", ["post"]),
    bot("boarder-1", ["storyboard"], { episode: 1, status: "working" }),
    bot("editor-1", ["post"], { episode: 1 }),
    bot("boarder-2", ["storyboard"], { episode: 2, status: "working" }),
    bot("boarder-3", ["storyboard"], { episode: 3 }),
    bot("editor-3", ["post"], { episode: 3 }),
    bot("ops", ["other"]),
  ];
  const nodes: CanvasNode[] = [
    node("brief", "text", { ...madeBy("lead"), metadata: { role: "brief", card: { rows: [["Episodes", "4"]] } } }),
    node("plan", "text", { ...madeBy("lead"), metadata: { role: "plan" } }),
    ...[1, 2, 3, 4].map((episode) => node(`ep${episode}`, "text", { title: `Episode ${episode}`, ...madeBy("writer"), metadata: { role: "episode", episode, content: `Scene ${episode}` } })),
    node("g-hero", "group", madeBy("painter")),
    node("hero", "text", { groupId: "g-hero", ...madeBy("painter"), metadata: { role: "character", card: { badge: "Lead" } } }),
    node("hero-1", "image", { groupId: "g-hero", metadata: { file: { path: "产出/hero.png", mime: "image/png", bytes: 1, name: "hero.png" } } }),
    node("g-pier", "group", madeBy("builder")),
    node("pier", "text", { groupId: "g-pier", ...madeBy("builder"), metadata: { role: "scene" } }),
    node("pier-end", "text", { ...madeBy("boarder-1"), metadata: { role: "scene" } }),
    node("sh1", "shot", { ...madeBy("boarder-1"), metadata: { episode: 1, prompt: "Wide", shot: { size: "wide" }, settings: { seconds: 6 } } }),
    node("sh2", "shot", { ...madeBy("boarder-1"), metadata: { episode: 1, prompt: "Close" } }),
    node("sh3", "shot", { ...madeBy("boarder-2"), metadata: { episode: 2, prompt: "Door" } }),
    node("cr1", "config", { metadata: { role: "creation", shotId: "sh1", episode: 1, status: "success" } }),
    node("t1a", "video", { metadata: { role: "take", shotId: "sh1", episode: 1, selected: true, file: { path: "a.mp4", mime: "video/mp4", bytes: 1, name: "a.mp4" } } }),
    node("t1b", "video", { metadata: { role: "take", shotId: "sh1", episode: 1, file: { path: "b.mp4", mime: "video/mp4", bytes: 1, name: "b.mp4" } } }),
    node("cr2", "config", { metadata: { role: "creation", shotId: "sh2", episode: 1, status: "loading" } }),
    node("cr3", "config", { metadata: { role: "creation", shotId: "sh3", episode: 2 } }),
    node("film3", "video", { metadata: { role: "final", episode: 3, file: { path: "ep3.mp4", mime: "video/mp4", bytes: 1, name: "ep3.mp4" } } }),
    node("note", "text", { metadata: { content: "Ideas" } }),
    ...(change.nodes ?? []),
  ];
  const production: ProductionWire = {
    plan: { assignments: { script: "writer", character: "painter", scene: "builder", storyboard: "boarder", post: "editor" }, episodes: 4, plannedAt: 1 },
    jobs: [{ job: "script", botId: "writer", status: "done" }, { job: "character", botId: "painter", status: "done" }, { job: "scene", botId: "builder", status: "done" }],
    ready: true,
    episodes: [
      episodeWire(1, "videos", { storyboardBotId: "boarder-1", postBotId: "editor-1", shots: 2, ready: 1, generating: 1 }),
      episodeWire(2, "storyboard", { storyboardBotId: "boarder-2", shots: 1 }),
      episodeWire(3, "done", { storyboardBotId: "boarder-3", postBotId: "editor-3", shots: 1, ready: 1 }),
      episodeWire(4, "waiting"),
    ],
    tasks: [],
    startedAt: 1,
    ...change.production,
  };
  return snapshot(bots, nodes, {
    connections: [link("hero-1", "cr1"), link("pier", "sh1"), link("pier", "pier-end"), link("pier-end", "cr2")],
    production,
  });
}

const card = (cards: readonly BoardCard[], id: string) => cards.find((one) => one.id === id);
const ids = (cards: readonly BoardCard[]) => cards.map((one) => one.id).sort();
const edge = (edges: readonly BoardEdge[], kind: BoardEdge["kind"], from: string, to: string) => edges.find((one) => one.kind === kind && one.from === from && one.to === to);

describe("the board's cards", () => {
  it("shows only the lead and says so before there is a plan or anything on the canvas", () => {
    const board = buildBoard(snapshot([bot("lead", ["lead"]), bot("writer", ["script"])], []));
    expect(board.empty).toBe(true);
    expect(ids(board.cards)).toEqual([botNodeId("lead")]);
    expect(board.edges).toEqual([]);
  });

  it("draws every episode in work and folds the others into one stack", () => {
    const board = buildBoard(drama());
    expect(board.empty).toBe(false);
    expect(board.unfolded).toEqual([1, 2]);
    expect(board.folded).toEqual([3, 4]);
    expect(card(board.cards, "stack")).toMatchObject({ kind: "stack", nodeIds: ["ep3", "ep4"], episodes: [{ episode: 3, title: "Episode 3", status: "done" }, { episode: 4, status: "waiting" }] });
    expect(card(board.cards, "ep3")).toBeUndefined();
    expect(card(board.cards, botNodeId("boarder-3"))).toBeUndefined();
    expect(card(board.cards, "film3")).toBeUndefined();
  });

  it("unfolds an episode the person opened, and a failed one", () => {
    const opened = buildBoard(drama(), { opened: new Set([3]) });
    expect(opened.unfolded).toEqual([1, 2, 3]);
    expect(card(opened.cards, "film3")).toMatchObject({ kind: "final", episode: 3, nodeIds: ["film3"] });
    const failed = buildBoard(drama({ production: { episodes: [episodeWire(1, "videos"), episodeWire(2, "done"), episodeWire(3, "failed"), episodeWire(4, "waiting")] } }));
    expect(failed.unfolded).toEqual([1, 3]);
    expect(failed.folded).toEqual([2, 4]);
  });

  it("gives each card the nodes it stands for", () => {
    const { cards } = buildBoard(drama());
    expect(card(cards, "hero")).toMatchObject({ kind: "character", stage: "library", nodeIds: ["hero", "g-hero", "hero-1"], facts: { badge: "Lead" }, picture: { nodeId: "hero-1" }, appearsIn: [{ shotId: "sh1", episode: 1, number: 1 }] });
    expect(card(cards, "pier")).toMatchObject({ kind: "scene", stage: "library", nodeIds: ["pier", "g-pier"] });
    expect(card(cards, "pier-end")).toMatchObject({ kind: "scene", stage: "storyboard", episode: 1, refinedBy: "boarder-1", refinedFrom: "pier" });
    expect(card(cards, "result:sh1")).toMatchObject({ kind: "result", nodeIds: ["cr1", "t1a", "t1b"], status: "done", selectedTakeId: "t1a", number: 1 });
    expect(card(cards, "result:sh2")).toMatchObject({ status: "generating", number: 2, generation: { status: "loading" } });
    expect(card(cards, "sh3")).toMatchObject({ kind: "shot", episode: 2, number: 1, status: "idle" });
    expect(card(cards, "sh1")).toMatchObject({ kind: "shot", seconds: 6, design: { size: "wide" }, takes: 2, characters: ["hero"], scenes: ["pier"] });
    expect(card(cards, "sh2")).toMatchObject({ characters: [], scenes: ["pier-end"] });
    expect(card(cards, "final:1")).toMatchObject({ kind: "final", episode: 1, nodeIds: [], postBotId: "editor-1", clips: [{ number: 1, state: "ready", durationMs: 6000 }, { number: 2, state: "generating" }] });
    expect(card(cards, "note")).toMatchObject({ kind: "other", nodeIds: ["note"] });
    expect(card(cards, "brief")).toMatchObject({ kind: "brief", stage: "brief", rows: [["Episodes", "4"]], by: "lead" });
    expect(card(cards, "plan")).toMatchObject({ kind: "plan", stage: "brief" });
  });

  it("draws each episode's own bots and leaves out the bots they are copies of", () => {
    const { cards } = buildBoard(drama());
    const bots = cards.filter((one) => one.kind === "bot").map((one) => one.id).sort();
    expect(bots).toEqual(["boarder-1", "boarder-2", "builder", "editor-1", "lead", "ops", "painter", "writer"].map(botNodeId).sort());
    expect(card(cards, botNodeId("boarder-1"))).toMatchObject({ stage: "storyboard", episode: 1, job: "storyboard" });
    expect(card(cards, botNodeId("ops"))).toMatchObject({ stage: "brief" });
  });

  it("reads a drama made before episodes as its first episode", () => {
    const legacy = snapshot([bot("lead", ["lead"]), bot("writer", ["script"]), bot("boarder", ["storyboard"]), bot("editor", ["post"])], [
      node("script", "text", { ...madeBy("writer"), metadata: { role: "script", content: "Rain." } }),
      node("sh1", "shot", { ...madeBy("boarder"), metadata: { prompt: "Rooftop" } }),
      node("cr1", "config", { metadata: { role: "creation", shotId: "sh1" } }),
      node("t1", "video", { metadata: { role: "take", shotId: "sh1", selected: true } }),
      node("film", "video", { metadata: { role: "final", file: { path: "f.mp4", mime: "video/mp4", bytes: 1, name: "f.mp4" } } }),
    ]);
    const board = buildBoard(legacy);
    expect(board.unfolded).toEqual([1]);
    expect(card(board.cards, "script")).toMatchObject({ kind: "episode", episode: 1, stage: "script" });
    expect(card(board.cards, "sh1")).toMatchObject({ episode: 1, number: 1 });
    expect(card(board.cards, "film")).toMatchObject({ kind: "final", episode: 1 });
    expect(card(board.cards, botNodeId("boarder"))).toMatchObject({ stage: "storyboard", episode: 1 });
    expect(edge(board.edges, "dispatch", "script", botNodeId("boarder"))).toMatchObject({ label: { kind: "dispatchEpisode", episode: 1 } });
    expect(edge(board.edges, "dispatch", botNodeId("lead"), botNodeId("writer"))).toBeTruthy();
  });

  it("says what each bot is on and how far it got", () => {
    const snap = drama({ production: { tasks: [{ id: "t", job: "storyboard", botId: "boarder-2", episode: 2, status: "working", at: 5 }] } });
    const { cards } = buildBoard(snap);
    expect(card(cards, botNodeId("writer"))).toMatchObject({ progress: { unit: "episodes", done: 4, total: 4 } });
    expect(card(cards, botNodeId("boarder-1"))).toMatchObject({ progress: { unit: "videos", done: 1, total: 2 } });
    expect(card(cards, botNodeId("boarder-2"))).toMatchObject({ task: { job: "storyboard", episode: 2, status: "working" }, jobStatus: "working" });
    expect(card(cards, botNodeId("painter"))).toMatchObject({ jobStatus: "done", progress: { unit: "characters", done: 1, total: 1 } });
    expect(card(cards, botNodeId("lead"))).toMatchObject({ lead: true, progress: { unit: "tasks", done: 3, total: 5 } });
  });

  it("tells a storyboard bot what its episode waits for, where each shot starts, how long an episode runs, and what was made before a change", () => {
    const snap = drama();
    const changed: Record<string, NonNullable<CanvasNode["metadata"]>> = { sh2: { settings: { seconds: 4 } }, cr1: { stale: true }, t1b: { stale: true } };
    snap.nodes = snap.nodes.map((one) => (changed[one.id] ? { ...one, metadata: { ...one.metadata, ...changed[one.id] } } : one));
    const { cards } = buildBoard(snap);
    expect(card(cards, botNodeId("boarder-1"))).toMatchObject({ gate: { characters: { done: 1, total: 1 }, scenes: { done: 0, total: 1 }, script: true } });
    expect(card(cards, botNodeId("editor-1"))).not.toHaveProperty("gate");
    expect(card(cards, botNodeId("writer"))).not.toHaveProperty("gate");
    expect(card(cards, "sh1")).toMatchObject({ startsAt: 0, stale: true });
    expect(card(cards, "sh2")).toMatchObject({ startsAt: 6, seconds: 4 });
    expect(card(cards, "sh2")).not.toHaveProperty("stale");
    expect(card(cards, "ep1")).toMatchObject({ seconds: 10 });
    expect(card(cards, "sh3")).toMatchObject({ startsAt: 0 });
    expect(card(cards, "ep2")).not.toHaveProperty("seconds");
    expect(card(cards, "result:sh1")).toMatchObject({ takes: [{ nodeId: "t1a", selected: true }, { nodeId: "t1b", stale: true }] });
    expect((card(cards, "result:sh1") as { takes: object[] }).takes[0]).not.toHaveProperty("stale");

    const noCast = buildBoard(drama({ production: { jobs: [{ job: "script", botId: "writer", status: "done" }, { job: "scene", botId: "builder", status: "done" }] } }));
    expect((card(noCast.cards, botNodeId("boarder-1")) as { gate?: object }).gate).toEqual({ scenes: { done: 0, total: 1 }, script: true });
  });

  it("offers a retry on a bot whose job or episode stopped", () => {
    const snap = drama({ production: {
      jobs: [{ job: "script", botId: "writer", status: "done" }, { job: "character", botId: "painter", status: "failed" }, { job: "scene", botId: "builder", status: "done" }],
      episodes: [episodeWire(1, "failed", { storyboardBotId: "boarder-1", postBotId: "editor-1" }), episodeWire(2, "storyboard", { storyboardBotId: "boarder-2" }), episodeWire(3, "done"), episodeWire(4, "waiting")],
    } });
    const { cards } = buildBoard(snap);
    expect(card(cards, botNodeId("painter"))).toMatchObject({ retry: { job: "character" } });
    expect(card(cards, botNodeId("boarder-1"))).toMatchObject({ retry: { episode: 1 } });
    expect(card(cards, botNodeId("boarder-2"))).not.toHaveProperty("retry");
    expect(card(cards, botNodeId("writer"))).not.toHaveProperty("retry");
  });
});

describe("the board's lines", () => {
  it("joins the cards as the work flows, each line done, active or waiting", () => {
    const { edges } = buildBoard(drama());
    const lead = botNodeId("lead");
    const writer = botNodeId("writer");
    expect(edge(edges, "output", lead, "brief")?.state).toBe("done");
    expect(edge(edges, "output", lead, "plan")?.state).toBe("done");
    expect(edge(edges, "handoff", "brief", writer)?.state).toBe("done");
    expect(edge(edges, "dispatch", "plan", writer)).toMatchObject({ state: "done", label: { kind: "dispatchScript" } });
    expect(edge(edges, "dispatch", writer, botNodeId("painter"))).toMatchObject({ label: { kind: "dispatchCharacters" } });
    expect(edge(edges, "dispatch", writer, botNodeId("builder"))).toMatchObject({ label: { kind: "dispatchScenes" } });
    expect(edge(edges, "output", writer, "ep1")).toMatchObject({ label: { kind: "episodes", count: 4 } });
    expect(edge(edges, "output", writer, "ep2")).not.toHaveProperty("label");
    expect(edge(edges, "output", writer, "stack")).toBeTruthy();
    expect(edge(edges, "output", botNodeId("painter"), "hero")?.state).toBe("done");
    expect(edge(edges, "output", botNodeId("builder"), "pier")).toBeTruthy();
    expect(edge(edges, "output", botNodeId("builder"), "pier-end")).toBeUndefined();
    expect(edge(edges, "dispatch", "ep1", botNodeId("boarder-1"))).toMatchObject({ state: "done", label: { kind: "dispatchEpisode", episode: 1 } });
    expect(edge(edges, "dispatch", "ep2", botNodeId("boarder-2"))?.state).toBe("active");
    expect(edge(edges, "output", botNodeId("boarder-1"), "sh1")?.state).toBe("done");
    expect(edge(edges, "output", botNodeId("boarder-1"), "sh2")?.state).toBe("active");
    expect(edge(edges, "output", botNodeId("boarder-2"), "sh3")?.state).toBe("active");
    expect(edge(edges, "gen", "sh1", "result:sh1")?.state).toBe("done");
    expect(edge(edges, "gen", "sh2", "result:sh2")?.state).toBe("active");
    expect(edge(edges, "gen", "sh3", "result:sh3")?.state).toBe("wait");
    expect(edge(edges, "handoff", "result:sh1", botNodeId("editor-1"))).toMatchObject({ state: "done", label: { kind: "videos", ready: 1, shots: 2 } });
    expect(edge(edges, "handoff", "result:sh2", botNodeId("editor-1"))).toMatchObject({ state: "wait" });
    expect(edge(edges, "output", botNodeId("editor-1"), "final:1")).toMatchObject({ state: "wait", label: { kind: "cut", episode: 1 } });
    expect(edge(edges, "derive", botNodeId("boarder-1"), "pier-end")).toMatchObject({ label: { kind: "refine" } });
    expect(edge(edges, "ref", "pier", "pier-end")).toBeTruthy();
    expect(edge(edges, "ref", "hero", "sh1")).toBeTruthy();
    expect(edge(edges, "ref", "pier", "sh1")).toBeTruthy();
    expect(edge(edges, "ref", "pier-end", "sh2")).toBeTruthy();
    expect(new Set(edges.map((one) => one.id)).size).toBe(edges.length);
  });

  it("hides reference lines unless they are asked for or touch the card in focus", () => {
    const { edges } = buildBoard(drama());
    const refs = (shown: readonly BoardEdge[]) => shown.filter((one) => one.kind === "ref").map((one) => one.id).sort();
    expect(refs(visibleEdges(edges, { showRefs: false, focus: null }))).toEqual([]);
    expect(refs(visibleEdges(edges, { showRefs: true, focus: null }))).toEqual(refs(edges));
    expect(refs(visibleEdges(edges, { showRefs: false, focus: "hero" }))).toEqual([edge(edges, "ref", "hero", "sh1")!.id]);
    expect(visibleEdges(edges, { showRefs: false, focus: null }).filter((one) => one.kind !== "ref")).toHaveLength(edges.filter((one) => one.kind !== "ref").length);
  });
});

describe("the board's stages", () => {
  it("tells each stage's state from the production, a stage some episodes are past being at work", () => {
    expect(buildBoard(drama()).stages).toEqual({ brief: "done", script: "done", library: "done", storyboard: "active", post: "active" });
    const posting = drama({ production: { episodes: [episodeWire(1, "post"), episodeWire(2, "done")] } });
    expect(buildBoard(posting).stages).toMatchObject({ storyboard: "done", post: "active" });
    const between = drama({ production: { episodes: [episodeWire(1, "done"), episodeWire(2, "waiting")] } });
    expect(buildBoard(between).stages).toMatchObject({ storyboard: "active", post: "active" });
    const waiting = drama({ production: { episodes: [episodeWire(1, "waiting"), episodeWire(2, "waiting")] } });
    expect(buildBoard(waiting).stages).toMatchObject({ storyboard: "wait", post: "wait" });
    const finished = drama({ production: { episodes: [episodeWire(1, "done"), episodeWire(2, "done")] } });
    expect(buildBoard(finished).stages).toMatchObject({ storyboard: "done", post: "done" });
    const failing = drama({ production: { jobs: [{ job: "script", botId: "writer", status: "done" }, { job: "character", botId: "painter", status: "failed" }, { job: "scene", botId: "builder", status: "working" }] } });
    expect(buildBoard(failing).stages).toMatchObject({ library: "failed" });
    expect(buildBoard(snapshot([bot("lead", ["lead"])], [])).stages).toEqual({ brief: "active", script: "wait", library: "wait", storyboard: "wait", post: "wait" });
  });

  it("knows the episode of a node inside a folded episode", () => {
    const board = buildBoard(drama());
    expect(board.episodeOfNode.get("film3")).toBe(3);
    expect(board.episodeOfNode.get(botNodeId("boarder-3"))).toBe(3);
    expect(board.episodeOfNode.get("ep4")).toBe(4);
    expect(board.cardOfNode.get("t1b")).toBe("result:sh1");
    expect(board.cardOfNode.get("g-hero")).toBe("hero");
  });
});
