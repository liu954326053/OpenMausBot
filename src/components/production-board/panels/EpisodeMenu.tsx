import { useEffect, useRef } from "react";
import { episodeCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { t } from "@/lib/i18n";
import { episodeStatus } from "@/lib/production-board/status";

/** The episodes that wait or are done: choosing a folded one unfolds it on the board, choosing an unfolded one folds it back. */
export function EpisodeMenu({ episodes, at, onChoose, onClose }: {
  episodes: ReadonlyArray<{ episode: number; title: string; unfolded: boolean; status?: ProductionEpisodeStatus }>;
  at: { x: number; y: number };
  onChoose(episode: number): void;
  onClose(): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(true, rootRef, onClose);
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>("[role=menuitemcheckbox]")?.focus({ preventScroll: true });
  }, []);
  const title = t("productionBoard.stack.title");
  return (
    <div ref={rootRef} className="ep-menu" role="menu" aria-label={title} data-board-chrome="" style={{ left: at.x, top: at.y }}>
      <header className="pk-head"><b>{title}</b></header>
      <div className="pk-list" role="none">
        {episodes.map((one) => (
          <button
            key={one.episode}
            type="button"
            className="pk"
            role="menuitemcheckbox"
            data-board-stack-episode={one.episode}
            aria-checked={one.unfolded}
            title={episodeStatus(one.status)?.label}
            onClick={() => onChoose(one.episode)}
          >
            <span className="pk-th mono">{episodeCode(one.episode)}</span>
            <span>{one.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
