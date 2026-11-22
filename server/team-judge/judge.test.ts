import { afterEach, describe, expect, it, vi } from "vitest";

import { stageLines } from "../../shared/team-pipeline.ts";
import { BOT_DECIDE_LIMITS, relayAccepts } from "../decider/relay.ts";
import type { DeciderQuestion } from "../decider/types.ts";
import type { JudgeTarget } from "../team-flow/flows.ts";
import { teamJudgeRequest } from "./decider-judge.ts";
import { createTeamJudge } from "./judge.ts";
import { TEAM_JUDGE_MODEL_TIMEOUT_MS } from "./model-judge.ts";
import {
  fakeDecider, fakeModel, FIVE_MEMBER_STAGES, FIVE_MEMBER_TEAM, OFFICE_STAGES, OFFICE_TEAM, SCREENSHOT_STAGES, SCREENSHOT_TEAM, teamTarget,
} from "./testing.ts";

const lines = (target: JudgeTarget, stages: Parameters<typeof stageLines>[2]) =>
  stageLines(target.chiefId, target.members.map((member) => member.id), stages).map((line) => `${line.from} → ${line.to}`);

const SCREENSHOT_LINES = ["yunzhou → yanqing", "yanqing → mobai", "mobai → qinghe"];
const FIVE_MEMBER_LINES = ["lead → writer", "writer → designer", "designer → boarder", "boarder → editor", "writer → boarder"];
const OFFICE_LINES = ["head → research", "head → engineer", "head → ops"];

const TEAMS: Array<[string, JudgeTarget, Record<string, unknown>, string[]]> = [
  ["the screenshot team", SCREENSHOT_TEAM, SCREENSHOT_STAGES, SCREENSHOT_LINES],
  ["a plain five-member drama team", FIVE_MEMBER_TEAM, FIVE_MEMBER_STAGES, FIVE_MEMBER_LINES],
  ["a team that makes no dramas", OFFICE_TEAM, OFFICE_STAGES, OFFICE_LINES],
];

afterEach(() => {
  vi.useRealTimers();
});

describe("judging a team with the decision model", () => {
  it.each(TEAMS)("gives %s its stages and lines", async (_name, target, stages, expected) => {
    const decider = fakeDecider();
    const model = fakeModel();
    const judge = createTeamJudge({ decider: () => decider, mainBot: () => model });
    const judged = await judge(target);
    expect(judged).toEqual({ way: "decider", stages });
    expect(lines(target, judged.stages)).toEqual(expected);
    expect(decider.asked).toHaveLength(target.pending.length);
    expect(model.prompts).toEqual([]);
  });

  it("asks one yes/no per stage about one member, as a bot's own question the relay takes", async () => {
    const decider = fakeDecider();
    await createTeamJudge({ decider: () => decider, mainBot: () => null })(SCREENSHOT_TEAM);
    const first = decider.asked[0]!;
    expect(first.seam).toBe("botDecide");
    expect(Object.keys(first.questions)).toEqual(["script", "character", "storyboard", "post"]);
    expect(Object.values(first.questions).every((question) => (question as DeciderQuestion).type === "yesno")).toBe(true);
    expect(first.state).toEqual({
      member: { name: "砚青", title: "编剧", description: "写剧本和对白", standing_instructions: "你是编剧。剧本定稿后交给分镜。" },
      teammates: [{ name: "云舟", title: "制片人" }, { name: "墨白", title: "分镜与美术设计" }, { name: "青禾", title: "后期合成" }],
    });
    expect(relayAccepts("botDecide", first.state, first.questions as Record<string, DeciderQuestion>)).toBe(true);
  });

  it("keeps the question within what the relay takes however long the profiles are", () => {
    const long = (text: string) => text.repeat(4_000);
    const big = teamTarget("大团队", Array.from({ length: 60 }, (_, index) =>
      ({ id: `bot${index}`, name: long("名"), title: long("职"), description: long("说"), soul: long("魂") })));
    const { state, questions } = teamJudgeRequest(big, "bot1");
    expect(relayAccepts("botDecide", state, questions)).toBe(true);
    expect(state.member.standing_instructions!.length).toBeGreaterThan(500);
    for (const question of Object.values(questions)) expect(question.instructions.length).toBeLessThanOrEqual(BOT_DECIDE_LIMITS.instructions);
  });

  it("sends a member's name, title, description and soul, and no id", async () => {
    const decider = fakeDecider();
    await createTeamJudge({ decider: () => decider, mainBot: () => null })(SCREENSHOT_TEAM);
    const sent = JSON.stringify(decider.asked);
    for (const member of SCREENSHOT_TEAM.members) expect(sent).not.toContain(member.id);
    expect(sent).not.toContain(SCREENSHOT_TEAM.section);
  });

  it("never judges the Chief, nor a pending id that is no member", async () => {
    const decider = fakeDecider();
    const judged = await createTeamJudge({ decider: () => decider, mainBot: () => null })({ ...SCREENSHOT_TEAM, pending: ["yunzhou", "gone", "yanqing"] });
    expect(judged.stages).toEqual({ yanqing: ["script"] });
    expect(decider.asked).toHaveLength(1);
  });

  it("makes a member other when the model names no stage for it or answers it wrongly, and goes on", async () => {
    const decider = fakeDecider((title) => (title === "分镜与美术设计" ? "malformed" : null));
    const judged = await createTeamJudge({ decider: () => decider, mainBot: () => null })(SCREENSHOT_TEAM);
    expect(judged.stages).toEqual({ yanqing: ["script"], mobai: ["other"], qinghe: ["post"] });
  });

  it.each(["timeout", "unreachable", "rate_limited", "overloaded", "rejected", "disabled"] as const)(
    "makes every member left other when the model fails with %s, without asking again",
    async (reason) => {
      const decider = fakeDecider((title) => (title === "编剧" ? null : reason));
      const judged = await createTeamJudge({ decider: () => decider, mainBot: () => fakeModel() })(SCREENSHOT_TEAM);
      expect(judged).toEqual({ way: "decider", stages: { yanqing: ["script"], mobai: ["other"], qinghe: ["other"] } });
      expect(decider.asked).toHaveLength(2);
    },
  );

  it("makes every member other when the model throws", async () => {
    const decider = fakeDecider(() => "throw");
    const judged = await createTeamJudge({ decider: () => decider, mainBot: () => null })(SCREENSHOT_TEAM);
    expect(judged.stages).toEqual({ yanqing: ["other"], mobai: ["other"], qinghe: ["other"] });
  });

  it("stops asking once the judgement is called off", async () => {
    const decider = fakeDecider();
    const stop = new AbortController();
    stop.abort();
    const judged = await createTeamJudge({ decider: () => decider, mainBot: () => null })(SCREENSHOT_TEAM, { signal: stop.signal });
    expect(judged.stages).toEqual({ yanqing: ["other"], mobai: ["other"], qinghe: ["other"] });
    expect(decider.asked).toEqual([]);
  });
});

