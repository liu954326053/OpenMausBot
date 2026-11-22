import { PIPELINE_STAGES, type FlowStage, type PipelineStage, type TeamPipelineWire } from "../../shared/team-pipeline";
import { CARD_HEIGHT, CARD_WIDTH, GAP, HEADER_HEIGHT, TEAM_PADDING, type Point } from "./team-canvas";

export const PIPELINE_COLUMN_GAP = 56;
/** How far the `other` members stand in from the lead they hang under. */
export const OTHER_INDENT = 28;
/** How far a line swings out of a card's side before it turns back past that card. */
const TURN = 24;
const CORNER = 8;

export type PipelineColumn = "lead" | PipelineStage | "other";
export interface PipelineCard { botId: string; x: number; y: number; column: PipelineColumn }
export interface PipelineLine {
  from: string;
  to: string;
  start: Point;
  end: Point;
  path: string;
  /** The part of the line that is its own to press, where it shares its way with another. */
  hit: string;
  /** Where the line's own control stands. */
  mid: Point;
}
export interface PipelineLayout { width: number; height: number; cards: PipelineCard[]; lines: PipelineLine[] }

type Placed = PipelineCard & { stand: number; row: number };

const rowTop = (row: number) => HEADER_HEIGHT + row * (CARD_HEIGHT + GAP);
const middle = (card: Placed) => card.y + CARD_HEIGHT / 2;
/** The clear space above `row`, between it and the row before. */
const spaceAbove = (row: number) => rowTop(row) - GAP / 2;

/** The stages a card shows: the lead's own, a member's in pipeline order, and nothing for `other`. */
export function cardStages(pipeline: TeamPipelineWire, botId: string): FlowStage[] {
  if (botId === pipeline.chiefId) return ["lead"];
  const own = Object.hasOwn(pipeline.stages, botId) ? pipeline.stages[botId] : [];
  return PIPELINE_STAGES.filter((stage) => own.includes(stage));
}

const swing = (from: Point, to: Point) => {
  const turn = (from.x + to.x) / 2;
  return `C ${turn} ${from.y} ${turn} ${to.y} ${to.x} ${to.y}`;
};
/** Out of a card's side and back past it: `side` is 1 from a right edge, -1 into a left edge. */
const hook = (at: Point, y: number, side: 1 | -1) => `C ${at.x + side * TURN} ${at.y} ${at.x + side * TURN} ${y} ${at.x} ${y}`;

