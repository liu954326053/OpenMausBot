import { LoaderCircle } from "lucide-react";
import { t } from "@/lib/i18n";
import type { BoardCharacterCard, BoardSceneCard } from "@/lib/production-board/types";
import { Chips, failureText, Ic, Pal, profileCode, shotList, type NodeContext } from "./parts";

/** What a character or a scene without a picture offers: making one, or making it again after it failed. */
export function PictureAction({ card, ctx }: { card: BoardCharacterCard | BoardSceneCard; ctx: NodeContext }) {
  const { newest } = card;
  const generate = ctx.actions.generate;
  if (card.picture?.file || !newest) return null;
  if (newest.generation?.status === "loading") {
    return (
      <span className="st run">
        <Ic icon={LoaderCircle} className="spin" />
        {t("boardCards.generating")}
      </span>
    );
  }
  if (!newest.prompt || !generate) return null;
  const failed = newest.generation?.status === "error";
  return (
    <button type="button" className="btn-ink" title={failed ? failureText(newest.generation) : undefined} onClick={() => generate(newest.nodeId)}>
      {t(failed ? "boardCards.generateAgain" : "boardCards.asset.generatePicture")}
    </button>
  );
}

export function CharacterNode({ card, ctx }: { card: BoardCharacterCard; ctx: NodeContext }) {
  const { facts } = card;
  const file = card.picture?.file;
  return (
    <div className="ch">
      <div className="ch-art">
        {file ? <img src={ctx.fileUrl(file)} alt={t("boardCards.asset.picture", { name: card.name })} draggable={false} /> : null}
        <span className="code mono">{profileCode(ctx.snapshot, card.id, "character")}</span>
      </div>
      <div className="ch-body">
        <div className="ch-top">
          {facts.badge ? <span className="role">{facts.badge}</span> : <span />}
          {card.pictures ? <span className="mono">{t("boardCards.character.look", { count: card.pictures })}</span> : null}
        </div>
        <h3>{card.name}</h3>
        {facts.subtitle ? <p className="ch-sub">{facts.subtitle}</p> : null}
        {facts.tags?.length ? <Chips items={facts.tags} /> : null}
        {facts.rows?.length ? (
          <dl className="ch-dl">
            {facts.rows.slice(0, 2).map(([label, value], index) => (
              <div key={index}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="ch-foot">
          {facts.palette?.length ? <Pal colors={facts.palette} label={t("boardPanels.fact.colors")} /> : null}
          <PictureAction card={card} ctx={ctx} />
          <span className="uses">{card.appearsIn.length ? t("boardCards.asset.appearsIn", { shots: shotList(card.appearsIn) }) : t("boardCards.asset.inNoShot")}</span>
        </div>
      </div>
    </div>
  );
}
