/**
 * A team's pipeline says whose work goes to whom. Every member has stages; the lines follow from them: the Chief of
 * Staff leads, and work goes script → character → storyboard → post, each stage to the next one that has a member,
 * with script also going to storyboard when character sits between them. A member with several stages does them in
 * turn; a member with `other` is reached by the Chief only. Only a team with a Chief has a pipeline, and the main
 * bot is in none.
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

export interface TeamPipelineWire {
  /** The department that is the team. */
  section: string;
  chiefId: string;
  /** Every member → its stages in pipeline order: the Chief's is `["lead"]`, a member not judged yet has `["other"]`. */
  stages: Record<string, FlowStage[]>;
  /** The members whose stages are still to be judged. */
  pending: string[];
  /** The members whose lines the person set by hand: judging leaves their stages and lines as they are. */
  manual: string[];
  /** Every line of the pipeline: the ones the stages give, with the person's own added and removed. No loop, and
   * none into the Chief. */
  lines: FlowLineWire[];
}

/** `GET /api/team-pipelines`: the pipeline of every team, General and projects' own departments aside. */
export interface TeamPipelinesWire {
  /**
   * False while the stored pipelines cannot be read. Every team then shows and keeps to the lines its stages give,
   * with every member `other`, and no line can be drawn or removed until the file is restored.
   */
  readable: boolean;
  teams: TeamPipelineWire[];
}

/**
 * `PUT /api/team-pipelines/line`: with `present: true` the work of `from` goes to `to` from now on; with `false` it
 * no longer does. Both become `manual`. Answers the pipelines, or a `serverError.teamFlow.*` refusal.
 */
export interface TeamPipelineLineInput {
  from: string;
  to: string;
  present: boolean;
}

/**
 * `POST /api/team-pipelines/rejudge`: forgets what the person set by hand in the team and has every member judged
 * again. Answers the pipelines as they are meanwhile, and `undo`, which `PUT /api/team-pipelines/restore` takes
 * back whole to put the team's pipeline as it was.
 */
export interface TeamPipelineRejudgeInput {
  section: string;
}

export interface TeamPipelineRejudgeResult {
  pipelines: TeamPipelinesWire;
  undo: TeamPipelineRestoreInput;
}

/** What a team's pipeline held before a rejudge; opaque to the app. */
export interface TeamPipelineRestoreInput {
  section: string;
  state: unknown;
}

/**
 * `GET /api/team-pipelines/projects/:id`: a project's pipeline, never stored. The project's lead leads it. A copy
 * has the stages of its source in the team's pipeline, and the lines follow from the copies' stages as a team's do,
 * so they run between two copies where they run between their sources, and pass over a member the project has no
 * copy of; a line the person drew or took away in the team is drawn or taken away between the copies. Every other
 * bot of the project, and every bot of a project not made from a team, is `other` under the lead.
 */
export interface ProjectPipelineWire {
  projectId: string;
  /** Null while the project has no lead: then it has no pipeline. */
  leadId: string | null;
  stages: Record<string, FlowStage[]>;
  lines: FlowLineWire[];
}

const isPipelineStage = (stage: FlowStage): stage is PipelineStage => (PIPELINE_STAGES as readonly FlowStage[]).includes(stage);

/**
 * The lines the stages alone give. `members` is the team in the app's order, the Chief included; a member absent
 * from `stages` is `other`.
 */
export function stageLines(chiefId: string, members: readonly string[], stages: Readonly<Record<string, readonly FlowStage[]>>): FlowLineWire[] {
  const at = new Map<PipelineStage, string[]>();
  const outside: string[] = [];
  for (const member of members) {
    if (member === chiefId) continue;
    const own = (Object.hasOwn(stages, member) ? stages[member]! : []).filter(isPipelineStage);
    if (own.length === 0) outside.push(member);
    for (const stage of own) at.set(stage, [...(at.get(stage) ?? []), member]);
  }
  const staffed = PIPELINE_STAGES.filter((stage) => at.has(stage));
  const lines: FlowLineWire[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    const key = `${from}\u0000${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    lines.push({ from, to });
  };
  const first = staffed[0];
  if (first) for (const member of at.get(first)!) add(chiefId, member);
  for (let index = 0; index + 1 < staffed.length; index++) {
    for (const from of at.get(staffed[index]!)!) for (const to of at.get(staffed[index + 1]!)!) add(from, to);
  }
  if (at.has("script") && at.has("character") && at.has("storyboard")) {
    for (const from of at.get("script")!) for (const to of at.get("storyboard")!) add(from, to);
  }
  for (const member of outside) add(chiefId, member);
  return lines;
}
