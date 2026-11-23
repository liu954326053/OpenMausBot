import { Check, Circle, CircleDot, Crown, RotateCcw } from "lucide-react";
import { episodeCode, isEpisodeJob, type ProductionJob, type ProductionTaskStatus } from "../../../../shared/production";
import type { CanvasBotState } from "../../../../shared/project-canvas";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/clock-time";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { CardAction, CardLabel, CardName, CardShell, Meter, percentOf, SILVER, StatusMark } from "./parts";
import { botStatus, TONE_TEXT } from "./tone";

export type BoardProgressKind = "tasks" | "episodes" | "characters" | "scenes" | "videos";

/** How far a bot's job has come: for the lead its tasks, for the script bot its episodes, for an episode's bots its
 * shots' videos. */
export interface BoardProgress {
  kind: BoardProgressKind;
  done: number;
  total: number;
}

export interface BoardStep {
  text: string;
  state: "done" | "working" | "waiting";
  at?: number;
}

/** The ones made of a whole. */
export interface BoardCount {
  done: number;
  total: number;
}

/** What an episode's storyboard bot waits for before it starts. A condition the production does not wait for is left
 * out. */
export interface BoardGate {
  /** The drama's characters that are ready, of all of them. */
  characters?: BoardCount;
  scenes?: BoardCount;
  /** Its episode's script is written. */
  script?: boolean;
}

export interface BotCardProps {
  bot: CanvasBotState;
  look?: CanvasBotLook;
  /** Its job in the production, when the plan gave it one. */
  job?: ProductionJob;
  /** How that job's task stands: the whole-drama job's, or the task of its episode. */
  task?: ProductionTaskStatus;
  progress?: BoardProgress;
  /** Its newest steps, oldest first; the card shows the last four, or as many of them as fit. */
  steps?: readonly BoardStep[];
  /** For an episode's storyboard bot. */
  gate?: BoardGate;
  onOpen?: () => void;
  onRetry?: () => void;
}

const STEPS_SHOWN = 4;

/** An episode's bot is named after its source with the episode's code; the card shows the code apart. */
function ownName(name: string, episode: number | undefined): string {
  if (episode === undefined) return name;
  const code = ` ${episodeCode(episode)}`;
  return name.endsWith(code) && name.length > code.length ? name.slice(0, -code.length) : name;
}

function taskText(bot: CanvasBotState, job: ProductionJob | undefined): string | null {
  if (job && isEpisodeJob(job)) {
    return bot.episode === undefined ? t(`boardCards.plan.job.${job}`) : t(`boardCards.bot.task.${job}`, { episode: episodeCode(bot.episode) });
  }
  if (job) return t(`boardCards.bot.task.${job}`);
  if (bot.lead) return t("boardCards.bot.task.lead");
  return null;
}

const STEP_ICON = {
  done: <Check size={14} aria-hidden="true" className="mt-px shrink-0 text-success" />,
  working: <CircleDot size={14} aria-hidden="true" className="mt-px shrink-0 text-accent-text" />,
  waiting: <Circle size={14} aria-hidden="true" className="mt-px shrink-0 text-ink-tertiary" />,
};

interface GateItem {
  key: "characters" | "scenes" | "script";
  value: string;
  ready: boolean;
}

function gateItems(gate: BoardGate, episode: number | undefined): GateItem[] {
  const counted = (key: "characters" | "scenes", count: BoardCount | undefined): GateItem[] =>
    count ? [{ key, value: `${count.done}/${count.total}`, ready: count.total > 0 && count.done >= count.total }] : [];
  const script: GateItem[] = gate.script === undefined ? [] : [{ key: "script", value: episode === undefined ? "" : episodeCode(episode), ready: gate.script }];
  return [...counted("characters", gate.characters), ...counted("scenes", gate.scenes), ...script];
}

