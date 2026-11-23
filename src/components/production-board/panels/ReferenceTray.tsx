import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Film, Link2, Plus, X } from "lucide-react";
import type { CanvasFileRef } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { assetCode, assetKindLabel } from "./asset-words";
import type { BoardAsset, BoardIndex } from "./board-index";
import { EmptyLine, PANEL_ROW, RowGroup } from "./panel-parts";

const CHIP = "ui-chip max-w-48 bg-ink/[0.06] text-ink-secondary";

function Thumb({ asset, pictureUrl, size }: { asset: BoardAsset; pictureUrl(file: CanvasFileRef): string; size: "chip" | "row" }) {
  const file = asset.media?.type === "image" ? asset.media.metadata?.file : undefined;
  const box = size === "chip" ? "size-4 rounded-full" : "size-7 rounded-md";
  if (file) return <img src={pictureUrl(file)} alt="" loading="lazy" className={`${box} shrink-0 bg-inset object-cover`} />;
  const Icon = asset.media?.type === "video" ? Film : FileText;
  return size === "chip"
    ? <Icon size={14} aria-hidden="true" className="shrink-0" />
    : <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center bg-ink/[0.06] text-ink-tertiary`}><Icon size={16} /></span>;
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
      <div className="flex items-center justify-between gap-2 text-[12px] leading-4 text-ink-tertiary">
        <span id={labelId} className="font-medium">{t("boardPanels.chat.references")}</span>
        {count ? <span className="tabular-nums">{count === 1 ? t("boardPanels.chat.referenceCount.one") : t("boardPanels.chat.referenceCount", { count })}</span> : null}
      </div>
      <ul aria-labelledby={labelId} className="flex max-h-[76px] flex-wrap items-center gap-1.5 overflow-y-auto">
        {connected.map((asset) => (
          <li key={asset.cardId} data-reference={asset.node.id} title={`${assetKindLabel(asset)} · ${asset.title}\n${t("boardPanels.chat.connected", { name: botName })}`} className={CHIP}>
            <Link2 size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{asset.title}</span>
          </li>
        ))}
        {extras.map((asset) => (
          <li key={asset.cardId} data-reference={asset.node.id} title={`${assetKindLabel(asset)} · ${asset.title}`} className={`${CHIP} pe-0.5`}>
            <Thumb asset={asset} pictureUrl={pictureUrl} size="chip" />
            <span className="truncate">{asset.title}</span>
            <button
              type="button"
              aria-label={t("boardPanels.chat.removeReference", { title: asset.title })}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors duration-[120ms] hover:bg-ink/[0.08] hover:text-ink motion-reduce:transition-none"
              onClick={() => onRemove(asset)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="ui-pill min-h-[22px] px-2 text-[12px] leading-4" aria-expanded={pickerOpen} onClick={onPick}>
            <Plus size={14} aria-hidden="true" />
            {t("boardPanels.chat.addReference")}
          </button>
        </li>
      </ul>
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
    <section data-reference-picker="" aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-[13px] font-medium leading-[18px] text-ink">{t("boardPanels.chat.pickerTitle")}</h3>
        <button type="button" className="ui-button ui-button-sm" onClick={onDone}>{t("boardPanels.chat.pickerDone")}</button>
      </div>
      <input
        ref={filterRef}
        type="text"
        dir="auto"
        value={query}
        aria-label={t("boardPanels.chat.pickerFilter")}
        placeholder={t("boardPanels.chat.pickerFilter")}
        className="h-8 w-full rounded-lg border border-hairline bg-transparent px-2.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-tertiary"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {shown.length ? shown.map((group) => (
          <RowGroup key={group.label} label={group.label}>
            {group.assets.map((asset) => (
              <PickRow key={asset.cardId} asset={asset} onAdd={onAdd}>
                <Thumb asset={asset} pictureUrl={pictureUrl} size="row" />
              </PickRow>
            ))}
          </RowGroup>
        )) : <EmptyLine text={t("boardPanels.chat.pickerEmpty")} />}
      </div>
    </section>
  );
}

function PickRow({ asset, onAdd, children }: { asset: BoardAsset; onAdd(asset: BoardAsset): void; children: ReactNode }) {
  const name = referenceName(asset);
  return (
    <li>
      <button type="button" data-pick={asset.node.id} className={PANEL_ROW} onClick={() => onAdd(asset)}>
        {children}
        <span title={name} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{name}</span>
      </button>
    </li>
  );
}
