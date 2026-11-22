import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { AppConfig } from "../config.ts";
import { installTeamFlows, teamFlowsChanged, type JudgeTarget } from "../team-flow/flows.ts";
import { startTeamJudge } from "./host.ts";
import { TEAM_JUDGE_SETTLE_MS } from "./scheduler.ts";
import { fakeDecider, fakeModel, SCREENSHOT_STAGES, SCREENSHOT_TEAM } from "./testing.ts";

const NO_FLOWS = { parents: () => ({}), projectParents: () => ({}), lineOf: () => null };
const WITH_DECISION_MODEL = { decider: { enabled: true, key: "jev-key" } } as AppConfig;

/** The running flows, as far as a judge sees them. */
function installedTeam(target: JudgeTarget) {
  const recorded: Array<[string, Readonly<Record<string, readonly FlowStage[]>>]> = [];
  let pending = [...target.pending];
  installTeamFlows({
    ...NO_FLOWS,
    judgeTargets: () => (pending.length ? [{ ...target, pending }] : []),
    setJudged: (section, stages) => {
      recorded.push([section, stages]);
      pending = pending.filter((memberId) => !Object.hasOwn(stages, memberId));
      teamFlowsChanged();
    },
  });
  return recorded;
}

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  installTeamFlows(NO_FLOWS);
  vi.useRealTimers();
});

describe("the judge of the running flows", () => {
  it("judges the teams the flows name when they change, and records the stages with them", async () => {
    const recorded = installedTeam(SCREENSHOT_TEAM);
    const decider = fakeDecider();
    stop = startTeamJudge({ decider, config: () => WITH_DECISION_MODEL, mainBotText: () => fakeModel() });
    teamFlowsChanged();
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS);
    expect(recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
    expect(decider.asked).toHaveLength(3);
  });

  it("asks the main bot's model while no decision model is set up or it is switched off", async () => {
    for (const cfg of [{}, { decider: { enabled: false, key: "jev-key" } }, { decider: { provider: "off", key: "jev-key" } }] as AppConfig[]) {
      const recorded = installedTeam(SCREENSHOT_TEAM);
      const decider = fakeDecider();
      const model = fakeModel();
      stop = startTeamJudge({ decider, config: () => cfg, mainBotText: () => model });
      teamFlowsChanged();
      await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS);
      expect(recorded, JSON.stringify(cfg)).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
      expect(decider.asked).toEqual([]);
      expect(model.prompts).toHaveLength(1);
      stop();
    }
  });

  it("goes by keywords while the main bot has no text call either", async () => {
    const recorded = installedTeam(SCREENSHOT_TEAM);
    stop = startTeamJudge({ decider: fakeDecider(), config: () => ({}) as AppConfig, mainBotText: () => null });
    teamFlowsChanged();
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS);
    expect(recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
  });

  it("has nothing to judge while the flows name no team", async () => {
    installTeamFlows(NO_FLOWS);
    const model = fakeModel();
    stop = startTeamJudge({ decider: fakeDecider(), config: () => ({}) as AppConfig, mainBotText: () => model });
    teamFlowsChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(model.prompts).toEqual([]);
  });
});
