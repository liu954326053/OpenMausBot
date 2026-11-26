import { PRODUCTION_JOBS, type DramaJob, type ProductionEpisodeStatus, type ProductionEpisodeWire, type ProductionJob, type ProductionTaskStatus, type ProductionWire } from "../../../shared/production";
import { botIdOfNode, botNodeId, type CanvasBotState, type CanvasNode, type CanvasSnapshot } from "../../../shared/project-canvas";
import type { FlowStage } from "../../../shared/team-pipeline";
import { boardEdges } from "./edges";
import { BOARD_STAGES, type BoardStage } from "./overlay";
import { boardStages } from "./stages";
import type {
  Board,
  BoardBotCard,
  BoardCard,
  BoardCharacterCard,
  BoardClip,
  BoardCount,
  BoardGate,
  BoardGeneration,
  BoardPicture,
  BoardPlanTask,
  BoardProgress,
  BoardSceneCard,
  BoardShotCard,
  BoardShotUse,
  BoardStageState,
  BoardVideoStatus,
  RetryTarget,
} from "./types";

export interface BoardOptions {
  /** The episodes the person opened. */
  opened?: ReadonlySet<number>;
}

const IN_WORK: ReadonlySet<ProductionEpisodeStatus> = new Set(["storyboard", "videos", "post", "failed"]);
const STAGE_OF_JOB: Record<ProductionJob, BoardStage> = { script: "script", character: "library", scene: "library", storyboard: "storyboard", post: "post" };

const roleOf = (node: CanvasNode) => node.metadata?.role;
const isProfileRole = (role: string | undefined): role is "character" | "scene" => role === "character" || role === "scene";
const jobOfStages = (stages: readonly FlowStage[]): ProductionJob | undefined => PRODUCTION_JOBS.find((job) => stages.includes(job));
const isSelected = (take: CanvasNode) => Boolean(take.metadata?.selected);
const versionOf = (node: CanvasNode) => node.metadata?.version ?? 1;

