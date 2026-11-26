import { useEffect, useId, useMemo, useRef } from "react";
import { Check, Clapperboard, Drama, File, FileText, Film, Image as ImageIcon, Layers, ListChecks, LocateFixed, MessageSquare, Mountain, Music, PenLine, ScrollText, Video, X, type LucideIcon } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import { KIND_KEYS } from "@/lib/production-board/asset-words";
import type { AssetKind } from "@/lib/production-board/board-index";
import type { DetailsLink, DetailsView } from "@/lib/production-board/details-view";
import type { BoardCard, BoardCardKind } from "@/lib/production-board/types";
import { NODE_CLASS, NodeBody } from "../nodes/index";
import { Chips, Ic, JOB_ICON, Pal, type NodeContext } from "../nodes/parts";

const MOCKUP_KIND: Record<AssetKind, string> = {
  character: "char",
  scene: "scene",
  episode: "ep",
  shot: "shot",
  result: "result",
  final: "final",
  brief: "brief",
  plan: "tasks",
  text: "text",
  image: "image",
  video: "video",
  audio: "audio",
  file: "file",
};

const ASSET_ICON: Record<AssetKind, LucideIcon> = {
  character: Drama,
  scene: Mountain,
  episode: ScrollText,
  shot: Clapperboard,
  result: Video,
  final: Film,
  brief: FileText,
  plan: ListChecks,
  text: FileText,
  image: ImageIcon,
  video: Video,
  audio: Music,
  file: File,
};

const CARD_ICON: Record<Exclude<BoardCardKind, "bot">, LucideIcon> = {
  brief: FileText,
  plan: ListChecks,
  episode: ScrollText,
  stack: Layers,
  character: Drama,
  scene: Mountain,
  shot: Clapperboard,
  result: Video,
  final: Film,
  other: File,
};

const DOCUMENT_KINDS = new Set<BoardCardKind>(["brief", "plan", "episode", "shot"]);

const STILL_ACTIONS: NodeContext["actions"] = { focusCard() {}, openChat() {}, openStack() {} };

export interface DetailModalProps {
  view: DetailsView;
  links: { upstream: DetailsLink[]; downstream: DetailsLink[] };
  card: BoardCard | undefined;
  ctx: NodeContext;
  readOnly: boolean;
  onClose(): void;
  onLocate(): void;
  onAsk(): void;
  onOpenCard(link: DetailsLink): void;
  onSelectTake?(nodeId: string): void;
}

