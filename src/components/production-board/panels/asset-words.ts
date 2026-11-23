import { episodeCode } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { AssetKind, BoardAsset } from "./board-index";

export const KIND_KEYS: Record<AssetKind, LocaleKey> = {
  character: "boardPanels.kind.character",
  scene: "boardPanels.kind.scene",
  episode: "boardPanels.kind.episode",
  shot: "boardPanels.kind.shot",
  result: "boardPanels.kind.result",
  final: "boardPanels.kind.final",
  brief: "boardPanels.kind.brief",
  plan: "boardPanels.kind.plan",
  text: "boardPanels.kind.text",
  image: "boardPanels.kind.image",
  video: "boardPanels.kind.video",
  audio: "boardPanels.kind.audio",
  file: "boardPanels.kind.file",
};

/** "EP01 SH03": where it sits in the drama; empty for what belongs to no episode. */
export function assetCode(asset: BoardAsset): string {
  if (asset.episode === undefined) return "";
  return asset.code ? `${episodeCode(asset.episode)} ${asset.code}` : episodeCode(asset.episode);
}

/** "Shot EP01 SH03". */
export function assetKindLabel(asset: BoardAsset): string {
  return [t(KIND_KEYS[asset.kind]), assetCode(asset)].filter(Boolean).join(" ");
}
