import { formatTime } from "@/lib/clock-time";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardName, CardShell, PAPER_FOOT_RULE, PAPER_HEAD_RULE, PaperStamp } from "./parts";

export interface BriefCardProps {
  title?: string;
  /** The brief's lines, each a label and its value, as the lead agreed them with the person. */
  rows: readonly (readonly [label: string, value: string])[];
  /** What the card shows when the brief has no lines. */
  text?: string;
  agreed?: boolean;
  by?: string;
  at?: number;
  onOpen?: () => void;
}

export function BriefCard({ title, rows, text, agreed = true, by, at, onOpen }: BriefCardProps) {
  const name = title?.trim() || t("boardCards.brief.title");
  const written = by ? [t("boardCards.brief.by", { name: by }), at === undefined ? null : formatTime(at)].filter(Boolean).join(" · ") : null;
  return (
    <CardShell kind="brief" label={name} surface="paper" onOpen={onOpen}>
      <header className={cn("flex items-baseline gap-2 px-4 pb-2.5 pt-3", PAPER_HEAD_RULE)}>
        <span data-brief-code="" className="shrink-0 font-mono text-[12px] leading-4 text-board-ink-3">REQ-001</span>
        <CardName text={name} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6 text-board-ink" />
        <span data-brief-version="" className="shrink-0 font-mono text-[12px] leading-4 text-board-ink-3">v1</span>
      </header>
      {rows.length > 0 ? (
        <dl data-canvas-scroll="" className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
          {rows.map(([label, value], index) => (
            <div key={index} data-brief-row="" className="flex gap-3 border-b border-dashed border-board-paper-line py-2 text-[13px] leading-[18px] last:border-b-0">
              <dt dir="auto" title={label} className="w-10 shrink-0 truncate text-board-ink-3">{label}</dt>
              <dd dir="auto" title={value} className="line-clamp-2 min-w-0 flex-1 font-medium text-board-ink">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p data-brief-text="" dir="auto" className="min-h-0 flex-1 overflow-hidden whitespace-pre-line px-4 pt-2 text-[13px] leading-[18px] text-board-ink-2">
          {text?.trim() || t("boardCards.brief.empty")}
        </p>
      )}
      <footer className={cn("flex items-center justify-between gap-2 px-4 pb-3 pt-2", PAPER_FOOT_RULE)}>
        {written ? <span data-brief-by="" className="min-w-0 truncate text-[12px] leading-4 text-board-ink-3">{written}</span> : <span />}
        {agreed ? <PaperStamp label={t("boardCards.brief.agreed")} /> : null}
      </footer>
    </CardShell>
  );
}
