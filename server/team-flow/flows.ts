import type { FlowStage, ProjectPipelineWire } from "../../shared/team-pipeline.ts";

/** Where a bot stands in its flow: its superior (null for the root), its direct subordinates in the app's order, and every
 * bot of the flow, the root included. */
export interface FlowLine {
  superior: string | null;
  subordinates: string[];
  team: string[];
}

/** Where a bot stands in its pipeline: its stages, the bots whose work comes to it, the bots its work goes to, and
 * every bot of the pipeline, the lead included. The lead has no upstream. */
export interface PipelinePlace {
  stages: FlowStage[];
  upstream: string[];
  downstream: string[];
  team: string[];
}

/** A team with members whose stages are still to be judged, and what a judge may read of each member. */
export interface JudgeTarget {
  section: string;
  chiefId: string;
  members: Array<{ id: string; name: string; title: string; description: string; soul: string }>;
  /** The members to judge; the others are there for context. */
  pending: string[];
}

/** What the running server's flows answer; see `TeamFlows`. */
export interface InstalledFlows {
  parents(section: string): Record<string, string>;
  projectParents(projectId: string): Record<string, string>;
  lineOf(botId: string): FlowLine | null;
  projectPipeline?(projectId: string): ProjectPipelineWire;
  placeOf?(botId: string): PipelinePlace | null;
  judgeTargets?(): JudgeTarget[];
  setJudged?(section: string, stages: Readonly<Record<string, readonly FlowStage[]>>): void;
}

const NONE: InstalledFlows = { parents: () => ({}), projectParents: () => ({}), lineOf: () => null };
let installed = NONE;
const listeners = new Set<() => void>();

/** Until this is called no bot is in a flow, so every bot reaches the others as it would without one. */
export function installTeamFlows(flows: InstalledFlows): void {
  installed = flows;
}

/** `listener` runs after a flow may have changed: a line drawn or taken away, `team-flows.json` read again, or a member,
 * a Chief or a project's copy changed. Returns the unsubscribe. */
export function onTeamFlowsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function teamFlowsChanged(): void {
  for (const listener of listeners) listener();
}

/** Every member of the department's team but its Chief → its superior; a project's department answers its project's flow. */
export function parents(section: string): Record<string, string> {
  return installed.parents(section);
}

/** Every bot of the project but its lead → its superior, mapped from its team's flow through each copy's source. */
export function projectParents(projectId: string): Record<string, string> {
  return installed.projectParents(projectId);
}

/** Null for a bot in no flow: the main bot, an archived bot, a bot in General or in a department without a Chief. */
export function flowLineOf(botId: string): FlowLine | null {
  return installed.lineOf(botId);
}

/** A project's pipeline: its bots' stages and the lines between them. Until the running flows answer it themselves,
 * every bot but the lead is `other` and the lines are the old flow's, superior to subordinate. */
export function projectPipeline(projectId: string, leadId: string | null): ProjectPipelineWire {
  if (installed.projectPipeline) return installed.projectPipeline(projectId);
  const parents = installed.projectParents(projectId);
  const stages: Record<string, FlowStage[]> = Object.fromEntries(Object.keys(parents).map((botId) => [botId, ["other"]]));
  if (leadId) stages[leadId] = ["lead"];
  return { projectId, leadId, stages, lines: Object.entries(parents).map(([to, from]) => ({ from, to })) };
}

/** Null for a bot in no pipeline: the main bot, an archived bot, a bot in General or in a department without a Chief. */
export function pipelinePlaceOf(botId: string): PipelinePlace | null {
  if (installed.placeOf) return installed.placeOf(botId);
  const line = installed.lineOf(botId);
  if (!line) return null;
  return { stages: line.superior ? ["other"] : ["lead"], upstream: line.superior ? [line.superior] : [], downstream: line.subordinates, team: line.team };
}

/** The teams with members waiting for a judge. */
export function judgeTargets(): JudgeTarget[] {
  return installed.judgeTargets?.() ?? [];
}

/** Records the stages a judge gave members of the team. A member the person set by hand, or one that left, is left
 * as it is. Tells `onTeamFlowsChange` listeners when anything changed. */
export function setJudgedStages(section: string, stages: Readonly<Record<string, readonly FlowStage[]>>): void {
  installed.setJudged?.(section, stages);
}
