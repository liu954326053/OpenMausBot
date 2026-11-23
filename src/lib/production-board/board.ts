import {
  PRODUCTION_JOBS,
  type DramaJob,
  type ProductionEpisodeStatus,
  type ProductionEpisodeWire,
  type ProductionJob,
  type ProductionTaskStatus,
  type ProductionTaskWire,
  type ProductionWire,
} from "../../../shared/production";
import {
  botIdOfNode,
  type CanvasBotState,
  type CanvasBotStatus,
  type CanvasFileRef,
  type CanvasGenerationStatus,
  type CanvasNode,
  type CanvasPoint,
  type CanvasSnapshot,
} from "../../../shared/project-canvas";
import type { ProjectDraftWire } from "../../../shared/project-draft";
import type { ServerTextParams } from "../../../shared/server-text";
import type { FlowStage } from "../../../shared/team-pipeline";
import { BOARD_STAGES, type BoardStage } from "./overlay";
import { boardEdges } from "./edges";
import { boardStages } from "./stages";

export type BoardCardKind = "bot" | "brief" | "plan" | "episode" | "stack" | "character" | "scene" | "shot" | "result" | "final" | "other";

interface CardBase<Kind extends BoardCardKind> {
  kind: Kind;
  id: string;
  /** The nodes the card stands for; the first is the one its details open on. Empty for a card nothing stands for yet. */
  nodeIds: string[];
  /** The band it is drawn in; none for a node outside the production. */
  stage?: BoardStage;
  episode?: number;
  /** The node whose stored position the card takes once the person moved it. */
  dragNodeId?: string;
  /** Where the person put it. */
  moved?: CanvasPoint;
}

export type RetryTarget = { job: DramaJob } | { episode: number };

export interface BoardProgress {
  unit: "tasks" | "episodes" | "characters" | "scenes" | "videos";
  done: number;
  total?: number;
}

export interface BoardBotCard extends CardBase<"bot"> {
  botId: string;
  name: string;
  title: string;
  lead: boolean;
  status: CanvasBotStatus;
  job?: ProductionJob;
  doing?: string;
  /** The production's task it is on, else the last one it had. */
  task?: { job: ProductionJob; episode?: number; status: ProductionTaskWire["status"]; at?: number };
  progress?: BoardProgress;
  steps: Array<{ text: string; at: number }>;
  waiting: boolean;
  retry?: RetryTarget;
}

export interface BoardBriefCard extends CardBase<"brief"> {
  title: string;
  rows: Array<[string, string]>;
  text: string;
}

export interface BoardPlanTask {
  job: ProductionJob;
  botId?: string;
  status: ProductionTaskStatus;
  parallel?: true;
  count?: number;
}

export interface BoardPlanCard extends CardBase<"plan"> {
  title: string;
  tasks: BoardPlanTask[];
}

export interface BoardEpisodeCard extends CardBase<"episode"> {
  episode: number;
  title: string;
  subtitle?: string;
  text: string;
  status?: ProductionEpisodeStatus;
  storyboardBotId?: string;
  shots: number;
  ready: number;
}

export interface BoardStackCard extends CardBase<"stack"> {
  episodes: Array<{ episode: number; title: string; nodeId: string; status?: ProductionEpisodeStatus }>;
}

export interface BoardPicture {
  nodeId: string;
  file?: CanvasFileRef;
  status?: CanvasGenerationStatus;
  prompt?: string;
}

export interface BoardShotUse {
  shotId: string;
  episode: number;
  code: string;
}

export interface BoardProfileCard<Kind extends "character" | "scene"> extends CardBase<Kind> {
  name: string;
  badge?: string;
  subtitle?: string;
  tags: string[];
  palette: string[];
  rows: Array<[string, string]>;
  text: string;
  /** The picture it shows: the group's selected one, else its first. */
  picture?: BoardPicture;
  pictures: BoardPicture[];
  appearsIn: BoardShotUse[];
  /** A scene a storyboard bot refined for its episode: that bot. */
  refinedBy?: string;
  /** The card of the scene it was refined from. */
  refinedFrom?: string;
}

