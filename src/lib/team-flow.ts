import type { TeamFlowWire } from "../../shared/team-flow";
import { CARD_HEIGHT, CARD_WIDTH, GAP, HEADER_HEIGHT, TEAM_PADDING, type Point } from "./team-canvas";

export const FLOW_COLUMN_GAP = 56;
/** Where a line turns towards its subordinate, past the dot on its superior's card. */
const LINE_TURN = 16;

export interface FlowCard { botId: string; x: number; y: number }
export interface FlowLink { botId: string; superiorId: string; points: Point[] }
export interface FlowLayout { width: number; height: number; cards: FlowCard[]; links: FlowLink[] }

function superiors(ids: readonly string[], flow: TeamFlowWire): Map<string, string> {
  const drawn = new Set(ids);
  const named = (id: string) => {
    const superior = Object.hasOwn(flow.parents, id) ? flow.parents[id] : undefined;
    return superior && superior !== id && drawn.has(superior) ? superior : flow.chiefId;
  };
  const reachesChief = (id: string) => {
    const seen = new Set<string>();
    for (let at = id; at !== flow.chiefId; at = named(at)) {
      if (seen.has(at)) return false;
      seen.add(at);
    }
    return true;
  };
  return new Map(ids.filter((id) => id !== flow.chiefId).map((id) => [id, reachesChief(id) ? named(id) : flow.chiefId]));
}

export function flowLayout(ordered: readonly { id: string }[], flow: TeamFlowWire): FlowLayout | null {
  const ids = ordered.map((bot) => bot.id);
  if (!ids.includes(flow.chiefId)) return null;
  const above = superiors(ids, flow);
  const below = new Map<string, string[]>();
  for (const id of ids) {
    const superior = above.get(id);
    if (superior) below.set(superior, [...(below.get(superior) ?? []), id]);
  }
  const cards: FlowCard[] = [];
  let rows = 0, depthMax = 0;
  const place = (id: string, depth: number): number => {
    const under = (below.get(id) ?? []).map((child) => place(child, depth + 1));
    const row = under.length ? (under[0] + under.at(-1)!) / 2 : rows++;
    depthMax = Math.max(depthMax, depth);
    cards.push({ botId: id, x: TEAM_PADDING + depth * (CARD_WIDTH + FLOW_COLUMN_GAP), y: HEADER_HEIGHT + row * (CARD_HEIGHT + GAP) });
    return row;
  };
  place(flow.chiefId, 0);
  const at = new Map(cards.map((card) => [card.botId, card]));
  const links = [...above].map(([botId, superiorId]) => {
    const from = at.get(superiorId)!, to = at.get(botId)!;
    const start = { x: from.x + CARD_WIDTH, y: from.y + CARD_HEIGHT / 2 }, end = { x: to.x, y: to.y + CARD_HEIGHT / 2 };
    const turn = start.x + LINE_TURN;
    return { botId, superiorId, points: [start, { x: turn, y: start.y }, { x: turn, y: end.y }, end] };
  });
  return {
    width: TEAM_PADDING * 2 + (depthMax + 1) * CARD_WIDTH + depthMax * FLOW_COLUMN_GAP,
    height: HEADER_HEIGHT + TEAM_PADDING + Math.max(1, rows) * (CARD_HEIGHT + GAP) - GAP,
    cards,
    links,
  };
}

/** A line from the Chief is where every member starts, so it cannot be taken away. */
export function removableLines(layout: FlowLayout, chiefId: string): FlowLink[] {
  return layout.links.filter((link) => link.superiorId !== chiefId);
}

/** The part of a line that is its own: the stretch into its subordinate, which no sibling's line shares. */
export const ownStretch = (link: FlowLink): Point[] => link.points.slice(-2);

/** Changes when a team gains or loses a member or a Chief, so the flows are read again. */
export function flowShape(sections: ReadonlyArray<{ key: string; chiefs: ReadonlyArray<{ id: string }>; members: ReadonlyArray<{ id: string }> }>): string {
  return JSON.stringify(sections.map((section) => [section.key, section.chiefs.map((bot) => bot.id), section.members.map((bot) => bot.id)]));
}
