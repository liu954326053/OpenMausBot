import type { ProductionJob } from "../../../../shared/production";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";
import type { Board, BoardCard } from "@/lib/production-board/types";
import type { Rect } from "./camera";

export const CARD_WIDTH: Record<BoardCard["kind"], number> = {
  bot: 320,
  brief: 330,
  plan: 330,
  episode: 400,
  stack: 400,
  character: 400,
  scene: 340,
  shot: 470,
  result: 320,
  final: 620,
  other: 320,
};

export const LEAD_WIDTH = 380;

export const ESTIMATED_HEIGHT: Record<BoardCard["kind"], number> = {
  bot: 380,
  brief: 339,
  plan: 299,
  episode: 281,
  stack: 255,
  character: 210,
  scene: 264,
  shot: 270,
  result: 218,
  final: 600,
  other: 220,
};

const isLead = (card: BoardCard): boolean => card.kind === "bot" && card.lead;

export const cardWidth = (card: BoardCard): number => (isLead(card) ? LEAD_WIDTH : CARD_WIDTH[card.kind]);

export interface BoardLayout {
  rects: Map<string, Rect>;
  /** Each stage's cards, grown by 48. */
  stages: Partial<Record<BoardStage, Rect>>;
  /** Each unfolded episode's shots, post bot and film. */
  blocks: Map<number, Rect>;
  /** Every card, grown by 60. */
  bounds: Rect;
}

const G = 28;
const RG = 34;
const SPLIT = 96;
const XA = 1640;
const XB = 2260;
const XS = 2960;
const XV = XS + 470 + 120;
const XP = XV + 320 + 240;
const XF = XP + 320 + 150;
const OUTS_X = 500;
const OUTS_GAP = 48;
const WRITER_X = 960;
const BOARDERS_GAP = 44;
const BLOCK_GAP = 120;
const OTHERS_PER_ROW = 8;
const OTHERS_GAP = 240;
const STAGE_PAD = 48;
const WORLD_PAD = 60;
const STAGE_BAR_MIN_ZOOM = 0.2;
const STAGE_BAR_SLACK = 200;

