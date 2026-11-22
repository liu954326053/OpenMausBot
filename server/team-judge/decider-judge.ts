// A member's stages, asked of the decision model: one yes/no per stage, so a member can have several. It goes as a
// bot's own question so Cloud's relay takes it as it is; only the members' names, titles, descriptions and souls reach
// the model, cleaned.
import { PIPELINE_STAGES, type FlowStage, type PipelineStage } from "../../shared/team-pipeline.ts";
import type { AppConfig } from "../config.ts";
import { deciderAccount, deciderEnabled, type Decider } from "../decider/index.ts";
import { RELAY_MAX_STATE_BYTES } from "../decider/relay.ts";
import type { DeciderFailure, YesNoQuestion } from "../decider/types.ts";
import { clean } from "../records-block.ts";
import type { JudgeTarget } from "../team-flow/flows.ts";
import { judgedStages, STAGE_WORK } from "./stages.ts";

export const TEAM_JUDGE_DECIDER_TIMEOUT_MS = 8_000;
/** A stage is the member's from this probability up. */
export const TEAM_JUDGE_YES = 0.5;
const MAX_TEAMMATES = 20;
const NAME_MAX = 80;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 1_000;
const SOUL_MAX = 4_000;
/** Room left under the relay's limit for the JSON around the text. */
const STATE_BYTES = RELAY_MAX_STATE_BYTES - 1_000;

/** After one of these the model is not asked about the members left: it would fail them the same way. */
const NOT_ANSWERING: ReadonlySet<DeciderFailure> = new Set<DeciderFailure>([
  "disabled", "no_key", "job_off", "misconfigured", "timeout", "cancelled", "unreachable", "rejected", "rate_limited", "overloaded",
]);

const QUESTIONS = Object.fromEntries(PIPELINE_STAGES.map((stage): [PipelineStage, YesNoQuestion] => [stage, {
  type: "yesno",
  instructions: `Going by the title, description and standing instructions of \`member\`, is this its own work in its team: it ${STAGE_WORK[stage]}? Work it only receives from a teammate, or hands on to one, does not count.`,
}])) as Record<PipelineStage, YesNoQuestion>;

interface MemberState {
  name: string;
  title: string;
  description?: string;
  standing_instructions?: string;
}

export function teamJudgeDeciderReady(cfg: AppConfig): boolean {
  return deciderEnabled(cfg) && Boolean(deciderAccount(cfg, "botDecide"));
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** What the model is asked about one member. The teammates are there to tell a drama team from any other. */
export function teamJudgeRequest(target: JudgeTarget, memberId: string) {
  const subject = target.members.find((member) => member.id === memberId)!;
  const description = clean(subject.description, DESCRIPTION_MAX);
  const member: MemberState = { name: clean(subject.name, NAME_MAX), title: clean(subject.title, TITLE_MAX), ...(description ? { description } : {}) };
  let teammates = target.members.filter((other) => other.id !== memberId).slice(0, MAX_TEAMMATES)
    .map((other) => ({ name: clean(other.name, NAME_MAX), title: clean(other.title, TITLE_MAX) }));
  while (teammates.length && bytes({ member, teammates }) > STATE_BYTES / 2) teammates = teammates.slice(0, Math.floor(teammates.length / 2));
  let soul = clean(subject.soul, SOUL_MAX);
  const state = () => ({ member: { ...member, ...(soul ? { standing_instructions: soul } : {}) }, teammates });
  while (soul && bytes(state()) > STATE_BYTES) soul = clean(soul, Math.floor(Array.from(soul).length * 0.8));
  return { state: state(), questions: QUESTIONS };
}

/** Every member of `pending` → its stages; `["other"]` for one the model failed on or gave no stage. Never throws. */
export async function judgeWithDecider(
  decider: Pick<Decider, "ask">,
  target: JudgeTarget,
  pending: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<Record<string, FlowStage[]>> {
  const stages: Record<string, FlowStage[]> = {};
  let answering = true;
  for (const memberId of pending) {
    stages[memberId] = ["other"];
    if (!answering || options.signal?.aborted) continue;
    try {
      const { state, questions } = teamJudgeRequest(target, memberId);
      const result = await decider.ask("botDecide", state, questions, { timeoutMs: TEAM_JUDGE_DECIDER_TIMEOUT_MS, signal: options.signal });
      if (!result.ok) {
        answering = !NOT_ANSWERING.has(result.reason);
        continue;
      }
      stages[memberId] = judgedStages(PIPELINE_STAGES.filter((stage) => result.answers[stage]?.p >= TEAM_JUDGE_YES));
    } catch {
      answering = false;
    }
  }
  return stages;
}
