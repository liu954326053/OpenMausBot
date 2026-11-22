import type { PipelineStage } from "./team-pipeline.ts";

/**
 * `waiting`: a stage before it is not done. `working`: its bots have the stage's task. `done`: every bot of it ended
 * the task's turn well. `failed`: a bot's turn for the task failed or was stopped.
 */
export type PipelineStageStatus = "waiting" | "working" | "done" | "failed";

/** `waiting`: the shots are not there yet. `confirm`: they are, and the person has not said to generate. `working`:
 * videos are generating. `done`: every shot has a selected take. `failed`: generating ended with a shot that has
 * none. */
export type PipelineVideosStatus = "waiting" | "confirm" | "working" | "done" | "failed";

/**
 * One run of a project's pipeline, from the lead handing the first stage its task to the JianYing draft. A project
 * has one at a time; a new one starts when the lead hands the first stage a task while the last one has ended, has a
 * failed stage, or waits on the person about the videos.
 */
export interface PipelineRunWire {
  id: string;
  startedAt: number;
  /** Set once post-production is done; by then the draft is written if this computer can write one. */
  endedAt?: number;
  /** Only the stages the project's pipeline has, in order. */
  stages: Array<{ stage: PipelineStage; botIds: string[]; status: PipelineStageStatus }>;
  videos: { status: PipelineVideosStatus; shots: number; ready: number; failed: number };
}

/** `POST /api/team-projects/:id/pipeline/videos`: the person's answer to `videos.status === "confirm"`. `start`
 * generates every shot that has no take; `retry` generates the failed ones again; `skip` goes on to post without
 * the shots that have none. */
export interface PipelineVideosInput {
  action: "start" | "retry" | "skip";
}
