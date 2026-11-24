import { memo, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Clapperboard, FileText, Film, Image as ImageIcon, LocateFixed, MapPin, MessageSquare, Music, ScrollText, UserRound, Video, X, type LucideIcon } from "lucide-react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardCardKind } from "../cards";
import { CardShell } from "../cards/parts";
import { KIND_KEYS } from "./asset-words";
import type { AssetKind } from "./board-index";
import type { DetailsFact, DetailsView } from "./details-view";

const KIND_ICONS: Record<AssetKind, LucideIcon> = {
  character: UserRound,
  scene: MapPin,
  episode: ScrollText,
  shot: Clapperboard,
  result: Video,
  final: Film,
  brief: FileText,
  plan: FileText,
  text: FileText,
  image: ImageIcon,
  video: Video,
  audio: Music,
  file: FileText,
};

const HEADING = "text-[12px] font-medium leading-4 text-ink-tertiary";
const COLUMN = "min-h-0 overflow-y-auto p-4";

export interface AssetDetailsProps {
  view: DetailsView;
  /** With the owner's bot id and the asset's node id. */
  onAsk(botId: string, nodeId: string): void;
  /** With the card id of the asset. */
  onLocate(cardId: string): void;
  onAsset(nodeId: string): void;
  onClose(): void;
  locale: string;
}

/** An asset's details, read only, over the whole board. A character or a scene gives its picture less room than a shot
 * or a film, whose screen is what the person came to see. */
