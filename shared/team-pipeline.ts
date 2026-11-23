/**
 * A stage of a project's drama: the project's lead has `lead`, a bot with a job of the production has that job's
 * stage, and every other bot of the project has `other`, reached from the lead.
 */
export type FlowStage = "lead" | "script" | "character" | "scene" | "storyboard" | "post" | "other";

/** The stages work passes through, in order. `lead` comes before them and `other` stands outside. */
export const PIPELINE_STAGES = ["script", "character", "storyboard", "post"] as const satisfies readonly FlowStage[];

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The work of `from` goes to `to`. */
export interface FlowLineWire {
  from: string;
  to: string;
}

/**
 * A project's pipeline, never stored: the stages of each bot of the project as its production has them, and the
 * lines work passes along between them. The project's lead leads it.
 */
export interface ProjectPipelineWire {
  projectId: string;
  /** Null while the project has no lead: then it has no pipeline. */
  leadId: string | null;
  stages: Record<string, FlowStage[]>;
  lines: FlowLineWire[];
}
