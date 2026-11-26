import { Camera, GitBranch } from "lucide-react";
import { t } from "@/lib/i18n";
import type { BoardSceneCard } from "@/lib/production-board/types";
import { PictureAction } from "./CharacterNode";
import { Chips, Ic, profileCode, shotList, type NodeContext } from "./parts";

export function SceneNode({ card, ctx }: { card: BoardSceneCard; ctx: NodeContext }) {
  const { facts } = card;
  const file = card.picture?.file;
  const refiner = card.refinedBy ? ctx.snapshot.bots[card.refinedBy]?.name ?? card.refinedBy : undefined;
  return (
    <>
      <div className="sn-art">
        {file ? <img src={ctx.fileUrl(file)} alt={t("boardCards.asset.picture", { name: card.name })} draggable={false} /> : null}
        <span className="code mono">{profileCode(ctx.snapshot, card.id, "scene")}</span>
        {refiner ? (
          <span className="refined">
            <Ic icon={GitBranch} />
            {t("boardCards.scene.refinedBy", { name: refiner })}
          </span>
        ) : null}
        <div className="sn-cap">
          <h3>{card.name}</h3>
          {facts.subtitle ? <p>{facts.subtitle}</p> : null}
        </div>
      </div>
      <div className="sn-meta">
        <Chips items={facts.tags ?? []} />
        <PictureAction card={card} ctx={ctx} />
        {facts.cameras ? (
          <span className="cams">
            <Ic icon={Camera} />
            {facts.cameras === 1 ? t("boardCards.scene.cameras.one") : t("boardCards.scene.cameras", { count: facts.cameras })}
          </span>
        ) : null}
      </div>
      <div className="sn-uses">
        <span>{card.appearsIn.length ? t("boardCards.asset.usedIn", { shots: shotList(card.appearsIn) }) : t("boardCards.asset.inNoShot")}</span>
        <span className="mono">{t("boardCards.version", { version: card.version })}</span>
      </div>
      {facts.palette?.length ? (
        <div className="sn-pal" role="img" aria-label={t("boardPanels.fact.colors")}>
          {facts.palette.map((color, index) => <i key={index} style={{ background: color }} />)}
        </div>
      ) : null}
    </>
  );
}
