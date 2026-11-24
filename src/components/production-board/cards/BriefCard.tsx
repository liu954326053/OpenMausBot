import { Check, FileText } from "lucide-react";
import { formatTime } from "@/lib/clock-time";
import { t } from "@/lib/i18n";
import { CardName, CardShell } from "./parts";

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
    <CardShell kind="brief" label={name} onOpen={onOpen}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <FileText size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <CardName text={name} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6" />
        {agreed ? (
          <span data-brief-agreed="" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-4 text-success">
            <Check size={14} aria-hidden="true" />
            {t("boardCards.brief.agreed")}
          </span>
        ) : null}
      </header>
      {rows.length > 0 ? (
        <dl data-canvas-scroll="" className="min-h-0 flex-1 overflow-y-auto px-3 pb-1 pt-2">
          {rows.map(([label, value], index) => (
            <div key={index} data-brief-row="" className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-1 text-[13px] leading-[18px]">
              <dt dir="auto" title={label} className="truncate text-ink-tertiary">{label}</dt>
              <dd dir="auto" title={value} className="line-clamp-2 text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p data-brief-text="" dir="auto" className="min-h-0 flex-1 overflow-hidden whitespace-pre-line px-3 pt-2 text-[13px] leading-[18px] text-ink-secondary">
          {text?.trim() || t("boardCards.brief.empty")}
        </p>
      )}
      {written ? <footer data-brief-by="" className="truncate px-3 pb-3 pt-2 text-[12px] leading-4 text-ink-tertiary">{written}</footer> : <div className="h-3 shrink-0" />}
    </CardShell>
  );
}
