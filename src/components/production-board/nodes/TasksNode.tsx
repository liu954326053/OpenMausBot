import { Check, CircleDashed, LoaderCircle, X, type LucideIcon } from "lucide-react";
import type { ProductionJob, ProductionTaskStatus } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import { taskStatus } from "@/lib/production-board/status";
import type { BoardPlanCard } from "@/lib/production-board/types";
import { BotButton, Ic, timeOfDay, type NodeContext } from "./parts";

const ROW: Readonly<Record<ProductionTaskStatus, { s: string; icon: LucideIcon }>> = {
  done: { s: "done", icon: Check },
  working: { s: "run", icon: LoaderCircle },
  waiting: { s: "wait", icon: CircleDashed },
  failed: { s: "failed", icon: X },
};

const PARALLEL: ReadonlySet<ProductionJob> = new Set(["script", "character", "scene"]);

export function TasksNode({ card, ctx }: { card: BoardPlanCard; ctx: NodeContext }) {
  const done = card.tasks.filter((task) => task.status === "done").length;
  const lead = Object.values(ctx.snapshot.bots).find((bot) => bot.lead || bot.botId === ctx.snapshot.project.leadBotId);
  const split = lead ? [t("boardCards.brief.by", { name: lead.name }), ...(card.plannedAt === undefined ? [] : [timeOfDay(card.plannedAt)])].join(" · ") : "";
  return (
    <>
      <header className="pp-head">
        <span className="mono">TASKS</span>
        <h3>{card.title.trim() || t("boardCards.plan.title")}</h3>
        <span className="mono">{`${done} / ${card.tasks.length}`}</span>
      </header>
      <ol className="tk">
        {card.tasks.map((task, index) => {
          const row = ROW[task.status];
          const name = t(`boardCards.plan.job.${task.job}`);
          return (
            <li key={task.job} data-s={row.s}>
              <span className="tk-ic" role="img" aria-label={taskStatus(task.status)!.label}>
                <Ic icon={row.icon} className={task.status === "working" ? "spin" : undefined} />
              </span>
              <span className="mono">{`T${index + 1}`}</span>
              <span className="tk-t">
                {task.count === undefined ? name : `${name} ×${task.count}`}
                {PARALLEL.has(task.job) ? <em>{t("boardCards.plan.peer")}</em> : null}
              </span>
              {task.botId ? <BotButton botId={task.botId} ctx={ctx} /> : null}
            </li>
          );
        })}
      </ol>
      <footer className="pp-foot">
        <span>{split}</span>
        <span>{t("boardCards.plan.foot")}</span>
      </footer>
    </>
  );
}
