import { describe, expect, it } from "vitest";
import type { Board, BoardCard } from "@/lib/production-board/types";
import { intersects } from "./camera";
import { bbox, cardWidth, layoutBoard, stageAt } from "./layout";

const HEIGHT: Record<string, number> = { bot: 300, brief: 340, plan: 300, episode: 280, stack: 250, character: 210, scene: 264, shot: 270, result: 218, final: 600, other: 220 };
const heightOf = (card: BoardCard) => (card.kind === "bot" && card.lead ? 500 : HEIGHT[card.kind]!);
const card = (kind: BoardCard["kind"], id: string, more: Record<string, unknown> = {}) => ({ kind, id, nodeIds: [id], ...more }) as unknown as BoardCard;
const bot = (id: string, job: string | undefined, more: Record<string, unknown> = {}) => card("bot", id, { botId: id, lead: false, job, ...more });

const CARDS: BoardCard[] = [
  bot("lead", undefined, { lead: true, stage: "brief" }),
  card("brief", "brief", { stage: "brief" }), card("plan", "plan", { stage: "brief" }),
  bot("writer", "script", { stage: "script" }),
  card("episode", "ep1", { episode: 1, stage: "script" }), card("episode", "ep2", { episode: 2, stage: "script" }), card("stack", "stack", { stage: "script" }),
  bot("faces", "character", { stage: "library" }), bot("sets", "scene", { stage: "library" }),
  card("character", "c1", { stage: "library" }), card("character", "c2", { stage: "library" }), card("scene", "s1", { stage: "library" }),
  bot("b1", "storyboard", { episode: 1, stage: "storyboard" }), bot("b2", "storyboard", { episode: 2, stage: "storyboard" }),
  card("shot", "sh1", { episode: 1, stage: "storyboard" }), card("result", "v1", { episode: 1, shotId: "sh1", stage: "storyboard" }),
  card("shot", "sh2", { episode: 1, stage: "storyboard" }), card("result", "v2", { episode: 1, shotId: "sh2", stage: "storyboard" }),
  card("shot", "sh3", { episode: 2, stage: "storyboard" }),
  bot("p1", "post", { episode: 1, stage: "post" }), card("final", "f1", { episode: 1, stage: "post" }),
];
const board = (cards: BoardCard[] = CARDS) => ({ empty: false, cards, edges: [], stages: {}, unfolded: [1, 2], folded: [3], cardOfNode: new Map(), episodeOfNode: new Map() }) as unknown as Board;
const at = (cards?: BoardCard[]) => {
  const { rects } = layoutBoard(board(cards), heightOf);
  return (id: string) => { const r = rects.get(id)!; return [r.x, r.y]; };
};

