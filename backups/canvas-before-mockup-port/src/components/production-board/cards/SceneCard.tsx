import { GitBranch, ImageOff } from "lucide-react";
import type { CanvasCardFacts } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { AssetShots, paletteColours } from "./asset-parts";
import { CardName, CardShell, failureText, PaperButton, type BoardGeneration, type BoardShotRef } from "./parts";

export interface SceneCardProps {
  name: string;
  facts?: CanvasCardFacts;
  pictureUrl?: string;
  /** How its newest picture is being made. */
  generation?: BoardGeneration;
  shots?: readonly BoardShotRef[];
  /** The bot that refined the scene for its episode's shots. */
  refinedBy?: string;
  onOpen?: () => void;
  onGenerate?: () => void;
}

export function SceneCard({ name, facts, pictureUrl, generation, shots, refinedBy, onOpen, onGenerate }: SceneCardProps) {
  const palette = paletteColours(facts?.palette);
  const subtitle = facts?.subtitle?.trim();
  const tags = facts?.tags?.filter((tag) => tag.trim()) ?? [];
  return (
    <CardShell kind="scene" label={name} surface="panel" onOpen={onOpen}>
      <div data-asset-picture="" className="relative aspect-video w-full shrink-0 overflow-hidden bg-app">
        {pictureUrl ? (
          <img src={pictureUrl} alt={t("boardCards.asset.picture", { name })} draggable={false} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-[12px] leading-4 text-ink-tertiary">
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
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-board-monitor/95 via-board-monitor/55 to-transparent pt-10" />
        <div data-scene-caption="" className="absolute inset-x-0 bottom-0 min-w-0 px-3 pb-2">
          <CardName text={name} onOpen={onOpen} className="block w-full text-[18px] font-semibold leading-6 tracking-[0.02em] text-board-paper" />
          {subtitle ? <div data-asset-subtitle="" dir="auto" title={subtitle} className="truncate text-[12px] leading-4 text-board-paper/70">{subtitle}</div> : null}
        </div>
        {refinedBy ? (
          <span
            data-scene-refined=""
            title={t("boardCards.scene.refinedBy", { name: refinedBy })}
            className="absolute end-2 top-2 inline-flex h-5 items-center gap-1 rounded bg-board-amber px-1.5 text-[12px] font-semibold leading-4 text-board-ink"
          >
            <GitBranch size={12} aria-hidden="true" />
            {t("boardCards.scene.refined")}
          </span>
        ) : null}
        {pictureUrl && generation?.status === "loading" ? (
          <span data-asset-generating="" className="absolute start-2 top-2 inline-flex h-5 items-center rounded bg-board-ink/85 px-1.5 text-[12px] leading-4 text-board-paper">{t("boardCards.generating")}</span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-1.5 pt-2">
        <div data-scene-meta="" className="flex min-w-0 items-center justify-between gap-2 text-[12px] leading-4">
          <span dir="auto" title={tags.join(" · ")} className="min-w-0 flex-1 truncate text-ink-secondary">{tags.join(" · ")}</span>
          <AssetShots shots={shots} verb="usedIn" className="min-w-0 max-w-[55%] text-end text-ink-tertiary" />
        </div>
      </div>
      {palette.length ? (
        <div data-scene-palette="" aria-hidden="true" className="flex h-1.5 w-full shrink-0 overflow-hidden">
          {palette.map((colour, index) => (
            <span key={index} data-asset-swatch="" title={colour} className="flex-1" style={{ backgroundColor: colour }} />
          ))}
        </div>
      ) : null}
    </CardShell>
  );
}
