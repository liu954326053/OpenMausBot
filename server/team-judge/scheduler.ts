// When teams are judged: in the background, after a team has stopped changing, one judgement at a time, each bounded,
// and only so many that ask a model in a minute.
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { JudgeTarget } from "../team-flow/flows.ts";
import { judgeable, type TeamJudge, type TeamJudgement } from "./judge.ts";
import { judgedStages } from "./stages.ts";

/** A team is judged once nothing about it has changed for this long: a team being built gains its members one after
 * another. */
export const TEAM_JUDGE_SETTLE_MS = 1_500;
/** How long after the start the teams already waiting are taken up: the engines are still starting before that. */
export const TEAM_JUDGE_START_DELAY_MS = 10_000;
/** A judgement that has not answered by then is called off. */
export const TEAM_JUDGE_TIMEOUT_MS = 60_000;
/** How long a judgement called off has to say what it found out so far; the members it does not answer for are `other`. */
export const TEAM_JUDGE_GRACE_MS = 2_000;
/** Judgements that ask a model: at most `count` start within `perMs`. */
export const TEAM_JUDGE_MODEL_LIMIT = { count: 12, perMs: 60_000 } as const;

type Timer = { cancel(): void };

export interface TeamJudgeSchedulerDeps {
  /** The teams with members waiting for a judge. */
  targets(): JudgeTarget[];
  /** Records the stages a judgement gave members of a team. */
  record(section: string, stages: Readonly<Record<string, readonly FlowStage[]>>): void;
  /** `listener` runs after a team may have changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  judge: TeamJudge;
  log?(line: string): void;
  now?(): number;
  after?(ms: number, run: () => void): Timer;
}

const profileOf = (member: JudgeTarget["members"][number]) => JSON.stringify([member.name, member.title, member.description, member.soul]);
/** What a judgement of the team would go by: who waits, and every member's profile. */
const askOf = (target: JudgeTarget) => JSON.stringify([judgeable(target).sort(), target.members.map((member) => [member.id, profileOf(member)])]);
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Judges the pending members of every team from now on; the function returned stops it. */
export function startTeamJudgeScheduler(deps: TeamJudgeSchedulerDeps): () => void {
  const now = deps.now ?? Date.now;
  const after = deps.after ?? ((ms, run) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  });
  const log = (line: string) => deps.log?.(line);

  const settling = new Map<string, { ask: string; timer: Timer }>();
  const queue: string[] = [];
  /** Teams whose members stayed pending after their stages were recorded → what was asked: not asked again as it is. */
  const answered = new Map<string, string>();
  const modelStarts: number[] = [];
  let judging: { section: string; stop: AbortController } | null = null;
  let recording = false;
  let running = false;
  let stopped = false;
  let pause: Timer | null = null;

  const targets = (): JudgeTarget[] => {
    try {
      return deps.targets().filter((target) => judgeable(target).length > 0);
    } catch (error) {
      log(`the teams to judge could not be read (${reasonOf(error)})`);
      return [];
    }
  };
  const targetOf = (section: string) => targets().find((target) => target.section === section);

  const settle = (section: string, ask: string) => {
    const waiting = settling.get(section);
    if (waiting?.ask === ask) return;
    waiting?.timer.cancel();
    settling.set(section, { ask, timer: after(TEAM_JUDGE_SETTLE_MS, () => {
      settling.delete(section);
      if (!queue.includes(section)) queue.push(section);
      void run();
    }) });
  };

  const look = () => {
    if (stopped || recording) return;
    const waiting = new Set<string>();
    for (const target of targets()) {
      const { section } = target;
      waiting.add(section);
      if (judging?.section === section || queue.includes(section)) continue;
      const ask = askOf(target);
      if (answered.get(section) === ask) continue;
      answered.delete(section);
      settle(section, ask);
    }
    for (const [section, entry] of settling) {
      if (waiting.has(section)) continue;
      entry.timer.cancel();
      settling.delete(section);
    }
    for (const section of answered.keys()) if (!waiting.has(section)) answered.delete(section);
  };

