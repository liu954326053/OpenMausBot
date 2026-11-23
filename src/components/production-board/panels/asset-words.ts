import { episodeCode } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { AssetKind, BoardAsset, EpisodeRow } from "./board-index";

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

export const EPISODE_STATUS_KEYS: Record<NonNullable<EpisodeRow["status"]>, LocaleKey> = {
  waiting: "boardPanels.episodeStatus.waiting",
  storyboard: "boardPanels.episodeStatus.storyboard",
  videos: "boardPanels.episodeStatus.videos",
  post: "boardPanels.episodeStatus.post",
  done: "boardPanels.episodeStatus.done",
  failed: "boardPanels.episodeStatus.failed",
};

/** "3/5 selected", or that the episode has no shots yet. */
export const episodeProgress = (row: EpisodeRow): string =>
  row.shots ? t("boardPanels.episodes.ready", { ready: row.ready, shots: row.shots }) : t("boardPanels.episodes.noShots");