/** An asset's details over the whole board: what it looks like on the left, what is known of it on the right. */
export function DetailModal({ view, links, card, ctx, readOnly, onClose, onLocate, onAsk, onOpenCard, onSelectTake }: DetailModalProps) {
  const boxRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useModalDialog(boxRef, onClose);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [view.cardId]);
  const about = view.subtitle ?? firstParagraph(view.content);
  const chips = [view.badge, ...view.tags].filter((chip): chip is string => Boolean(chip));
  return (
    <div className="dm">
      <button type="button" className="dm-scrim" tabIndex={-1} aria-label={t("boardPanels.close")} onClick={onClose} />
      <section
        ref={boxRef}
        className="dm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-board-asset={view.kind}
        data-kind={MOCKUP_KIND[view.kind]}
      >
        <header className="dm-head">
          <span className="dm-kind"><Ic icon={ASSET_ICON[view.kind]} />{t(KIND_KEYS[view.kind])}</span>
          {view.code ? <b className="mono">{view.code}</b> : null}
          <h2 id={titleId}>{view.title}</h2>
          <button ref={closeRef} type="button" className="tbtn dm-close" aria-label={t("boardPanels.close")} onClick={onClose}>
            <Ic icon={X} />
          </button>
        </header>
        <div key={view.cardId} className="dm-body">
          <div className="dm-media">
            <Media view={view} card={card} ctx={ctx} readOnly={readOnly} onSelectTake={onSelectTake} />
          </div>
          <div className="dm-info">
            {about ? <p className="dm-about" dir="auto">{about}</p> : null}
            {chips.length ? <Chips items={chips} /> : null}
            {view.facts.length ? (
              <section className="dm-sec">
                <dl className="dm-dl">
                  {view.facts.map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd data-danger={fact.danger}>{fact.text}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {view.prompt ? (
              <section className="dm-sec">
                <h3>{t("boardPanels.details.prompt")}</h3>
                <p className="dm-prompt" dir="auto">{view.prompt}</p>
              </section>
            ) : null}
            {view.appearances ? <Appearances shots={view.appearances} onOpenCard={onOpenCard} /> : null}
            <Links heading={t("boardPanels.details.upstream", { count: links.upstream.length })} links={links.upstream} ctx={ctx} onOpenCard={onOpenCard} />
            <Links heading={t("boardPanels.details.downstream", { count: links.downstream.length })} links={links.downstream} ctx={ctx} onOpenCard={onOpenCard} />
          </div>
        </div>
        <footer className="dm-foot">
          <button type="button" className="btn" onClick={onLocate}>
            <Ic icon={LocateFixed} />
            <span>{t("boardPanels.details.locate")}</span>
          </button>
          {view.owner && !readOnly ? (
            <button type="button" className="btn btn-primary" onClick={onAsk}>
              <Ic icon={MessageSquare} />
              <span>{t("boardPanels.details.askOwner", { name: view.owner.name })}</span>
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function firstParagraph(text: string | undefined): string | undefined {
  return text?.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).find(Boolean);
}

/** A document as the still paper card the board draws, a picture, a video with its takes, a sound, or a plain sheet. */
function Media({ view, card, ctx, readOnly, onSelectTake }: Pick<DetailModalProps, "view" | "card" | "ctx" | "readOnly" | "onSelectTake">) {
  const stillCtx = useMemo<NodeContext>(() => ({ ...ctx, actions: STILL_ACTIONS }), [ctx]);
  const { preview } = view;
  if (card && DOCUMENT_KINDS.has(card.kind)) {
    return (
      <article className={`node ${NODE_CLASS[card.kind]} dm-card`}>
        <NodeBody card={card} ctx={stillCtx} />
      </article>
    );
  }
  if (preview?.type === "image") {
    return (
      <figure className={view.kind === "character" ? "dm-art is-portrait" : "dm-art"}>
        <img src={preview.url} alt={view.title} />
        <Caption view={view} />
      </figure>
    );
  }
  if (preview?.type === "video") {
    const takeIds = card?.kind === "result" ? card.takes.map((take) => take.nodeId) : [];
    return (
      <>
        <div className="node k-result dm-card">
          <div className="rs-screen">
            <video src={preview.url} controls playsInline preload="metadata" aria-label={view.title} />
          </div>
        </div>
        {view.takes.length ? (
          <div className="dm-takes">
            <span>{t("boardPanels.details.versions")}</span>
            {view.takes.map((take) => {
              const nodeId = takeIds[take.number - 1];
              return (
                <button
                  key={take.number}
                  type="button"
                  className="take"
                  data-cur={take.current || undefined}
                  aria-pressed={take.current}
                  disabled={readOnly || !onSelectTake || !nodeId}
                  onClick={() => { if (!take.current && nodeId) onSelectTake?.(nodeId); }}
                >
                  {t("boardPanels.details.take", { number: take.number })}
                  {take.current ? <Ic icon={Check} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <Caption view={view} />
      </>
    );
  }
  if (preview?.type === "audio") {
    return (
      <figure className="dm-art">
        <audio src={preview.url} controls preload="metadata" aria-label={view.title} />
        <Caption view={view} />
      </figure>
    );
  }
  return (
    <div className="dm-sheet">
      <h3>{view.still?.heading ?? view.title}</h3>
      {view.still?.body ? <p dir="auto">{view.still.body}</p> : null}
    </div>
  );
}

function Caption({ view }: { view: DetailsView }) {
  if (!view.palette.length && !view.resolution) return null;
  return (
    <figcaption>
      {view.palette.length ? <Pal colors={view.palette} label={t("boardPanels.fact.colors")} /> : <span />}
      {view.resolution ? <span className="mono">{view.resolution}</span> : null}
    </figcaption>
  );
}

function Appearances({ shots, onOpenCard }: { shots: NonNullable<DetailsView["appearances"]>; onOpenCard(link: DetailsLink): void }) {
  if (!shots.length) {
    return (
      <section className="dm-sec">
        <p className="dm-none">{t("boardPanels.details.notInShots")}</p>
      </section>
    );
  }
  return (
    <section className="dm-sec">
      <h3>{shots.length === 1 ? t("boardPanels.details.appearsIn.one") : t("boardPanels.details.appearsIn", { count: shots.length })}</h3>
      <div className="dm-uses">
        {shots.map((shot) => (
          <button
            key={shot.cardId}
            type="button"
            className="use"
            onClick={() => onOpenCard({ cardId: shot.cardId, cardKind: "shot", nodeId: shot.nodeId, botId: undefined, title: shot.title, kind: "ref" })}
          >
            {shot.picture ? <img src={shot.picture} alt="" draggable={false} /> : <span className="use-wip"><Ic icon={PenLine} /></span>}
            <span className="mono">{shot.code}</span>
            <span>{shot.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Links({ heading, links, ctx, onOpenCard }: { heading: string; links: DetailsLink[]; ctx: NodeContext; onOpenCard(link: DetailsLink): void }) {
  if (!links.length) return null;
  return (
    <section className="dm-sec">
      <h3>{heading}</h3>
      <div className="rels">
        {links.map((link) => (
          <button key={`${link.kind}:${link.cardId}`} type="button" className="rel" onClick={() => onOpenCard(link)}>
            <Ic icon={linkIcon(link, ctx)} />
            <span>{link.title}</span>
            <em>{t(`boardPanels.details.edge.${link.kind}`)}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function linkIcon(link: DetailsLink, ctx: NodeContext): LucideIcon {
  if (link.cardKind === "bot") {
    const bot = link.botId ? ctx.snapshot.bots[link.botId] : undefined;
    return JOB_ICON[bot?.lead ? "lead" : bot?.stages[0] ?? "other"];
  }
  return link.cardKind ? CARD_ICON[link.cardKind] : File;
}