export type BoardCharacterCard = BoardProfileCard<"character">;
export type BoardSceneCard = BoardProfileCard<"scene">;

export type BoardVideoStatus = "idle" | "generating" | "failed" | "done";

export interface BoardShotCard extends CardBase<"shot"> {
  episode: number;
  code: string;
  title: string;
  size?: string;
  move?: string;
  seconds?: number;
  audio?: string;
  prompt?: string;
  /** The character and scene cards it uses. */
  characters: string[];
  scenes: string[];
  status: BoardVideoStatus;
  stale?: boolean;
  creationId?: string;
}

export interface BoardTake {
  nodeId: string;
  file?: CanvasFileRef;
  durationMs?: number;
  selected: boolean;
  stale?: boolean;
}

export interface BoardResultCard extends CardBase<"result"> {
  shotId: string;
  episode: number;
  code: string;
  title: string;
  creationId?: string;
  takes: BoardTake[];
  selectedTakeId?: string;
  status: BoardVideoStatus;
  error?: { key?: string; params?: ServerTextParams; details?: string };
  seconds?: number;
}

export interface BoardClip {
  shotId: string;
  code: string;
  durationMs?: number;
  take?: { nodeId: string; file?: CanvasFileRef };
}

export interface BoardFinalCard extends CardBase<"final"> {
  episode: number;
  title: string;
  film?: { nodeId: string; file?: CanvasFileRef; durationMs?: number };
  draft?: ProjectDraftWire;
  clips: BoardClip[];
  status?: ProductionEpisodeStatus;
  postBotId?: string;
}

export interface BoardOtherCard extends CardBase<"other"> {
  node: CanvasNode;
}

export type BoardCard =
  | BoardBotCard
  | BoardBriefCard
  | BoardPlanCard
  | BoardEpisodeCard
  | BoardStackCard
  | BoardCharacterCard
  | BoardSceneCard
  | BoardShotCard
  | BoardResultCard
  | BoardFinalCard
  | BoardOtherCard;

export type BoardEdgeKind = "dispatch" | "output" | "handoff" | "gen" | "derive" | "ref";
export type BoardEdgeState = "done" | "active" | "wait";

export type BoardEdgeLabel =
  | { kind: "dispatchScript" }
  | { kind: "dispatchCharacters" }
  | { kind: "dispatchScenes" }
  | { kind: "episodes"; count: number }
  | { kind: "dispatchEpisode"; episode: number }
  | { kind: "videos"; ready: number; shots: number }
  | { kind: "cut"; episode: number }
  | { kind: "refine" };

export interface BoardEdge {
  id: string;
  kind: BoardEdgeKind;
  state: BoardEdgeState;
  from: string;
  to: string;
  label?: BoardEdgeLabel;
}

export type BoardStageState = "wait" | "active" | "done" | "failed";

export interface Board {
  /** No plan and nothing on the canvas yet: the lead's card alone, with a hint. */
  empty: boolean;
  cards: BoardCard[];
  edges: BoardEdge[];
  stages: Record<BoardStage, BoardStageState>;
  /** The episodes drawn in full, in order. */
  unfolded: number[];
  /** The episodes in the stack, in order. */
  folded: number[];
  /** Every node a card stands for → that card's id. */
  cardOfNode: Map<string, string>;
  /** Every node of an episode → its number, folded or not. */
  episodeOfNode: Map<string, number>;
}

export interface BoardOptions {
  /** The episodes the person opened. */
  opened?: ReadonlySet<number>;
}

const IN_WORK: ReadonlySet<ProductionEpisodeStatus> = new Set(["storyboard", "videos", "post", "failed"]);
const STAGE_OF_JOB: Record<ProductionJob, BoardStage> = { script: "script", character: "library", scene: "library", storyboard: "storyboard", post: "post" };

