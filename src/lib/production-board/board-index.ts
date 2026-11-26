import { EPISODE_JOBS, shotCode, type EpisodeJob, type ProductionEpisodeWire } from "../../../shared/production";
import { botNodeId, type CanvasBotState, type CanvasNode, type CanvasSnapshot } from "../../../shared/project-canvas";
import type { FlowStage } from "../../../shared/team-pipeline";
import { splitTeamByEpisode, type EpisodeBotPlace } from "@/lib/team-projects";

export type AssetKind = "character" | "scene" | "episode" | "shot" | "result" | "final" | "brief" | "plan" | "text" | "image" | "video" | "audio" | "file";

/** One thing the board draws a card for, and every node that is part of it. */
export interface BoardAsset {
  kind: AssetKind;
  /** The node of its card on the board: a character's or a scene's group when it has one. */
  cardId: string;
  /** What a bot reads it by: a character's or a scene's profile, a shot, a result's creation, an episode's script. */
  node: CanvasNode;
  title: string;
  episode?: number;
  /** A shot's and its result's place in their episode, such as "SH03". */
  code?: string;
  /** The node whose file shows it: a profile's picture, a shot's or a result's take, the film itself. */
  media?: CanvasNode;
  /** A shot's and its result's takes, oldest first. */
  takes?: CanvasNode[];
}

export interface EpisodeRow {
  episode: number;
  nodeId?: string;
  title: string;
  /** Absent in a project from before productions. */
  status?: ProductionEpisodeWire["status"];
  shots: number;
  /** Shots with a selected take. */
  ready: number;
}

export interface BoardIndex {
  /** `drama`: the lead, then the bots of the drama's jobs in the order the work goes. `episodes`: each episode's bots,
   * by episode, storyboard before post. */
  team: { drama: CanvasBotState[]; episodes: CanvasBotState[] };
  characters: BoardAsset[];
  scenes: BoardAsset[];
  shotsByEpisode: Array<{ episode: number; shots: BoardAsset[] }>;
  results: BoardAsset[];
  finals: BoardAsset[];
  /** Each episode's script, by episode. */
  scripts: BoardAsset[];
  /** The brief and the plan. */
  documents: BoardAsset[];
  others: BoardAsset[];
  episodes: EpisodeRow[];
  assetOf(nodeId: string): BoardAsset | null;
  /** The shots a character or a scene is connected into, in episode and shot order. */
  appearances(asset: BoardAsset): BoardAsset[];
  /** The bot asked to change it: the one whose job made it, and the lead for what no job makes. */
  ownerOf(asset: BoardAsset): string;
  /** What is connected into the bot's node, which the server sends with every task to it. */
  connectedInto(botId: string): BoardAsset[];
  /** What a bot works from without a line drawn to it: a storyboard bot has every character and scene. */
  libraryFor(botId: string): BoardAsset[];
}

const WORK_ORDER: readonly FlowStage[] = ["lead", "script", "character", "scene", "storyboard", "post", "other"];
const FILE_KINDS = new Set<CanvasNode["type"]>(["text", "image", "video", "audio", "file"]);

function workRank(bot: CanvasBotState): number {
  if (bot.lead) return -1;
  const ranks = bot.stages.map((stage) => WORK_ORDER.indexOf(stage));
  return ranks.length ? Math.min(...ranks) : WORK_ORDER.length;
}

const isEpisodeStage = (stage: FlowStage): stage is EpisodeJob => (EPISODE_JOBS as readonly FlowStage[]).includes(stage);

const episodePlace = (bot: CanvasBotState): EpisodeBotPlace | undefined =>
  bot.lead || bot.episode === undefined ? undefined : { number: bot.episode, job: bot.stages.find(isEpisodeStage) };

function teamInOrder(bots: readonly CanvasBotState[]): BoardIndex["team"] {
  const { drama, episodes } = splitTeamByEpisode(bots, episodePlace);
  drama.sort((a, b) => workRank(a) - workRank(b));
  return { drama, episodes: episodes.flatMap((episode) => episode.bots) };
}