function generationOf(node: CanvasNode | undefined): BoardGeneration | undefined {
  const metadata = node?.metadata;
  if (!metadata?.status) return undefined;
  return {
    status: metadata.status,
    ...(metadata.errorKey ? { errorKey: metadata.errorKey } : {}),
    ...(metadata.errorParams ? { errorParams: metadata.errorParams } : {}),
    ...(metadata.errorDetails ? { errorDetails: metadata.errorDetails } : {}),
  };
}

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
  const written = snapshot.nodes.filter((one) => one.type === "text" && roleOf(one) === "episode" && typeof one.metadata?.episode === "number");
  for (const node of written.sort((a, b) => a.metadata!.episode! - b.metadata!.episode!)) {
    if (!episodeNodes.has(node.metadata!.episode!)) episodeNodes.set(node.metadata!.episode!, node);
  }
  const legacyScript = snapshot.nodes.find((node) => node.type === "text" && roleOf(node) === "script");
  if (legacyScript && !episodeNodes.has(1)) episodeNodes.set(1, legacyScript);
  const shots = new Map<number, CanvasNode[]>();
  const creationOf = new Map<string, CanvasNode>();
  const takesOf = new Map<string, CanvasNode[]>();
  const finals = new Map<number, CanvasNode>();
  for (const node of snapshot.nodes) {
    const shotId = node.metadata?.shotId;
    const episode = node.metadata?.episode ?? 1;
    if (node.type === "shot") shots.set(episode, [...(shots.get(episode) ?? []), node]);
    else if (node.type === "config" && roleOf(node) === "creation" && shotId && !creationOf.has(shotId)) creationOf.set(shotId, node);
    else if (node.type === "video" && roleOf(node) === "take" && shotId) takesOf.set(shotId, [...(takesOf.get(shotId) ?? []), node]);
    else if (node.type === "video" && roleOf(node) === "final" && !finals.has(episode)) finals.set(episode, node);
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

const shotSeconds = (index: BoardIndex, shot: CanvasNode) => shot.metadata?.settings?.seconds ?? index.creationOf.get(shot.id)?.metadata?.settings?.seconds;

function videoStatus(creation: CanvasNode | undefined, takes: readonly CanvasNode[]): BoardVideoStatus {
  if (creation?.metadata?.status === "loading") return "generating";
  if (takes.some(isSelected)) return "done";
  if (creation?.metadata?.status === "error") return "failed";
  return "idle";
}

function episodesOf(index: BoardIndex): number[] {
  return [...new Set([...index.episodeNodes.keys(), ...index.productionEpisodes.keys(), ...index.shots.keys()])].sort((a, b) => a - b);
}

function unfoldedOf(index: BoardIndex, opened: ReadonlySet<number>): Set<number> {
  return new Set(episodesOf(index).filter((episode) => {
    const status = index.productionEpisodes.get(episode)?.status;
    return !index.production || (status && IN_WORK.has(status)) || opened.has(episode);
  }));
}

interface Profile {
  card: BoardCharacterCard | BoardSceneCard;
  /** Every node of its group. */
  members: string[];
}

const pictureOf = (node: CanvasNode): BoardPicture => {
  const generation = generationOf(node);
  return {
    nodeId: node.id,
    ...(node.metadata?.file ? { file: node.metadata.file } : {}),
    ...(generation ? { generation } : {}),
    ...(node.metadata?.prompt ? { prompt: node.metadata.prompt } : {}),
  };
};

function profilesOf(index: BoardIndex): Profile[] {
  const grouped = new Map<string, CanvasNode[]>();
  for (const node of index.snapshot.nodes) if (node.groupId) grouped.set(node.groupId, [...(grouped.get(node.groupId) ?? []), node]);
  return index.snapshot.nodes.filter((node) => node.type === "text" && isProfileRole(roleOf(node))).map((node): Profile => {
    const kind = roleOf(node) as "character" | "scene";
    const images = (node.groupId ? grouped.get(node.groupId) ?? [] : []).filter((one) => one.type === "image");
    const shown = images.find(isSelected) ?? images.find((one) => one.metadata?.file) ?? images[0];
    const newest = images.at(-1);
    const maker = node.createdBy?.kind === "bot" ? node.createdBy.botId : undefined;
    const refinedBy = kind === "scene" && maker && index.jobOfBot.get(maker) === "storyboard" ? maker : undefined;
    const episode = refinedBy ? index.episodeOfBot.get(refinedBy) ?? 1 : undefined;
    const nodeIds = [node.id, ...(node.groupId && index.byId.has(node.groupId) ? [node.groupId] : []), ...images.map((one) => one.id)];
    const base = {
      id: node.id,
      nodeIds,
      stage: refinedBy ? "storyboard" as const : "library" as const,
      ...(episode === undefined ? {} : { episode }),
      dragNodeId: node.id,
      name: node.title,
      facts: node.metadata?.card ?? {},
      text: node.metadata?.content ?? "",
      ...(shown ? { picture: pictureOf(shown) } : {}),
      ...(newest ? { newest: pictureOf(newest) } : {}),
      appearsIn: [],
      ...(refinedBy ? { refinedBy } : {}),
      version: versionOf(node),
      pictures: images.filter((one) => one.metadata?.file).length,
    };
    return { card: kind === "character" ? { ...base, kind } : { ...base, kind }, members: nodeIds };
  });
}

function planTasks(production: ProductionWire | undefined): BoardPlanTask[] {
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
    return [{ job, botId, status, ...(count ? { count } : {}) }];
  });
}

function madeProfiles(profiles: readonly Profile[], kind: "character" | "scene"): BoardCount {
  const made = profiles.filter((one) => one.card.kind === kind && !one.card.refinedBy);
  return { done: made.filter((one) => one.card.picture?.file).length, total: made.length };
}

function gateOf(index: BoardIndex, episode: number, profiles: readonly Profile[]): BoardGate | undefined {
  const jobs = index.production?.jobs;
  if (!jobs) return undefined;
  const has = (job: DramaJob) => jobs.some((one) => one.job === job);
  return {
    ...(has("character") ? { characters: madeProfiles(profiles, "character") } : {}),
    ...(has("scene") ? { scenes: madeProfiles(profiles, "scene") } : {}),
    ...(has("script") ? { script: index.episodeNodes.has(episode) } : {}),
  };
}

