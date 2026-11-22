import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { JudgeTarget } from "../team-flow/flows.ts";
import { createTeamJudge, type TeamJudge, type TeamJudgement } from "./judge.ts";
import { startTeamJudgeScheduler, TEAM_JUDGE_MODEL_LIMIT, TEAM_JUDGE_SETTLE_MS, TEAM_JUDGE_START_DELAY_MS, TEAM_JUDGE_TIMEOUT_MS } from "./scheduler.ts";
import { fakeFlows, FIVE_MEMBER_STAGES, FIVE_MEMBER_TEAM, OFFICE_STAGES, OFFICE_TEAM, SCREENSHOT_STAGES, SCREENSHOT_TEAM, teamTarget } from "./testing.ts";

const byKeyword = createTeamJudge({ decider: () => null, mainBot: () => null });

/** A judge whose every judgement waits to be answered by the test. */
function heldJudge(way: TeamJudgement["way"] = "model") {
  const calls: Array<{ target: JudgeTarget; signal?: AbortSignal; answer(stages: Record<string, FlowStage[]>): void; fail(): void }> = [];
  let open = 0;
  let most = 0;
  const judge: TeamJudge = (target, options) => new Promise<TeamJudgement>((resolve, reject) => {
    open += 1;
    most = Math.max(most, open);
    calls.push({
      target, signal: options?.signal,
      answer: (stages) => { open -= 1; resolve({ way, stages }); },
      fail: () => { open -= 1; reject(new Error("the judge broke")); },
    });
  });
  return { judge, calls, most: () => most };
}

const settle = () => vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS);
const allOther = (target: JudgeTarget) => Object.fromEntries(target.pending.map((memberId) => [memberId, ["other"]]));
const withMembers = (target: JudgeTarget, count: number): JudgeTarget =>
  ({ ...target, members: target.members.slice(0, count), pending: target.pending.slice(0, count - 1) });

