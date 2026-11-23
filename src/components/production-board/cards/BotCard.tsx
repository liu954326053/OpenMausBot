import { Check, Circle, CircleDot, Crown, RotateCcw } from "lucide-react";
import { episodeCode, isEpisodeJob, type ProductionJob, type ProductionTaskStatus } from "../../../../shared/production";
import type { CanvasBotState } from "../../../../shared/project-canvas";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/clock-time";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { CardAction, CardLabel, CardName, CardShell, Meter, percentOf, StatusMark } from "./parts";
import { botStatus } from "./tone";

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

export interface BotCardProps {
  bot: CanvasBotState;
  look?: CanvasBotLook;
  /** Its job in the production, when the plan gave it one. */
  job?: ProductionJob;
  /** How that job's task stands: the whole-drama job's, or the task of its episode. */
  task?: ProductionTaskStatus;
  progress?: BoardProgress;
  /** Its newest steps, oldest first; the card shows the last four. */
  steps?: readonly BoardStep[];
  onOpen?: () => void;
  onRetry?: () => void;
}

const STEPS_SHOWN = 4;
const SILVER: CanvasBotLook = { color: "silver" };

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

export function BotCard({ bot, look, job, task, progress, steps, onOpen, onRetry }: BotCardProps) {
  const status = botStatus(bot, task);
  const name = ownName(bot.name, bot.episode);
  const planned = taskText(bot, job);
  const doing = bot.status === "working" ? bot.doing?.trim() : undefined;
  const current = planned ?? doing ?? t("boardCards.bot.noTask");
  const progressLabel = progress ? t(`boardCards.progress.${progress.kind}`, { done: progress.done, total: progress.total }) : "";
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

      {steps?.length ? (
        <ol aria-label={t("boardCards.bot.steps")} className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-3 pt-3">
          {steps.slice(-STEPS_SHOWN).map((step, index) => (
            <li key={index} data-step={step.state} className={cn("flex items-start gap-2 text-[12px] leading-4", step.state === "waiting" ? "text-ink-tertiary" : step.state === "working" ? "text-ink" : "text-ink-secondary")}>
              {STEP_ICON[step.state]}
              <span data-step-text="" dir="auto" title={step.text} className="min-w-0 flex-1 truncate">{step.text}</span>
              {step.at !== undefined ? <time dateTime={new Date(step.at).toISOString()} className="shrink-0 text-ink-tertiary tabular-nums">{formatTime(step.at)}</time> : null}
            </li>
          ))}
        </ol>
      ) : <div className="flex-1" />}

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
