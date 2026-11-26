import { episodeCode, shotCode } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardShotRef } from "./parts";

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

export const paletteColours = (palette: readonly string[] | undefined): string[] => palette?.filter((colour) => COLOUR.test(colour)) ?? [];
