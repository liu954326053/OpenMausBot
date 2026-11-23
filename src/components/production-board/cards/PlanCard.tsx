import { ListChecks } from "lucide-react";
import type { ProductionJob, ProductionTaskStatus } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import { BotChip, CardName, CardShell, StatusMark, type BoardBotRef } from "./parts";
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
    <CardShell kind="plan" label={title} onOpen={onOpen}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <ListChecks size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <CardName text={title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6" />
        <span data-plan-count="" className="shrink-0 text-[12px] leading-4 text-ink-tertiary tabular-nums">{`${done} / ${tasks.length}`}</span>
      </header>
      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-3 pt-2">
        {tasks.map((task, index) => {
          const status = taskStatus(task.status)!;
          const name = t(`boardCards.plan.job.${task.job}`);
          return (
            <li key={task.job} data-plan-task={task.job} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 py-1">
              <span data-task-code="" className="font-mono text-[12px] leading-[18px] text-ink-tertiary">{`T${index + 1}`}</span>
              <div className="flex min-w-0 items-center gap-1.5">
                <span data-task-name="" title={name} className="min-w-0 truncate text-[13px] font-medium leading-[18px] text-ink">
                  {task.count === undefined ? name : `${name} ×${task.count}`}
                </span>
                {SIDE_BY_SIDE.has(task.job) ? <span data-task-parallel="" className="ui-chip shrink-0 bg-control text-ink-secondary">{t("boardCards.plan.parallel")}</span> : null}
              </div>
              <div className="col-start-2 flex min-w-0 items-center justify-between gap-2 pt-0.5">
                {task.bot ? <BotChip bot={task.bot} /> : <span data-task-nobody="" className="text-[12px] leading-4 text-ink-tertiary">{t("boardCards.plan.nobody")}</span>}
                <StatusMark status={status} />
              </div>
            </li>
          );
        })}
      </ol>
      <footer className="px-3 pb-3 pt-2 text-[12px] leading-4 text-ink-tertiary">{t("boardCards.plan.gate")}</footer>
    </CardShell>
  );
}
