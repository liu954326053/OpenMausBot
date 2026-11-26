import { describe, expect, it } from "vitest";
import type { CanvasNode, CanvasSnapshot } from "../../../shared/project-canvas";
import { boardIndex, type BoardAsset } from "./board-index";
import { bigBoardSnapshot, boardSnapshot } from "./board-sample.fixture";

const ids = (assets: readonly BoardAsset[]): string[] => assets.map((asset) => asset.node.id);

function legacySnapshot(): CanvasSnapshot {
  const snapshot = boardSnapshot();
  const kept = new Set(["lead", "writer", "designer", "scenery", "board", "post"]);
  const episodeNodes = new Set(["episode-2", "episode-3", "episode-4"]);
  const nodes: CanvasNode[] = [];
  for (const node of snapshot.nodes) {
    if (node.type === "bot" && !kept.has(node.id.slice("bot:".length))) continue;
    if (episodeNodes.has(node.id)) continue;
    const episode = node.metadata?.episode;
    if (episode !== undefined && episode !== 1) continue;
    if (node.id === "episode-1") {
      nodes.push({ ...node, title: "雾港灯语 剧本", metadata: { role: "script", content: "剧本" } });
      continue;
    }
    if (!node.metadata) {
      nodes.push(node);
      continue;
    }
    const { episode: _episode, ...metadata } = node.metadata;
    nodes.push({ ...node, metadata });
  }
  const live = new Set(nodes.map((node) => node.id));
  return {
    ...snapshot,
    nodes,
    connections: snapshot.connections.filter((line) => live.has(line.fromNodeId) && live.has(line.toNodeId)),
    bots: Object.fromEntries(Object.entries(snapshot.bots).filter(([botId]) => kept.has(botId))),
    production: undefined,
  };
}

