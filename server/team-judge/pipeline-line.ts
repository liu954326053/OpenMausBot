import { PIPELINE_STAGES, stageLines, type FlowStage } from "../../shared/team-pipeline.ts";

/**
 * A team's pipeline as it reads in one line: after the Chief, the members with a stage of the pipeline, each as many
 * steps along the lines the stages give as the longest way to it, members of one step together; `outside` has the
 * members with no such stage. `members` is the team in the app's order, the Chief included.
 */
export function pipelineOrder(
  chiefId: string,
  members: readonly string[],
  stages: Readonly<Record<string, readonly FlowStage[]>>,
): { order: string[][]; outside: string[] } {
  const inPipeline = (member: string) =>
    Object.hasOwn(stages, member) && stages[member]!.some((stage) => (PIPELINE_STAGES as readonly FlowStage[]).includes(stage));
  const staffed = members.filter((member) => member !== chiefId && inPipeline(member));
  const from = new Map<string, string[]>();
  for (const line of stageLines(chiefId, members, stages)) from.set(line.to, [...(from.get(line.to) ?? []), line.from]);
  const steps = new Map<string, number>([[chiefId, 0]]);
  const walking = new Set<string>();
  // Two members with interleaved stages hand work both ways; a member already on the way is not gone through again.
  const stepOf = (member: string): number => {
    const known = steps.get(member);
    if (known !== undefined) return known;
    walking.add(member);
    const before = (from.get(member) ?? []).filter((other) => !walking.has(other)).map(stepOf);
    walking.delete(member);
    const step = 1 + Math.max(0, ...before);
    steps.set(member, step);
    return step;
  };
  const order: string[][] = [];
  for (const member of staffed) (order[stepOf(member) - 1] ??= []).push(member);
  return { order: order.filter((step) => step?.length), outside: members.filter((member) => member !== chiefId && !inPipeline(member)) };
}
