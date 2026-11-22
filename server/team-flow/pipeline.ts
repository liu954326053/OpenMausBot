import { PIPELINE_STAGES, stageLines, type FlowLineWire, type FlowStage } from "../../shared/team-pipeline.ts";
import type { StoredPipeline } from "./file.ts";
import type { PipelinePlace } from "./flows.ts";

export type Stages = Readonly<Record<string, readonly FlowStage[]>>;

export type LineProblem = "self" | "chief" | "loop";

/** The stages a member that is not the Chief is recorded with: the pipeline's, once each and in its order, or `other`. */
export function memberStages(given: readonly unknown[]): FlowStage[] {
  const own = PIPELINE_STAGES.filter((stage) => given.includes(stage));
  return own.length ? own : ["other"];
}

export const lineKey = ({ from, to }: FlowLineWire): string => `${from}\u0000${to}`;

/** Whether work leaving `from` comes to `to` along `lines`. */
function reaches(lines: readonly FlowLineWire[], from: string, to: string): boolean {
  const passed = new Set<string>();
  const ahead = [from];
  for (let at = ahead.pop(); at !== undefined; at = ahead.pop()) {
    if (at === to) return true;
    if (passed.has(at)) continue;
    passed.add(at);
    for (const line of lines) if (line.from === at) ahead.push(line.to);
  }
  return false;
}

export interface PipelineInput {
  chiefId: string;
  /** The team in the app's order, the Chief included. */
  members: readonly string[];
  /** A member absent here is `other`. */
  stages: Stages;
  /** The lines the person drew, in the order drawn, and the ones the person took away. */
  added: readonly FlowLineWire[];
  removed: readonly FlowLineWire[];
}

/**
 * Every line of the pipeline: the ones the stages give, less the ones taken away by hand, then the ones drawn by hand.
 * Both ends are members, none goes into the Chief and none closes a loop: a line drawn by hand stays, and a stage's
 * line that would close a loop with the lines before it is left out.
 */
export function pipelineLines({ chiefId, members, stages, added, removed }: PipelineInput): FlowLineWire[] {
  const inTeam = new Set(members);
  const takenAway = new Set(removed.map(lineKey));
  const drawn: FlowLineWire[] = [];
  const seen = new Set<string>();
  const draw = (line: FlowLineWire): boolean => {
    if (!inTeam.has(line.from) || !inTeam.has(line.to) || line.from === line.to || line.to === chiefId) return false;
    if (seen.has(lineKey(line)) || reaches(drawn, line.to, line.from)) return false;
    seen.add(lineKey(line));
    drawn.push({ from: line.from, to: line.to });
    return true;
  };
  const byHand = added.filter(draw);
  const byStage = stageLines(chiefId, members, stages).filter((line) => seen.has(lineKey(line)) || (!takenAway.has(lineKey(line)) && draw(line)));
  const staged = new Set(byStage.map(lineKey));
  return [...byStage, ...byHand.filter((line) => !staged.has(lineKey(line))).map(({ from, to }) => ({ from, to }))];
}

/** Why no line can go from `from` to `to`, both members of the pipeline `lines` describes. */
export function lineProblem(lines: readonly FlowLineWire[], chiefId: string, from: string, to: string): LineProblem | null {
  if (from === to) return "self";
  if (to === chiefId) return "chief";
  return reaches(lines, to, from) ? "loop" : null;
}

export interface Pipeline {
  leadId: string;
  /** Every bot of the pipeline in the app's order, the lead included. */
  members: readonly string[];
  /** Every member → its stages; the lead's is `["lead"]`. */
  stages: Readonly<Record<string, FlowStage[]>>;
  lines: readonly FlowLineWire[];
}

export function placeIn({ leadId, members, stages, lines }: Pipeline, botId: string): PipelinePlace | null {
  if (!members.includes(botId)) return null;
  return {
    stages: [...(stages[botId] ?? ["other"])],
    upstream: lines.filter((line) => line.to === botId).map((line) => line.from),
    downstream: lines.filter((line) => line.from === botId).map((line) => line.to),
    team: [leadId, ...members.filter((member) => member !== leadId)],
  };
}

