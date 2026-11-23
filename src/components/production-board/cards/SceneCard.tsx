import type { CanvasCardFacts } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { AssetPicture, AssetShots, AssetSubtitle, AssetTags } from "./asset-parts";
import { CardName, CardShell, type BoardGeneration, type BoardShotRef } from "./parts";

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
  return (
    <CardShell kind="scene" label={name} onOpen={onOpen}>
      <AssetPicture name={name} pictureUrl={pictureUrl} generation={generation} onGenerate={onGenerate} className="h-[150px] w-full shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2.5">
        <CardName text={name} onOpen={onOpen} className="text-[17px] font-semibold leading-6" />
        <AssetSubtitle facts={facts} />
        <AssetTags tags={facts?.tags} className="max-h-[24px] pt-1" />
        <div className="mt-auto flex min-w-0 items-center gap-3 pt-1.5">
          <AssetShots shots={shots} verb="usedIn" className="flex-1" />
          {refinedBy ? (
            <span data-scene-refined="" dir="auto" title={t("boardCards.scene.refinedBy", { name: refinedBy })} className="min-w-0 max-w-[50%] truncate text-[12px] leading-4 text-ink-tertiary">
              {t("boardCards.scene.refinedBy", { name: refinedBy })}
            </span>
          ) : null}
        </div>
      </div>
    </CardShell>
  );
}
