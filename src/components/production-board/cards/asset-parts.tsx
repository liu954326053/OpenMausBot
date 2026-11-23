import { ImageOff, Sparkles } from "lucide-react";
import type { CanvasCardFacts } from "../../../../shared/project-canvas";
import { episodeCode } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardAction, failureText, PicturePlaceholder, shotCode, type BoardGeneration, type BoardShotRef } from "./parts";

const COLOUR = /^#[0-9a-f]{6}$/i;

export function shotList(shots: readonly BoardShotRef[]): string {
  const episodes = new Set(shots.map((shot) => shot.episode));
  const named = episodes.size > 1;
  return shots.map((shot) => (named && shot.episode !== undefined ? `${episodeCode(shot.episode)} ${shotCode(shot.number)}` : shotCode(shot.number))).join(" · ");
}

export function AssetShots({ shots, verb, className }: { shots: readonly BoardShotRef[] | undefined; verb: "appearsIn" | "usedIn"; className?: string }) {
  const text = shots?.length ? t(`boardCards.asset.${verb}`, { shots: shotList(shots) }) : t("boardCards.asset.inNoShot");
  return <span data-asset-shots="" title={text} className={cn("min-w-0 truncate text-[12px] leading-4 text-ink-tertiary", className)}>{text}</span>;
}

/** A character's or a scene's picture, or what stands in its place while there is none. */
export function AssetPicture({ name, pictureUrl, generation, onGenerate, className }: {
  name: string;
  pictureUrl?: string;
  generation?: BoardGeneration;
  onGenerate?: () => void;
  className?: string;
}) {
  const making = generation?.status === "loading";
  if (pictureUrl) {
    return (
      <div data-asset-picture="" className={cn("relative overflow-hidden bg-ink/[0.04]", className)}>
        <img src={pictureUrl} alt={t("boardCards.asset.picture", { name })} draggable={false} className="size-full object-cover" />
        {making ? <span data-asset-generating="" className="ui-chip absolute left-2 top-2 bg-card text-ink-secondary">{t("boardCards.generating")}</span> : null}
      </div>
    );
  }
  return (
    <div data-asset-picture="" className={cn("overflow-hidden", className)}>
      {making ? (
        <PicturePlaceholder>{t("boardCards.generating")}</PicturePlaceholder>
      ) : generation?.status === "error" ? (
        <PicturePlaceholder>
          <span data-asset-failure="" title={failureText(generation)} className="line-clamp-3 text-danger">{failureText(generation)}</span>
          {onGenerate ? <CardAction label={t("boardCards.generateAgain")} onClick={onGenerate} /> : null}
        </PicturePlaceholder>
      ) : (
        <PicturePlaceholder>
          <ImageOff size={14} aria-hidden="true" />
          <span>{t("boardCards.asset.noPicture")}</span>
          {onGenerate ? <CardAction icon={<Sparkles size={14} aria-hidden="true" />} label={t("boardCards.asset.generatePicture")} onClick={onGenerate} /> : null}
        </PicturePlaceholder>
      )}
    </div>
  );
}

export function AssetSubtitle({ facts }: { facts?: CanvasCardFacts }) {
  const subtitle = facts?.subtitle?.trim();
  return subtitle ? <div data-asset-subtitle="" dir="auto" title={subtitle} className="truncate text-[12px] leading-4 text-ink-tertiary">{subtitle}</div> : null;
}

export function AssetTags({ tags, className }: { tags?: readonly string[]; className?: string }) {
  if (!tags?.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1 overflow-hidden", className)}>
      {tags.map((tag, index) => <span key={index} data-asset-tag="" dir="auto" className="ui-chip max-w-full truncate bg-control text-ink-secondary">{tag}</span>)}
    </div>
  );
}

export function AssetPalette({ palette }: { palette?: readonly string[] }) {
  const colours = palette?.filter((colour) => COLOUR.test(colour)) ?? [];
  if (colours.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {colours.map((colour, index) => <span key={index} data-asset-swatch="" title={colour} className="size-3 rounded-full border border-hairline" style={{ backgroundColor: colour }} />)}
    </div>
  );
}
