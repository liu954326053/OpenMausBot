import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, FileText, Film, Image as ImageIcon, LocateFixed, MapPin, MessageSquare, Music, ScrollText, UserRound, Video, X, type LucideIcon } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import type { CanvasBotState, CanvasFileRef, CanvasNode } from "../../../../shared/project-canvas";
import type { ProjectDraftWire } from "../../../../shared/project-draft";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { assetCode, EPISODE_STATUS_KEYS, episodeProgress, KIND_KEYS } from "./asset-words";
import type { AssetKind, BoardAsset, BoardIndex } from "./board-index";

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

const CONTENT_HEADINGS: Partial<Record<AssetKind, LocaleKey>> = {
  character: "boardPanels.details.profile",
  scene: "boardPanels.details.profile",
  episode: "boardPanels.details.script",
};

const DRAFT_UNAVAILABLE_KEYS: Record<NonNullable<ProjectDraftWire["reason"]>, LocaleKey> = {
  "not-installed": "boardPanels.draft.notInstalled",
  remote: "boardPanels.draft.remote",
  "unsupported-version": "boardPanels.draft.unsupportedVersion",
};

const HEADING = "text-[12px] font-medium leading-4 text-ink-tertiary";

type Fact = [label: string, value: ReactNode];

export interface AssetDetailsProps {
  asset: BoardAsset;
  index: BoardIndex;
  /** The bot asked to change it, when it is in the project. */
  owner: CanvasBotState | undefined;
  /** By episode. */
  drafts: Record<number, ProjectDraftWire> | undefined;
  fileUrl(file: CanvasFileRef): string;
  onAsk(owner: CanvasBotState): void;
  onLocate(): void;
  onAsset(nodeId: string): void;
  onClose(): void;
}