let stop: (() => void) | undefined;
function start(flows: ReturnType<typeof fakeFlows>, judge: TeamJudge, extra: Partial<Parameters<typeof startTeamJudgeScheduler>[0]> = {}) {
  const logged: string[] = [];
  stop = startTeamJudgeScheduler({ targets: flows.targets, record: flows.record, onChange: flows.onChange, judge, log: (line) => logged.push(line), ...extra });
  return logged;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe("judging teams in the background", () => {
  it("judges a team's pending members once it has stopped changing, and records their stages", async () => {
    const flows = fakeFlows();
    start(flows, byKeyword);
    flows.put(SCREENSHOT_TEAM);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS - 1);
    expect(flows.recorded).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(flows.recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
    expect(flows.targets()).toEqual([]);
  });

  it("judges every team that waits, each by itself", async () => {
    const flows = fakeFlows();
    start(flows, byKeyword);
    flows.put(SCREENSHOT_TEAM);
    flows.put(FIVE_MEMBER_TEAM);
    flows.put(OFFICE_TEAM);
    await settle();
    expect(flows.recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES], ["Drama Studio", FIVE_MEMBER_STAGES], ["增长", OFFICE_STAGES]]);
  });

  it("judges once a team that gains its members one after another", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    for (const count of [2, 3, 4, 5]) {
      flows.put(withMembers(FIVE_MEMBER_TEAM, count));
      await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS - 100);
    }
    expect(held.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(held.calls.map((call) => call.target.pending)).toEqual([["writer", "designer", "boarder", "editor"]]);
  });

  it("does not wait longer for a team because another one changes", async () => {
    const flows = fakeFlows();
    start(flows, byKeyword);
    flows.put(SCREENSHOT_TEAM);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS - 100);
    flows.put(OFFICE_TEAM);
    await vi.advanceTimersByTimeAsync(100);
    expect(flows.recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
  });

  it("takes up the teams that waited before it started, with no change to tell it", async () => {
    const flows = fakeFlows();
    flows.put(SCREENSHOT_TEAM);
    start(flows, byKeyword);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_START_DELAY_MS + TEAM_JUDGE_SETTLE_MS - 1);
    expect(flows.recorded).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(flows.recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
  });

  it("runs one judgement at a time, and never two of the same team", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    flows.put(FIVE_MEMBER_TEAM);
    await settle();
    expect(held.calls.map((call) => call.target.section)).toEqual(["漫剧工作室"]);
    flows.put({ ...SCREENSHOT_TEAM, members: [...SCREENSHOT_TEAM.members, { id: "voice", name: "阿音", title: "配音", description: "", soul: "" }], pending: [...SCREENSHOT_TEAM.pending, "voice"] });
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS * 3);
    expect(held.calls).toHaveLength(1);
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await vi.advanceTimersByTimeAsync(0);
    expect(held.calls.map((call) => call.target.section)).toEqual(["漫剧工作室", "Drama Studio"]);
    held.calls[1]!.answer(FIVE_MEMBER_STAGES);
    await settle();
    expect(held.calls.map((call) => [call.target.section, call.target.pending])).toEqual([
      ["漫剧工作室", ["yanqing", "mobai", "qinghe"]], ["Drama Studio", ["writer", "designer", "boarder", "editor"]], ["漫剧工作室", ["voice"]],
    ]);
    held.calls[2]!.answer({ voice: ["other"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(held.most()).toBe(1);
    expect(flows.recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES], ["Drama Studio", FIVE_MEMBER_STAGES], ["漫剧工作室", { voice: ["other"] }]]);
  });

  it("records nothing for a member that changed or left while it was judged, and judges the changed one again", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    const rewritten = SCREENSHOT_TEAM.members.map((member) => (member.id === "mobai" ? { ...member, title: "分镜师" } : member));
    flows.put({ ...SCREENSHOT_TEAM, members: rewritten.filter((member) => member.id !== "qinghe"), pending: ["yanqing", "mobai"] });
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await vi.advanceTimersByTimeAsync(0);
    expect(flows.recorded).toEqual([["漫剧工作室", { yanqing: ["script"] }]]);
    await settle();
    expect(held.calls[1]!.target.pending).toEqual(["mobai"]);
    expect(held.calls[1]!.target.members.find((member) => member.id === "mobai")!.title).toBe("分镜师");
    held.calls[1]!.answer({ mobai: ["storyboard"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flows.recorded[1]).toEqual(["漫剧工作室", { mobai: ["storyboard"] }]);
  });

  it("records nothing for a team that went away while it was judged", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    flows.remove("漫剧工作室");
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await settle();
    expect(flows.recorded).toEqual([]);
    expect(held.calls).toHaveLength(1);
  });

  it("gives a member the judge left out, or answered with no stage, other", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    held.calls[0]!.answer({ yanqing: ["script"], mobai: [], stranger: ["post"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(flows.recorded).toEqual([["漫剧工作室", { yanqing: ["script"], mobai: ["other"], qinghe: ["other"] }]]);
  });
});

describe("a judgement that fails", () => {
  it("is called off when it takes too long: its members are other and the next team is judged", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    flows.put(FIVE_MEMBER_TEAM);
    await settle();
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_TIMEOUT_MS - 1);
    expect(flows.recorded).toEqual([]);
    expect(held.calls[0]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(held.calls[0]!.signal!.aborted).toBe(true);
    expect(flows.recorded).toEqual([["漫剧工作室", allOther(SCREENSHOT_TEAM)]]);
    expect(held.calls.map((call) => call.target.section)).toEqual(["漫剧工作室", "Drama Studio"]);
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await vi.advanceTimersByTimeAsync(0);
    expect(flows.recorded).toHaveLength(1);
  });

  it("leaves its members other when the judge throws, and keeps judging", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    const logged = start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    held.calls[0]!.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(flows.recorded).toEqual([["漫剧工作室", allOther(SCREENSHOT_TEAM)]]);
    expect(logged.join("\n")).toContain("漫剧工作室");
    flows.put(OFFICE_TEAM);
    await settle();
    expect(held.calls).toHaveLength(2);
  });

  it("is not tried again until the team changes", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    held.calls[0]!.fail();
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS * 10);
    expect(held.calls).toHaveLength(1);
    flows.put({ ...SCREENSHOT_TEAM, pending: ["yanqing"] });
    await settle();
    expect(held.calls).toHaveLength(2);
  });

  it("survives flows that cannot be read or written", async () => {
    const flows = fakeFlows();
    let broken = true;
    const logged = start(flows, byKeyword, {
      targets: () => { if (broken) throw new Error("flows unreadable"); return flows.targets(); },
      record: (section, stages) => { if (section === "增长") throw new Error("flows unwritable"); flows.record(section, stages); },
    });
    flows.put(SCREENSHOT_TEAM);
    await settle();
    expect(flows.recorded).toEqual([]);
    broken = false;
    flows.put(OFFICE_TEAM);
    await settle();
    expect(flows.recorded).toEqual([["漫剧工作室", SCREENSHOT_STAGES]]);
    expect(logged.join("\n")).toMatch(/flows unreadable[\s\S]*flows unwritable/);
  });
});

