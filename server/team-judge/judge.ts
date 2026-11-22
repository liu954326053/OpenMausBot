import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { Decider } from "../decider/index.ts";
import type { JudgeTarget } from "../team-flow/flows.ts";
import { judgeWithDecider } from "./decider-judge.ts";
import { keywordStages } from "./keywords.ts";
import { judgeWithModel, type JudgeModel } from "./model-judge.ts";

export type JudgeWay = "decider" | "model" | "keywords";

/** The models a judgement may use, looked up afresh for each one. */
export interface TeamJudgeWays {
  /** Null while no decision model is set up and switched on. */
  decider(): Pick<Decider, "ask"> | null;
  /** Null while the main bot has no one-off text call. */
  mainBot(): JudgeModel | null;
}

export interface TeamJudgement {
  way: JudgeWay;
  stages: Record<string, FlowStage[]>;
  /** Members the way chosen had no answer for: asked about again the next time their team is judged. */
  unanswered: string[];
}

export type TeamJudge = (target: JudgeTarget, options?: { signal?: AbortSignal }) => Promise<TeamJudgement>;

/** The members of the team that wait for a judge: never its Chief. */
export function judgeable(target: JudgeTarget): string[] {
  const members = new Set(target.members.map((member) => member.id));
  return [...new Set(target.pending)].filter((memberId) => memberId !== target.chiefId && members.has(memberId));
}

const found = <T>(look: () => T | null): T | null => {
  try {
    return look();
  } catch {
    return null;
  }
};

/**
 * Judges with the decision model when there is one, else with the main bot's model, else by keyword. The way is
 * chosen by what is set up: a model that then fails leaves its members `["other"]`. Never throws.
 */
export function createTeamJudge(ways: TeamJudgeWays): TeamJudge {
  return async (target, options = {}) => {
    const pending = judgeable(target);
    const byKeyword = (): TeamJudgement => ({
      way: "keywords",
      stages: Object.fromEntries(pending.map((memberId) => [memberId, keywordStages(target.members.find((member) => member.id === memberId)!)])),
      unanswered: [],
    });
    if (!pending.length) return byKeyword();
    const decider = found(ways.decider);
    if (decider) return { way: "decider", ...(await judgeWithDecider(decider, target, pending, options)) };
    const model = found(ways.mainBot);
    if (model) return { way: "model", ...(await judgeWithModel(model, target, pending, options)) };
    return byKeyword();
  };
}
