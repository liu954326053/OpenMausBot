import { Layers } from "lucide-react";
import { Fragment } from "react";
import { episodeCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import { CardName, CardShell } from "./parts";
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
    <CardShell kind="episodeStack" label={title} onOpen={onOpen}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <Layers size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <span data-stack-range="" className="shrink-0 font-mono text-[12px] leading-4 text-ink-secondary">{`${episodeCode(first)} – ${episodeCode(last)}`}</span>
      </header>
      <CardName text={title} onOpen={onOpen} className="mx-3 pt-1 text-[17px] font-semibold leading-6" />
      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-3 pt-2">
        {titles.map((item, index) => (
          <Fragment key={item.episode}>
            {index > 0 && item.episode > titles[index - 1]!.episode + 1 ? <li data-stack-item="" aria-hidden="true" className="text-[12px] leading-4 text-ink-tertiary">···</li> : null}
            <li data-stack-item="" className="flex min-w-0 items-baseline gap-2 text-[12px] leading-4">
              <span className="shrink-0 font-mono text-ink-tertiary">{episodeCode(item.episode)}</span>
              <span dir="auto" title={item.title} className="min-w-0 truncate text-ink-secondary">{item.title}</span>
            </li>
          </Fragment>
        ))}
      </ol>
      {sums.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-3 pt-2">
          {sums.map((sum) => (
            <span key={sum.key} data-stack-status={sum.key} className="inline-flex items-center gap-1.5 text-[12px] leading-4 text-ink-secondary tabular-nums">
              <span aria-hidden="true" className={`size-2 rounded-full ${TONE_DOT[sum.tone]}`} />
              {t(`boardCards.stack.${sum.key}`, { count: sum.count })}
            </span>
          ))}
        </footer>
      ) : <div className="h-3 shrink-0" />}
    </CardShell>
  );
}
