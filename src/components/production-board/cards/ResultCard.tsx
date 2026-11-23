import { Check, Clapperboard, Sparkles } from "lucide-react";
import { useId, useRef, useState } from "react";
import { shotCode } from "../../../../shared/production";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardAction, CardName, CardShell, clockLength, failureText, InlineVideo, PicturePlaceholder, StaleMark, type BoardGeneration } from "./parts";

/** One video made of a shot. */
export interface BoardTake {
  id: string;
  videoUrl?: string;
  posterUrl?: string;
  /** The take that goes to post. */
  selected?: boolean;
  durationMs?: number;
  /** The take node's `metadata.stale`. */
  stale?: boolean;
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

const TAKE_BUTTONS_MAX = 4;

/** All the takes when they fit; else the selected, the shown and the newest, then the newest of the rest, leaving room
 * for the button that opens the others. */
function takesInView(takes: readonly BoardTake[], shown: BoardTake | undefined): Set<string> {
  if (takes.length <= TAKE_BUTTONS_MAX) return new Set(takes.map((one) => one.id));
  const inView = new Set([takes.find((one) => one.selected), shown].flatMap((one) => (one ? [one.id] : [])));
  for (let index = takes.length - 1; index >= 0 && inView.size < TAKE_BUTTONS_MAX - 1; index -= 1) inView.add(takes[index]!.id);
  return inView;
}

function TakeButton({ index, pressed, onShow }: { index: number; pressed: boolean; onShow: () => void }) {
  return (
    <button
      type="button"
      data-result-take=""
      aria-pressed={pressed}
      title={t("boardCards.result.take", { n: index + 1 })}
      className={cn("h-6 min-w-7 shrink-0 rounded-full px-1.5 font-mono text-[12px]", pressed ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink")}
      onClick={(event) => {
        event.stopPropagation();
        onShow();
      }}
    >
      {`V${index + 1}`}
    </button>
  );
}

function TakeStrip({ takes, shown, onShow }: { takes: readonly BoardTake[]; shown: BoardTake | undefined; onShow: (takeId: string) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  const inView = takesInView(takes, shown);
  const others = takes.flatMap((one, index) => (inView.has(one.id) ? [] : [{ one, index }]));
  const showOther = (takeId: string) => {
    onShow(takeId);
    setOpen(false);
    moreRef.current?.focus();
  };
  return (
    <div data-result-strip="" className="flex min-w-0 items-center gap-0.5">
      {takes.map((one, index) => (inView.has(one.id) ? <TakeButton key={one.id} index={index} pressed={one.id === shown?.id} onShow={() => onShow(one.id)} /> : null))}
      {others.length ? (
        <div ref={rootRef} className="contents">
          <button
            ref={moreRef}
            type="button"
            data-result-more=""
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t("boardCards.result.moreTakes", { count: others.length })}
            title={t("boardCards.result.moreTakes", { count: others.length })}
            className={cn("h-6 min-w-7 shrink-0 rounded-full px-1.5 font-mono text-[12px]", open ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink")}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((was) => !was);
            }}
          >
            {`+${others.length}`}
          </button>
          <div
            id={panelId}
            role="group"
            aria-label={t("boardCards.result.otherTakes")}
            hidden={!open}
            className="popover-surface absolute bottom-full start-3 mb-1 flex w-max max-w-[calc(100%-1.5rem)] flex-wrap gap-0.5 rounded-lg p-1"
            onKeyDown={(event) => {
              if (event.key === "Escape") moreRef.current?.focus();
            }}
          >
            {others.map(({ one, index }) => <TakeButton key={one.id} index={index} pressed={false} onShow={() => showOther(one.id)} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
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
      <div data-result-media="" className="relative h-42 shrink-0">
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
        {take && making ? <span data-result-generating="" className="ui-chip absolute start-2 top-2 bg-card text-ink-secondary">{t("boardCards.generating")}</span> : null}
        {take?.stale ? <StaleMark reason={t("boardCards.stale.take")} className="absolute end-2 top-2 bg-card text-ink-secondary" /> : null}
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
      <footer className="relative mt-auto flex min-w-0 items-center gap-2 px-3 pb-3 pt-2">
        {takes.length > 0 ? <TakeStrip takes={takes} shown={take} onShow={setShownId} /> : null}
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