/** The pipeline read as a tree: every member but the Chief → its first upstream, or the Chief when no line reaches it. */
export function parentsOf(members: readonly string[], chiefId: string, lines: readonly FlowLineWire[]): Record<string, string> {
  const parents: Record<string, string> = {};
  for (const member of members) {
    if (member !== chiefId) parents[member] = lines.find((line) => line.to === member)?.from ?? chiefId;
  }
  return parents;
}

export interface ProjectPipelineInput {
  leadId: string;
  /** The project's bots in the app's order, the lead included, each with the team member it is a copy of while it follows one. */
  bots: ReadonlyArray<{ id: string; source?: string }>;
  /** The pipeline of the team the project was made from; null when it has none. */
  team: { chiefId: string; stages: Stages; added: readonly FlowLineWire[]; removed: readonly FlowLineWire[] } | null;
}

/**
 * A project's pipeline, from its team's. The lead leads, in the Chief's place. A copy has its source's stages, and the
 * lines follow from the copies' stages as a team's do, so a member the project has no copy of is passed over; a line
 * the person drew or took away between two members is drawn or taken away between their copies. Every other bot is
 * `other`.
 */
export function projectPipelineOf({ leadId, bots, team }: ProjectPipelineInput): { stages: Record<string, FlowStage[]>; lines: FlowLineWire[] } {
  const copies = new Map<string, string[]>();
  const follows = (source: string, botId: string) => copies.set(source, [...(copies.get(source) ?? []), botId]);
  const stages: Record<string, FlowStage[]> = {};
  if (team) follows(team.chiefId, leadId);
  for (const bot of bots) {
    const source = team && bot.source !== team.chiefId ? bot.source : undefined;
    if (source !== undefined) follows(source, bot.id);
    stages[bot.id] = bot.id === leadId ? ["lead"]
      : source !== undefined && Object.hasOwn(team!.stages, source) ? memberStages(team!.stages[source]!) : ["other"];
  }
  const between = (lines: readonly FlowLineWire[]) =>
    lines.flatMap((line) => (copies.get(line.from) ?? []).flatMap((from) => (copies.get(line.to) ?? []).map((to) => ({ from, to }))));
  const lines = pipelineLines({
    chiefId: leadId, members: bots.map((bot) => bot.id), stages,
    added: team ? between(team.added) : [], removed: team ? between(team.removed) : [],
  });
  return { stages, lines };
}

/** What of `stored` today's team still holds: a member that left takes its stages and the lines at it with it, the
 * Chief has no stages of its own and no line into it, and a line is kept once. */
export function heldBy(members: readonly string[], chiefId: string, stored: StoredPipeline): StoredPipeline {
  const inTeam = new Set(members);
  const member = (botId: string) => botId !== chiefId && inTeam.has(botId);
  const stages = Object.fromEntries(Object.entries(stored.stages).filter(([botId]) => member(botId)).map(([botId, given]) => [botId, memberStages(given)]));
  const once = (lines: readonly FlowLineWire[]) => {
    const seen = new Set<string>();
    return lines.filter((line) => {
      if (!inTeam.has(line.from) || !member(line.to) || line.from === line.to || seen.has(lineKey(line))) return false;
      seen.add(lineKey(line));
      return true;
    });
  };
  return {
    stages,
    judged: Object.fromEntries(Object.entries(stored.judged).filter(([botId]) => Object.hasOwn(stages, botId))),
    manual: [...new Set(stored.manual)].filter(member),
    added: once(stored.added),
    removed: once(stored.removed),
  };
}

export const nothingStored = (stored: StoredPipeline): boolean =>
  !Object.keys(stored.stages).length && !stored.manual.length && !stored.added.length && !stored.removed.length;
