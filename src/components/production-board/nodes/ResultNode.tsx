import { Check, CircleDashed, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { shotCode } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardResultCard, BoardVideoStatus } from "@/lib/production-board/types";
import { clock, failureText, Ic, type NodeContext } from "./parts";

export const VIDEO_STATE: Readonly<Record<BoardVideoStatus, "todo" | "gen" | "failed" | "done">> = {
  idle: "todo",
  generating: "gen",
  failed: "failed",
  done: "done",
};

const DASH = "—";

interface Playhead {
  takeId: string;
  seconds: number;
  duration?: number;
}

function ResultStatus({ card, inFilm }: { card: BoardResultCard; inFilm: boolean }) {
  switch (card.status) {
    case "done": return <span className="rs-ok"><Ic icon={Check} />{t(inFilm ? "boardCards.result.inFilm" : "boardCards.video.ready")}</span>;
    case "generating": return <span className="rs-run"><Ic icon={LoaderCircle} className="spin" />{t("boardCards.generating")}</span>;
    case "failed": return <span className="rs-idle">{t("boardCards.generationFailed")}</span>;
    case "idle": return <span className="rs-idle">{t("boardCards.video.none")}</span>;
  }
}

export function ResultNode({ card, ctx }: { card: BoardResultCard; ctx: NodeContext }) {
  const [shownId, setShownId] = useState<string>();
  const [playingId, setPlayingId] = useState<string>();
  const [playhead, setPlayhead] = useState<Playhead>();
  const video = useRef<HTMLVideoElement>(null);
  const shown = card.takes.find((take) => take.nodeId === shownId) ?? card.takes.find((take) => take.selected) ?? card.takes.at(-1);
  const state = VIDEO_STATE[card.status];
  const code = shotCode(card.number);
  const playing = Boolean(shown) && playingId === shown?.nodeId;
  const at = playhead && playhead.takeId === shown?.nodeId ? playhead : undefined;
  const length = shown?.durationMs ? shown.durationMs / 1000 : at?.duration;
  const { generate, selectTake } = ctx.actions;
  const creationId = card.creationId;

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) element.play().catch(() => setPlayingId(undefined));
    else element.pause();
  };
  const ended = () => {
    setPlayingId(undefined);
    setPlayhead(undefined);
    if (video.current) video.current.currentTime = 0;
  };

  return (
    <div className={cn("rs", playing && "is-playing")}>
      <div className="rs-screen">
        {shown?.file ? (
          <video
            key={shown.nodeId}
            ref={video}
            src={`${ctx.fileUrl(shown.file)}#t=0.1`}
            preload="metadata"
            playsInline
            onPlay={() => setPlayingId(shown.nodeId)}
            onPause={() => setPlayingId(undefined)}
            onEnded={ended}
            onTimeUpdate={(event) => {
              const { currentTime, duration } = event.currentTarget;
              setPlayhead({ takeId: shown.nodeId, seconds: currentTime, ...(Number.isFinite(duration) ? { duration } : {}) });
            }}
          />
        ) : null}
        <span className="rs-tag mono">{code}</span>
        {shown ? (
          <span className="rs-ver mono" title={shown.stale ? t("boardCards.stale.take") : undefined}>
            {`V${card.takes.indexOf(shown) + 1} · ${t("boardCards.result.takes", { count: card.takes.length })}`}
            {shown.stale ? ` · ${t("boardCards.stale.label")}` : null}
          </span>
        ) : null}
        {state === "done" && shown?.file ? (
          <>
            <button type="button" className="rs-play" aria-label={t("boardCards.result.play", { name: `${code} ${card.title}` })} aria-pressed={playing} onClick={toggle}>
              <Ic icon={playing ? Pause : Play} />
            </button>
            <div className="rs-scrub">
              <i style={{ width: `${at && length ? Math.min(100, (at.seconds / length) * 100) : 0}%` }} />
            </div>
          </>
        ) : null}
        {state === "gen" ? (
          <div className="rs-over"><span><Ic icon={LoaderCircle} className="spin" />{t("boardCards.generating")}</span></div>
        ) : state === "failed" ? (
          <div className="rs-over">
            <span title={failureText(card.generation)}>{failureText(card.generation)}</span>
            {generate && creationId ? (
              <button type="button" className="btn-ghost" onClick={() => generate(creationId)}>
                <Ic icon={RotateCcw} />
                {t("boardCards.generateAgain")}
              </button>
            ) : null}
          </div>
        ) : state === "todo" ? (
          <div className="rs-over"><span><Ic icon={CircleDashed} />{t("boardCards.video.none")}</span></div>
        ) : null}
      </div>
      <footer className="rs-foot">
        <span className="mono rs-tc">{`${shown ? clock((at?.seconds ?? 0) * 1000) : DASH} / ${length ? clock(length * 1000) : DASH}`}</span>
        <span className="rs-name">{card.title}</span>
        <ResultStatus card={card} inFilm={Boolean(shown?.selected)} />
      </footer>
      {card.takes.length > 1 || (shown && !shown.selected && selectTake) ? (
        <div className="rs-takes">
          {card.takes.length > 1
            ? card.takes.map((take, index) => (
              <button
                key={take.nodeId}
                type="button"
                className="take"
                data-cur={take === shown ? "" : undefined}
                aria-pressed={take === shown}
                title={t("boardCards.result.take", { n: index + 1 })}
                onClick={() => setShownId(take.nodeId)}
              >
                {`V${index + 1}`}
                {take.selected ? <Ic icon={Check} /> : null}
              </button>
            ))
            : null}
          {shown && !shown.selected && selectTake ? (
            <button type="button" className="btn-ghost" onClick={() => selectTake(shown.nodeId)}>{t("boardCards.result.select")}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