export const stageOfFlow = (stage: FlowStage | undefined): BoardStage => (stage && stage !== "lead" && stage !== "other" ? STAGE_OF_JOB[stage] : "brief");

const roleOf = (node: CanvasNode) => node.metadata?.role;
const isProfileRole = (role: string | undefined): role is "character" | "scene" => role === "character" || role === "scene";
const shotCode = (index: number) => `SH${String(index + 1).padStart(2, "0")}`;
const jobOfStages = (stages: readonly FlowStage[]): ProductionJob | undefined => PRODUCTION_JOBS.find((job) => stages.includes(job));

/** What the board is made from, read once from the snapshot. */
export interface BoardIndex {
  snapshot: CanvasSnapshot;
  production?: ProductionWire;
  byId: Map<string, CanvasNode>;
  /** The node holding each episode's script. */
  episodeNodes: Map<number, CanvasNode>;
  /** Each episode's shots, in the order they were added. */
  shots: Map<number, CanvasNode[]>;
  creationOf: Map<string, CanvasNode>;
  takesOf: Map<string, CanvasNode[]>;
  finals: Map<number, CanvasNode>;
  productionEpisodes: Map<number, ProductionEpisodeWire>;
  episodeOfBot: Map<string, number>;
  jobOfBot: Map<string, ProductionJob>;
}

export function indexSnapshot(snapshot: CanvasSnapshot): BoardIndex {
  const production = snapshot.production;
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const episodeNodes = new Map<number, CanvasNode>();
  for (const node of [...snapshot.nodes].filter((one) => one.type === "text" && roleOf(one) === "episode" && typeof one.metadata?.episode === "number").sort((a, b) => a.metadata!.episode! - b.metadata!.episode!)) {
    if (!episodeNodes.has(node.metadata!.episode!)) episodeNodes.set(node.metadata!.episode!, node);
  }
  const legacyScript = snapshot.nodes.find((node) => node.type === "text" && roleOf(node) === "script");
  if (legacyScript && !episodeNodes.has(1)) episodeNodes.set(1, legacyScript);
  const shots = new Map<number, CanvasNode[]>();
  for (const node of snapshot.nodes) {
    if (node.type !== "shot") continue;
    const episode = node.metadata?.episode ?? 1;
    shots.set(episode, [...(shots.get(episode) ?? []), node]);
  }
  const creationOf = new Map<string, CanvasNode>();
  const takesOf = new Map<string, CanvasNode[]>();
  const finals = new Map<number, CanvasNode>();
  for (const node of snapshot.nodes) {
    const shotId = node.metadata?.shotId;
    if (node.type === "config" && roleOf(node) === "creation" && shotId && !creationOf.has(shotId)) creationOf.set(shotId, node);
    if (node.type === "video" && roleOf(node) === "take" && shotId) takesOf.set(shotId, [...(takesOf.get(shotId) ?? []), node]);
    if (node.type === "video" && roleOf(node) === "final" && !finals.has(node.metadata?.episode ?? 1)) finals.set(node.metadata?.episode ?? 1, node);
  }
  const productionEpisodes = new Map((production?.episodes ?? []).map((episode) => [episode.episode, episode]));
  const jobOfBot = new Map<string, ProductionJob>();
  const episodeOfBot = new Map<string, number>();
  for (const bot of Object.values(snapshot.bots)) {
    const job = jobOfStages(bot.stages);
    if (job) jobOfBot.set(bot.botId, job);
    if (bot.episode !== undefined) episodeOfBot.set(bot.botId, bot.episode);
    else if (!production && (job === "storyboard" || job === "post")) episodeOfBot.set(bot.botId, 1);
  }
  for (const episode of production?.episodes ?? []) {
    for (const botId of [episode.storyboardBotId, episode.postBotId]) if (botId && snapshot.bots[botId]) episodeOfBot.set(botId, episode.episode);
  }
  return { snapshot, production, byId, episodeNodes, shots, creationOf, takesOf, finals, productionEpisodes, episodeOfBot, jobOfBot };
}