  const modelSlot = async () => {
    while (!stopped) {
      const window = now() - TEAM_JUDGE_MODEL_LIMIT.perMs;
      while (modelStarts.length && modelStarts[0]! <= window) modelStarts.shift();
      if (modelStarts.length < TEAM_JUDGE_MODEL_LIMIT.count) return;
      await new Promise<void>((resolve) => {
        pause = after(modelStarts[0]! - window, resolve);
      });
    }
  };

  const judgement = async (target: JudgeTarget): Promise<TeamJudgement | null> => {
    const stop = new AbortController();
    judging = { section: target.section, stop };
    const unanswered = (why: unknown) => {
      if (!stopped) log(`"${target.section}" could not be judged (${reasonOf(why)}); its members are "other" until it changes`);
      return null;
    };
    const answer = Promise.resolve().then(() => deps.judge(target, { signal: stop.signal })).catch(unanswered);
    let grace: Timer | undefined;
    // Raced as well as cancelled: a judge that ignores the signal must not hold every other team.
    const calledOff = new Promise<null>((resolve) => {
      stop.signal.addEventListener("abort", () => {
        grace = after(TEAM_JUDGE_GRACE_MS, () => resolve(unanswered(stop.signal.reason)));
      }, { once: true });
    });
    const expiry = after(TEAM_JUDGE_TIMEOUT_MS, () => stop.abort(new Error(`no answer after ${TEAM_JUDGE_TIMEOUT_MS / 1000} s`)));
    try {
      return await Promise.race([answer, calledOff]);
    } finally {
      expiry.cancel();
      grace?.cancel();
      judging = null;
    }
  };

  /** Records what holds for the team as it is now: a member that changed or left meanwhile is not recorded. */
  const record = (judged: JudgeTarget, stages: Readonly<Record<string, FlowStage[]>>) => {
    const { section } = judged;
    const asked = new Map(judged.members.map((member) => [member.id, profileOf(member)]));
    const unchanged = (target: JudgeTarget, memberId: string) =>
      Object.hasOwn(stages, memberId) && asked.get(memberId) === profileOf(target.members.find((member) => member.id === memberId)!);
    const before = targetOf(section);
    if (!before) return;
    const settled = judgeable(before).filter((memberId) => unchanged(before, memberId));
    if (settled.length) {
      recording = true;
      try {
        deps.record(section, Object.fromEntries(settled.map((memberId) => [memberId, stages[memberId]!])));
      } catch (error) {
        log(`the stages of "${section}" could not be recorded (${reasonOf(error)})`);
      } finally {
        recording = false;
      }
    }
    const left = targetOf(section);
    if (!left) return;
    const ask = askOf(left);
    if (judgeable(left).every((memberId) => settled.includes(memberId) && unchanged(left, memberId))) answered.set(section, ask);
    else settle(section, ask);
  };

  const run = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length && !stopped) {
        await modelSlot();
        const section = queue.shift();
        const target = section === undefined || stopped ? undefined : targetOf(section);
        if (!target) continue;
        const started = now();
        const judged = await judgement(target);
        if (stopped) return;
        if (judged?.way !== "keywords") modelStarts.push(started);
        record(target, Object.fromEntries(judgeable(target).map((memberId) => [memberId, judgedStages(judged?.stages[memberId])])));
      }
    } finally {
      running = false;
    }
  };

  const unsubscribe = deps.onChange(look);
  const first = after(TEAM_JUDGE_START_DELAY_MS, look);

  return () => {
    stopped = true;
    unsubscribe();
    first.cancel();
    pause?.cancel();
    for (const entry of settling.values()) entry.timer.cancel();
    settling.clear();
    queue.length = 0;
    judging?.stop.abort(new Error("stopped"));
  };
}