export const AssetDetails = memo(function AssetDetails({ view, onAsk, onLocate, onAsset, onClose }: AssetDetailsProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(dialogRef, onClose);
  useEffect(() => dialogRef.current!.focus(), [view.cardId]);
  const Icon = KIND_ICONS[view.kind];
  const { owner } = view;
  const narrow = view.kind === "character" || view.kind === "scene";
  return createPortal(
    <div
      data-details-scrim=""
      className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4 [@media(max-width:760px)]:p-2"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-board-asset={view.nodeId}
        data-kind={view.kind}
        className="ui-modal flex max-h-full w-full max-w-[980px] flex-col overflow-hidden rounded-[14px] text-ink outline-none animate-details-in motion-reduce:animate-none"
      >
        <header className="flex flex-none items-center gap-2.5 border-b border-hairline py-2.5 pe-2.5 ps-4">
          <span data-details-kind="" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] leading-4 text-ink-tertiary">
            <Icon size={14} aria-hidden="true" className="shrink-0" />
            {t(KIND_KEYS[view.kind])}
          </span>
          {view.code ? (
            <span data-version="" className="shrink-0 whitespace-nowrap rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-[12px] font-medium leading-4 text-ink-secondary">
              {view.code}
            </span>
          ) : null}
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-6 text-ink">{view.title}</h2>
          {view.badge ? <span className="ui-chip shrink-0 bg-ink/[0.06] text-ink-secondary">{view.badge}</span> : null}
          <button type="button" className="ui-icon-button shrink-0" aria-label={t("boardPanels.close")} title={t("boardPanels.close")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div
          key={view.cardId}
          data-details-body=""
          className="flex min-h-0 flex-1 [@media(max-width:760px)]:flex-col [@media(max-width:760px)]:overflow-y-auto"
        >
          <div
            data-media=""
            className={cn(COLUMN, "flex flex-col gap-3 bg-app", narrow ? "flex-[0.85_1_0]" : "flex-[1.3_1_0]", "[@media(max-width:760px)]:flex-none [@media(max-width:760px)]:overflow-visible")}
          >
            <Media view={view} />
          </div>
          <div
            data-info=""
            className={cn(COLUMN, "flex flex-[1_1_0] flex-col gap-4 border-s border-hairline [@media(max-width:760px)]:flex-none [@media(max-width:760px)]:overflow-visible [@media(max-width:760px)]:border-s-0 [@media(max-width:760px)]:border-t")}
          >
            {view.subtitle ? <p className="text-[14px] leading-[1.6] text-ink-secondary">{view.subtitle}</p> : null}
            {view.tags.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {view.tags.map((tag) => <li key={tag} data-tag="" className="ui-chip bg-ink/[0.06] text-ink-secondary">{tag}</li>)}
              </ul>
            ) : null}
            {view.facts.length ? (
              <dl className="flex flex-col gap-1.5 text-[13px] leading-[18px]">
                {view.facts.map((fact) => (
                  <div key={fact.label} className="flex gap-3">
                    <dt className="w-16 shrink-0 truncate text-ink-tertiary">{fact.label}</dt>
                    <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{factValue(fact)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {view.content ? (
              <section className="flex flex-col gap-2">
                {view.contentHeading ? <h3 className={HEADING}>{t(view.contentHeading)}</h3> : null}
                <div dir="auto" className="text-[13px] leading-[18px]"><ChatMarkdown text={view.content} /></div>
              </section>
            ) : null}
            {view.prompt ? (
              <section className="flex flex-col gap-2">
                <h3 className={HEADING}>{t("boardPanels.details.prompt")}</h3>
                <p data-prompt="" dir="auto" className="whitespace-pre-wrap rounded-lg border border-hairline bg-card px-3 py-2.5 text-[13px] leading-[1.6] text-ink-secondary [overflow-wrap:anywhere]">{view.prompt}</p>
              </section>
            ) : null}
            {view.appearances ? <Appearances shots={view.appearances} onAsset={onAsset} /> : null}
          </div>
        </div>
        <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
          <button type="button" className="ui-button ui-button-md" onClick={() => onLocate(view.cardId)}>
            <LocateFixed size={14} aria-hidden="true" />
            {t("boardPanels.details.locate")}
          </button>
          <span className="flex-1" />
          {owner ? (
            <button type="button" className="ui-button ui-button-md ui-button-primary" onClick={() => onAsk(owner.botId, view.nodeId)}>
              <MessageSquare size={14} aria-hidden="true" />
              {t("boardPanels.details.askOwner", { name: owner.name })}
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
});

/** The picture, the 16:9 screen with its takes, the still sheet, or the sound. */
function Media({ view }: { view: DetailsView }) {
  const { preview, still, takes } = view;
  if (preview?.type === "video") {
    return (
      <>
        <div data-screen="" className="aspect-video w-full overflow-hidden rounded-lg bg-board-monitor">
          <video src={preview.url} controls playsInline preload="metadata" aria-label={view.title} className="aspect-video w-full bg-board-monitor object-contain" />
        </div>
        {takes.length ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] leading-4 text-ink-tertiary">
            <span className="shrink-0">{t("boardPanels.details.versions")}</span>
            {takes.map((take) => (
              <span
                key={take.number}
                data-take=""
                data-cur={take.current || undefined}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-[12px] leading-none",
                  take.current ? "border-board-teal-ink bg-board-paper text-board-teal-ink" : "border-hairline text-ink-secondary",
                )}
              >
                {t("boardPanels.details.take", { number: take.number })}
                {take.current ? <Check size={12} aria-hidden="true" /> : null}
              </span>
            ))}
          </div>
        ) : null}
        <Caption view={view} />
      </>
    );
  }
  if (preview?.type === "audio") {
    return (
      <>
        <audio src={preview.url} controls preload="metadata" aria-label={view.title} className="w-full" />
        <Caption view={view} />
      </>
    );
  }
  if (preview) {
    return (
      <>
        <figure className="flex flex-col gap-2.5">
          <img src={preview.url} alt={view.title} className="w-full rounded-lg bg-inset object-contain [@media(max-width:760px)]:max-h-[52vh]" />
          <Caption view={view} />
        </figure>
      </>
    );
  }
  if (still) {
    return (
      <CardShell
        kind={sheetKind(view.kind)}
        label={still.heading}
        surface="paper"
        static
        className="cursor-default select-text p-4"
        data={{ "data-sheet": "", "data-sketch": still.sketch ? "" : undefined }}
      >
        <h3 className="text-[16px] font-semibold leading-[1.3] text-board-ink">{still.heading}</h3>
        {still.sketch ? (
          <div data-sketch-frame="" className="mt-2 grid aspect-video w-full place-items-center rounded border-[1.5px] border-dashed border-board-paper-line text-[12px] text-board-ink-3">
            {still.body}
          </div>
        ) : still.body ? (
          <div className="mt-2 border-t border-board-paper-line pt-2 text-[13px] leading-[1.6] text-board-ink-2" dir="auto">
            <ChatMarkdown text={still.body} />
          </div>
        ) : null}
      </CardShell>
    );
  }
  return null;
}

/** The paper a document reads as: the kind of card the board draws for it, or the plain sheet of a loose file. */
function sheetKind(kind: AssetKind): BoardCardKind {
  if (kind === "shot" || kind === "episode" || kind === "brief" || kind === "plan") return kind;
  return "generic";
}

/** What the picture is, under it: its colours, then its size. */
function Caption({ view }: { view: DetailsView }) {
  if (!view.palette.length && !view.resolution) return null;
  return (
    <figcaption data-caption="" className="flex items-center justify-between gap-2 text-[12px] leading-4 text-ink-tertiary">
      <span className="min-w-0">{view.palette.length ? <Swatches colors={view.palette} /> : null}</span>
      {view.resolution ? <span data-resolution="" className="shrink-0 tabular-nums">{view.resolution}</span> : null}
    </figcaption>
  );
}

function factValue(fact: DetailsFact): ReactNode {
  return fact.danger ? <span className="text-danger">{fact.text}</span> : fact.text;
}

function Swatches({ colors }: { colors: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5 pt-px">
      {colors.map((color) => <span key={color} data-swatch="" role="img" aria-label={color} title={color} className="size-5 rounded-full border border-hairline" style={{ backgroundColor: color }} />)}
    </span>
  );
}

function Appearances({ shots, onAsset }: { shots: NonNullable<DetailsView["appearances"]>; onAsset(nodeId: string): void }) {
  if (!shots.length) return <p className="text-[13px] leading-[18px] text-ink-tertiary">{t("boardPanels.details.notInShots")}</p>;
  return (
    <section className="flex flex-col gap-2">
      <h3 className={HEADING}>{shots.length === 1 ? t("boardPanels.details.appearsIn.one") : t("boardPanels.details.appearsIn", { count: shots.length })}</h3>
      <ul className="flex flex-wrap gap-2">
        {shots.map((shot) => (
          <li key={shot.cardId} className="min-w-0">
            <button
              type="button"
              data-appearance={shot.nodeId}
              className="flex w-[108px] min-w-0 flex-col gap-0.5 rounded-lg border border-hairline p-1 text-start text-[12px] leading-[1.35] transition-colors duration-[120ms] hover:border-hairline hover:bg-card motion-reduce:transition-none"
              onClick={() => onAsset(shot.nodeId)}
            >
              <span data-use-thumb="" aria-hidden="true" className="mb-0.5 aspect-video w-full overflow-hidden rounded-sm bg-card">
                {shot.picture ? <img src={shot.picture} alt="" loading="lazy" className="size-full object-cover" /> : null}
              </span>
              <span className="truncate px-0.5 font-mono tabular-nums text-ink-tertiary">{shot.code}</span>
              <span className="truncate px-0.5 text-ink">{shot.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