describe("boardIndex", () => {
  it("orders the team as the work goes: the lead, the drama's jobs, then each episode's storyboard and post", () => {
    const { team } = boardIndex(boardSnapshot());
    expect(team.drama.map((bot) => bot.botId)).toEqual(["lead", "writer", "designer", "scenery", "board", "post", "publicist"]);
    expect(team.episodes.map((bot) => bot.botId)).toEqual(["board-1", "post-1", "board-2", "board-3"]);
  });

  it("finds a character and a scene by their group, their profile or a picture in the group", () => {
    const index = boardIndex(boardSnapshot());
    expect(ids(index.characters)).toEqual(["profile-qingwu", "profile-chenzhou", "profile-baixiansheng", "profile-aman"]);
    expect(ids(index.scenes)).toEqual(["profile-pier", "profile-shop", "profile-lighthouse", "profile-street", "profile-pier-end"]);
    const qingwu = index.characters[0]!;
    expect(qingwu).toMatchObject({ kind: "character", cardId: "group-qingwu", title: "沈青梧" });
    expect(qingwu.media?.id).toBe("image-qingwu");
    expect(index.assetOf("group-qingwu")).toBe(qingwu);
    expect(index.assetOf("image-qingwu")).toBe(qingwu);
    expect(index.assetOf("profile-qingwu")).toBe(qingwu);
  });

  it("numbers each episode's shots and finds a shot's result by its creation or any of its takes", () => {
    const index = boardIndex(boardSnapshot());
    expect(index.shotsByEpisode.map((group) => [group.episode, group.shots.length])).toEqual([[1, 6], [2, 5], [3, 2]]);
    const third = index.shotsByEpisode[0]!.shots[2]!;
    expect(third).toMatchObject({ kind: "shot", cardId: "shot-1-3", code: "SH03", episode: 1 });
    expect(third.node.id).toBe("shot-1-3");
    expect(third.media?.id).toBe("take-1-3-3");
    expect(third.takes?.map((take) => take.id)).toEqual(["take-1-3-1", "take-1-3-2", "take-1-3-3"]);
    const result = index.assetOf("take-1-3-1")!;
    expect(result).toMatchObject({ kind: "result", cardId: "creation-1-3", code: "SH03", episode: 1, title: "船影" });
    expect(result.node.id).toBe("creation-1-3");
    expect(index.assetOf("creation-1-3")).toBe(result);
    expect(ids(index.results)).toHaveLength(13);
    expect(index.assetOf("shot-2-4")?.media).toBeUndefined();
  });

  it("knows the finished films, the documents and what is no asset", () => {
    const index = boardIndex(boardSnapshot());
    expect(ids(index.finals)).toEqual(["final-1"]);
    expect(index.assetOf("final-1")).toMatchObject({ kind: "final", episode: 1, title: "点灯的人 成片" });
    expect(index.assetOf("final-1")?.media?.id).toBe("final-1");
    expect(index.assetOf("episode-2")).toMatchObject({ kind: "episode", episode: 2, title: "不在航表上的船" });
    expect(index.assetOf("brief")).toMatchObject({ kind: "brief" });
    expect(index.assetOf("bot:lead")).toBeNull();
    expect(index.assetOf("missing")).toBeNull();
  });

  it("lists the shots a character or a scene is connected into", () => {
    const index = boardIndex(boardSnapshot());
    expect(ids(index.appearances(index.assetOf("group-qingwu")!))).toEqual(["shot-1-1", "shot-1-3", "shot-1-5", "shot-2-1", "shot-2-3", "shot-2-5", "shot-3-1"]);
    expect(ids(index.appearances(index.assetOf("group-pier-end")!))).toEqual(["shot-1-6"]);
    expect(index.appearances(index.assetOf("shot-1-1")!)).toEqual([]);
  });

  it("names the bot that owns each kind of asset", () => {
    const index = boardIndex(boardSnapshot());
    const owner = (nodeId: string): string => index.ownerOf(index.assetOf(nodeId)!);
    expect(owner("group-qingwu")).toBe("designer");
    expect(owner("group-pier")).toBe("scenery");
    expect(owner("group-pier-end")).toBe("board-1");
    expect(owner("shot-2-1")).toBe("board-2");
    expect(owner("take-2-1-1")).toBe("board-2");
    expect(owner("final-1")).toBe("post-1");
    expect(owner("episode-3")).toBe("writer");
    expect(owner("brief")).toBe("lead");
    expect(owner("plan")).toBe("lead");
  });

  it("offers a storyboard bot every character and scene, and gathers what is connected into a bot", () => {
    const index = boardIndex(boardSnapshot());
    expect(ids(index.libraryFor("board-2"))).toEqual([...ids(index.characters), ...ids(index.scenes)]);
    expect(index.libraryFor("writer")).toEqual([]);
    expect(ids(index.connectedInto("board-2"))).toEqual(["episode-2"]);
    expect(ids(index.connectedInto("writer"))).toEqual(["brief"]);
    expect(ids(index.connectedInto("post-1"))).toEqual(["creation-1-1", "creation-1-2", "creation-1-3", "creation-1-4", "creation-1-5", "creation-1-6"]);
  });

  it("gives each episode its row from the production", () => {
    expect(boardIndex(boardSnapshot()).episodes).toEqual([
      { episode: 1, nodeId: "episode-1", title: "点灯的人", status: "done", shots: 6, ready: 6 },
      { episode: 2, nodeId: "episode-2", title: "不在航表上的船", status: "videos", shots: 5, ready: 3 },
      { episode: 3, nodeId: "episode-3", title: "灯芯里的名字", status: "storyboard", shots: 2, ready: 0 },
      { episode: 4, nodeId: "episode-4", title: "钟楼下的账本", status: "waiting", shots: 0, ready: 0 },
    ]);
  });

  it("reads a project from before episodes as one episode: its script, and shots without an episode", () => {
    const index = boardIndex(legacySnapshot());
    expect(index.episodes).toEqual([{ episode: 1, nodeId: "episode-1", title: "雾港灯语 剧本", shots: 6, ready: 6 }]);
    expect(index.assetOf("episode-1")).toMatchObject({ kind: "episode", episode: 1 });
    expect(index.shotsByEpisode.map((group) => [group.episode, group.shots.length])).toEqual([[1, 6]]);
    expect(index.ownerOf(index.assetOf("shot-1-2")!)).toBe("board");
    expect(index.ownerOf(index.assetOf("group-pier-end")!)).toBe("scenery");
    expect(index.team.drama.map((bot) => bot.botId)).toEqual(["lead", "writer", "designer", "scenery", "board", "post"]);
    expect(index.team.episodes).toEqual([]);
  });

  it("indexes a drama of 60 episodes quickly", () => {
    const snapshot = bigBoardSnapshot(60);
    boardIndex(snapshot);
    const started = performance.now();
    const index = boardIndex(snapshot);
    const elapsed = performance.now() - started;
    expect(index.team.drama.length + index.team.episodes.length).toBe(127);
    expect(index.episodes).toHaveLength(60);
    expect(index.shotsByEpisode.flatMap((group) => group.shots)).toHaveLength(360);
    expect(elapsed).toBeLessThan(50);
  });
});
