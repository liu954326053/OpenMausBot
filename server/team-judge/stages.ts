import { PIPELINE_STAGES, type FlowStage, type PipelineStage } from "../../shared/team-pipeline.ts";

/** What the member of each stage does, as a model is told it. */
export const STAGE_WORK: Record<PipelineStage, string> = {
  script: "writes the script of the drama: the story, the plot and the dialogue",
  character: "designs the characters: who they are, how they look, and their reference art",
  storyboard: "turns the script into a storyboard: the shots, each with what it shows",
  post: "does post-production: editing the shots' videos into the finished film",
};

/** The pipeline stages `given` names, once each and in pipeline order; `["other"]` when it names none. */
export function judgedStages(given: unknown): FlowStage[] {
  const named = new Set(Array.isArray(given) ? given : []);
  const stages = PIPELINE_STAGES.filter((stage) => named.has(stage));
  return stages.length ? stages : ["other"];
}