function videoStatus(creation: CanvasNode | undefined, takes: readonly CanvasNode[]): BoardVideoStatus {
  if (creation?.metadata?.status === "loading") return "generating";
  if (takes.some((take) => take.metadata?.selected)) return "done";
  if (creation?.metadata?.status === "error") return "failed";
  return "idle";
}

function episodesOf(index: BoardIndex): number[] {
  const numbers = new Set<number>([...index.episodeNodes.keys(), ...index.productionEpisodes.keys(), ...index.shots.keys()]);
  return [...numbers].sort((a, b) => a - b);
}

function unfoldedOf(index: BoardIndex, opened: ReadonlySet<number>): Set<number> {
  const unfolded = new Set<number>();
  for (const episode of episodesOf(index)) {
    const status = index.productionEpisodes.get(episode)?.status;
    if (!index.production || (status && IN_WORK.has(status)) || opened.has(episode)) unfolded.add(episode);
  }
  return unfolded;
}

interface Profile {
  card: BoardCharacterCard | BoardSceneCard;
  /** Every node of its group. */
  members: string[];
}

function profilesOf(index: BoardIndex): Profile[] {
  const { snapshot } = index;
  const grouped = new Map<string, CanvasNode[]>();
  for (const node of snapshot.nodes) if (node.groupId) grouped.set(node.groupId, [...(grouped.get(node.groupId) ?? []), node]);
  return snapshot.nodes.filter((node) => node.type === "text" && isProfileRole(roleOf(node))).map((node): Profile => {
    const kind = roleOf(node) as "character" | "scene";
    const pictures = (node.groupId ? grouped.get(node.groupId) ?? [] : []).filter((one) => one.type === "image").map((one): BoardPicture => ({
      nodeId: one.id,
      ...(one.metadata?.file ? { file: one.metadata.file } : {}),
      ...(one.metadata?.status ? { status: one.metadata.status } : {}),
      ...(one.metadata?.prompt ? { prompt: one.metadata.prompt } : {}),
    }));
    const shown = pictures.find((picture) => index.byId.get(picture.nodeId)?.metadata?.selected) ?? pictures.find((picture) => picture.file) ?? pictures[0];
    const maker = node.createdBy?.kind === "bot" ? node.createdBy.botId : undefined;
    const refinedBy = kind === "scene" && maker && index.jobOfBot.get(maker) === "storyboard" ? maker : undefined;
    const episode = refinedBy ? index.episodeOfBot.get(refinedBy) ?? 1 : undefined;
    const card = node.metadata?.card;
    const nodeIds = [node.id, ...(node.groupId && index.byId.has(node.groupId) ? [node.groupId] : []), ...pictures.map((picture) => picture.nodeId)];
    const base = {
      id: node.id,
      nodeIds,
      stage: refinedBy ? "storyboard" as const : "library" as const,
      ...(episode === undefined ? {} : { episode }),
      dragNodeId: node.id,
      name: node.title,
      ...(card?.badge ? { badge: card.badge } : {}),
      ...(card?.subtitle ? { subtitle: card.subtitle } : {}),
      tags: card?.tags ?? [],
      palette: card?.palette ?? [],
      rows: card?.rows ?? [],
      text: node.metadata?.content ?? "",
      ...(shown ? { picture: shown } : {}),
      pictures,
      appearsIn: [],
      ...(refinedBy ? { refinedBy } : {}),
    };
    return { card: kind === "character" ? { ...base, kind } : { ...base, kind }, members: nodeIds };
  });
}

