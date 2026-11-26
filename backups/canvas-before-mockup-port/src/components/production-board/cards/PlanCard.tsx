import type { ProductionJob, ProductionTaskStatus } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardName, CardShell, PAPER_FOOT_RULE, PAPER_HEAD_RULE, PaperBotChip, StatusStamp, type BoardBotRef } from "./parts";
import { taskStatus } from "./tone";

export interface PlanTask {
  job: ProductionJob;
  status: ProductionTaskStatus;
  bot?: BoardBotRef;
  /** How many things the task makes, when that is known: episodes, characters, scenes. */
  count?: number;
}

export interface PlanCardProps {
  /** In the plan's order: the whole-drama jobs, then the per-episode ones. */
  tasks: readonly PlanTask[];
  onOpen?: () => void;
}

const SIDE_BY_SIDE: ReadonlySet<ProductionJob> = new Set(["character", "scene"]);

export function PlanCard({ tasks, onOpen }: PlanCardProps) {
  const title = t("boardCards.plan.title");
  const done = tasks.filter((task) => task.status === "done").length;
  return (
    <CardShell kind="plan" label={title} surface="paper" onOpen={onOpen}>
      <header className={cn("flex items-baseline gap-2 px-4 pb-2.5 pt-3", PAPER_HEAD_RULE)}>
        <span data-plan-code="" className="shrink-0 font-mono text-[12px] leading-4 text-board-ink-3">TASKS</span>
        <CardName text={title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6 text-board-ink" />
        <span data-plan-count="" className="shrink-0 font-mono text-[12px] leading-4 text-board-ink-3 tabular-nums">{`${done} / ${tasks.length}`}</span>
      </header>
      <ol className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1">
        {tasks.map((task, index) => {
          const status = taskStatus(task.status)!;
          const name = t(`boardCards.plan.job.${task.job}`);
          return (
            <li key={task.job} data-plan-task={task.job} data-task-status={status.tone} className="flex min-w-0 items-center gap-2 border-b border-dashed border-board-paper-line px-1 py-2.5 last:border-b-0">
              <StatusStamp status={status} />
              <span data-task-code="" className="w-5 shrink-0 font-mono text-[12px] leading-4 text-board-ink-3">{`T${index + 1}`}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span data-task-name="" title={name} className="min-w-0 truncate text-[13px] font-medium leading-[18px] text-board-ink">
                  {task.count === undefined ? name : `${name} ×${task.count}`}
                </span>
                {SIDE_BY_SIDE.has(task.job) ? (
                  <span data-task-parallel="" className="inline-flex h-5 shrink-0 items-center rounded border border-board-ink-3 px-1.5 text-[12px] leading-4 text-board-ink-2">{t("boardCards.plan.peer")}</span>
                ) : null}
              </span>
              {task.bot ? <PaperBotChip bot={task.bot} /> : <span data-task-nobody="" className="shrink-0 text-[12px] leading-4 text-board-ink-3">{t("boardCards.plan.nobody")}</span>}
            </li>
          );
        })}
      </ol>
      <footer className={cn("px-4 pb-3 pt-2 text-[12px] leading-4 text-board-ink-3", PAPER_FOOT_RULE)}>{t("boardCards.plan.gate")}</footer>
    </CardShell>
  );
}
