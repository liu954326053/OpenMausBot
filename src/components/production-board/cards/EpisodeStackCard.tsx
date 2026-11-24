import { Fragment } from "react";
import { episodeCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardName, CardShell, PAPER_FOOT_RULE, PAPER_HEAD_RULE, PaperCode, ScriptHoles } from "./parts";
import { TONE_DOT, type BoardTone } from "./tone";

export interface EpisodeStackCardProps {
  first: number;
  last: number;
  count: number;
  /** A few of its episodes' titles, in order. */
  titles: readonly { episode: number; title: string }[];
  statuses?: Partial<Record<ProductionEpisodeStatus, number>>;
  onOpen?: () => void;
}

const SUMMED: ReadonlyArray<{ key: "done" | "working" | "waiting" | "failed"; tone: BoardTone; of: readonly ProductionEpisodeStatus[] }> = [
  { key: "done", tone: "done", of: ["done"] },
  { key: "working", tone: "working", of: ["storyboard", "videos", "post"] },
  { key: "waiting", tone: "idle", of: ["waiting"] },
  { key: "failed", tone: "failed", of: ["failed"] },
];

export function EpisodeStackCard({ first, last, count, titles, statuses, onOpen }: EpisodeStackCardProps) {
  const title = t("boardCards.stack.more", { count });
  const sums = statuses ? SUMMED.map((sum) => ({ ...sum, count: sum.of.reduce((total, status) => total + (statuses[status] ?? 0), 0) })).filter((sum) => sum.count > 0) : [];
  return (
    <CardShell kind="episodeStack" label={title} surface="paper" className="board-paper-stack" onOpen={onOpen}>
      <ScriptHoles />
      <header className={cn("flex min-w-0 items-center gap-2 pe-3.5 ps-7 pb-2 pt-2.5", PAPER_HEAD_RULE)}>
        <span data-stack-range=""><PaperCode text={`${episodeCode(first)} – ${episodeCode(last)}`} /></span>
        <CardName text={title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6 text-board-ink" />
      </header>
      <ol className="flex min-h-0 flex-1 flex-col justify-start gap-1 overflow-hidden px-3.5 ps-7 pt-1">
        {titles.map((item, index) => (
          <Fragment key={item.episode}>
            {index > 0 && item.episode > titles[index - 1]!.episode + 1 ? <li data-stack-item="" aria-hidden="true" className="ps-14 text-[12px] leading-4 text-board-ink-3">···</li> : null}
            <li data-stack-item="" className="flex min-w-0 items-baseline gap-2 border-b border-dashed border-board-paper-line py-1 text-[13px] leading-[18px] last:border-b-0">
              <span className="w-12 shrink-0 font-mono text-[12px] text-board-ink-3">{episodeCode(item.episode)}</span>
              <span dir="auto" title={item.title} className="min-w-0 truncate text-board-ink-2">{item.title}</span>
            </li>
          </Fragment>
        ))}
      </ol>
      <footer className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 ps-7 pb-2.5 pt-1.5", PAPER_FOOT_RULE)}>
        {sums.length > 0 ? sums.map((sum) => (
          <span key={sum.key} data-stack-status={sum.key} className="inline-flex items-center gap-1.5 text-[12px] leading-4 text-board-ink-2 tabular-nums">
            <span aria-hidden="true" className={`size-2 rounded-full ${TONE_DOT[sum.tone]}`} />
            {t(`boardCards.stack.${sum.key}`, { count: sum.count })}
          </span>
        )) : <span />}
      </footer>
    </CardShell>
  );
}
