import { episodeCode } from "../../../../shared/production";
import type { CanvasBotState, CanvasFileRef } from "../../../../shared/project-canvas";
import { sameFields, sameItems } from "@/state/store-select";
import type { BoardAsset, BoardIndex, EpisodeRow } from "./board-index";

export interface TeamFacts {
  botId: string;
  name: string;
  title: string;
  status: CanvasBotState["status"];
  lead: boolean;
}

export interface AssetFacts {
  cardId: string;
  title: string;
  meta: string | undefined;
  /** The address of its picture. */
  picture: string | undefined;
}

export interface ShotFacts {
  cardId: string;
  code: string | undefined;
  title: string;
  seconds: number | undefined;
}

export interface EpisodeShotsFacts {
  episode: number;
  title: string;
  shots: readonly ShotFacts[];
}

/** What the side panel's rows show, by tab. A row showing what it showed for the last snapshot keeps its object, and a
 * list with no such change keeps its array, so a memoised row draws again only when what it shows changed. */
export interface PanelRows {
  team: { drama: readonly TeamFacts[]; episodes: readonly TeamFacts[] };
  characters: readonly AssetFacts[];
  scenes: readonly AssetFacts[];
  shots: readonly EpisodeShotsFacts[];
  finals: readonly AssetFacts[];
  episodes: readonly EpisodeRow[];
}

const byCard = (facts: { cardId: string }) => facts.cardId;
const teamFacts = ({ botId, name, title, status, lead }: CanvasBotState): TeamFacts => ({ botId, name, title, status, lead });
const shotFacts = (shot: BoardAsset): ShotFacts => ({ cardId: shot.cardId, code: shot.code, title: shot.title, seconds: shot.node.metadata?.settings?.seconds });

/** `next`, where each item that shows what the item of its key in `last` showed is that item, or `last` itself when
 * every item is. */
function kept<Item extends object>(last: readonly Item[] | undefined, next: Item[], keyOf: (item: Item) => string | number): readonly Item[] {
  if (!last) return next;
  const before = new Map(last.map((item) => [keyOf(item), item]));
  const merged = next.map((item) => {
    const old = before.get(keyOf(item));
    return old && sameFields(old, item) ? old : item;
  });
  return sameItems(last, merged) ? last : merged;
}

export function panelRows(index: BoardIndex, pictureUrl: (file: CanvasFileRef) => string, last: PanelRows | null): PanelRows {
  const profileFacts = (asset: BoardAsset): AssetFacts => {
    const file = asset.media?.metadata?.file;
    return { cardId: asset.cardId, title: asset.title, meta: asset.node.metadata?.card?.subtitle, picture: file ? pictureUrl(file) : undefined };
  };
  const titles = new Map(index.episodes.map((row) => [row.episode, row.title]));
  const lastShots = new Map(last?.shots.map((group) => [group.episode, group.shots]));
  const team = {
    drama: kept(last?.team.drama, index.team.drama.map(teamFacts), (bot) => bot.botId),
    episodes: kept(last?.team.episodes, index.team.episodes.map(teamFacts), (bot) => bot.botId),
  };
  const next: PanelRows = {
    team: last && sameFields(last.team, team) ? last.team : team,
    characters: kept(last?.characters, index.characters.map(profileFacts), byCard),
    scenes: kept(last?.scenes, index.scenes.map(profileFacts), byCard),
    shots: kept(last?.shots, index.shotsByEpisode.map(({ episode, shots }) => ({
      episode,
      title: titles.get(episode) ?? "",
      shots: kept(lastShots.get(episode), shots.map(shotFacts), byCard),
    })), (group) => group.episode),
    finals: kept(last?.finals, index.finals.map((asset) => ({ cardId: asset.cardId, title: asset.title, meta: episodeCode(asset.episode!), picture: undefined })), byCard),
    episodes: kept(last?.episodes, index.episodes, (row) => row.episode),
  };
  return last && sameFields(last, next) ? last : next;
}
