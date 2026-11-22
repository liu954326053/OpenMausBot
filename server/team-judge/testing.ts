import type { FlowStage, PipelineStage } from "../../shared/team-pipeline.ts";
import { PIPELINE_STAGES } from "../../shared/team-pipeline.ts";
import type { Decider } from "../decider/index.ts";
import type { DeciderFailure, YesNoAnswer } from "../decider/types.ts";
import type { JudgeTarget } from "../team-flow/flows.ts";

type Member = JudgeTarget["members"][number];

const member = (id: string, name: string, title: string, description = "", soul = ""): Member => ({ id, name, title, description, soul });

/** A team whose every member but its Chief (the first) waits for a judge. */
export function teamTarget(section: string, members: Member[]): JudgeTarget {
  return { section, chiefId: members[0]!.id, members, pending: members.slice(1).map((each) => each.id) };
}

/** The team of the design's screenshot. */
export const SCREENSHOT_TEAM = teamTarget("漫剧工作室", [
  member("yunzhou", "云舟", "制片人", "统筹整部短剧的制作", "你是制片人，把人的要求变成创作要求。"),
  member("yanqing", "砚青", "编剧", "写剧本和对白", "你是编剧。剧本定稿后交给分镜。"),
  member("mobai", "墨白", "分镜与美术设计", "设计角色，并把剧本拆成镜头", "你负责角色的美术设计和分镜。"),
  member("qinghe", "青禾", "后期合成", "把镜头的视频合成成片", "你负责后期。"),
]);
export const SCREENSHOT_STAGES: Record<string, FlowStage[]> = { yanqing: ["script"], mobai: ["character", "storyboard"], qinghe: ["post"] };

export const FIVE_MEMBER_TEAM = teamTarget("Drama Studio", [
  member("lead", "Avery", "Producer", "Runs the production"),
  member("writer", "Blake", "Screenwriter", "Writes the screenplay"),
  member("designer", "Casey", "Character Designer", "Designs the characters and their reference art"),
  member("boarder", "Devon", "Storyboard Artist", "Turns the script into shots"),
  member("editor", "Emery", "Video Editor", "Edits the finished film"),
]);
export const FIVE_MEMBER_STAGES: Record<string, FlowStage[]> = { writer: ["script"], designer: ["character"], boarder: ["storyboard"], editor: ["post"] };

export const OFFICE_TEAM = teamTarget("增长", [
  member("head", "林一", "增长负责人", "带领增长团队"),
  member("research", "周二", "市场研究员", "研究竞品和用户", "你的角色是严谨的研究员。"),
  member("engineer", "张三", "工程师", "写代码和修问题"),
  member("ops", "李四", "运营", "发布内容并回复用户"),
]);
export const OFFICE_STAGES: Record<string, FlowStage[]> = { research: ["other"], engineer: ["other"], ops: ["other"] };

/** The stages a fake model gives a member, by its title. */
export const STAGES_BY_TITLE: Record<string, PipelineStage[]> = {
  编剧: ["script"], 分镜与美术设计: ["character", "storyboard"], 后期合成: ["post"],
  Screenwriter: ["script"], "Character Designer": ["character"], "Storyboard Artist": ["storyboard"], "Video Editor": ["post"],
};

type Ask = Decider["ask"];
type Asked = { seam: string; state: { member: { name: string; title: string } }; questions: Record<string, unknown>; options: unknown };

/** A decision model that answers each stage's yes/no by the member's title, or fails as told. */
export function fakeDecider(fail: (title: string) => DeciderFailure | "throw" | null = () => null) {
  const asked: Asked[] = [];
  const ask = (async (seam: string, state: Asked["state"], questions: Record<string, unknown>, options: unknown) => {
    asked.push({ seam, state, questions, options });
    const failure = fail(state.member.title);
    if (failure === "throw") throw new Error("the decision model broke");
    if (failure) return { ok: false, provider: "jev", reason: failure };
    const stages = STAGES_BY_TITLE[state.member.title] ?? [];
    const answers = Object.fromEntries(PIPELINE_STAGES.map((stage): [string, YesNoAnswer] => [stage, { type: "yesno", p: stages.includes(stage) ? 0.93 : 0.04 }]));
    return { ok: true, provider: "jev", latencyMs: 1, answers };
  }) as unknown as Ask;
  return { ask, asked };
}

/** The main bot's model: answers every member the prompt asks about, by its title, as the JSON object asked for. */
export function fakeModel(reply?: (prompt: string) => string | Promise<string>) {
  const prompts: string[] = [];
  const generateText = async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    if (reply) return reply(prompt);
    const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as { members: Record<string, { title: string }>; judge: string[] };
    return JSON.stringify(Object.fromEntries(data.judge.map((key) => [key, STAGES_BY_TITLE[data.members[key]!.title] ?? ["other"]])));
  };
  return { generateText, prompts };
}

/** What the scheduler reads and writes in place of the running flows: teams with pending members, and what a judge
 * recorded. `keeps` leaves a recorded member pending, as flows that take no stages would. */
export function fakeFlows(options: { keeps?: boolean } = {}) {
  const teams = new Map<string, JudgeTarget>();
  const listeners = new Set<() => void>();
  const recorded: Array<[string, Record<string, readonly FlowStage[]>]> = [];
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    recorded,
    listeners,
    targets: (): JudgeTarget[] => [...teams.values()].filter((team) => team.pending.length).map((team) => structuredClone(team)),
    record(section: string, stages: Readonly<Record<string, readonly FlowStage[]>>): void {
      recorded.push([section, { ...stages }]);
      const team = teams.get(section);
      if (!team || options.keeps) return changed();
      team.pending = team.pending.filter((memberId) => !Object.hasOwn(stages, memberId));
      changed();
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Puts the team as given, in place of what was there under its name. */
    put(target: JudgeTarget): void {
      teams.set(target.section, structuredClone(target));
      changed();
    },
    remove(section: string): void {
      teams.delete(section);
      changed();
    },
    changed,
  };
}
