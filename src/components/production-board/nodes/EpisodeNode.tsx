import { RotateCcw } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import type { BoardEpisodeCard } from "@/lib/production-board/types";
import { scriptPage } from "../engine/script-page";
import { BotButton, clock, Ic, ScriptHoles, type NodeContext } from "./parts";

const length = (seconds: number): string => (seconds < 60 ? t("boardCards.shot.seconds", { count: seconds }) : clock(seconds * 1000));

export function EpisodeNode({ card, ctx }: { card: BoardEpisodeCard; ctx: NodeContext }) {
  const code = episodeCode(card.episode);
  const lines = scriptPage(card.text);
  const counts = [
    ...(card.shots > 0 ? [t("boardCards.episode.shotsReady", { ready: card.ready, shots: card.shots })] : []),
    ...(card.seconds ? [length(card.seconds)] : []),
  ].join(" · ");
  const bot = card.storyboardBotId ? ctx.snapshot.bots[card.storyboardBotId] : undefined;
  const onRetry = ctx.actions.retry;
  return (
    <>
      <ScriptHoles />
      <header className="pp-head">
        <span className="mono ep-no">{code}</span>
        <h3>{card.title}</h3>
        <span className="mono">{t("boardCards.version", { version: card.version })}</span>
      </header>
      {card.logline ? <p className="ep-log">{card.logline}</p> : null}
      <div className="sc-page">
        {lines.length ? lines.map((line, index) => <p key={index} className={`sc-${line.k}`}>{line.t}</p>) : <p className="sc-act">{t("boardCards.episode.noText")}</p>}
      </div>
      <footer className="pp-foot">
        <span>{counts}</span>
        {bot ? <BotButton botId={bot.botId} ctx={ctx} suffix={bot.name.endsWith(code) ? undefined : code} label={t("boardCards.episode.to", { name: bot.name })} /> : null}
        {card.status === "failed" && onRetry ? (
          <button type="button" className="btn-ink" onClick={() => onRetry({ episode: card.episode })}>
            <Ic icon={RotateCcw} />
            {t("boardCards.retry")}
          </button>
        ) : null}
      </footer>
    </>
  );
}