function botCard(index: BoardIndex, bot: CanvasBotState, lead: boolean, stage: BoardStage, tasks: readonly BoardPlanTask[], profiles: readonly Profile[]): BoardBotCard {
  const { production } = index;
  const job = index.jobOfBot.get(bot.botId);
  const episode = index.episodeOfBot.get(bot.botId);
  const own = production?.tasks.filter((task) => task.botId === bot.botId) ?? [];
  const task = own.findLast((one) => one.status === "working") ?? own.at(-1);
  const productionEpisode = episode === undefined ? undefined : index.productionEpisodes.get(episode);
  const dramaJob = job === "script" || job === "character" || job === "scene" ? job : undefined;
  const jobStatus: ProductionTaskStatus | undefined = dramaJob
    ? production?.jobs.find((one) => one.job === dramaJob && one.botId === bot.botId)?.status
    : episode !== undefined && production ? task?.status ?? "waiting" : undefined;
  const progress = ((): BoardProgress | undefined => {
    if (lead) return tasks.length ? { unit: "tasks", done: tasks.filter((one) => one.status === "done").length, total: tasks.length } : undefined;
    if (job === "script") return production ? { unit: "episodes", done: production.episodes.length, total: production.plan.episodes ?? production.episodes.length } : undefined;
    if (job === "character" || job === "scene") {
      const made = madeProfiles(profiles, job);
      return made.total ? { unit: job === "character" ? "characters" : "scenes", ...made } : undefined;
    }
    if ((job === "storyboard" || job === "post") && episode !== undefined) {
      const shots = index.shots.get(episode) ?? [];
      const ready = shots.filter((shot) => (index.takesOf.get(shot.id) ?? []).some(isSelected)).length;
      return { unit: "videos", done: productionEpisode?.ready ?? ready, total: productionEpisode?.shots ?? shots.length };
    }
    return undefined;
  })();
  const retry: RetryTarget | undefined = dramaJob && jobStatus === "failed" ? { job: dramaJob } : productionEpisode?.status === "failed" ? { episode: productionEpisode.episode } : undefined;
  const gate = job === "storyboard" && episode !== undefined ? gateOf(index, episode, profiles) : undefined;
  const id = botNodeId(bot.botId);
  return {
    kind: "bot", id, nodeIds: [id], stage,
    ...(episode === undefined ? {} : { episode }),
    dragNodeId: id,
    botId: bot.botId,
    lead,
    status: bot.status,
    ...(job ? { job } : {}),
    ...(jobStatus ? { jobStatus } : {}),
    ...(task ? { task: { job: task.job, ...(task.episode === undefined ? {} : { episode: task.episode }), status: task.status, ...(task.at === undefined ? {} : { at: task.at }) } } : {}),
    ...(progress ? { progress } : {}),
    ...(retry ? { retry } : {}),
    ...(gate ? { gate } : {}),
    ...(lead && production?.plan.source ? { source: production.plan.source } : {}),
    ...(lead && production?.plan.episodes ? { episodes: production.plan.episodes } : {}),
  };
}

type ShownBot = { bot: CanvasBotState; lead: boolean; stage: BoardStage };