function push<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const hasFile = (node: CanvasNode): boolean => Boolean(node.metadata?.file);
const chosen = (nodes: readonly CanvasNode[]): CanvasNode | undefined => nodes.find((node) => node.metadata?.selected) ?? nodes.at(-1);

export function boardIndex(snapshot: CanvasSnapshot): BoardIndex {
  const team = teamInOrder(Object.values(snapshot.bots));
  const leadBotId = snapshot.project.leadBotId;
  const assets = new Map<string, BoardAsset>();
  const groupMembers = new Map<string, CanvasNode[]>();
  const takesByShot = new Map<string, CanvasNode[]>();
  const creationByShot = new Map<string, CanvasNode>();
  const profileGroups = new Set<string>();
  for (const node of snapshot.nodes) {
    const metadata = node.metadata;
    if (node.groupId) push(groupMembers, node.groupId, node);
    if ((metadata?.role === "character" || metadata?.role === "scene") && node.groupId) profileGroups.add(node.groupId);
    if (metadata?.role === "take" && metadata.shotId && hasFile(node)) push(takesByShot, metadata.shotId, node);
    if (metadata?.role === "creation" && metadata.shotId) creationByShot.set(metadata.shotId, node);
  }

  const characters: BoardAsset[] = [];
  const scenes: BoardAsset[] = [];
  const shots = new Map<number, BoardAsset[]>();
  const results: BoardAsset[] = [];
  const finals: BoardAsset[] = [];
  const scripts: BoardAsset[] = [];
  const documents: BoardAsset[] = [];
  const others: BoardAsset[] = [];
  const pending: CanvasNode[] = [];

  for (const node of snapshot.nodes) {
    const role = node.metadata?.role;
    if (role === "character" || role === "scene") {
      const members = node.groupId ? groupMembers.get(node.groupId) ?? [] : [node];
      const pictures = members.filter((member) => member.type === "image" && hasFile(member));
      const asset: BoardAsset = { kind: role, cardId: node.groupId ?? node.id, node, title: node.title, media: pictures.find((picture) => picture.metadata?.selected) ?? pictures[0] };
      (role === "character" ? characters : scenes).push(asset);
      for (const member of members) assets.set(member.id, asset);
      assets.set(asset.cardId, asset);
    } else if (node.type === "shot") {
      const episode = node.metadata?.episode ?? 1;
      const code = shotCode((shots.get(episode)?.length ?? 0) + 1);
      const takes = takesByShot.get(node.id) ?? [];
      const media = chosen(takes);
      const shot: BoardAsset = { kind: "shot", cardId: node.id, node, title: node.title, episode, code, takes, ...(media ? { media } : {}) };
      push(shots, episode, shot);
      assets.set(node.id, shot);
      const creation = creationByShot.get(node.id);
      if (creation) {
        const result: BoardAsset = { ...shot, kind: "result", cardId: creation.id, node: creation };
        results.push(result);
        assets.set(creation.id, result);
        for (const take of takes) assets.set(take.id, result);
      }
    } else if (role === "final") {
      const asset: BoardAsset = { kind: "final", cardId: node.id, node, title: node.title, episode: node.metadata?.episode ?? 1, ...(hasFile(node) ? { media: node } : {}) };
      finals.push(asset);
      assets.set(node.id, asset);
    } else if (role === "episode" || role === "script") {
      const asset: BoardAsset = { kind: "episode", cardId: node.id, node, title: node.title, episode: role === "episode" ? node.metadata?.episode ?? 1 : 1 };
      scripts.push(asset);
      assets.set(node.id, asset);
    } else if (role === "brief" || role === "plan") {
      const asset: BoardAsset = { kind: role, cardId: node.id, node, title: node.title };
      documents.push(asset);
      assets.set(node.id, asset);
    } else if (FILE_KINDS.has(node.type) && !(node.groupId && profileGroups.has(node.groupId))) {
      pending.push(node);
    }
  }
  for (const node of pending) {
    if (assets.has(node.id)) continue;
    const asset: BoardAsset = { kind: node.type as AssetKind, cardId: node.id, node, title: node.title, ...(hasFile(node) ? { media: node } : {}) };
    others.push(asset);
    assets.set(node.id, asset);
  }
  scripts.sort((a, b) => a.episode! - b.episode!);
  finals.sort((a, b) => a.episode! - b.episode!);
  const shotsByEpisode = [...shots.entries()].sort(([a], [b]) => a - b).map(([episode, list]) => ({ episode, shots: list }));

  const shotOf = new Map<string, BoardAsset>();
  for (const group of shotsByEpisode) for (const shot of group.shots) shotOf.set(shot.node.id, shot);
  const sourcesByShot = new Map<BoardAsset, Set<BoardAsset>>();
  const connected = new Map<string, BoardAsset[]>();
  for (const line of snapshot.connections) {
    if (line.kind !== "content") continue;
    const source = assets.get(line.fromNodeId);
    if (!source) continue;
    const shot = shotOf.get(line.toNodeId);
    if (shot && (source.kind === "character" || source.kind === "scene")) {
      const sources = sourcesByShot.get(shot) ?? new Set<BoardAsset>();
      sources.add(source);
      sourcesByShot.set(shot, sources);
    }
    const into = connected.get(line.toNodeId);
    if (!into?.includes(source)) push(connected, line.toNodeId, source);
  }
  const appearances = new Map<BoardAsset, BoardAsset[]>();
  for (const group of shotsByEpisode) {
    for (const shot of group.shots) for (const source of sourcesByShot.get(shot) ?? []) push(appearances, source, shot);
  }

  const jobBot = (job: FlowStage, episode?: number): string | undefined =>
    (episode === undefined ? undefined : team.episodes.find((bot) => bot.episode === episode && bot.stages.includes(job)))?.botId
    ?? team.drama.find((bot) => bot.stages.includes(job))?.botId;
  const madeByStoryboard = (node: CanvasNode): string | undefined => {
    const maker = node.createdBy?.kind === "bot" ? snapshot.bots[node.createdBy.botId] : undefined;
    return maker?.stages.includes("storyboard") ? maker.botId : undefined;
  };

  return {
    team,
    characters,
    scenes,
    shotsByEpisode,
    results,
    finals,
    scripts,
    documents,
    others,
    episodes: episodeRows(snapshot, scripts, shotsByEpisode),
    assetOf: (nodeId) => assets.get(nodeId) ?? null,
    appearances: (asset) => appearances.get(asset) ?? [],
    ownerOf: (asset) => {
      switch (asset.kind) {
        case "character": return jobBot("character") ?? leadBotId;
        case "scene": return madeByStoryboard(asset.node) ?? jobBot("scene") ?? leadBotId;
        case "shot":
        case "result": return jobBot("storyboard", asset.episode) ?? leadBotId;
        case "final": return jobBot("post", asset.episode) ?? leadBotId;
        case "episode": return jobBot("script") ?? leadBotId;
        default: return leadBotId;
      }
    },
    connectedInto: (botId) => connected.get(botNodeId(botId)) ?? [],
    libraryFor: (botId) => snapshot.bots[botId]?.stages.includes("storyboard") ? [...characters, ...scenes] : [],
  };
}

function episodeRows(snapshot: CanvasSnapshot, scripts: readonly BoardAsset[], shotsByEpisode: BoardIndex["shotsByEpisode"]): EpisodeRow[] {
  if (snapshot.production) {
    return [...snapshot.production.episodes]
      .sort((a, b) => a.episode - b.episode)
      .map(({ episode, nodeId, title, status, shots, ready }) => ({ episode, nodeId, title, status, shots, ready }));
  }
  const rows = new Map<number, EpisodeRow>();
  for (const script of scripts) rows.set(script.episode!, { episode: script.episode!, nodeId: script.node.id, title: script.title, shots: 0, ready: 0 });
  for (const { episode, shots } of shotsByEpisode) {
    const row = rows.get(episode) ?? { episode, title: "", shots: 0, ready: 0 };
    row.shots = shots.length;
    row.ready = shots.filter((shot) => shot.takes?.some((take) => take.metadata?.selected)).length;
    rows.set(episode, row);
  }
  return [...rows.values()].sort((a, b) => a.episode - b.episode);
}
