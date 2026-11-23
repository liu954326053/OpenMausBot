import { Check, Clapperboard, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardAction, CardName, CardShell, clockLength, failureText, InlineVideo, PicturePlaceholder, shotCode, type BoardGeneration } from "./parts";

/** One video made of a shot. */
export interface BoardTake {
  id: string;
  videoUrl?: string;
  posterUrl?: string;
  /** The take that goes to post. */
  selected?: boolean;
  durationMs?: number;
}

export interface ResultCardProps {
  number: number;
  title: string;
  /** Oldest first. */
  takes: readonly BoardTake[];
  /** How its newest take is being made. */
  generation?: BoardGeneration;
  onOpen?: () => void;
  onGenerate?: () => void;
  onPlay?: (takeId: string) => void;
  onSelectTake?: (takeId: string) => void;
}

export function ResultCard({ number, title, takes, generation, onOpen, onGenerate, onPlay, onSelectTake }: ResultCardProps) {
  const [shownId, setShownId] = useState<string>();
  const take = takes.find((one) => one.id === shownId) ?? takes.find((one) => one.selected) ?? takes.at(-1);
  const making = generation?.status === "loading";
  const failed = generation?.status === "error";
  const code = shotCode(number);
  const name = `${code} ${title}`;
  return (
    <CardShell kind="result" label={name} tone={failed ? "failed" : undefined} onOpen={onOpen}>
      <div data-result-media="" className="relative h-[168px] shrink-0">
        {take?.videoUrl ? (
          <InlineVideo src={take.videoUrl} posterUrl={take.posterUrl} label={t("boardCards.result.play", { name })} onPlay={() => onPlay?.(take.id)} className="size-full" />
        ) : making ? (
          <PicturePlaceholder>{t("boardCards.generating")}</PicturePlaceholder>
        ) : failed && !take ? (
          <PicturePlaceholder>
            <span data-result-failure="" title={failureText(generation)} className="line-clamp-3 text-danger">{failureText(generation)}</span>
            {onGenerate ? <CardAction label={t("boardCards.generateAgain")} onClick={onGenerate} /> : null}
          </PicturePlaceholder>
        ) : (
          <PicturePlaceholder>
            <Clapperboard size={14} aria-hidden="true" />
            <span>{t("boardCards.video.none")}</span>
            {onGenerate ? <CardAction icon={<Sparkles size={14} aria-hidden="true" />} label={t("boardCards.video.generate")} onClick={onGenerate} /> : null}
          </PicturePlaceholder>
        )}
        {take && making ? <span data-result-generating="" className="ui-chip absolute left-2 top-2 bg-card text-ink-secondary">{t("boardCards.generating")}</span> : null}
        {take && failed ? (
          <span data-result-failure="" title={failureText(generation)} className="absolute inset-x-2 bottom-2 truncate rounded-md bg-card px-2 py-1 text-[12px] leading-4 text-danger">{failureText(generation)}</span>
        ) : null}
      </div>
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <span data-shot-code="" className="ui-chip shrink-0 bg-control font-mono text-ink-secondary">{code}</span>
        <CardName text={title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6" />
        {takes.length > 0 ? <span data-result-count="" className="shrink-0 text-[12px] leading-4 text-ink-tertiary">{t("boardCards.result.takes", { count: takes.length })}</span> : null}
        {take?.durationMs ? <span data-result-length="" className="shrink-0 text-[12px] leading-4 text-ink-tertiary tabular-nums">{clockLength(take.durationMs)}</span> : null}
      </header>
      <footer className="mt-auto flex min-w-0 items-center gap-2 px-3 pb-3 pt-2">
        {takes.length > 0 ? (
          <>
            <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
              {takes.map((one, index) => (
                <button
                  key={one.id}
                  type="button"
                  data-result-take=""
                  aria-pressed={one.id === take?.id}
                  title={t("boardCards.result.take", { n: index + 1 })}
                  className={cn("h-6 min-w-7 shrink-0 rounded-md px-1.5 font-mono text-[12px]", one.id === take?.id ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setShownId(one.id);
                  }}
                >
                  {`V${index + 1}`}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <span className="flex-1" />
        {take?.selected ? (
          <span data-result-selected="" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-4 text-success">
            <Check size={14} aria-hidden="true" />
            {t("boardCards.result.inFilm")}
          </span>
        ) : take && onSelectTake ? (
          <CardAction label={t("boardCards.result.select")} onClick={() => onSelectTake(take.id)} />
        ) : null}
        {take && onGenerate && !making ? (
          <button
            type="button"
            aria-label={t("boardCards.generateAgain")}
            title={t("boardCards.generateAgain")}
            className="ui-button ui-button-sm shrink-0 px-1.5"
            onClick={(event) => {
              event.stopPropagation();
              onGenerate();
            }}
          >
            <Sparkles size={14} aria-hidden="true" />
          </button>
        ) : null}
      </footer>
    </CardShell>
  );
}
