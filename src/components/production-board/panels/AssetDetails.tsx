import { memo, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, FileText, Film, Image as ImageIcon, LocateFixed, MapPin, MessageSquare, Music, ScrollText, UserRound, Video, X, type LucideIcon } from "lucide-react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
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

/** An asset's details, read only, over the whole board. */
export const AssetDetails = memo(function AssetDetails({ view, onAsk, onLocate, onAsset, onClose }: AssetDetailsProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(dialogRef, onClose);
  useEffect(() => dialogRef.current!.focus(), [view.cardId]);
  const Icon = KIND_ICONS[view.kind];
  const { owner, preview } = view;
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-board-asset={view.nodeId}
        className="ui-modal flex max-h-full w-full max-w-[880px] flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none">
        <header className="flex items-center gap-2 py-3 pe-3 ps-5">
          <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
          <span className="shrink-0 text-[12px] leading-4 text-ink-tertiary">{t(KIND_KEYS[view.kind])}</span>
          {view.code ? <span className="ui-chip shrink-0 bg-ink/[0.06] tabular-nums text-ink-secondary">{view.code}</span> : null}
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]">{view.title}</h2>
          {view.badge ? <span className="ui-chip shrink-0 bg-accent/15 text-accent-text">{view.badge}</span> : null}
          <button type="button" className="ui-icon-button shrink-0" aria-label={t("boardPanels.close")} title={t("boardPanels.close")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="ui-modal-divider" />
        <div key={view.cardId} className={cn("grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-5", preview && "sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]")}>
          {preview ? <Preview title={view.title} type={preview.type} url={preview.url} /> : null}
          <div className="flex min-w-0 flex-col gap-4">
            {view.subtitle ? <p className="text-[13px] leading-[18px] text-ink-secondary">{view.subtitle}</p> : null}
            {view.tags.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {view.tags.map((tag) => <li key={tag} data-tag="" className="ui-chip bg-ink/[0.06] text-ink-secondary">{tag}</li>)}
              </ul>
            ) : null}
            {view.facts.length ? (
              <dl className="flex flex-col gap-1.5 text-[13px] leading-[18px]">
                {view.facts.map((fact) => (
                  <div key={fact.label} className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)] gap-3">
                    <dt className="text-ink-tertiary">{fact.label}</dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">{factValue(fact)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {view.content ? (
              <section className="flex flex-col gap-1.5">
                {view.contentHeading ? <h3 className={HEADING}>{t(view.contentHeading)}</h3> : null}
                <div dir="auto" className="text-[13px] leading-[18px]"><ChatMarkdown text={view.content} /></div>
              </section>
            ) : null}
            {view.prompt ? (
              <section className="flex flex-col gap-1.5">
                <h3 className={HEADING}>{t("boardPanels.details.prompt")}</h3>
                <p dir="auto" className="whitespace-pre-wrap rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px] leading-[18px] text-ink-secondary [overflow-wrap:anywhere]">{view.prompt}</p>
              </section>
            ) : null}
            {view.appearances ? <Appearances shots={view.appearances} onAsset={onAsset} /> : null}
          </div>
        </div>
        <div className="ui-modal-divider" />
        <footer className="flex flex-wrap items-center gap-2 px-5 py-3">
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

function Preview({ title, type, url }: { title: string; type: "image" | "video" | "audio"; url: string }) {
  if (type === "video") return <video src={url} controls playsInline preload="metadata" aria-label={title} className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />;
  if (type === "audio") return <audio src={url} controls preload="metadata" aria-label={title} className="w-full" />;
  return <img src={url} alt={title} className="max-h-[60vh] w-full rounded-lg bg-inset object-contain" />;
}

function factValue(fact: DetailsFact): ReactNode {
  if ("colors" in fact) return <Swatches colors={fact.colors} />;
  return fact.danger ? <span className="text-danger">{fact.text}</span> : fact.text;
}

function Swatches({ colors }: { colors: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5 pt-px">
      {colors.map((color) => <span key={color} data-swatch="" role="img" aria-label={color} title={color} className="size-4 rounded-full border border-hairline" style={{ backgroundColor: color }} />)}
    </span>
  );
}

function Appearances({ shots, onAsset }: { shots: NonNullable<DetailsView["appearances"]>; onAsset(nodeId: string): void }) {
  if (!shots.length) return <p className="text-[12px] leading-4 text-ink-tertiary">{t("boardPanels.details.notInShots")}</p>;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={HEADING}>{shots.length === 1 ? t("boardPanels.details.appearsIn.one") : t("boardPanels.details.appearsIn", { count: shots.length })}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {shots.map((shot) => (
          <li key={shot.cardId} className="min-w-0">
            <button type="button" data-appearance={shot.nodeId} className="ui-pill gap-1.5 px-2.5 text-[12px] leading-4" onClick={() => onAsset(shot.nodeId)}>
              <span className="shrink-0 tabular-nums text-ink-tertiary">{shot.code}</span>
              <span className="truncate">{shot.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
