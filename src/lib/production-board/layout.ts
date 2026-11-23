import type { Board, BoardCard, BoardCardKind } from "./board";
import { BOARD_STAGES, type BoardStage } from "./overlay";

export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardSize {
  width: number;
  height: number;
}

export type BoardCardSizes = Record<BoardCardKind, BoardSize>;

export const PLACEHOLDER_CARD_SIZES: BoardCardSizes = {
  bot: { width: 320, height: 280 },
  brief: { width: 330, height: 300 },
  plan: { width: 330, height: 260 },
  episode: { width: 400, height: 320 },
  stack: { width: 400, height: 220 },
  character: { width: 400, height: 240 },
  scene: { width: 340, height: 260 },
  shot: { width: 470, height: 300 },
  result: { width: 320, height: 230 },
  final: { width: 620, height: 420 },
  other: { width: 340, height: 240 },
};

export const ROW_GAP = 32;
export const LANE_GAP = 120;
/** Between the episodes' lanes and the characters above them or the scenes below. */
export const LIBRARY_SPLIT = 160;
const OTHERS_GAP = 240;
const OTHERS_PER_ROW = 8;

/** The columns from left to right, each with the room after it; the wider ones leave room for a line's label. */
const COLUMNS = ["lead", "brief", "writer", "episodes", "boarders", "shots", "results", "editors", "finals"] as const;
type Column = (typeof COLUMNS)[number];
const GAP_AFTER: Record<Column, number> = { lead: 120, brief: 130, writer: 320, episodes: 220, boarders: 280, shots: 120, results: 240, editors: 150, finals: 0 };

export interface BoardLayout {
  rects: Map<string, BoardRect>;
  /** The span of each stage's cards; none for a stage without one. */
  stages: Partial<Record<BoardStage, BoardRect>>;
  /** Each unfolded episode's row, from its episode card to its film. */
  lanes: Map<number, BoardRect>;
  bounds: BoardRect;
}