describe("the board's layout", () => {
  it("gives each card its kind's width, the lead's wider", () => {
    expect(CARDS.map(cardWidth)).toEqual([380, 330, 330, 320, 400, 400, 400, 320, 320, 400, 400, 340, 320, 320, 470, 320, 470, 320, 470, 320, 620]);
  });

  it("stands the lead, the brief and the plan, and the script bot on the mockup's first columns", () => {
    const xy = at();
    expect(xy("lead")).toEqual([0, -250]);
    expect(xy("brief")).toEqual([500, -344]);
    expect(xy("plan")).toEqual([500, 44]);
    expect(xy("writer")).toEqual([960, -150]);
  });

  it("stacks the episodes with the stack under them, the character bot above and the scene bot below", () => {
    const xy = at();
    expect([xy("ep1"), xy("ep2"), xy("stack")]).toEqual([[1640, -433], [1640, -125], [1640, 183]]);
    expect(xy("faces")).toEqual([1640, -903]);
    expect(xy("sets")).toEqual([1640, 511]);
  });

  it("keeps the character bot and the scene bot clear of the episodes while there are no characters or scenes", () => {
    const { rects } = layoutBoard(board(CARDS.filter((one) => one.kind !== "character" && one.kind !== "scene")), heightOf);
    const episodes = rects.get("ep1")!;
    const stack = rects.get("stack")!;
    const faces = rects.get("faces")!;
    expect(faces.y + faces.h).toBe(episodes.y - 28);
    expect(rects.get("sets")!.y).toBe(stack.y + stack.h + 28);
  });

  it("keeps the script, character and scene bots apart on a board of bots alone", () => {
    const { rects } = layoutBoard(board([CARDS[0]!, ...["writer", "faces", "sets"].map((id) => CARDS.find((one) => one.id === id)!)]), heightOf);
    const [writer, faces, sets] = ["writer", "faces", "sets"].map((id) => rects.get(id)!);
    expect([intersects(faces!, sets!), intersects(faces!, writer!), intersects(sets!, writer!)]).toEqual([false, false, false]);
  });

  it("stacks several bots of one job as a group, clear of the episodes", () => {
    const cards = [...CARDS.filter((one) => one.kind !== "character" && one.kind !== "scene"), bot("faces2", "character", { stage: "library" })];
    const { rects } = layoutBoard(board(cards), heightOf);
    expect(rects.get("faces2")!.y + rects.get("faces2")!.h).toBe(rects.get("ep1")!.y - 28);
    expect(rects.get("faces")!.y + rects.get("faces")!.h).toBe(rects.get("faces2")!.y - 28);
  });

  it("stacks the storyboard bots between the characters above and the scenes below", () => {
    const xy = at();
    expect([xy("b1"), xy("b2")]).toEqual([[2260, -322], [2260, 22]]);
    expect([xy("c1"), xy("c2")]).toEqual([[2260, -977], [2260, -739]]);
    expect(xy("s1")).toEqual([2260, 529]);
  });

  it("gives each unfolded episode a block of its shots and their videos, the first about its storyboard bot, the next 120 below", () => {
    const xy = at();
    expect([xy("sh1"), xy("v1")]).toEqual([[2960, -459], [3550, -433]]);
    expect([xy("sh2"), xy("v2")]).toEqual([[2960, -155], [3550, -129]]);
    expect([xy("p1"), xy("f1")]).toEqual([[4110, -322], [4580, -472]]);
    expect(xy("sh3")).toEqual([2960, 248]);
    const { blocks } = layoutBoard(board(), heightOf);
    expect(blocks.get(1)).toEqual({ x: 2960, y: -472, w: 2240, h: 600 });
    expect(blocks.get(2)).toEqual({ x: 2960, y: 248, w: 470, h: 270 });
  });

  it("puts a scene a storyboard bot refined above its episode's shots", () => {
    const xy = at([...CARDS, card("scene", "s1a", { episode: 1, refinedBy: "b1", stage: "storyboard" })]);
    expect(xy("s1a")).toEqual([2960, -459 - 34 - 264]);
    expect(xy("s1")).toEqual([2260, 529]);
  });

  it("leaves a card the person moved where they put it, and rows what is outside the production under the rest", () => {
    const xy = at([...CARDS, card("other", "note"), card("brief", "brief", { stage: "brief", moved: { x: 7, y: 9 } })].filter((one, index, list) => one.id !== "brief" || index === list.length - 1));
    expect(xy("brief")).toEqual([7, 9]);
    expect(xy("note")[0]).toBe(0);
    expect(xy("note")[1]).toBeGreaterThan(529 + 264);
  });

  it("rows a folded episode's shot and a second post bot with the rest rather than over a placed card", () => {
    const xy = at([...CARDS, card("shot", "sh9", { episode: 3, stage: "storyboard" }), bot("p1b", "post", { episode: 1, stage: "post" })]);
    expect([xy("sh9")[0], xy("p1b")[0]]).toEqual([0, 470 + 34]);
    expect(xy("sh9")[1]).toBe(811 + 240);
    expect(xy("p1")).toEqual([4110, -322]);
  });

  it("spans nothing for an empty board", () => {
    expect(layoutBoard(board([]), heightOf)).toEqual({ rects: new Map(), stages: {}, blocks: new Map(), bounds: { x: 0, y: 0, w: 0, h: 0 } });
  });

  it("spans each stage by its cards grown by 48, and the world by all of them grown by 60", () => {
    const { stages, bounds, rects } = layoutBoard(board(), heightOf);
    expect(stages.brief).toEqual({ x: -48, y: -392, w: 926, h: 784 });
    const all = bbox(rects.values())!;
    expect(bounds).toEqual({ x: all.x - 60, y: all.y - 60, w: all.w + 120, h: all.h + 120 });
  });

  it("names the stage the view's centre is in, with 200 to spare above and below, and none when zoomed out past 20%", () => {
    const { stages } = layoutBoard(board(), heightOf);
    expect(stageAt(stages, { x: 200, y: 0 }, 1)).toBe("brief");
    expect(stageAt(stages, { x: 200, y: 560 }, 1)).toBe("brief");
    expect(stageAt(stages, { x: 200, y: 700 }, 1)).toBeUndefined();
    expect(stageAt(stages, { x: 200, y: 0 }, 0.19)).toBeUndefined();
  });
});
