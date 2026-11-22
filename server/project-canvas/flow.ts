import type { FlowLineWire, FlowStage, ProjectPipelineWire } from "../../shared/team-pipeline.ts";

/** A project's bots as its pipeline has them. */
export interface CanvasFlow {
  /** In the order the project lists them. */
  botIds: readonly string[];
  leadBotId: string;
  /** Every bot of the project → its stages, in pipeline order. */
  stages: Record<string, FlowStage[]>;
  /** The pipeline's lines whose two ends are bots of the project. */
  lines: FlowLineWire[];
}

export type ProjectPipeline = Pick<ProjectPipelineWire, "stages" | "lines">;

/** The pipeline as the canvas draws it: the lead leads whatever the pipeline says, and a bot the pipeline does not
 * know is `other`, reached from the lead. */
export function canvasFlow(project: { botIds: readonly string[]; leadBotId: string }, pipeline: ProjectPipeline): CanvasFlow {
  const members = new Set(project.botIds);
  const led = members.has(project.leadBotId);
  const stages: Record<string, FlowStage[]> = {};
  const unknown: string[] = [];
  for (const botId of project.botIds) {
    const own = botId === project.leadBotId ? [] : (Object.hasOwn(pipeline.stages, botId) ? pipeline.stages[botId]! : []).filter((stage) => stage !== "lead");
    if (botId !== project.leadBotId && !own.length) unknown.push(botId);
    stages[botId] = botId === project.leadBotId ? ["lead"] : own.length ? [...own] : ["other"];
  }
  const lines: FlowLineWire[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    const key = `${from}\u0000${to}`;
    if (from === to || to === project.leadBotId || !members.has(from) || !members.has(to) || seen.has(key)) return;
    seen.add(key);
    lines.push({ from, to });
  };
  for (const line of pipeline.lines) add(line.from, line.to);
  if (led) for (const botId of unknown) add(project.leadBotId, botId);
  return { botIds: project.botIds, leadBotId: project.leadBotId, stages, lines };
}

/** The bots that have `stage`, in the project's order. */
export function botsAt(flow: Pick<CanvasFlow, "botIds" | "stages">, stage: FlowStage): string[] {
  return flow.botIds.filter((botId) => flow.stages[botId]?.includes(stage));
}
