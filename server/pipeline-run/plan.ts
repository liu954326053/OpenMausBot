import { PIPELINE_STAGES, type PipelineStage } from "../../shared/team-pipeline.ts";
import { botsAt, type CanvasFlow } from "../project-canvas/flow.ts";

/** A stage of a run: the project's bots that have it, in the project's order. */
export interface PlannedStage {
  stage: PipelineStage;
  botIds: string[];
}

/** What a stage waits for: the stages before it that are done, and, for post, the shots' videos. */
export interface StageNeeds {
  stages: PipelineStage[];
  videos: boolean;
}

/** The stages a run of the project goes through: the pipeline's stages that have a bot, in order. */
export function plannedStages(flow: Pick<CanvasFlow, "botIds" | "stages">): PlannedStage[] {
  return PIPELINE_STAGES.flatMap((stage) => {
    const botIds = botsAt(flow, stage);
    return botIds.length ? [{ stage, botIds }] : [];
  });
}

/**
 * Character waits for the script; storyboard for the script and every character; post for every shot's video, or,
 * without a storyboard, for every stage before it. A stage with no bot is passed over.
 */
export function stageNeeds(stage: PipelineStage, staffed: readonly PipelineStage[]): StageNeeds {
  const before = (stages: readonly PipelineStage[]) => stages.filter((one) => staffed.includes(one));
  if (stage === "character") return { stages: before(["script"]), videos: false };
  if (stage === "storyboard") return { stages: before(["script", "character"]), videos: false };
  if (stage === "post") return staffed.includes("storyboard") ? { stages: [], videos: true } : { stages: before(["script", "character"]), videos: false };
  return { stages: [], videos: false };
}
