import type { DramaJob, ProductionEpisodeStatus, ProductionTaskStatus } from "../../../shared/production";
import type { BoardIndex } from "./board";
import type { BoardBotCard, BoardCard, BoardEdge, BoardEdgeKind, BoardEdgeLabel, BoardEdgeState, BoardResultCard } from "./types";

const taskState = (status: ProductionTaskStatus | undefined): BoardEdgeState => (status === "done" ? "done" : status === "working" ? "active" : "wait");

function storyboardState(status: ProductionEpisodeStatus | undefined, legacyDone: boolean): BoardEdgeState {
  if (status === undefined) return legacyDone ? "done" : "wait";
  if (status === "storyboard") return "active";
  return status === "videos" || status === "post" || status === "done" ? "done" : "wait";
}

/** The lines between the board's cards, from what the production and the nodes say. */
export function boardEdges(index: BoardIndex, cards: readonly BoardCard[], unfolded: ReadonlySet<number>): BoardEdge[] {
  const { production } = index;
  const drawn = new Map(cards.map((card) => [card.id, card]));
  const edges: BoardEdge[] = [];
  const add = (kind: BoardEdgeKind, from: string | undefined, to: string | undefined, state: BoardEdgeState, label?: BoardEdgeLabel) => {
    if (!from || !to || from === to || !drawn.has(from) || !drawn.has(to)) return;
    const id = `${kind}:${from}>${to}`;
    if (edges.some((edge) => edge.id === id)) return;
    edges.push({ id, kind, state, from, to, ...(label ? { label } : {}) });
  };
  const of = <Kind extends BoardCard["kind"]>(kind: Kind) => cards.filter((card): card is Extract<BoardCard, { kind: Kind }> => card.kind === kind);
  const bots = of("bot");
  const wholeDrama = (job: DramaJob) => bots.filter((bot) => bot.job === job && bot.episode === undefined);
  const assigned = (job: DramaJob): BoardBotCard | undefined => {
    const botId = production?.plan.assignments[job];
    return wholeDrama(job).find((bot) => bot.botId === botId) ?? wholeDrama(job)[0];
  };
  const jobState = (job: DramaJob): BoardEdgeState => {
    if (production) return taskState(production.jobs.find((one) => one.job === job)?.status);
    const made = job === "script" ? cards.some((card) => card.kind === "episode") : cards.some((card) => card.kind === job);
    return made ? "done" : "wait";
  };
  const episodeBot = (job: "storyboard" | "post", episode: number) => bots.find((bot) => bot.job === job && bot.episode === episode);
  const makerOf = (cardId: string) => {
    const creator = index.byId.get(cardId)?.createdBy;
    return creator?.kind === "bot" ? creator.botId : undefined;
  };

  const lead = bots.find((bot) => bot.lead);
  const brief = of("brief")[0];
  const plan = of("plan")[0];
  const writer = assigned("script");
  add("output", lead?.id, brief?.id, "done");
  add("output", lead?.id, plan?.id, "done");
  add("handoff", brief?.id, writer?.id, jobState("script"));
  add("dispatch", plan?.id, writer?.id, jobState("script"), { kind: "dispatchScript" });
  if (!brief && !plan) add("dispatch", lead?.id, writer?.id, jobState("script"));
  for (const bot of wholeDrama("character")) add("dispatch", writer?.id, bot.id, jobState("character"), { kind: "dispatchCharacters" });
  for (const bot of wholeDrama("scene")) add("dispatch", writer?.id, bot.id, jobState("scene"), { kind: "dispatchScenes" });

  const episodes = of("episode").sort((a, b) => a.episode - b.episode);
  const written = [...episodes.map((card) => card.id), ...of("stack").map((card) => card.id)];
  const count = production?.plan.episodes ?? production?.episodes.length ?? episodes.length;
  written.forEach((id, at) => add("output", writer?.id, id, "done", at === 0 && count ? { kind: "episodes", count } : undefined));

  for (const card of [...of("character"), ...of("scene")]) {
    if (card.refinedBy) {
      add("derive", `bot:${card.refinedBy}`, card.id, "done", { kind: "refine" });
      add("ref", card.refinedFrom, card.id, "done");
      continue;
    }
    const maker = makerOf(card.id);
    const bot = wholeDrama(card.kind).find((one) => one.botId === maker) ?? assigned(card.kind);
    add("output", bot?.id, card.id, "done");
  }

  const results = new Map(of("result").map((card) => [card.shotId, card]));
  const shotsOf = new Map<number, Array<{ shot: string; result?: BoardResultCard }>>();
  for (const shot of of("shot")) shotsOf.set(shot.episode, [...(shotsOf.get(shot.episode) ?? []), { shot: shot.id, result: results.get(shot.id) }]);
  for (const episode of [...unfolded].sort((a, b) => a - b)) {
    const status = index.productionEpisodes.get(episode)?.status;
    const shots = shotsOf.get(episode) ?? [];
    const boarder = episodeBot("storyboard", episode);
    const editor = episodeBot("post", episode);
    const episodeCard = episodes.find((card) => card.episode === episode);
    add("dispatch", episodeCard?.id, boarder?.id, storyboardState(status, shots.length > 0), { kind: "dispatchEpisode", episode });
    const ready = shots.filter(({ result }) => result?.status === "done").length;
    shots.forEach(({ shot, result }, at) => {
      const video = result?.status;
      const written: BoardEdgeState = video === "generating" ? "active" : video === "done" ? "done" : status === "storyboard" ? "active" : status === "post" || status === "done" || !production ? "done" : "wait";
      add("output", boarder?.id, shot, written);
      add("gen", shot, result?.id, video === "generating" ? "active" : video === "done" ? "done" : "wait");
      add("handoff", result?.id, editor?.id, video === "done" ? "done" : "wait", at === 0 ? { kind: "videos", ready, shots: shots.length } : undefined);
    });
    const final = of("final").find((card) => card.episode === episode);
    const cut: BoardEdgeState = status === "done" || (!production && final?.film) ? "done" : status === "post" ? "active" : "wait";
    add("output", editor?.id, final?.id, cut, { kind: "cut", episode });
  }

  const shotCards = of("shot");
  for (const shot of shotCards) for (const id of [...shot.characters, ...shot.scenes]) add("ref", id, shot.id, "done");
  return edges;
}

export interface EdgeFilter {
  showRefs: boolean;
  /** The card hovered or selected: its own reference lines show. */
  focus: string | null;
}

export const visibleEdges = (edges: readonly BoardEdge[], { showRefs, focus }: EdgeFilter): BoardEdge[] =>
  edges.filter((edge) => edge.kind !== "ref" || showRefs || edge.from === focus || edge.to === focus);
