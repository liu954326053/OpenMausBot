import { Clock, RotateCcw } from "lucide-react";
import { episodeCode, type ProductionEpisodeWire } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardName, CardShell, clockLength, PAPER_FOOT_RULE, PAPER_HEAD_RULE, PaperBotChip, PaperButton, PaperCode, PaperStatus, ScriptHoles, type BoardBotRef } from "./parts";
import { episodeStatus } from "./tone";

export interface EpisodeCardProps {
  /** The production's episode, or just its number and title for a script the production has not opened. */
  episode: Pick<ProductionEpisodeWire, "episode" | "title"> & Partial<ProductionEpisodeWire>;
  logline?: string;
  /** The script's text; the card shows its first lines. */
  text?: string;
  /** The bot the episode went to. */
  to?: BoardBotRef;
  /** How long its shots run together. */
  seconds?: number;
  onOpen?: () => void;
  onRetry?: () => void;
}

export function EpisodeCard({ episode, logline, text, to, seconds, onOpen, onRetry }: EpisodeCardProps) {
  const status = episodeStatus(episode.status);
  const shots = episode.shots ?? 0;
  const script = text?.trim();
  return (
    <CardShell kind="episode" label={`${episodeCode(episode.episode)} ${episode.title}`} tone={status?.tone} surface="paper" onOpen={onOpen}>
      <ScriptHoles />
      <header className={cn("flex min-w-0 items-center gap-2 pe-3 ps-7 pb-2 pt-2.5", PAPER_HEAD_RULE)}>
        <span data-episode-code=""><PaperCode text={episodeCode(episode.episode)} /></span>
        <CardName text={episode.title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6 text-board-ink" />
        {status ? <PaperStatus status={status} className="max-w-[46%]" /> : null}
      </header>
      {logline?.trim() ? (
        <p data-episode-logline="" dir="auto" title={logline} className="line-clamp-2 px-3 ps-7 pt-2 text-[13px] font-medium leading-[18px] text-board-ink">{logline}</p>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden px-3 ps-7 pt-2">
        <p data-episode-text="" dir="auto" className={cn("whitespace-pre-line text-[12px] leading-[17px]", script ? "text-board-ink-2" : "text-board-ink-3")}>
          {script ? text : t("boardCards.episode.noText")}
        </p>
        {script ? <div data-episode-fade="" aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-board-paper to-transparent" /> : null}
      </div>
      <footer className={cn("flex min-w-0 items-center gap-2 pe-3 ps-7 pb-2.5 pt-1.5", PAPER_FOOT_RULE)}>
        {shots > 0 ? (
          <span data-episode-shots="" className="shrink-0 text-[12px] leading-4 text-board-ink-2 tabular-nums">
            {t("boardCards.episode.shotsReady", { ready: episode.ready ?? 0, shots })}
          </span>
        ) : null}
        {seconds ? (
          <span data-episode-length="" className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] leading-4 text-board-ink-3 tabular-nums">
            <Clock size={12} aria-label={t("boardCards.shot.length")} className="shrink-0" />
            {seconds < 60 ? t("boardCards.shot.seconds", { count: seconds }) : clockLength(seconds * 1000)}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 justify-end">{to ? <PaperBotChip bot={to} label={t("boardCards.episode.to", { name: to.name })} /> : null}</span>
        {status?.tone === "failed" && onRetry ? <PaperButton iconOnly icon={<RotateCcw size={12} aria-hidden="true" />} label={t("boardCards.retry")} onClick={onRetry} /> : null}
      </footer>
    </CardShell>
  );
}