function planTasks(index: BoardIndex): BoardPlanTask[] {
  const production = index.production;
  if (!production) return [];
  const episodes = production.episodes;
  const jobStatus = (job: DramaJob): ProductionTaskStatus => production.jobs.find((one) => one.job === job)?.status ?? "waiting";
  const storyboard = (): ProductionTaskStatus => {
    if (episodes.some((one) => one.status === "failed" && !one.postBotId)) return "failed";
    if (episodes.some((one) => one.status === "storyboard" || one.status === "videos")) return "working";
    return episodes.length && episodes.every((one) => one.status === "post" || one.status === "done") ? "done" : "waiting";
  };
  const post = (): ProductionTaskStatus => {
    if (episodes.some((one) => one.status === "failed" && one.postBotId)) return "failed";
    if (episodes.some((one) => one.status === "post")) return "working";
    return episodes.length && episodes.every((one) => one.status === "done") ? "done" : "waiting";
  };
  return PRODUCTION_JOBS.flatMap((job): BoardPlanTask[] => {
    const botId = production.plan.assignments[job];
    if (!botId) return [];
    const status = job === "storyboard" ? storyboard() : job === "post" ? post() : jobStatus(job);
    const count = job === "script" ? production.plan.episodes : job === "storyboard" || job === "post" ? episodes.length : undefined;
    return [{ job, botId, status, ...(job === "character" || job === "scene" ? { parallel: true as const } : {}), ...(count ? { count } : {}) }];
  });
}

function botCard(index: BoardIndex, bot: CanvasBotState, stage: BoardStage, tasks: readonly BoardPlanTask[], profiles: readonly Profile[]): BoardBotCard {
  const { production } = index;
  const job = index.jobOfBot.get(bot.botId);
  const episode = index.episodeOfBot.get(bot.botId);
  const own = production?.tasks.filter((task) => task.botId === bot.botId) ?? [];
  const task = own.findLast((one) => one.status === "working") ?? own.at(-1);
  const productionEpisode = episode === undefined ? undefined : index.productionEpisodes.get(episode);
  const progress = ((): BoardProgress | undefined => {
    if (bot.lead) return tasks.length ? { unit: "tasks", done: tasks.filter((one) => one.status === "done").length, total: tasks.length } : undefined;
    if (job === "script") return production ? { unit: "episodes", done: production.episodes.length, total: production.plan.episodes ?? production.episodes.length } : undefined;
    if (job === "character" || job === "scene") {
      const made = profiles.filter((one) => one.card.kind === job && !one.card.refinedBy).length;
      return { unit: job === "character" ? "characters" : "scenes", done: made };
    }
    if ((job === "storyboard" || job === "post") && episode !== undefined) {
      const shots = index.shots.get(episode) ?? [];
      const ready = shots.filter((shot) => (index.takesOf.get(shot.id) ?? []).some((take) => take.metadata?.selected)).length;
      return { unit: "videos", done: productionEpisode?.ready ?? ready, total: productionEpisode?.shots ?? shots.length };
    }
    return undefined;
  })();
  const jobFailed = job && job !== "storyboard" && job !== "post" && production?.jobs.some((one) => one.job === job && one.botId === bot.botId && one.status === "failed");
  const retry: RetryTarget | undefined = jobFailed ? { job: job as DramaJob } : productionEpisode?.status === "failed" ? { episode: productionEpisode.episode } : undefined;
  return {
    kind: "bot",
    id: `bot:${bot.botId}`,
    nodeIds: [`bot:${bot.botId}`],
    stage,
    ...(episode === undefined ? {} : { episode }),
    dragNodeId: `bot:${bot.botId}`,
    botId: bot.botId,
    name: bot.name,
    title: bot.title,
    lead: bot.lead,
    status: bot.status,
    ...(job ? { job } : {}),
    ...(bot.doing ? { doing: bot.doing } : {}),
    ...(task ? { task: { job: task.job, ...(task.episode === undefined ? {} : { episode: task.episode }), status: task.status, ...(task.at === undefined ? {} : { at: task.at }) } } : {}),
    ...(progress ? { progress } : {}),
    steps: bot.steps ?? [],
    waiting: Boolean(bot.waiting),
    ...(retry ? { retry } : {}),
  };
}