/** Which bots the board draws, and in which band: the copies an episode's bots are made from stay off it. */
function shownBots(index: BoardIndex, unfolded: ReadonlySet<number>, empty: boolean): ShownBot[] {
  const { snapshot, production } = index;
  return Object.values(snapshot.bots).flatMap((bot): ShownBot[] => {
    if (bot.lead || bot.botId === snapshot.project.leadBotId) return [{ bot, lead: true, stage: "brief" }];
    if (empty) return [];
    const job = index.jobOfBot.get(bot.botId);
    const episode = index.episodeOfBot.get(bot.botId);
    if ((job === "storyboard" || job === "post") && (episode === undefined ? Boolean(production) : !unfolded.has(episode))) return [];
    return [{ bot, lead: false, stage: job ? STAGE_OF_JOB[job] : "brief" }];
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

  const tasks = planTasks(production);
  const profiles = empty ? [] : profilesOf(index);
  for (const [botId, episode] of index.episodeOfBot) episodeOfNode.set(botNodeId(botId), episode);
  for (const { bot, lead, stage } of shownBots(index, unfolded, empty)) cards.push(botCard(index, bot, lead, stage, tasks, profiles));

  if (!empty) {
    const brief = snapshot.nodes.find((node) => node.type === "text" && roleOf(node) === "brief");
    if (brief) {
      consumed.add(brief.id);
      const by = brief.createdBy?.kind === "bot" ? brief.createdBy.botId : undefined;
      cards.push({ kind: "brief", id: brief.id, nodeIds: [brief.id], stage: "brief", dragNodeId: brief.id, title: brief.title, rows: brief.metadata?.card?.rows ?? [], text: brief.metadata?.content ?? "", ...(by ? { by } : {}), version: versionOf(brief), ...(production ? { agreedAt: production.plan.plannedAt } : {}) });
    }
    const plan = snapshot.nodes.find((node) => node.type === "text" && roleOf(node) === "plan");
    if (plan) {
      consumed.add(plan.id);
      cards.push({ kind: "plan", id: plan.id, nodeIds: [plan.id], stage: "brief", dragNodeId: plan.id, title: plan.title, tasks, ...(production ? { plannedAt: production.plan.plannedAt } : {}) });
    }

    const shotCards = new Map<string, BoardShotCard>();
    const uses = new Map<string, BoardShotUse>();
    const episodeSeconds = new Map<number, number>();
    for (const [episode, shots] of index.shots) {
      let clock: number | undefined = 0;
      shots.forEach((shot, at) => {
        const number = at + 1;
        const creation = index.creationOf.get(shot.id);
        const takes = index.takesOf.get(shot.id) ?? [];
        const seconds = shotSeconds(index, shot);
        const startsAt = clock;
        clock = clock !== undefined && seconds ? clock + seconds : undefined;
        uses.set(shot.id, { shotId: shot.id, episode, number });
        for (const id of [shot.id, ...(creation ? [creation.id] : []), ...takes.map((take) => take.id)]) {
          consumed.add(id);
          episodeOfNode.set(id, episode);
        }
        if (!unfolded.has(episode)) return;
        const status = videoStatus(creation, takes);
        const generation = generationOf(creation);
        const shotCard: BoardShotCard = {
          kind: "shot", id: shot.id, nodeIds: [shot.id], stage: "storyboard", episode, dragNodeId: shot.id, number, title: shot.title,
          ...(shot.metadata?.shot ? { design: shot.metadata.shot } : {}),
          ...(seconds ? { seconds } : {}),
          ...(startsAt === undefined ? {} : { startsAt }),
          ...(shot.metadata?.prompt ? { prompt: shot.metadata.prompt } : {}),
          characters: [], scenes: [], references: [], status, takes: takes.length,
          ...(generation ? { generation } : {}),
          ...(creation ? { creationId: creation.id } : {}),
          ...(shot.metadata?.stale || creation?.metadata?.stale ? { stale: true } : {}),
        };
        shotCards.set(shot.id, shotCard);
        cards.push(shotCard);
        if (!creation && !takes.length) return;
        const selected = takes.find(isSelected);
        cards.push({
          kind: "result", id: `result:${shot.id}`, nodeIds: [...(creation ? [creation.id] : []), ...takes.map((take) => take.id)], stage: "storyboard", episode,
          ...(creation ? { dragNodeId: creation.id } : {}),
          shotId: shot.id, number, title: shot.title,
          ...(creation ? { creationId: creation.id } : {}),
          takes: takes.map((take) => ({
            nodeId: take.id, selected: isSelected(take),
            ...(take.metadata?.file ? { file: take.metadata.file } : {}),
            ...(take.metadata?.durationMs ? { durationMs: take.metadata.durationMs } : {}),
            ...(take.metadata?.stale ? { stale: true } : {}),
          })),
          ...(selected ? { selectedTakeId: selected.id } : {}),
          status,
          ...(generation ? { generation } : {}),
        });
      });
      if (clock) episodeSeconds.set(episode, clock);
    }

    const profileOfNode = new Map<string, Profile>();
    for (const profile of profiles) for (const id of profile.members) profileOfNode.set(id, profile);
    const shotOfNode = new Map<string, string>();
    for (const shotId of uses.keys()) {
      shotOfNode.set(shotId, shotId);
      const creation = index.creationOf.get(shotId);
      if (creation) shotOfNode.set(creation.id, shotId);
    }
    for (const connection of snapshot.connections) {
      const from = connection.kind === "content" ? profileOfNode.get(connection.fromNodeId) : undefined;
      if (!from) continue;
      const shotId = shotOfNode.get(connection.toNodeId);
      const to = profileOfNode.get(connection.toNodeId);
      if (shotId) {
        if (!from.card.appearsIn.some((one) => one.shotId === shotId)) from.card.appearsIn.push(uses.get(shotId)!);
        const shotCard = shotCards.get(shotId);
        const list = shotCard ? (from.card.kind === "character" ? shotCard.characters : shotCard.scenes) : undefined;
        if (shotCard && list && !list.includes(from.card.id)) {
          list.push(from.card.id);
          const picture = from.card.picture?.file;
          shotCard.references.push({ cardId: from.card.id, kind: from.card.kind, name: from.card.name, ...(picture ? { picture } : {}) });
        }
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
          ...(node.metadata?.card?.subtitle ? { logline: node.metadata.card.subtitle } : {}),
          text: node.metadata?.content ?? "",
          ...(wire ? { status: wire.status } : {}),
          ...(wire?.storyboardBotId ? { storyboardBotId: wire.storyboardBotId } : {}),
          shots: wire?.shots ?? shots.length,
          ready: wire?.ready ?? shots.filter((shot) => (index.takesOf.get(shot.id) ?? []).some(isSelected)).length,
          ...(episodeSeconds.has(episode) ? { seconds: episodeSeconds.get(episode)! } : {}),
          version: versionOf(node),
        });
      }
      const film = index.finals.get(episode);
      const postBotId = wire?.postBotId ?? [...index.episodeOfBot].find(([botId, number]) => number === episode && index.jobOfBot.get(botId) === "post")?.[0];
      if (!film && !postBotId && !snapshot.drafts?.[episode]) continue;
      const clips = shots.map((shot, at): BoardClip => {
        const takes = index.takesOf.get(shot.id) ?? [];
        const take = takes.find(isSelected);
        const status = videoStatus(index.creationOf.get(shot.id), takes);
        const seconds = shotSeconds(index, shot);
        const durationMs = take?.metadata?.durationMs ?? (seconds ? seconds * 1000 : undefined);
        const state = take ? "ready" : status === "generating" ? "generating" : status === "failed" ? "failed" : "missing";
        return { shotId: shot.id, number: at + 1, state, ...(durationMs ? { durationMs } : {}) };
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
    for (const [episode, film] of index.finals) {
      consumed.add(film.id);
      episodeOfNode.set(film.id, episode);
    }

    if (folded.length) {
      cards.push({
        kind: "stack", id: "stack", nodeIds: folded.map((episode) => index.episodeNodes.get(episode)!.id), stage: "script",
        episodes: folded.map((episode) => {
          const node = index.episodeNodes.get(episode)!;
          const wire = index.productionEpisodes.get(episode);
          return { episode, title: wire?.title || node.title, nodeId: node.id, ...(wire ? { status: wire.status } : {}) };
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
    const groupCard = node.groupId && !cardOfNode.has(node.id) ? cardOfNode.get(node.groupId) : undefined;
    if (groupCard) cardOfNode.set(node.id, groupCard);
  }
  const waiting = Object.fromEntries(BOARD_STAGES.map((stage) => [stage, "wait"])) as Record<BoardStage, BoardStageState>;
  return {
    empty,
    cards,
    edges: boardEdges(index, cards, unfolded),
    stages: empty ? { ...waiting, brief: "active" } : boardStages(index),
    unfolded: [...unfolded].sort((a, b) => a - b),
    folded,
    cardOfNode,
    episodeOfNode,
  };
}
