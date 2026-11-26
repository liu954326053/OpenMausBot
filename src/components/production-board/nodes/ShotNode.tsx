import { ArrowRight, Check, LoaderCircle, Mountain, PenLine, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { episodeCode, shotCode } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import type { BoardShotCard } from "@/lib/production-board/types";
import { clock, failureText, Ic, profileCode, type NodeContext } from "./parts";

const DASH = "—";

function timeIn(startsAt: number, seconds: number | undefined): string {
  const start = clock(startsAt * 1000);
  return seconds ? `${start} – ${clock((startsAt + seconds) * 1000)}` : start;
}

function ShotFoot({ card, ctx }: { card: BoardShotCard; ctx: NodeContext }) {
  const { generate } = ctx.actions;
  const creationId = card.creationId;
  const stale = card.stale ? <span title={t("boardCards.stale.shot")}>{` · ${t("boardCards.stale.label")}`}</span> : null;
  const again = generate && creationId ? (
    <button type="button" className="btn-ink" onClick={() => generate(creationId)}>
      <Ic icon={RotateCcw} />
      {t("boardCards.generateAgain")}
    </button>
  ) : null;
  switch (card.status) {
    case "done":
      return (
        <>
          <span className="st done"><Ic icon={Check} />{t("boardCards.video.ready")}{stale}</span>
          <span className="sh-acts">
            <button type="button" className="btn-ink" onClick={() => ctx.actions.focusCard(`result:${card.id}`)}>
              {t("boardCards.shot.viewVideo")}
              <Ic icon={ArrowRight} />
            </button>
            {again}
          </span>
        </>
      );
    case "generating":
      return <span className="st run"><Ic icon={LoaderCircle} className="spin" />{t("boardCards.generating")}{stale}</span>;
    case "failed":
      return (
        <>
          <span className="st" title={failureText(card.generation)}>{failureText(card.generation)}{stale}</span>
          {again}
        </>
      );
    case "idle":
      return (
        <>
          <span className="st">{t("boardCards.video.none")}{stale}</span>
          {generate && creationId ? (
            <button type="button" className="btn-gen" onClick={() => generate(creationId)}>
              <Ic icon={Sparkles} />
              {t("boardCards.video.generateShot")}
            </button>
          ) : null}
        </>
      );
  }
}

export function ShotNode({ card, ctx }: { card: BoardShotCard; ctx: NodeContext }) {
  const take = ctx.takeOf(card.id);
  const audio = card.design?.audio?.trim();
  const facts: Array<[label: string, value: string | undefined]> = [
    [t("boardCards.shot.size"), card.design?.size?.trim()],
    [t("boardCards.shot.move"), card.design?.move?.trim()],
    [t("boardCards.shot.length"), card.seconds ? t("boardCards.shot.seconds", { count: card.seconds }) : undefined],
  ];
  const references = [...card.references.filter((one) => one.kind === "scene"), ...card.references.filter((one) => one.kind === "character")];
  const time = card.startsAt === undefined ? undefined : timeIn(card.startsAt, card.seconds);
  return (
    <>
      <header className="sh-head">
        <span className="sh-no mono">{shotCode(card.number)}</span>
        <h3>{card.title}</h3>
        <span className="mono tc">{time ? `${episodeCode(card.episode)} · ${time}` : episodeCode(card.episode)}</span>
      </header>
      <div className="sh-main">
        {take?.file ? (
          <div className="sh-frame">
            <video src={`${ctx.fileUrl(take.file)}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" />
          </div>
        ) : (
          <div className="sh-frame is-wip" role="img" aria-label={t("boardCards.shot.noPicture")}>
            <Ic icon={PenLine} />
            <span>{t("boardCards.shot.noPicture")}</span>
          </div>
        )}
        <div className="sh-notes">
          <dl className="sh-dl">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? DASH}</dd>
              </div>
            ))}
          </dl>
          <p className="sh-desc">{card.prompt?.trim() || t("boardCards.shot.noPrompt")}</p>
          {audio ? (
            <p className="sh-audio">
              <Ic icon={Volume2} />
              <span>{audio}</span>
            </p>
          ) : null}
        </div>
      </div>
      {references.length ? (
        <div className="sh-refs">
          <span className="lbl">{t("boardCards.shot.references")}</span>
          {references.map((reference) => (
            <button key={reference.cardId} type="button" className="ref" onClick={() => ctx.actions.focusCard(reference.cardId)}>
              {reference.kind === "scene" ? <Ic icon={Mountain} /> : reference.picture ? <img src={ctx.fileUrl(reference.picture)} alt="" draggable={false} /> : null}
              {reference.kind === "scene" ? `${profileCode(ctx.snapshot, reference.cardId, "scene")} ${reference.name}` : reference.name}
            </button>
          ))}
        </div>
      ) : null}
      <footer className="sh-foot">
        <ShotFoot card={card} ctx={ctx} />
      </footer>
    </>
  );
}