/** Which bots the board draws, and in which band. */
function shownBots(index: BoardIndex, unfolded: ReadonlySet<number>, empty: boolean): Array<{ bot: CanvasBotState; stage: BoardStage }> {
  const { snapshot, production } = index;
  return Object.values(snapshot.bots).flatMap((bot) => {
    const lead = bot.lead || bot.botId === snapshot.project.leadBotId;
    if (lead) return [{ bot: { ...bot, lead: true }, stage: "brief" as const }];
    if (empty) return [];
    const job = index.jobOfBot.get(bot.botId);
    const episode = index.episodeOfBot.get(bot.botId);
    if (job === "storyboard" || job === "post") {
      if (episode === undefined ? Boolean(production) : !unfolded.has(episode)) return [];
    }
    return [{ bot, stage: job ? STAGE_OF_JOB[job] : "brief" as const }];
  });
}

/** The board a snapshot draws: its cards, the lines between them and its stages' states. */
export function buildBoard(snapshot: CanvasSnapshot, options: BoardOptions = {}): Board {
  const index = indexSnapshot(snapshot);
  const { production, byId } = index;
  const empty = !production && snapshot.nodes.every((node) => botIdOfNode(node.id) !== null);
  const unfolded = unfoldedOf(index, options.opened ?? new Set());
  const allEpisodes = episodesOf(index);
  const folded = allEpisodes.filter((episode) => !unfolded.has(episode) && index.episodeNodes.has(episode));
  const consumed = new Set<string>();
  const cards: BoardCard[] = [];
  const episodeOfNode = new Map<string, number>();

  const tasks = planTasks(index);
  const profiles = empty ? [] : profilesOf(index);
  for (const [botId, episode] of index.episodeOfBot) episodeOfNode.set(`bot:${botId}`, episode);
  for (const { bot, stage } of shownBots(index, unfolded, empty)) cards.push(botCard(index, bot, stage, tasks, profiles));

  if (!empty) {
    const brief = snapshot.nodes.find((node) => node.type === "text" && roleOf(node) === "brief");
    if (brief) {
      consumed.add(brief.id);
      cards.push({ kind: "brief", id: brief.id, nodeIds: [brief.id], stage: "brief", dragNodeId: brief.id, title: brief.title, rows: brief.metadata?.card?.rows ?? [], text: brief.metadata?.content ?? "" });
    }
    const plan = snapshot.nodes.find((node) => node.type === "text" && roleOf(node) === "plan");
    if (plan) {
      consumed.add(plan.id);
      cards.push({ kind: "plan", id: plan.id, nodeIds: [plan.id], stage: "brief", dragNodeId: plan.id, title: plan.title, tasks });
    }

    const shotCards = new Map<string, BoardShotCard>();
    const uses = new Map<string, BoardShotUse>();
    for (const [episode, shots] of index.shots) {
      shots.forEach((shot, at) => {
        const code = shotCode(at);
        const creation = index.creationOf.get(shot.id);
        const takes = index.takesOf.get(shot.id) ?? [];
        uses.set(shot.id, { shotId: shot.id, episode, code });
        for (const id of [shot.id, ...(creation ? [creation.id] : []), ...takes.map((take) => take.id)]) {
          consumed.add(id);
          episodeOfNode.set(id, episode);
        }
        if (!unfolded.has(episode)) return;
        const design = shot.metadata?.shot;
        const seconds = shot.metadata?.settings?.seconds ?? creation?.metadata?.settings?.seconds;
        const status = videoStatus(creation, takes);
        const shotCard: BoardShotCard = {
          kind: "shot", id: shot.id, nodeIds: [shot.id], stage: "storyboard", episode, dragNodeId: shot.id, code, title: shot.title,
          ...(design?.size ? { size: design.size } : {}),
          ...(design?.move ? { move: design.move } : {}),
          ...(seconds ? { seconds } : {}),
          ...(design?.audio ? { audio: design.audio } : {}),
          ...(shot.metadata?.prompt ? { prompt: shot.metadata.prompt } : {}),
          characters: [], scenes: [], status,
          ...(shot.metadata?.stale ? { stale: true } : {}),
          ...(creation ? { creationId: creation.id } : {}),
        };
        shotCards.set(shot.id, shotCard);
        cards.push(shotCard);
        if (!creation && !takes.length) return;
        const selected = takes.find((take) => take.metadata?.selected);
        const errorKey = creation?.metadata?.errorKey;
        const errorDetails = creation?.metadata?.errorDetails;
        cards.push({
          kind: "result", id: `result:${shot.id}`, nodeIds: [...(creation ? [creation.id] : []), ...takes.map((take) => take.id)], stage: "storyboard", episode,
          ...(creation ? { dragNodeId: creation.id } : {}),
          shotId: shot.id, code, title: shot.title,
          ...(creation ? { creationId: creation.id } : {}),
          takes: takes.map((take): BoardTake => ({
            nodeId: take.id, selected: Boolean(take.metadata?.selected),
            ...(take.metadata?.file ? { file: take.metadata.file } : {}),
            ...(take.metadata?.durationMs ? { durationMs: take.metadata.durationMs } : {}),
            ...(take.metadata?.stale ? { stale: true } : {}),
          })),
          ...(selected ? { selectedTakeId: selected.id } : {}),
          status,
          ...(creation?.metadata?.status === "error" ? { error: { ...(errorKey ? { key: errorKey } : {}), ...(creation.metadata.errorParams ? { params: creation.metadata.errorParams } : {}), ...(errorDetails ? { details: errorDetails } : {}) } } : {}),
          ...(seconds ? { seconds } : {}),
        });
      });
    }

    const profileOfNode = new Map<string, Profile>();
    for (const profile of profiles) for (const id of profile.members) profileOfNode.set(id, profile);
    const shotOfNode = new Map<string, string>();
    for (const [shotId] of uses) {
      shotOfNode.set(shotId, shotId);
      const creation = index.creationOf.get(shotId);
      if (creation) shotOfNode.set(creation.id, shotId);
    }
    for (const connection of snapshot.connections) {
      if (connection.kind !== "content") continue;
      const from = profileOfNode.get(connection.fromNodeId);
      if (!from) continue;
      const shotId = shotOfNode.get(connection.toNodeId);
      const to = profileOfNode.get(connection.toNodeId);
      if (shotId) {
        const use = uses.get(shotId)!;
        if (!from.card.appearsIn.some((one) => one.shotId === shotId)) from.card.appearsIn.push(use);
        const shotCard = shotCards.get(shotId);
        const list = shotCard ? (from.card.kind === "character" ? shotCard.characters : shotCard.scenes) : undefined;
        if (list && !list.includes(from.card.id)) list.push(from.card.id);
      } else if (to && to !== from && to.card.refinedBy && from.card.kind === "scene" && !to.card.refinedFrom) {
        to.card.refinedFrom = from.card.id;
      }
    }
    for (const profile of profiles) {
      for (const id of profile.members) consumed.add(id);
      if (profile.card.episode !== undefined) for (const id of profile.members) episodeOfNode.set(id, profile.card.episode);
      if (profile.card.episode === undefined || unfolded.has(profile.card.episode)) cards.push(profile.card);
    }

    for (const episode of allEpisodes) {
      const node = index.episodeNodes.get(episode);
      const wire = index.productionEpisodes.get(episode);
      if (node) {
        consumed.add(node.id);
        episodeOfNode.set(node.id, episode);
      }
      if (!unfolded.has(episode)) continue;
      const shots = index.shots.get(episode) ?? [];
      if (node) {
        cards.push({
          kind: "episode", id: node.id, nodeIds: [node.id], stage: "script", episode, dragNodeId: node.id, title: wire?.title || node.title,
          ...(node.metadata?.card?.subtitle ? { subtitle: node.metadata.card.subtitle } : {}),
          text: node.metadata?.content ?? "",
          ...(wire ? { status: wire.status } : {}),
          ...(wire?.storyboardBotId ? { storyboardBotId: wire.storyboardBotId } : {}),
          shots: wire?.shots ?? shots.length,
          ready: wire?.ready ?? shots.filter((shot) => (index.takesOf.get(shot.id) ?? []).some((take) => take.metadata?.selected)).length,
        });
      }
      const film = index.finals.get(episode);
      const postBotId = wire?.postBotId ?? [...index.episodeOfBot].find(([botId, number]) => number === episode && index.jobOfBot.get(botId) === "post")?.[0];
      if (film || postBotId || snapshot.drafts?.[episode]) {
        const clips = shots.map((shot, at): BoardClip => {
          const take = (index.takesOf.get(shot.id) ?? []).find((one) => one.metadata?.selected);
          const seconds = shot.metadata?.settings?.seconds ?? index.creationOf.get(shot.id)?.metadata?.settings?.seconds;
          const durationMs = take?.metadata?.durationMs ?? (seconds ? seconds * 1000 : undefined);
          return { shotId: shot.id, code: shotCode(at), ...(durationMs ? { durationMs } : {}), ...(take ? { take: { nodeId: take.id, ...(take.metadata?.file ? { file: take.metadata.file } : {}) } } : {}) };
        });
        cards.push({
          kind: "final", id: film?.id ?? `final:${episode}`, nodeIds: film ? [film.id] : [], stage: "post", episode,
          ...(film ? { dragNodeId: film.id } : {}),
          title: wire?.title || node?.title || film?.title || "",
          ...(film ? { film: { nodeId: film.id, ...(film.metadata?.file ? { file: film.metadata.file } : {}), ...(film.metadata?.durationMs ? { durationMs: film.metadata.durationMs } : {}) } } : {}),
          ...(snapshot.drafts?.[episode] ? { draft: snapshot.drafts[episode] } : {}),
          clips,
          ...(wire ? { status: wire.status } : {}),
          ...(postBotId ? { postBotId } : {}),
        });
      }
    }
    for (const [episode, film] of index.finals) {
      consumed.add(film.id);
      episodeOfNode.set(film.id, episode);
    }

    if (folded.length) {
      cards.push({
        kind: "stack", id: "stack", nodeIds: folded.map((episode) => index.episodeNodes.get(episode)!.id), stage: "script",
        episodes: folded.map((episode) => {
          const node = index.episodeNodes.get(episode)!;
          const status = index.productionEpisodes.get(episode)?.status;
          return { episode, title: index.productionEpisodes.get(episode)?.title || node.title, nodeId: node.id, ...(status ? { status } : {}) };
        }),
      });
    }

    for (const node of snapshot.nodes) {
      if (consumed.has(node.id) || node.type === "bot" || node.type === "group" || botIdOfNode(node.id) !== null) continue;
      if (node.groupId && consumed.has(node.groupId)) continue;
      cards.push({ kind: "other", id: node.id, nodeIds: [node.id], dragNodeId: node.id, node });
    }
  }

  for (const one of cards) {
    const dragged = one.dragNodeId ? byId.get(one.dragNodeId) : undefined;
    if (dragged?.arranged) one.moved = dragged.position;
  }
  const cardOfNode = new Map<string, string>();
  for (const one of cards) for (const id of one.nodeIds) if (!cardOfNode.has(id)) cardOfNode.set(id, one.id);
  for (const node of snapshot.nodes) {
    if (byId.get(node.id)?.groupId && !cardOfNode.has(node.id)) {
      const groupCard = cardOfNode.get(node.groupId!);
      if (groupCard) cardOfNode.set(node.id, groupCard);
    }
  }
  return {
    empty,
    cards,
    edges: boardEdges(index, cards, unfolded),
    stages: empty ? { ...Object.fromEntries(BOARD_STAGES.map((stage) => [stage, "wait"])), brief: "active" } as Record<BoardStage, BoardStageState> : boardStages(index),
    unfolded: [...unfolded].sort((a, b) => a - b),
    folded,
    cardOfNode,
    episodeOfNode,
  };
}
