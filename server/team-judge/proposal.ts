// The stages a team setup plan gives its bots: what the plan may say, the pipeline its confirmation card shows, and
// recording them with the flows once the plan is applied, so that team needs no judging.
import { z } from "zod";

import type { TeamSetupOperation, TeamSetupRequest, TeamSetupResult, TeamSetupStage } from "../../shared/team-setup.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import { intlLocale } from "../language.ts";
import { serverLine } from "../server-lines.ts";
import { sectionKey, type BotRecord } from "../store.ts";
import { pipelinePlaceOf, setJudgedStages } from "../team-flow/flows.ts";
import { pipelineOrder } from "./pipeline-line.ts";
import { judgedStages } from "./stages.ts";

/** The stages a plan may give a bot, as `propose_team_setup` offers them. */
export const PLAN_STAGES = ["script", "character", "storyboard", "post", "other"] as const satisfies readonly TeamSetupStage[];

/** `fields.stages` of a plan's operation. `lead` is taken and dropped: a model may give it to the Chief. */
export const planStagesSchema = z.array(z.enum(["lead", ...PLAN_STAGES], { error: `stages takes ${PLAN_STAGES.join(", ")}` })).max(8).optional();

/** The stages an operation carries: the pipeline's in its order, or `other`; none for the team's Chief, which leads, and
 * none when the plan names none, which leaves the bot to be judged. */
export function plannedStages(given: readonly string[] | undefined, chief: boolean): TeamSetupStage[] | undefined {
  const named = given?.filter((stage) => stage !== "lead") ?? [];
  return chief || !named.length ? undefined : (judgedStages(named) as TeamSetupStage[]);
}

export type PlanBot = Pick<BotRecord, "id" | "name" | "section" | "chiefOfStaff" | "hidden" | "defaultBot" | "teamProject">;

interface PlannedTeam {
  chiefId: string;
  members: string[];
  names: Map<string, string>;
  stages: Record<string, readonly FlowStage[]>;
  /** The members the plan itself keeps outside the pipeline. */
  outside: Set<string>;
}

/** The team in `section` as the plan leaves it; null when it has no Chief or is a project's own. */
function plannedTeam(section: string, operations: readonly TeamSetupOperation[], bots: readonly PlanBot[]): PlannedTeam | null {
  const planned = new Map(operations.map((operation) => [operation.botId, operation]));
  const team: PlannedTeam = { chiefId: "", members: [], names: new Map(), stages: {}, outside: new Set() };
  const join = (id: string, name: string, chief: boolean, stages: readonly FlowStage[] | undefined) => {
    team.members.push(id);
    team.names.set(id, name);
    if (chief && !team.chiefId) team.chiefId = id;
    if (stages) team.stages[id] = stages;
    if (planned.get(id)?.stages?.includes("other")) team.outside.add(id);
  };
  for (const bot of bots) {
    const operation = planned.get(bot.id);
    if (bot.hidden || bot.defaultBot || sectionKey(operation?.fields.section ?? bot.section) !== section) continue;
    if (bot.teamProject) return null;
    join(bot.id, operation?.fields.name ?? bot.name, operation?.fields.chiefOfStaff ?? Boolean(bot.chiefOfStaff), operation?.stages ?? pipelinePlaceOf(bot.id)?.stages);
  }
  for (const operation of operations) {
    if (operation.action !== "create" || sectionKey(operation.fields.section) !== section) continue;
    join(operation.botId, operation.fields.name ?? "", operation.fields.chiefOfStaff === true, operation.stages);
  }
  return team.chiefId ? team : null;
}

/** For each team the plan gives stages: its pipeline as one line of names, and the members the plan keeps outside it. */
export function pipelineCardLines(request: Pick<TeamSetupRequest, "operations">, bots: readonly PlanBot[], language: string | undefined): string[] {
  const names = new Intl.ListFormat(intlLocale(language), { type: "conjunction" });
  const sections = new Set(request.operations.filter((operation) => operation.stages).map((operation) => sectionKey(operation.fields.section)));
  const lines: string[] = [];
  for (const section of sections) {
    const team = section ? plannedTeam(section, request.operations, bots) : null;
    if (!team) continue;
    const { order, outside } = pipelineOrder(team.chiefId, team.members, team.stages);
    if (!order.length) continue;
    const nameOf = (id: string) => team.names.get(id)!;
    const lead = nameOf(team.chiefId);
    lines.push(serverLine(language, "server.teamJudge.card.pipeline", { team: section, line: [lead, ...order.map((step) => names.format(step.map(nameOf)))].join(" → ") }));
    const apart = outside.filter((id) => team.outside.has(id));
    if (apart.length) lines.push(serverLine(language, "server.teamJudge.card.outside", { lead, names: names.format(apart.map(nameOf)) }));
  }
  return lines;
}

/** Records the stages of the bots an applied plan made or changed with their teams. Never throws: the bots exist
 * either way, and one whose stages were not taken is judged like any other. */
export function recordPlannedStages(request: Pick<TeamSetupRequest, "operations">, result: TeamSetupResult): void {
  if (result.state !== "applied") return;
  const applied = new Set(result.bots.filter((bot) => bot.action !== "deleted").map((bot) => bot.id));
  const teams = new Map<string, Record<string, FlowStage[]>>();
  for (const operation of request.operations) {
    const section = sectionKey(operation.fields.section);
    if (!operation.stages?.length || !section || !applied.has(operation.botId)) continue;
    const stages = teams.get(section) ?? {};
    stages[operation.botId] = [...operation.stages];
    teams.set(section, stages);
  }
  for (const [section, stages] of teams) {
    try {
      setJudgedStages(section, stages);
    } catch (error) {
      console.warn(`[team-judge] the stages a team setup gave "${section}" could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
