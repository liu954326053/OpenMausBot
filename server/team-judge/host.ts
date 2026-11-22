import type { AppConfig } from "../config.ts";
import type { Decider } from "../decider/index.ts";
import { judgeTargets, onTeamFlowsChange, setJudgedStages } from "../team-flow/flows.ts";
import { teamJudgeDeciderReady } from "./decider-judge.ts";
import { createTeamJudge } from "./judge.ts";
import type { JudgeModel } from "./model-judge.ts";
import { startTeamJudgeScheduler } from "./scheduler.ts";

export interface TeamJudgeHostDeps {
  decider: Pick<Decider, "ask">;
  config(): AppConfig;
  /** The main bot's one-off text call (side-jobs.ts, "team-judge"); null while it has none. */
  mainBotText(): JudgeModel | null;
  log?(line: string): void;
}

/**
 * From now on the pending members of every team are judged in the background, whenever the flows change, and their
 * stages recorded with the flows: by the decision model while one is set up and on, else by the main bot's model,
 * else by keyword. Returns the stop.
 */
export function startTeamJudge(deps: TeamJudgeHostDeps): () => void {
  const judge = createTeamJudge({
    decider: () => (teamJudgeDeciderReady(deps.config()) ? deps.decider : null),
    mainBot: deps.mainBotText,
  });
  return startTeamJudgeScheduler({
    targets: judgeTargets,
    record: setJudgedStages,
    onChange: onTeamFlowsChange,
    judge,
    log: deps.log ?? ((line) => console.warn(`[team-judge] ${line}`)),
  });
}
