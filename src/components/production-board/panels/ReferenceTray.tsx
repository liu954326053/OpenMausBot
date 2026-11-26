import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Film, Link2, Plus, X } from "lucide-react";
import type { CanvasFileRef } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { assetCode, assetKindLabel } from "@/lib/production-board/asset-words";
import type { BoardAsset, BoardIndex } from "@/lib/production-board/board-index";
import { EmptyLine, RowGroup } from "./panel-parts";

const BLOCK = "relative size-[52px] shrink-0";

/** A reference's 52px block: its picture, or its kind's mark, and its code along the bottom. */
function ReferenceBlock({ asset, pictureUrl }: { asset: BoardAsset; pictureUrl(file: CanvasFileRef): string }) {
  const file = asset.media?.type === "image" ? asset.media.metadata?.file : undefined;
  const Icon = asset.media?.type === "video" ? Film : FileText;
  const tag = assetCode(asset) || asset.title;
  return (
    <span data-thumb="" className={cn(BLOCK, "flex flex-col overflow-hidden rounded-lg border border-hairline bg-control text-ink-secondary")}>
      <span className="grid min-h-0 flex-1 place-items-center">
        {file ? <img src={pictureUrl(file)} alt="" loading="lazy" className="size-full object-cover" /> : <Icon size={16} aria-hidden="true" />}
      </span>
      <span data-reference-tag="" className="h-4 shrink-0 truncate bg-ink px-1 text-center font-mono text-[11px] leading-4 text-app">{tag}</span>
    </span>
  );
}

/** "EP01 SH03 · 船影", or the title alone for what belongs to no episode. */
const referenceName = (asset: BoardAsset): string => [assetCode(asset), asset.title].filter(Boolean).join(" · ");

export interface ReferenceTrayProps {
  /** Connected into the bot's node: the server sends them with every task, and only the board takes them away. */
  connected: readonly BoardAsset[];
  extras: readonly BoardAsset[];
  botName: string;
  pictureUrl(file: CanvasFileRef): string;
  pickerOpen: boolean;
  onPick(): void;
  onRemove(asset: BoardAsset): void;
}