function GateTags({ gate, episode }: { gate: BoardGate; episode: number | undefined }) {
  return (
    <ul data-bot-gate="" aria-label={t("boardCards.gate.label")} className="flex min-w-0 gap-1 px-3 pt-2.5">
      {gateItems(gate, episode).map(({ key, value, ready }) => {
        const label = t(`boardCards.gate.${key}`);
        const state = ready ? t("boardCards.gate.ready") : t("boardCards.gate.notReady");
        return (
          <li
            key={key}
            data-gate-item={key}
            data-gate-ready={String(ready)}
            title={`${[label, value].filter(Boolean).join(" ")} · ${state}`}
            className={cn("ui-chip px-1.5", ready ? "bg-success/10" : "bg-control", TONE_TEXT[ready ? "done" : "idle"])}
          >
            {ready ? <Check size={14} aria-hidden="true" className="shrink-0" /> : <Circle size={14} aria-hidden="true" className="shrink-0" />}
            <span data-gate-label="" className="min-w-0 truncate">{label}</span>
            {value ? <span data-gate-value="" className="shrink-0 font-mono">{value}</span> : null}
            <span className="sr-only">{state}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The steps, as many as fit whole, the newest kept. */
function Steps({ steps }: { steps: readonly BoardStep[] }) {
  return (
    <ol aria-label={t("boardCards.bot.steps")} className="flex min-h-0 flex-1 flex-col-reverse flex-wrap content-start justify-end gap-x-4 gap-y-1 overflow-hidden px-3 pt-3">
      {steps.map((step, index) => (
        <li key={index} data-step={step.state} style={{ order: steps.length - index }} className={cn("flex w-full items-start gap-2 text-[12px] leading-4", step.state === "waiting" ? "text-ink-tertiary" : step.state === "working" ? "text-ink" : "text-ink-secondary")}>
          {STEP_ICON[step.state]}
          <span data-step-text="" dir="auto" title={step.text} className="min-w-0 flex-1 truncate">{step.text}</span>
          {step.at !== undefined ? <time dateTime={new Date(step.at).toISOString()} className="shrink-0 text-ink-tertiary tabular-nums">{formatTime(step.at)}</time> : null}
        </li>
      ))}
    </ol>
  );
}

export function BotCard({ bot, look, job, task, progress, steps, gate, onOpen, onRetry }: BotCardProps) {
  const status = botStatus(bot, task);
  const name = ownName(bot.name, bot.episode);
  const planned = taskText(bot, job);
  const doing = bot.status === "working" ? bot.doing?.trim() : undefined;
  const current = planned ?? doing ?? t("boardCards.bot.noTask");
  const progressLabel = progress ? t(`boardCards.progress.${progress.kind}`, { done: progress.done, total: progress.total }) : "";
  const reply = bot.output?.text.trim();
  return (
    <CardShell kind="bot" label={bot.name} tone={status.tone} onOpen={onOpen}>
      <header className="flex items-center gap-2.5 px-3 pt-3">
        <BotAvatar bot={{ name: bot.name, ...(look ?? SILVER) }} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <CardName data="bot-name" text={name} title={bot.name} onOpen={onOpen} className="text-[17px] font-semibold leading-6 text-ink" />
            {bot.episode !== undefined ? <span data-episode-code="" className="ui-chip shrink-0 bg-control font-mono text-ink-secondary">{episodeCode(bot.episode)}</span> : null}
            {bot.lead ? (
              <span data-bot-lead="" title={t("boardCards.bot.lead")} className="flex shrink-0 items-center text-ink-secondary">
                <Crown size={14} aria-hidden="true" />
                <span className="sr-only">{t("boardCards.bot.lead")}</span>
              </span>
            ) : null}
          </div>
          <div data-bot-title="" dir="auto" title={bot.title} className="truncate text-[12px] leading-4 text-ink-tertiary">{bot.title}</div>
        </div>
        <StatusMark status={status} className="self-start pt-1" />
      </header>

      {gate ? <GateTags gate={gate} episode={bot.episode} /> : null}

      <section className="flex flex-col gap-1.5 px-3 pt-3">
        <CardLabel>{t("boardCards.bot.currentTask")}</CardLabel>
        <p data-current-task="" dir="auto" title={current} className={cn("line-clamp-2 text-[13px] leading-[18px]", planned || doing ? "text-ink" : "text-ink-tertiary")}>{current}</p>
        {planned && doing ? <p data-bot-doing="" dir="auto" title={doing} className="truncate text-[12px] leading-4 text-ink-secondary">{doing}</p> : null}
        {progress ? (
          <div className="flex flex-col gap-1 pt-0.5">
            <Meter done={progress.done} total={progress.total} tone={status.tone} label={progressLabel} />
            <div data-progress="" className="flex items-center justify-between gap-2 text-[12px] leading-4 text-ink-tertiary tabular-nums">
              <span className="truncate">{progressLabel}</span>
              <span>{`${percentOf(progress.done, progress.total)}%`}</span>
            </div>
          </div>
        ) : null}
      </section>

      {!steps?.length && reply ? (
        <section className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-3 pt-3">
          <span data-bot-output-label=""><CardLabel>{t("boardCards.bot.output")}</CardLabel></span>
          <p data-bot-output="" dir="auto" title={reply} className={cn("whitespace-pre-line text-[12px] leading-4 text-ink-secondary", gate ? "line-clamp-2" : "line-clamp-3")}>{reply}</p>
        </section>
      ) : steps?.length ? <Steps steps={steps.slice(-STEPS_SHOWN)} /> : <div className="flex-1" />}

      {bot.waiting ? (
        <div data-bot-asking="" role="status" className="mx-3 mb-3 mt-2 flex items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium leading-4 text-warning">{t("boardCards.bot.asking")}</div>
            {bot.waiting.card.title ? <div dir="auto" title={bot.waiting.card.title} className="truncate text-[12px] leading-4 text-ink-secondary">{bot.waiting.card.title}</div> : null}
          </div>
          {onOpen ? <CardAction label={t("boardCards.bot.answer")} onClick={onOpen} /> : null}
        </div>
      ) : task === "failed" && onRetry ? (
        <footer className="flex justify-end px-3 pb-3 pt-2">
          <CardAction icon={<RotateCcw size={14} aria-hidden="true" />} label={t("boardCards.retry")} onClick={onRetry} />
        </footer>
      ) : <div className="h-3 shrink-0" />}
    </CardShell>
  );
}
