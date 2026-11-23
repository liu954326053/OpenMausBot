import { RotateCcw } from "lucide-react";
import { episodeCode, type ProductionEpisodeWire } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BotChip, CardAction, CardName, CardShell, StatusMark, type BoardBotRef } from "./parts";
import { episodeStatus } from "./tone";

export interface EpisodeCardProps {
  /** The production's episode, or just its number and title for a script the production has not opened. */
  episode: Pick<ProductionEpisodeWire, "episode" | "title"> & Partial<ProductionEpisodeWire>;
  logline?: string;
  /** The script's text; the card shows its first lines. */
  text?: string;
  /** The bot the episode went to. */
  to?: BoardBotRef;
  onOpen?: () => void;
  onRetry?: () => void;
}

export function EpisodeCard({ episode, logline, text, to, onOpen, onRetry }: EpisodeCardProps) {
  const status = episodeStatus(episode.status);
  const shots = episode.shots ?? 0;
  const script = text?.trim();
  return (
    <CardShell kind="episode" label={`${episodeCode(episode.episode)} ${episode.title}`} tone={status?.tone} onOpen={onOpen}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <span data-episode-code="" className="ui-chip shrink-0 bg-control font-mono text-ink-secondary">{episodeCode(episode.episode)}</span>
        <CardName text={episode.title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6" />
        {status ? <StatusMark status={status} /> : null}
      </header>
      {logline?.trim() ? (
        <p data-episode-logline="" dir="auto" title={logline} className="line-clamp-2 px-3 pt-2 text-[13px] font-medium leading-[18px] text-ink-secondary">{logline}</p>
      ) : null}
      <p data-episode-text="" dir="auto" className={cn("min-h-0 flex-1 overflow-hidden whitespace-pre-line px-3 pt-2 text-[12px] leading-[18px]", script ? "text-ink-tertiary" : "text-ink-tertiary/70")}>
        {script ? text : t("boardCards.episode.noText")}
      </p>
      {shots > 0 || to || (status?.tone === "failed" && onRetry) ? (
        <footer className="flex min-w-0 items-center gap-3 px-3 pb-3 pt-2">
          {shots > 0 ? (
            <span data-episode-shots="" className="shrink-0 text-[12px] leading-4 text-ink-secondary tabular-nums">
              {t("boardCards.episode.shotsReady", { ready: episode.ready ?? 0, shots })}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 justify-end">{to ? <BotChip bot={to} label={t("boardCards.episode.to", { name: to.name })} /> : null}</span>
          {status?.tone === "failed" && onRetry ? <CardAction icon={<RotateCcw size={14} aria-hidden="true" />} label={t("boardCards.retry")} onClick={onRetry} /> : null}
        </footer>
      ) : <div className="h-3 shrink-0" />}
    </CardShell>
  );
}