function route(from: Placed, to: Placed, columnLeft: (stand: number) => number): Pick<PipelineLine, "start" | "end" | "path" | "hit" | "mid"> {
  const end = { x: to.x, y: middle(to) };
  if (from.column === "lead" && to.column === "other") {
    const trunk = from.x + OTHER_INDENT / 2;
    const start = { x: trunk, y: from.y + CARD_HEIGHT };
    return {
      start, end, mid: { x: trunk, y: end.y },
      path: `M ${trunk} ${start.y} L ${trunk} ${end.y - CORNER} Q ${trunk} ${end.y} ${trunk + CORNER} ${end.y} L ${end.x} ${end.y}`,
      hit: `M ${trunk} ${to.row === 1 ? start.y : end.y - CARD_HEIGHT - GAP} L ${trunk} ${end.y} L ${end.x} ${end.y}`,
    };
  }
  const start = { x: from.x + CARD_WIDTH, y: middle(from) };
  if (to.stand === from.stand + 1) {
    const path = `M ${start.x} ${start.y} ${swing(start, end)}`;
    return { start, end, path, hit: path, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  }
  const y = spaceAbove(to.row <= from.row ? to.row + 1 : to.row);
  if (to.stand > from.stand) {
    const enter = { x: columnLeft(from.stand + 1), y }, leave = { x: end.x - PIPELINE_COLUMN_GAP, y };
    const path = `M ${start.x} ${start.y} ${swing(start, enter)} L ${leave.x} ${y} ${swing(leave, end)}`;
    return { start, end, path, hit: path, mid: { x: (enter.x + leave.x) / 2, y } };
  }
  const path = `M ${start.x} ${start.y} ${hook(start, y, 1)} L ${end.x} ${y} ${hook({ x: end.x, y }, end.y, -1)}`;
  return { start, end, path, hit: path, mid: { x: (start.x + end.x) / 2, y } };
}

/** `ordered` is the team in the order the person keeps its cards, the lead included. */
export function pipelineLayout(ordered: readonly { id: string }[], pipeline: TeamPipelineWire): PipelineLayout | null {
  const ids = ordered.map((bot) => bot.id);
  if (!ids.includes(pipeline.chiefId)) return null;
  const members = ids.filter((id) => id !== pipeline.chiefId);
  const columnOf = (id: string): PipelineColumn => cardStages(pipeline, id)[0] as PipelineStage | undefined ?? "other";
  const others = members.filter((id) => columnOf(id) === "other");
  const staffed = PIPELINE_STAGES.filter((stage) => members.some((id) => columnOf(id) === stage));
  const indent = others.length ? OTHER_INDENT : 0;
  const columnLeft = (stand: number) => TEAM_PADDING + (stand === 0 ? 0 : indent + stand * (CARD_WIDTH + PIPELINE_COLUMN_GAP));
  const placed: Placed[] = [
    { botId: pipeline.chiefId, column: "lead", stand: 0, row: 0, x: columnLeft(0), y: rowTop(0) },
    ...others.map((botId, index): Placed => ({ botId, column: "other", stand: 0, row: index + 1, x: columnLeft(0) + indent, y: rowTop(index + 1) })),
    ...staffed.flatMap((stage, index) => members.filter((id) => columnOf(id) === stage)
      .map((botId, row): Placed => ({ botId, column: stage, stand: index + 1, row, x: columnLeft(index + 1), y: rowTop(row) }))),
  ];
  const at = new Map(placed.map((card) => [card.botId, card]));
  const lines = pipeline.lines.flatMap(({ from, to }) => {
    const sender = at.get(from), receiver = at.get(to);
    return sender && receiver && sender !== receiver ? [{ from, to, ...route(sender, receiver, columnLeft) }] : [];
  });
  const rows = Math.max(...placed.map((card) => card.row)) + 1;
  return {
    width: TEAM_PADDING * 2 + indent + (staffed.length + 1) * CARD_WIDTH + staffed.length * PIPELINE_COLUMN_GAP,
    height: HEADER_HEIGHT + TEAM_PADDING + rows * (CARD_HEIGHT + GAP) - GAP,
    cards: placed.map(({ botId, x, y, column }) => ({ botId, x, y, column })),
    lines,
  };
}

/** The cards that share a column with `botId`, itself included, from the top. */
export function columnMates(layout: PipelineLayout, botId: string): string[] {
  const own = layout.cards.find((card) => card.botId === botId);
  return own ? layout.cards.filter((card) => card.column === own.column).sort((a, b) => a.y - b.y).map((card) => card.botId) : [];
}

/**
 * Where `botId` goes among the rest of `lane`, the team's cards in the person's order, so that it stands at `index`
 * among `mates`, the other cards of its column, and no other card changes its order.
 */
export function laneIndexAmong(lane: readonly string[], mates: readonly string[], botId: string, index: number): number {
  const rest = lane.filter((id) => id !== botId);
  if (!mates.length) return Math.max(0, lane.indexOf(botId));
  const place = Math.max(0, Math.min(mates.length, index));
  return place < mates.length ? rest.indexOf(mates[place]!) : rest.indexOf(mates.at(-1)!) + 1;
}

/** Changes when a team gains or loses a member or a lead, so the pipelines are read again. */
export function pipelineShape(sections: ReadonlyArray<{ key: string; chiefs: ReadonlyArray<{ id: string }>; members: ReadonlyArray<{ id: string }> }>): string {
  return JSON.stringify(sections.map((section) => [section.key, section.chiefs.map((bot) => bot.id), section.members.map((bot) => bot.id)]));
}
