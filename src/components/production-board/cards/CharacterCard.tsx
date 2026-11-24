import { ImageOff } from "lucide-react";
import type { CanvasCardFacts } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AssetShots, paletteColours } from "./asset-parts";
import { CardShell, failureText, PaperButton, type BoardGeneration, type BoardShotRef } from "./parts";

export interface CharacterCardProps {
  name: string;
  facts?: CanvasCardFacts;
  pictureUrl?: string;
  /** How its newest picture is being made. */
  generation?: BoardGeneration;
  shots?: readonly BoardShotRef[];
  onOpen?: () => void;
  onGenerate?: () => void;
}

const ROWS_SHOWN = 3;

export function CharacterCard({ name, facts, pictureUrl, generation, shots, onOpen, onGenerate }: CharacterCardProps) {
  const badge = facts?.badge?.trim();
  const colours = paletteColours(facts?.palette);
  const tags = facts?.tags?.filter((tag) => tag.trim()) ?? [];
  return (
    <CardShell kind="character" label={name} surface="paper" onOpen={onOpen} className="flex-row">
      <div data-asset-picture="" className="relative w-38 shrink-0 overflow-hidden bg-board-paper-2">
        {pictureUrl ? (
          <img src={pictureUrl} alt={t("boardCards.asset.picture", { name })} draggable={false} className="size-full object-cover object-top" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-[12px] leading-4 text-board-ink-3">
            {generation?.status === "error" ? (
              <>
                <span data-asset-failure="" title={failureText(generation)} className="line-clamp-3">{failureText(generation)}</span>
                {onGenerate ? <PaperButton label={t("boardCards.generateAgain")} onClick={onGenerate} /> : null}
              </>
            ) : (
              <>
                <ImageOff size={16} aria-hidden="true" />
                <span>{generation?.status === "loading" ? t("boardCards.generating") : t("boardCards.asset.noPicture")}</span>
                {generation?.status === "loading" ? null : onGenerate ? <PaperButton label={t("boardCards.asset.generatePicture")} onClick={onGenerate} /> : null}
              </>
            )}
          </div>
        )}
        {pictureUrl && generation?.status === "loading" ? (
          <span data-asset-generating="" className="absolute start-2 top-2 inline-flex h-5 items-center rounded bg-board-ink/85 px-1.5 text-[12px] leading-4 text-board-paper">{t("boardCards.generating")}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3.5 py-3">
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          {badge ? <span data-asset-badge="" dir="auto" className="inline-flex h-5 shrink-0 items-center rounded bg-board-ink px-2 text-[12px] font-semibold leading-4 text-board-paper">{badge}</span> : null}
        </div>
        <h3 data-card-name="" title={name} dir="auto" className="truncate text-[21px] font-semibold leading-7 tracking-[0.02em] text-board-ink">{name}</h3>
        {facts?.subtitle?.trim() ? <div data-asset-subtitle="" dir="auto" title={facts.subtitle} className="truncate text-[13px] leading-[18px] text-board-ink-2">{facts.subtitle}</div> : null}
        {tags.length ? (
          <div className="flex h-5 min-w-0 flex-nowrap gap-1 overflow-hidden">
            {tags.map((tag, index) => (
              <span key={index} data-asset-tag="" dir="auto" title={tag} className="inline-flex h-5 shrink-0 items-center rounded border border-board-paper-line px-1.5 text-[11px] leading-4 text-board-ink-2">
                <span className="truncate">{tag}</span>
              </span>
            ))}
          </div>
        ) : null}
        {facts?.rows?.length ? (
          <dl className="flex min-h-0 flex-col gap-1 pt-0.5">
            {facts.rows.slice(0, ROWS_SHOWN).map(([label, value], index) => (
              <div key={index} data-asset-row="" className="flex min-w-0 gap-2 text-[12px] leading-4">
                <dt dir="auto" className="w-8 shrink-0 truncate text-board-ink-3">{label}</dt>
                <dd dir="auto" title={value} className="min-w-0 truncate text-board-ink-2">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-1">
          {colours.length ? (
            <span data-asset-palette="" aria-hidden="true" className="flex shrink-0">
              {colours.map((colour, index) => (
                <i key={index} data-asset-swatch="" title={colour} className={cn("size-4 rounded-full border-2 border-board-paper", index > 0 && "-ms-1")} style={{ backgroundColor: colour }} />
              ))}
            </span>
          ) : <span />}
          <AssetShots shots={shots} verb="appearsIn" className="text-board-ink-3" />
        </div>
      </div>
    </CardShell>
  );
}