export function bbox(rects: Iterable<Rect>): Rect | undefined {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return x1 === Infinity ? undefined : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

const doing = (job: ProductionJob | undefined, episode?: number) => (card: BoardCard): boolean =>
  card.kind === "bot" && !card.lead && card.job === job && (episode === undefined || card.episode === episode);

const isRefined = (card: BoardCard): boolean => (card.kind === "character" || card.kind === "scene") && card.refinedBy !== undefined;

const byEpisode = (a: BoardCard, b: BoardCard): number => (a.episode ?? 0) - (b.episode ?? 0);

class Placement {
  readonly rects = new Map<string, Rect>();
  readonly #pending: Set<BoardCard>;
  readonly #heightOf: (card: BoardCard) => number;

  constructor(cards: readonly BoardCard[], heightOf: (card: BoardCard) => number) {
    this.#pending = new Set(cards);
    this.#heightOf = heightOf;
  }

  get rest(): BoardCard[] {
    return [...this.#pending];
  }

  take(match: (card: BoardCard) => boolean): BoardCard[] {
    const taken = [...this.#pending].filter(match);
    for (const card of taken) this.#pending.delete(card);
    return taken;
  }

  takeFirst(match: (card: BoardCard) => boolean): BoardCard | undefined {
    for (const card of this.#pending) {
      if (!match(card)) continue;
      this.#pending.delete(card);
      return card;
    }
    return undefined;
  }

  height(card: BoardCard): number {
    return this.#heightOf(card);
  }

  stackHeight(cards: readonly BoardCard[], gap: number): number {
    if (!cards.length) return 0;
    return cards.reduce((sum, card) => sum + this.height(card), 0) + gap * (cards.length - 1);
  }

  at(card: BoardCard, x: number, y: number): void {
    this.rects.set(card.id, { x, y: Math.round(y), w: cardWidth(card), h: this.height(card) });
  }

  mid(card: BoardCard, x: number, cy: number): void {
    this.at(card, x, cy - this.height(card) / 2);
  }

  stack(cards: readonly BoardCard[], x: number, top: number, gap: number): void {
    let y = top;
    for (const card of cards) {
      this.at(card, x, y);
      y += this.height(card) + gap;
    }
  }

  centreY(card: BoardCard): number {
    const r = this.rects.get(card.id)!;
    return r.y + r.h / 2;
  }

  bottom(card: BoardCard): number {
    const r = this.rects.get(card.id)!;
    return r.y + r.h;
  }
}

function placeColumns(p: Placement): { boarders: BoardCard[] } {
  const lead = p.takeFirst(isLead);
  if (lead) p.mid(lead, 0, 0);
  p.stack(p.take(doing(undefined)), 0, lead ? p.bottom(lead) + G : 0, G);

  const outs = [p.takeFirst((card) => card.kind === "brief"), p.takeFirst((card) => card.kind === "plan")].filter((card) => card !== undefined);
  p.stack(outs, OUTS_X, -p.stackHeight(outs, OUTS_GAP) / 2, OUTS_GAP);
  const writer = p.takeFirst(doing("script"));
  if (writer) p.mid(writer, WRITER_X, 0);

  const episodes = [...p.take((card) => card.kind === "episode").sort(byEpisode), ...p.take((card) => card.kind === "stack")];
  const epH = p.stackHeight(episodes, G);
  p.stack(episodes, XA, -epH / 2, G);
  const boarders = p.take(doing("storyboard")).sort(byEpisode);
  const dsH = p.stackHeight(boarders, BOARDERS_GAP);
  p.stack(boarders, XB, -dsH / 2, BOARDERS_GAP);

  const band = Math.max(epH, dsH) / 2 + SPLIT;
  const characters = p.take((card) => card.kind === "character" && !isRefined(card));
  const scenes = p.take((card) => card.kind === "scene" && !isRefined(card));
  const chH = p.stackHeight(characters, G);
  const snH = p.stackHeight(scenes, G);
  p.stack(characters, XB, -band - chH, G);
  p.stack(scenes, XB, band, G);
  const characterBots = p.take(doing("character"));
  const characterBotsH = p.stackHeight(characterBots, G);
  const characterCentre = Math.min(-band - chH / 2, -(epH / 2 + G + characterBotsH / 2));
  p.stack(characterBots, XA, characterCentre - characterBotsH / 2, G);
  const sceneBots = p.take(doing("scene"));
  const sceneBotsH = p.stackHeight(sceneBots, G);
  const sceneCentre = Math.max(band + snH / 2, epH / 2 + G + sceneBotsH / 2);
  p.stack(sceneBots, XA, sceneCentre - sceneBotsH / 2, G);
  return { boarders };
}

function placeBlocks(p: Placement, unfolded: readonly number[], boarders: readonly BoardCard[]): Map<number, Rect> {
  const boarderCentre = (episode: number): number => {
    const boarder = boarders.find((card) => card.episode === episode) ?? boarders[0];
    return boarder ? p.centreY(boarder) : 0;
  };
  const blocks = new Map<number, Rect>();
  let previousBottom: number | undefined;
  for (const episode of [...unfolded].sort((a, b) => a - b)) {
    const shots = p.take((card) => card.kind === "shot" && card.episode === episode);
    const refined = p.take((card) => card.kind === "scene" && card.episode === episode && isRefined(card));
    const post = p.takeFirst(doing("post", episode));
    const final = p.takeFirst((card) => card.kind === "final" && card.episode === episode);
    if (!shots.length && !refined.length && !post && !final) continue;
    const results = shots.map((shot) => p.takeFirst((card) => card.kind === "result" && card.shotId === shot.id));

    const rowH = shots.length ? Math.max(...[...shots, ...results].map((card) => (card ? p.height(card) : 0))) + RG : 0;
    const rowsH = shots.length ? rowH * shots.length - RG : 0;
    const filmH = Math.max(post ? p.height(post) : 0, final ? p.height(final) : 0);
    const lowerH = Math.max(rowsH, filmH);

    let centre: number;
    if (previousBottom === undefined) {
      centre = boarderCentre(episode);
      let above = centre - rowsH / 2 - RG;
      for (const scene of refined) {
        p.at(scene, XS, above - p.height(scene));
        above -= p.height(scene) + RG;
      }
      previousBottom = centre + lowerH / 2;
    } else {
      const blockTop = previousBottom + BLOCK_GAP;
      const refinedH = p.stackHeight(refined, RG);
      p.stack(refined, XS, blockTop, RG);
      const rowsTop = refined.length ? blockTop + refinedH + RG : blockTop;
      centre = Math.max(rowsTop + rowsH / 2, blockTop + filmH / 2);
      previousBottom = lowerH ? centre + lowerH / 2 : blockTop + refinedH;
    }

    const top = centre - rowsH / 2;
    shots.forEach((shot, i) => {
      const cy = top + i * rowH + (rowH - RG) / 2;
      p.mid(shot, XS, cy);
      const result = results[i];
      if (result) p.mid(result, XV, cy);
    });
    if (post) p.mid(post, XP, centre);
    if (final) p.mid(final, XF, centre);

    const block = bbox([...refined, ...shots, ...results, post, final].flatMap((card) => (card ? [p.rects.get(card.id)!] : [])));
    if (block) blocks.set(episode, block);
  }
  return blocks;
}

function placeOthers(p: Placement): void {
  const others = p.rest;
  if (!others.length) return;
  const placed = bbox(p.rects.values());
  const top = placed ? placed.y + placed.h + OTHERS_GAP : 0;
  const cellW = Math.max(...others.map(cardWidth)) + RG;
  const cellH = Math.max(...others.map((card) => p.height(card))) + RG;
  others.forEach((card, i) => p.at(card, (i % OTHERS_PER_ROW) * cellW, top + Math.floor(i / OTHERS_PER_ROW) * cellH));
}

export function layoutBoard(board: Board, heightOf: (card: BoardCard) => number): BoardLayout {
  const p = new Placement(board.cards, heightOf);
  const { boarders } = placeColumns(p);
  const blocks = placeBlocks(p, board.unfolded, boarders);
  placeOthers(p);

  const { rects } = p;
  for (const card of board.cards) {
    const r = rects.get(card.id);
    if (card.moved && r) rects.set(card.id, { ...r, x: card.moved.x, y: card.moved.y });
  }

  const stages: Partial<Record<BoardStage, Rect>> = {};
  for (const stage of BOARD_STAGES) {
    const span = bbox(board.cards.flatMap((card) => (card.stage === stage ? [rects.get(card.id)!] : [])));
    if (span) stages[stage] = grow(span, STAGE_PAD);
  }
  const all = bbox(rects.values());
  return { rects, stages, blocks, bounds: all ? grow(all, WORLD_PAD) : { x: 0, y: 0, w: 0, h: 0 } };
}

/** The stage the view's centre is in, as the stage bar marks it; none when zoomed out past 20% or outside them all. */
export function stageAt(stages: Partial<Record<BoardStage, Rect>>, centre: { x: number; y: number }, zoom: number): BoardStage | undefined {
  if (zoom < STAGE_BAR_MIN_ZOOM) return undefined;
  let current: BoardStage | undefined;
  for (const stage of BOARD_STAGES) {
    const r = stages[stage];
    if (r && centre.x >= r.x && centre.x <= r.x + r.w && centre.y >= r.y - STAGE_BAR_SLACK && centre.y <= r.y + r.h + STAGE_BAR_SLACK) current = stage;
  }
  return current;
}