/** An asset's details, read only, over the whole board. */
export function AssetDetails({ asset, index, owner, drafts, fileUrl, onAsk, onLocate, onAsset, onClose }: AssetDetailsProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(dialogRef, onClose);
  useEffect(() => dialogRef.current!.focus(), [asset.cardId]);
  const Icon = KIND_ICONS[asset.kind];
  const code = assetCode(asset);
  const card = asset.node.metadata?.card;
  const shown = previewOf(asset);
  const facts = factsOf(asset, index, drafts);
  const content = asset.node.metadata?.content;
  const contentHeading = CONTENT_HEADINGS[asset.kind];
  const prompt = promptOf(asset, index);
  const appearances = asset.kind === "character" || asset.kind === "scene" ? index.appearances(asset) : null;
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-board-asset={asset.node.id}
        className="ui-modal flex max-h-full w-full max-w-[880px] flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none">
        <header className="flex items-center gap-2 py-3 pe-3 ps-5">
          <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
          <span className="shrink-0 text-[12px] leading-4 text-ink-tertiary">{t(KIND_KEYS[asset.kind])}</span>
          {code ? <span className="ui-chip shrink-0 bg-ink/[0.06] tabular-nums text-ink-secondary">{code}</span> : null}
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]">{asset.title}</h2>
          {card?.badge ? <span className="ui-chip shrink-0 bg-accent/15 text-accent-text">{card.badge}</span> : null}
          <button type="button" className="ui-icon-button shrink-0" aria-label={t("boardPanels.close")} title={t("boardPanels.close")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="ui-modal-divider" />
        <div key={asset.cardId} className={cn("grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-5", shown && "sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]")}>
          {shown ? <Preview title={asset.title} media={shown.media} url={fileUrl(shown.file)} /> : null}
          <div className="flex min-w-0 flex-col gap-4">
            {card?.subtitle && asset.kind !== "episode" ? <p className="text-[13px] leading-[18px] text-ink-secondary">{card.subtitle}</p> : null}
            {card?.tags?.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {card.tags.map((tag) => <li key={tag} data-tag="" className="ui-chip bg-ink/[0.06] text-ink-secondary">{tag}</li>)}
              </ul>
            ) : null}
            {facts.length ? (
              <dl className="flex flex-col gap-1.5 text-[13px] leading-[18px]">
                {facts.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)] gap-3">
                    <dt className="text-ink-tertiary">{label}</dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {content ? (
              <section className="flex flex-col gap-1.5">
                {contentHeading ? <h3 className={HEADING}>{t(contentHeading)}</h3> : null}
                <div dir="auto" className="text-[13px] leading-[18px]"><ChatMarkdown text={content} /></div>
              </section>
            ) : null}
            {prompt ? (
              <section className="flex flex-col gap-1.5">
                <h3 className={HEADING}>{t("boardPanels.details.prompt")}</h3>
                <p dir="auto" className="whitespace-pre-wrap rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px] leading-[18px] text-ink-secondary [overflow-wrap:anywhere]">{prompt}</p>
              </section>
            ) : null}
            {appearances ? <Appearances shots={appearances} onAsset={onAsset} /> : null}
          </div>
        </div>
        <div className="ui-modal-divider" />
        <footer className="flex flex-wrap items-center gap-2 px-5 py-3">
          <button type="button" className="ui-button ui-button-md" onClick={onLocate}>
            <LocateFixed size={14} aria-hidden="true" />
            {t("boardPanels.details.locate")}
          </button>
          <span className="flex-1" />
          {owner ? (
            <button type="button" className="ui-button ui-button-md ui-button-primary" onClick={() => onAsk(owner)}>
              <MessageSquare size={14} aria-hidden="true" />
              {t("boardPanels.details.askOwner", { name: owner.name })}
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function previewOf(asset: BoardAsset): { media: CanvasNode; file: CanvasFileRef } | null {
  const media = asset.media;
  const file = media?.metadata?.file;
  if (!media || !file || !(media.type === "image" || media.type === "video" || media.type === "audio")) return null;
  return { media, file };
}

function Preview({ title, media, url }: { title: string; media: CanvasNode; url: string }) {
  if (media.type === "video") return <video src={url} controls playsInline preload="metadata" aria-label={title} className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />;
  if (media.type === "audio") return <audio src={url} controls preload="metadata" aria-label={title} className="w-full" />;
  return <img src={url} alt={title} className="max-h-[60vh] w-full rounded-lg bg-inset object-contain" />;
}

const seconds = (count: number): string => t("boardPanels.fact.seconds", { count });

function factsOf(asset: BoardAsset, index: BoardIndex, drafts: AssetDetailsProps["drafts"]): Fact[] {
  const metadata = asset.node.metadata;
  const episode: Fact[] = asset.episode === undefined ? [] : [[t("boardPanels.fact.episode"), episodeCode(asset.episode)]];
  switch (asset.kind) {
    case "shot": {
      const design = metadata?.shot;
      const length = metadata?.settings?.seconds;
      return [
        ...episode,
        ...(design?.size ? [[t("boardPanels.fact.size"), design.size] satisfies Fact] : []),
        ...(design?.move ? [[t("boardPanels.fact.move"), design.move] satisfies Fact] : []),
        ...(length ? [[t("boardPanels.fact.length"), seconds(length)] satisfies Fact] : []),
        ...(design?.audio ? [[t("boardPanels.fact.audio"), design.audio] satisfies Fact] : []),
      ];
    }
    case "result": {
      const takes = asset.takes ?? [];
      const selected = takes.findIndex((take) => take.metadata?.selected);
      const status = metadata?.status;
      return [
        ...episode,
        [t("boardPanels.fact.versions"), String(takes.length)],
        [t("boardPanels.fact.selected"), selected < 0 ? t("boardPanels.fact.selectedNone") : t("boardPanels.fact.selectedVersion", { number: selected + 1 })],
        ...(status === "loading" ? [[t("boardPanels.fact.status"), t("boardPanels.fact.generating")] satisfies Fact] : []),
        ...(status === "error" ? [[t("boardPanels.fact.status"), <span className="text-danger">{t("boardPanels.fact.generateFailed")}</span>] satisfies Fact] : []),
      ];
    }
    case "final": {
      const length = asset.media?.metadata?.durationMs;
      return [
        ...episode,
        ...(length ? [[t("boardPanels.fact.length"), seconds(Math.round(length / 1000))] satisfies Fact] : []),
        ...(drafts ? [[t("boardPanels.fact.draft"), draftWords(drafts[asset.episode!])] satisfies Fact] : []),
      ];
    }
    case "episode": {
      const row = index.episodes.find((each) => each.episode === asset.episode);
      return [
        ...(metadata?.card?.subtitle ? [[t("boardPanels.fact.logline"), metadata.card.subtitle] satisfies Fact] : []),
        ...(row?.status ? [[t("boardPanels.fact.status"), t(EPISODE_STATUS_KEYS[row.status])] satisfies Fact] : []),
        ...(row ? [[t("boardPanels.fact.shots"), episodeProgress(row)] satisfies Fact] : []),
      ];
    }
    default: {
      const palette = metadata?.card?.palette;
      return [
        ...(metadata?.card?.rows ?? []).map(([label, value]): Fact => [label, value]),
        ...(palette?.length ? [[t("boardPanels.fact.colors"), <Swatches colors={palette} />] satisfies Fact] : []),
      ];
    }
  }
}

function draftWords(draft: ProjectDraftWire | undefined): string {
  if (!draft || draft.state === "none") return t("boardPanels.draft.none");
  if (draft.state === "written") return t("boardPanels.draft.written", { name: draft.name! });
  if (draft.state === "kept") return t("boardPanels.draft.kept");
  return t(DRAFT_UNAVAILABLE_KEYS[draft.reason!]);
}

function Swatches({ colors }: { colors: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5 pt-px">
      {colors.map((color) => <span key={color} data-swatch="" role="img" aria-label={color} title={color} className="size-4 rounded-full border border-hairline" style={{ backgroundColor: color }} />)}
    </span>
  );
}

/** What it was generated from: a picture's prompt for a character or a scene, a shot's own for a shot and its video. */
function promptOf(asset: BoardAsset, index: BoardIndex): string | undefined {
  const own = asset.node.metadata?.prompt;
  if (asset.kind === "result") return own ?? index.assetOf(asset.node.metadata!.shotId!)?.node.metadata?.prompt;
  return own ?? asset.media?.metadata?.prompt;
}

function Appearances({ shots, onAsset }: { shots: readonly BoardAsset[]; onAsset(nodeId: string): void }) {
  if (!shots.length) return <p className="text-[12px] leading-4 text-ink-tertiary">{t("boardPanels.details.notInShots")}</p>;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={HEADING}>{shots.length === 1 ? t("boardPanels.details.appearsIn.one") : t("boardPanels.details.appearsIn", { count: shots.length })}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {shots.map((shot) => (
          <li key={shot.cardId} className="min-w-0">
            <button type="button" data-appearance={shot.node.id} className="ui-pill gap-1.5 px-2.5 text-[12px] leading-4" onClick={() => onAsset(shot.node.id)}>
              <span className="shrink-0 tabular-nums text-ink-tertiary">{assetCode(shot)}</span>
              <span className="truncate">{shot.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