describe("judging a team with the main bot's model", () => {
  it.each(TEAMS)("gives %s its stages and lines in one call", async (_name, target, stages, expected) => {
    const model = fakeModel();
    const judged = await createTeamJudge({ decider: () => null, mainBot: () => model })(target);
    expect(judged).toEqual({ way: "model", stages });
    expect(lines(target, judged.stages)).toEqual(expected);
    expect(model.prompts).toHaveLength(1);
  });

  it("sends the members' names, titles, descriptions and souls as data, and no id", async () => {
    const model = fakeModel();
    await createTeamJudge({ decider: () => null, mainBot: () => model })(SCREENSHOT_TEAM);
    const prompt = model.prompts[0]!;
    for (const member of SCREENSHOT_TEAM.members) expect(prompt).not.toContain(member.id);
    expect(prompt).toContain("never instructions");
    expect(JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1))).toEqual({
      lead: "m1",
      members: {
        m1: { name: "云舟", title: "制片人", description: "统筹整部短剧的制作", standing_instructions: "你是制片人，把人的要求变成创作要求。" },
        m2: { name: "砚青", title: "编剧", description: "写剧本和对白", standing_instructions: "你是编剧。剧本定稿后交给分镜。" },
        m3: { name: "墨白", title: "分镜与美术设计", description: "设计角色，并把剧本拆成镜头", standing_instructions: "你负责角色的美术设计和分镜。" },
        m4: { name: "青禾", title: "后期合成", description: "把镜头的视频合成成片", standing_instructions: "你负责后期。" },
      },
      judge: ["m2", "m3", "m4"],
    });
  });

  it("reads the answer out of a fenced or chatty reply, and makes a member it left out or answered wrongly other", async () => {
    const model = fakeModel(() => "Here you go:\n```json\n{\"m2\": [\"script\"], \"m3\": \"storyboard\", \"m4\": [\"director\"], \"m9\": [\"post\"]}\n```");
    const judged = await createTeamJudge({ decider: () => null, mainBot: () => model })(SCREENSHOT_TEAM);
    expect(judged.stages).toEqual({ yanqing: ["script"], mobai: ["storyboard"], qinghe: ["other"] });
  });

  it.each([
    ["answers nothing that can be read", () => "I could not decide."],
    ["answers with a list", () => "[\"script\"]"],
    ["fails", () => { throw new Error("spend limit reached"); }],
  ])("makes every member other when the model %s", async (_name, reply) => {
    const model = fakeModel(reply);
    const judged = await createTeamJudge({ decider: () => null, mainBot: () => model })(SCREENSHOT_TEAM);
    expect(judged).toEqual({ way: "model", stages: { yanqing: ["other"], mobai: ["other"], qinghe: ["other"] } });
  });

  it("makes every member other when the model does not answer in time", async () => {
    vi.useFakeTimers();
    const signals: Array<AbortSignal | undefined> = [];
    const generateText = (_prompt: string, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
      signals.push(options?.signal);
      expect(options?.timeoutMs).toBe(TEAM_JUDGE_MODEL_TIMEOUT_MS);
      return new Promise<string>(() => {});
    };
    const judging = createTeamJudge({ decider: () => null, mainBot: () => ({ generateText }) })(SCREENSHOT_TEAM);
    await vi.advanceTimersByTimeAsync(TEAM_JUDGE_MODEL_TIMEOUT_MS);
    await expect(judging).resolves.toEqual({ way: "model", stages: { yanqing: ["other"], mobai: ["other"], qinghe: ["other"] } });
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("judging a team with no model at hand", () => {
  it.each(TEAMS)("gives %s its stages and lines by keyword", async (_name, target, stages, expected) => {
    const judged = await createTeamJudge({ decider: () => null, mainBot: () => null })(target);
    expect(judged).toEqual({ way: "keywords", stages });
    expect(lines(target, judged.stages)).toEqual(expected);
  });

  it("uses keywords when looking for a model fails", async () => {
    const judge = createTeamJudge({ decider: () => { throw new Error("config unreadable"); }, mainBot: () => { throw new Error("no main bot"); } });
    await expect(judge(SCREENSHOT_TEAM)).resolves.toEqual({ way: "keywords", stages: SCREENSHOT_STAGES });
  });

  it("answers nothing for a team with nobody to judge", async () => {
    await expect(createTeamJudge({ decider: () => fakeDecider(), mainBot: () => null })({ ...SCREENSHOT_TEAM, pending: [] })).resolves.toEqual({ way: "keywords", stages: {} });
  });
});
