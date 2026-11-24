import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { ProjectPipeline } from "../project-canvas/flow.ts";

/** Who does what in each project, as its production has it. */
export interface ProductionJobs {
  /** A project's bots that have a job → their jobs, and the lines work passes along between them. */
  pipeline(projectId: string, leadBotId: string): ProjectPipeline;
  /** A project bot's jobs; none for a bot that has none or is in no project. */
  stagesOf(botId: string): readonly FlowStage[];
  /** `production_plan`: a project's lead plans its production. Answers what the lead reads; refuses as a canvas does. */
  plan(projectId: string, botId: string, input: unknown): Promise<string>;
}

let connected: ProductionJobs | null = null;

/** The productions answer from here on. The canvases and the drafts are made before them and ask through this module;
 * until then, and after `null`, nobody has a job. */
export function connectProductionJobs(jobs: ProductionJobs | null): void {
  connected = jobs;
}

export const productionPipeline = (projectId: string, leadBotId: string): ProjectPipeline => connected?.pipeline(projectId, leadBotId) ?? { stages: {}, lines: [] };

export const productionStagesOf = (botId: string): readonly FlowStage[] => connected?.stagesOf(botId) ?? [];

export const planProduction = (projectId: string, botId: string, input: unknown): Promise<string> =>
  connected?.plan(projectId, botId, input) ?? Promise.reject(new Error("the productions are not started yet"));
