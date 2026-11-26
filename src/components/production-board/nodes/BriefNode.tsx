import { Check } from "lucide-react";
import { t } from "@/lib/i18n";
import type { BoardBriefCard } from "@/lib/production-board/types";
import { Ic, timeOfDay, type NodeContext } from "./parts";

export function BriefNode({ card, ctx }: { card: BoardBriefCard; ctx: NodeContext }) {
  const by = card.by ? ctx.snapshot.bots[card.by]?.name : undefined;
  const written = by ? [t("boardCards.brief.by", { name: by }), ...(card.agreedAt === undefined ? [] : [timeOfDay(card.agreedAt)])].join(" · ") : "";
  return (
    <>
      <header className="pp-head">
        <span className="mono">REQ</span>
        <h3>{card.title.trim() || t("boardCards.brief.title")}</h3>
        <span className="mono">{t("boardCards.version", { version: card.version })}</span>
      </header>
      {card.rows.length ? (
        <dl className="spec">
          {card.rows.map(([label, value], index) => (
            <div key={index}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="ep-log">{card.text.trim() || t("boardCards.brief.empty")}</p>
      )}
      <footer className="pp-foot">
        <span>{written}</span>
        {card.agreedAt === undefined ? null : <span className="stamp"><Ic icon={Check} />{t("boardCards.brief.agreed")}</span>}
      </footer>
    </>
  );
}