export function unionRect(rects: Iterable<BoardRect>): BoardRect | undefined {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const rect of rects) {
    x1 = Math.min(x1, rect.x);
    y1 = Math.min(y1, rect.y);
    x2 = Math.max(x2, rect.x + rect.width);
    y2 = Math.max(y2, rect.y + rect.height);
  }
  return x1 === Infinity ? undefined : { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

const columnOf = (card: BoardCard): Column | undefined => {
  switch (card.kind) {
    case "bot":
      if (card.lead || !card.job) return "lead";
      return card.job === "script" ? "writer" : card.job === "character" || card.job === "scene" ? "episodes" : card.job === "storyboard" ? "boarders" : "editors";
    case "brief":
    case "plan":
      return "brief";
    case "episode":
    case "stack":
      return "episodes";
    case "character":
    case "scene":
      return card.refinedBy ? "shots" : "boarders";
    case "shot":
      return "shots";
    case "result":
      return "results";
    case "final":
      return "finals";
    case "other":
      return undefined;
  }
};

/** Where each card of the board goes: the five stages from left to right, a row for each unfolded episode, the
 * characters above the rows and the scenes below; a card the person moved stays where they put it. */
export function layoutBoard(board: Board, sizeOf: (card: BoardCard) => BoardSize): BoardLayout {
  const sizes = new Map(board.cards.map((card) => [card.id, sizeOf(card)]));
  const width = (column: Column) => Math.max(0, ...board.cards.filter((card) => columnOf(card) === column).map((card) => sizes.get(card.id)!.width));
  const left = new Map<Column, number>();
  let x = 0;
  for (const column of COLUMNS) {
    left.set(column, x);
    const room = width(column);
    if (room) x += room + GAP_AFTER[column];
  }
  const rects = new Map<string, BoardRect>();
  const put = (card: BoardCard, top: number) => {
    const size = sizes.get(card.id)!;
    rects.set(card.id, { x: left.get(columnOf(card)!)!, y: Math.round(top), ...size });
    return top + size.height;
  };
  const stack = (cards: readonly BoardCard[], top: number, gap = ROW_GAP) => {
    let y = top;
    for (const card of cards) y = put(card, y) + gap;
    return cards.length ? y - gap : top;
  };
  const heightOf = (cards: readonly BoardCard[], gap = ROW_GAP) => cards.reduce((sum, card) => sum + sizes.get(card.id)!.height, 0) + gap * Math.max(0, cards.length - 1);
  const centred = (cards: readonly BoardCard[], centre: number, gap = ROW_GAP) => stack(cards, centre - heightOf(cards, gap) / 2, gap);
  const where = (column: Column, episode?: number) => board.cards.filter((card) => columnOf(card) === column && card.episode === episode);

  const leads = where("lead").sort((a, b) => Number(b.kind === "bot" && b.lead) - Number(a.kind === "bot" && a.lead));
  stack(leads, leads[0] ? -sizes.get(leads[0].id)!.height / 2 : 0);
  centred(where("brief"), 0, 48);
  centred(where("writer"), 0);

  const lanes = new Map<number, BoardRect>();
  const firstEpisode = board.cards.find((card) => card.kind === "episode");
  const lanesTop = -(firstEpisode ? sizes.get(firstEpisode.id)!.height : 0) / 2;
  let y = lanesTop;
  for (const episode of board.unfolded) {
    const head = Math.max(
      stack(where("episodes", episode).filter((card) => card.kind === "episode"), y),
      stack(where("boarders", episode).filter((card) => card.kind === "bot"), y),
      stack(where("editors", episode), y),
      stack(where("finals", episode), y),
    );
    const refined = where("shots", episode).filter((card) => card.kind === "scene");
    let row = refined.length ? stack(refined, y) + ROW_GAP : y;
    for (const shot of where("shots", episode).filter((card) => card.kind === "shot")) {
      const result = board.cards.find((card) => card.kind === "result" && card.shotId === shot.id);
      const rowHeight = Math.max(sizes.get(shot.id)!.height, result ? sizes.get(result.id)!.height : 0);
      put(shot, row + (rowHeight - sizes.get(shot.id)!.height) / 2);
      if (result) put(result, row + (rowHeight - sizes.get(result.id)!.height) / 2);
      row += rowHeight + ROW_GAP;
    }
    const bottom = Math.max(head, row - ROW_GAP);
    lanes.set(episode, { x: left.get("episodes")!, y, width: x - left.get("episodes")!, height: bottom - y });
    y = bottom + LANE_GAP;
  }
  const stackCard = board.cards.find((card) => card.kind === "stack");
  const lanesBottom = stackCard ? put(stackCard, y) : board.unfolded.length ? y - LANE_GAP : lanesTop;

  const library = (kind: "character" | "scene") => board.cards.filter((card) => card.kind === kind && !card.refinedBy);
  const libraryBots = (job: "character" | "scene") => board.cards.filter((card) => card.kind === "bot" && card.job === job && card.episode === undefined);
  const characters = library("character");
  const charactersTop = Math.min(lanesTop, 0) - LIBRARY_SPLIT - heightOf(characters);
  stack(characters, charactersTop);
  centred(libraryBots("character"), charactersTop + heightOf(characters) / 2);
  const scenes = library("scene");
  const scenesTop = Math.max(lanesBottom, 0) + LIBRARY_SPLIT;
  stack(scenes, scenesTop);
  centred(libraryBots("scene"), scenesTop + heightOf(scenes) / 2);

  const placed = unionRect(rects.values());
  const others = board.cards.filter((card) => !rects.has(card.id));
  const cell = { width: Math.max(0, ...others.map((card) => sizes.get(card.id)!.width)) + ROW_GAP, height: Math.max(0, ...others.map((card) => sizes.get(card.id)!.height)) + ROW_GAP };
  const othersTop = placed ? placed.y + placed.height + OTHERS_GAP : 0;
  others.forEach((card, at) => {
    rects.set(card.id, { x: (at % OTHERS_PER_ROW) * cell.width, y: othersTop + Math.floor(at / OTHERS_PER_ROW) * cell.height, ...sizes.get(card.id)! });
  });

  for (const card of board.cards) if (card.moved) rects.set(card.id, { ...card.moved, ...sizes.get(card.id)! });
  const stages: Partial<Record<BoardStage, BoardRect>> = {};
  for (const stage of BOARD_STAGES) {
    const span = unionRect(board.cards.filter((card) => card.stage === stage).map((card) => rects.get(card.id)!));
    if (span) stages[stage] = span;
  }
  return { rects, stages, lanes, bounds: unionRect(rects.values()) ?? { x: 0, y: 0, width: 0, height: 0 } };
}