export function ReferenceTray({ connected, extras, botName, pictureUrl, pickerOpen, onPick, onRemove }: ReferenceTrayProps) {
  const labelId = useId();
  const count = connected.length + extras.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12px] leading-4 text-ink-tertiary">
        <span id={labelId} className="shrink-0 text-[13px] font-medium leading-[18px] text-ink-secondary">{t("boardPanels.chat.references")}</span>
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {count ? (count === 1 ? t("boardPanels.chat.referenceCount.one") : t("boardPanels.chat.referenceCount", { count })) : null}
        </span>
      </div>
      <div className="flex items-start gap-1.5">
        {count ? (
          <ul aria-labelledby={labelId} className="flex max-h-[116px] min-w-0 flex-1 flex-wrap content-start items-start gap-1.5 overflow-y-auto pb-1">
            {connected.map((asset) => (
              <li key={asset.cardId} data-reference={asset.node.id} title={`${assetKindLabel(asset)} · ${asset.title}\n${t("boardPanels.chat.connected", { name: botName })}`} className={BLOCK}>
                <ReferenceBlock asset={asset} pictureUrl={pictureUrl} />
                <span aria-hidden="true" className="absolute -end-1 -top-1 grid size-[18px] place-items-center rounded-full bg-menu text-ink-tertiary">
                  <Link2 size={11} />
                </span>
              </li>
            ))}
            {extras.map((asset) => (
              <li key={asset.cardId} data-reference={asset.node.id} title={`${assetKindLabel(asset)} · ${asset.title}`} className={cn(BLOCK, "group")}>
                <ReferenceBlock asset={asset} pictureUrl={pictureUrl} />
                <button
                  type="button"
                  data-reference-remove=""
                  aria-label={t("boardPanels.chat.removeReference", { title: asset.title })}
                  className="absolute -end-1 -top-1 grid size-[18px] place-items-center rounded-full bg-ink text-app opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100 motion-reduce:transition-none"
                  onClick={() => onRemove(asset)}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          data-reference-add=""
          aria-label={t("boardPanels.chat.addReference")}
          title={t("boardPanels.chat.addReference")}
          aria-expanded={pickerOpen}
          onClick={onPick}
          className="grid size-[52px] shrink-0 place-items-center rounded-lg border-[1.5px] border-dashed border-hairline text-ink-secondary transition-colors duration-[120ms] hover:border-ink-secondary hover:bg-card hover:text-ink aria-expanded:border-ink-secondary aria-expanded:bg-card aria-expanded:text-ink motion-reduce:transition-none"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export interface ReferencePickerProps {
  index: BoardIndex;
  /** What the tray holds already, which the picker leaves out. */
  taken: ReadonlySet<BoardAsset>;
  pictureUrl(file: CanvasFileRef): string;
  onAdd(asset: BoardAsset): void;
  onDone(): void;
}

/** Every asset of the project not in the tray yet, by kind, to add to the task with a click. */
export function ReferencePicker({ index, taken, pictureUrl, onAdd, onDone }: ReferencePickerProps) {
  const headingId = useId();
  const filterRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => filterRef.current!.focus({ preventScroll: true }), []);
  const groups = useMemo(() => [
    { label: t("boardPanels.chat.group.scripts"), assets: index.scripts },
    { label: t("boardPanels.assets.characters"), assets: index.characters },
    { label: t("boardPanels.assets.scenes"), assets: index.scenes },
    { label: t("boardPanels.assets.shots"), assets: index.shotsByEpisode.flatMap((group) => group.shots) },
    { label: t("boardPanels.chat.group.results"), assets: index.results },
    { label: t("boardPanels.chat.group.documents"), assets: [...index.documents, ...index.finals, ...index.others] },
  ], [index]);
  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({ ...group, assets: group.assets.filter((asset) => !taken.has(asset) && (!needle || referenceName(asset).toLowerCase().includes(needle))) }))
    .filter((group) => group.assets.length);
  return (
    <section data-reference-picker="" aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <div data-picker-head="" className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-panel pb-2 pt-3">
        <h3 id={headingId} className="text-[13px] font-semibold leading-[18px] text-ink">{t("boardPanels.chat.pickerTitle")}</h3>
        <button type="button" className="ui-button ui-button-sm" onClick={onDone}>{t("boardPanels.chat.pickerDone")}</button>
      </div>
      <input
        ref={filterRef}
        type="text"
        dir="auto"
        value={query}
        aria-label={t("boardPanels.chat.pickerFilter")}
        placeholder={t("boardPanels.chat.pickerFilter")}
        className="mb-1 h-8 w-full rounded-lg border border-hairline bg-transparent px-2.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-tertiary focus:border-ink-secondary"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length ? shown.map((group) => (
          <RowGroup key={group.label} label={group.label}>
            {group.assets.map((asset) => (
              <PickRow key={asset.cardId} asset={asset} onAdd={onAdd}>
                <PickThumb asset={asset} pictureUrl={pictureUrl} />
              </PickRow>
            ))}
          </RowGroup>
        )) : <EmptyLine text={t("boardPanels.chat.pickerEmpty")} />}
      </div>
    </section>
  );
}

function PickThumb({ asset, pictureUrl }: { asset: BoardAsset; pictureUrl(file: CanvasFileRef): string }) {
  const file = asset.media?.type === "image" ? asset.media.metadata?.file : undefined;
  const Icon = asset.media?.type === "video" ? Film : FileText;
  return (
    <span data-thumb="" aria-hidden="true" className="grid h-[30px] w-[44px] shrink-0 place-items-center overflow-hidden rounded-sm bg-control text-ink-secondary">
      {file ? <img src={pictureUrl(file)} alt="" loading="lazy" className="size-full object-cover" /> : <Icon size={14} />}
    </span>
  );
}

function PickRow({ asset, onAdd, children }: { asset: BoardAsset; onAdd(asset: BoardAsset): void; children: ReactNode }) {
  const name = referenceName(asset);
  return (
    <li>
      <button
        type="button"
        data-pick={asset.node.id}
        className="flex w-full items-center gap-2.5 rounded-[8px] border border-hairline py-1 pe-2 ps-1 text-start text-[13px] leading-[18px] transition-colors duration-[120ms] hover:border-hairline hover:bg-card motion-reduce:transition-none"
        onClick={() => onAdd(asset)}
      >
        {children}
        <span title={name} className="min-w-0 flex-1 truncate">{name}</span>
      </button>
    </li>
  );
}
