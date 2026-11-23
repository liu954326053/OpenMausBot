import type { CanvasCardFacts } from "../../../../shared/project-canvas";
import { AssetPalette, AssetPicture, AssetShots, AssetSubtitle, AssetTags } from "./asset-parts";
import { CardName, CardShell, type BoardGeneration, type BoardShotRef } from "./parts";

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
  return (
    <CardShell kind="character" label={name} onOpen={onOpen}>
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <AssetPicture name={name} pictureUrl={pictureUrl} generation={generation} onGenerate={onGenerate} className="h-full w-[138px] shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <CardName text={name} onOpen={onOpen} className="text-[17px] font-semibold leading-6" />
            {badge ? <span data-asset-badge="" dir="auto" className="ui-chip shrink-0 bg-control text-ink-secondary">{badge}</span> : null}
          </div>
          <AssetSubtitle facts={facts} />
          <AssetTags tags={facts?.tags} rows={2} className="mt-2 shrink-0" />
          {facts?.rows?.length ? (
            <dl className="flex flex-col gap-0.5 pt-2">
              {facts.rows.slice(0, ROWS_SHOWN).map(([label, value], index) => (
                <div key={index} data-asset-row="" className="flex min-w-0 gap-2 text-[12px] leading-4">
                  <dt dir="auto" className="max-w-[40%] shrink-0 truncate text-ink-tertiary">{label}</dt>
                  <dd dir="auto" title={value} className="min-w-0 truncate text-ink-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-auto flex min-w-0 items-center gap-2 pt-2">
            <AssetPalette palette={facts?.palette} />
            <AssetShots shots={shots} verb="appearsIn" className="flex-1 text-end" />
          </div>
        </div>
      </div>
    </CardShell>
  );
}