describe("what keeps the judge from running away", () => {
  it("does not judge again because of what it recorded itself", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS * 10);
    expect(held.calls).toHaveLength(1);
  });

  it("leaves members that stay pending after it recorded them until something about the team changes", async () => {
    const flows = fakeFlows({ keeps: true });
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await vi.advanceTimersByTimeAsync(0);
    flows.changed();
    flows.put(OFFICE_TEAM);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_SETTLE_MS * 10);
    expect(held.calls.map((call) => call.target.section)).toEqual(["漫剧工作室", "增长"]);
    const retitled = SCREENSHOT_TEAM.members.map((member) => (member.id === "qinghe" ? { ...member, title: "剪辑" } : member));
    flows.put({ ...SCREENSHOT_TEAM, members: retitled });
    await settle();
    expect(held.calls.map((call) => call.target.section)).toEqual(["漫剧工作室", "增长"]);
    held.calls[1]!.answer(OFFICE_STAGES);
    await settle();
    expect(held.calls.map((call) => call.target.section)).toEqual(["漫剧工作室", "增长", "漫剧工作室"]);
  });

  it("starts only so many judgements that ask a model in a minute, and the rest as the minute passes", async () => {
    const flows = fakeFlows();
    const asked: string[] = [];
    const judge: TeamJudge = async (target) => {
      asked.push(target.section);
      return { way: "model", stages: {} };
    };
    start(flows, judge);
    const teams = Array.from({ length: TEAM_JUDGE_MODEL_LIMIT.count + 2 }, (_, index) => teamTarget(`Team ${index}`, [
      { id: `chief${index}`, name: "Chief", title: "Lead", description: "", soul: "" }, { id: `member${index}`, name: "Member", title: "Writer", description: "", soul: "" },
    ]));
    for (const team of teams) flows.put(team);
    await settle();
    expect(asked).toHaveLength(TEAM_JUDGE_MODEL_LIMIT.count);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_MODEL_LIMIT.perMs - 1);
    expect(asked).toHaveLength(TEAM_JUDGE_MODEL_LIMIT.count);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toHaveLength(TEAM_JUDGE_MODEL_LIMIT.count + 2);
  });

  it("does not hold back judgements that ask no model", async () => {
    const flows = fakeFlows();
    start(flows, byKeyword);
    const teams = Array.from({ length: TEAM_JUDGE_MODEL_LIMIT.count + 5 }, (_, index) => teamTarget(`Team ${index}`, [
      { id: `chief${index}`, name: "Chief", title: "Lead", description: "", soul: "" }, { id: `member${index}`, name: "Member", title: "Writer", description: "", soul: "" },
    ]));
    for (const team of teams) flows.put(team);
    await settle();
    expect(flows.recorded).toHaveLength(teams.length);
  });

  it("stops: nothing more is judged or recorded, and a judgement under way is called off", async () => {
    const flows = fakeFlows();
    const held = heldJudge();
    start(flows, held.judge);
    flows.put(SCREENSHOT_TEAM);
    await settle();
    flows.put(OFFICE_TEAM);
    stop!();
    expect(held.calls[0]!.signal!.aborted).toBe(true);
    expect(flows.listeners.size).toBe(0);
    held.calls[0]!.answer(SCREENSHOT_STAGES);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_TIMEOUT_MS * 2);
    expect(held.calls).toHaveLength(1);
    expect(flows.recorded).toEqual([]);
  });
});
