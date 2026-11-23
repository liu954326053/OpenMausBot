import { episodeCode } from "../../../../shared/production";
import type { CanvasBotState, CanvasFileRef } from "../../../../shared/project-canvas";
import type { ProjectDraftWire } from "../../../../shared/project-draft";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { assetCode, EPISODE_STATUS_KEYS, episodeProgress } from "./asset-words";
import type { AssetKind, BoardAsset, BoardIndex } from "./board-index";

const CONTENT_HEADINGS: Partial<Record<AssetKind, LocaleKey>> = {
  character: "boardPanels.details.profile",
  scene: "boardPanels.details.profile",
  episode: "boardPanels.details.script",
};

const DRAFT_UNAVAILABLE_KEYS: Record<NonNullable<ProjectDraftWire["reason"]>, LocaleKey> = {
  "not-installed": "boardPanels.draft.notInstalled",
  remote: "boardPanels.draft.remote",
  "unsupported-version": "boardPanels.draft.unsupportedVersion",
};

export type DetailsFact = { label: string; text: string; danger?: true } | { label: string; colors: readonly string[] };

/** What an asset's details show, worded in the language of the moment. */
export interface DetailsView {
  nodeId: string;
  cardId: string;
  kind: AssetKind;
  /** Empty for what belongs to no episode. */
  code: string;
  title: string;
  badge: string | undefined;
  /** An episode shows its logline among its facts instead. */
  subtitle: string | undefined;
  tags: readonly string[];
  preview: { type: "image" | "video" | "audio"; url: string } | null;
  facts: readonly DetailsFact[];
  content: string | undefined;
  contentHeading: LocaleKey | undefined;
  /** What it was generated from: a picture's prompt for a character or a scene, a shot's own for a shot and its video. */
  prompt: string | undefined;
  /** The shots a character or a scene is in; null for anything else. */
  appearances: ReadonlyArray<{ nodeId: string; cardId: string; code: string; title: string }> | null;
  /** The bot asked to change it, when it is in the project. */
  owner: { botId: string; name: string } | null;
}

export function detailsView(
  asset: BoardAsset,
  index: BoardIndex,
  owner: CanvasBotState | undefined,
  drafts: Record<number, ProjectDraftWire> | undefined,
  fileUrl: (file: CanvasFileRef) => string,
): DetailsView {
  const metadata = asset.node.metadata;
  const card = metadata?.card;
  const shown = previewOf(asset);
  return {
    nodeId: asset.node.id,
    cardId: asset.cardId,
    kind: asset.kind,
    code: assetCode(asset),
    title: asset.title,
    badge: card?.badge,
    subtitle: asset.kind === "episode" ? undefined : card?.subtitle,
    tags: card?.tags ?? [],
    preview: shown ? { type: shown.type, url: fileUrl(shown.file) } : null,
    facts: factsOf(asset, index, drafts),
    content: metadata?.content,
    contentHeading: CONTENT_HEADINGS[asset.kind],
    prompt: promptOf(asset, index),
    appearances: asset.kind === "character" || asset.kind === "scene"
      ? index.appearances(asset).map((shot) => ({ nodeId: shot.node.id, cardId: shot.cardId, code: assetCode(shot), title: shot.title }))
      : null,
    owner: owner ? { botId: owner.botId, name: owner.name } : null,
  };
}

function previewOf(asset: BoardAsset): { type: "image" | "video" | "audio"; file: CanvasFileRef } | null {
  const media = asset.media;
  const file = media?.metadata?.file;
  if (!media || !file || !(media.type === "image" || media.type === "video" || media.type === "audio")) return null;
  return { type: media.type, file };
}

const seconds = (count: number): string => t("boardPanels.fact.seconds", { count });

function factsOf(asset: BoardAsset, index: BoardIndex, drafts: Record<number, ProjectDraftWire> | undefined): DetailsFact[] {
  const metadata = asset.node.metadata;
  const fact = (label: string, text: string): DetailsFact => ({ label, text });
  const episode = asset.episode === undefined ? [] : [fact(t("boardPanels.fact.episode"), episodeCode(asset.episode))];
  switch (asset.kind) {
    case "shot": {
      const design = metadata?.shot;
      const length = metadata?.settings?.seconds;
      return [
        ...episode,
        ...(design?.size ? [fact(t("boardPanels.fact.size"), design.size)] : []),
        ...(design?.move ? [fact(t("boardPanels.fact.move"), design.move)] : []),
        ...(length ? [fact(t("boardPanels.fact.length"), seconds(length))] : []),
        ...(design?.audio ? [fact(t("boardPanels.fact.audio"), design.audio)] : []),
      ];
    }
    case "result": {
      const takes = asset.takes ?? [];
      const selected = takes.findIndex((take) => take.metadata?.selected);
      const status = metadata?.status;
      return [
        ...episode,
        fact(t("boardPanels.fact.versions"), String(takes.length)),
        fact(t("boardPanels.fact.selected"), selected < 0 ? t("boardPanels.fact.selectedNone") : t("boardPanels.fact.selectedVersion", { number: selected + 1 })),
        ...(status === "loading" ? [fact(t("boardPanels.fact.status"), t("boardPanels.fact.generating"))] : []),
        ...(status === "error" ? [{ label: t("boardPanels.fact.status"), text: t("boardPanels.fact.generateFailed"), danger: true } satisfies DetailsFact] : []),
      ];
    }
    case "final": {
      const length = asset.media?.metadata?.durationMs;
      return [
        ...episode,
        ...(length ? [fact(t("boardPanels.fact.length"), seconds(Math.round(length / 1000)))] : []),
        ...(drafts ? [fact(t("boardPanels.fact.draft"), draftWords(drafts[asset.episode!]))] : []),
      ];
    }
    case "episode": {
      const row = index.episodes.find((each) => each.episode === asset.episode);
      return [
        ...(metadata?.card?.subtitle ? [fact(t("boardPanels.fact.logline"), metadata.card.subtitle)] : []),
        ...(row?.status ? [fact(t("boardPanels.fact.status"), t(EPISODE_STATUS_KEYS[row.status]))] : []),
        ...(row ? [fact(t("boardPanels.fact.shots"), episodeProgress(row))] : []),
      ];
    }
    default: {
      const palette = metadata?.card?.palette;
      return [
        ...(metadata?.card?.rows ?? []).map(([label, value]) => fact(label, value)),
        ...(palette?.length ? [{ label: t("boardPanels.fact.colors"), colors: palette } satisfies DetailsFact] : []),
      ];
    }
  }
}

function draftWords(draft: ProjectDraftWire | undefined): string {
  if (!draft || draft.state === "none") return t("boardPanels.draft.none");
  if (draft.state === "written") return t("boardPanels.draft.written", { name: draft.name! });
  if (draft.state === "kept") return t("boardPanels.draft.kept");
  return t(DRAFT_UNAVAILABLE_KEYS[draft.reason!]);
}

function promptOf(asset: BoardAsset, index: BoardIndex): string | undefined {
  const own = asset.node.metadata?.prompt;
  if (asset.kind === "result") return own ?? index.assetOf(asset.node.metadata!.shotId!)?.node.metadata?.prompt;
  return own ?? asset.media?.metadata?.prompt;
}
