import { memo } from "react";
import { episodeCode, shotCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import type { CanvasBotState, CanvasFileRef, CanvasSnapshot } from "../../../../shared/project-canvas";
import type { BoardCard, BoardVideoStatus, RetryTarget } from "@/lib/production-board/types";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import {
  BOARD_CARD_SIZES,
  BoardFarLabel,
  BotCard,
  botStatus,
  BriefCard,
  CharacterCard,
  EpisodeCard,
  episodeStatus,
  EpisodeStackCard,
  FinalCard,
  GenericCard,
  generationTone,
  PlanCard,
  ResultCard,
  SceneCard,
  ShotCard,
  type BoardBotRef,
  type BoardCardKind as CardsKind,
  type BoardReference,
  type BoardStep,
  type BoardTone,
} from "../cards";

/** What a card can do on the board. Absent ones are not offered, as on an archived project's. */
export interface BoardCardActions {
  open(card: BoardCard): void;
  fileUrl(file: CanvasFileRef): string;
  generate?(nodeId: string): void;
  selectTake?(nodeId: string): void;
  retry?(target: RetryTarget): void;
  openDraft?(): void;
  openStack(): void;
}

const KIND: Record<BoardCard["kind"], CardsKind> = {
  bot: "bot", brief: "brief", plan: "plan", episode: "episode", stack: "episodeStack", character: "character", scene: "scene", shot: "shot", result: "result", final: "final", other: "generic",
};

export const cardSize = (card: BoardCard) => BOARD_CARD_SIZES[KIND[card.kind]];

const VIDEO_TONE: Record<BoardVideoStatus, BoardTone> = { idle: "idle", generating: "working", failed: "failed", done: "done" };
const EPISODE_STACK_TITLES = 3;

function botSteps(bot: CanvasBotState): BoardStep[] {
  const steps = bot.steps ?? [];
  return steps.map((step, at) => ({ text: step.text, at: step.at, state: at === steps.length - 1 && bot.status === "working" ? "working" : "done" }));
}

function stackStatuses(statuses: ReadonlyArray<ProductionEpisodeStatus | undefined>): Partial<Record<ProductionEpisodeStatus, number>> {
  const counts: Partial<Record<ProductionEpisodeStatus, number>> = {};
  for (const status of statuses) if (status) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

/** The card's name and colour when the board is zoomed far out. */
export function farLabel(card: BoardCard, snapshot: CanvasSnapshot): { name: string; tone: BoardTone; status?: string } {
  switch (card.kind) {
    case "bot": {
      const bot = snapshot.bots[card.botId];
      const status = bot ? botStatus(bot, card.jobStatus) : undefined;
      return { name: bot?.name ?? card.botId, tone: status?.tone ?? "idle", ...(status ? { status: status.label } : {}) };
    }
    case "episode": {
      const status = episodeStatus(card.status);
      return { name: `${episodeCode(card.episode)} · ${card.title}`, tone: status?.tone ?? "idle", ...(status ? { status: status.label } : {}) };
    }
    case "stack":
      return { name: `${episodeCode(card.episodes[0]!.episode)} – ${episodeCode(card.episodes.at(-1)!.episode)}`, tone: "idle" };
    case "character":
    case "scene":
      return { name: card.name, tone: card.picture?.file ? "done" : generationTone(card.newest?.generation?.status) };
    case "shot":
      return { name: `${shotCode(card.number)} · ${card.title}`, tone: VIDEO_TONE[card.status] };
    case "result":
      return { name: shotCode(card.number), tone: VIDEO_TONE[card.status] };
    case "final":
      return { name: episodeCode(card.episode), tone: card.film ? "done" : card.status === "post" ? "working" : card.status === "failed" ? "failed" : "idle" };
    case "brief":
    case "plan":
      return { name: card.title, tone: "done" };
    case "other":
      return { name: card.node.title, tone: "idle" };
  }
}

export const FarCard = memo(function FarCard({ card, snapshot, zoom }: { card: BoardCard; snapshot: CanvasSnapshot; zoom: number }) {
  const label = farLabel(card, snapshot);
  return <BoardFarLabel kind={KIND[card.kind]} name={label.name} tone={label.tone} zoom={zoom} {...(label.status ? { statusLabel: label.status } : {})} />;
});

/** One card of the board, drawn by the card of its kind from what the board knows of it. */
export const BoardCardView = memo(function BoardCardView({ card, snapshot, looks, actions }: {
  card: BoardCard;
  snapshot: CanvasSnapshot;
  looks: Record<string, CanvasBotLook>;
  actions: BoardCardActions;
}) {
  const open = () => actions.open(card);
  const url = (file: CanvasFileRef | undefined) => (file ? actions.fileUrl(file) : undefined);
  const botRef = (botId: string | undefined): BoardBotRef | undefined => {
    const bot = botId ? snapshot.bots[botId] : undefined;
    return bot ? { name: bot.name, ...(looks[bot.botId] ? { look: looks[bot.botId] } : {}) } : undefined;
  };
  const generate = (nodeId: string | undefined, busy: boolean) => (actions.generate && nodeId && !busy ? () => actions.generate!(nodeId) : undefined);
  switch (card.kind) {
    case "bot": {
      const bot = snapshot.bots[card.botId];
      if (!bot) return null;
      const retry = card.retry;
      return (
        <BotCard
          bot={card.lead === bot.lead ? bot : { ...bot, lead: card.lead }}
          look={looks[card.botId]}
          job={card.job}
          task={card.jobStatus}
          progress={card.progress && { kind: card.progress.unit, done: card.progress.done, total: card.progress.total }}
          steps={botSteps(bot)}
          gate={card.gate}
          onOpen={open}
          onRetry={retry && actions.retry ? () => actions.retry!(retry) : undefined}
        />
      );
    }
    case "brief":
      return <BriefCard title={card.title} rows={card.rows} text={card.text} by={botRef(card.by)?.name} onOpen={open} />;
    case "plan":
      return <PlanCard tasks={card.tasks.map((task) => ({ job: task.job, status: task.status, ...(task.count ? { count: task.count } : {}), ...(botRef(task.botId) ? { bot: botRef(task.botId)! } : {}) }))} onOpen={open} />;
    case "episode": {
      const wire = snapshot.production?.episodes.find((one) => one.episode === card.episode);
      const episode = card.episode;
      return (
        <EpisodeCard
          episode={{ ...wire, episode, title: card.title, shots: card.shots, ready: card.ready, ...(card.status ? { status: card.status } : {}) }}
          logline={card.logline}
          text={card.text}
          to={botRef(card.storyboardBotId)}
          seconds={card.seconds}
          onOpen={open}
          onRetry={card.status === "failed" && actions.retry ? () => actions.retry!({ episode }) : undefined}
        />
      );
    }
    case "stack":
      return (
        <EpisodeStackCard
          first={card.episodes[0]!.episode}
          last={card.episodes.at(-1)!.episode}
          count={card.episodes.length}
          titles={card.episodes.slice(0, EPISODE_STACK_TITLES).map((one) => ({ episode: one.episode, title: one.title }))}
          statuses={stackStatuses(card.episodes.map((one) => one.status))}
          onOpen={actions.openStack}
        />
      );
    case "character":
    case "scene": {
      const props = {
        name: card.name,
        facts: card.facts,
        pictureUrl: url(card.picture?.file),
        generation: card.newest?.generation,
        shots: card.appearsIn.map((use) => ({ episode: use.episode, number: use.number })),
        onOpen: open,
        onGenerate: card.newest?.prompt ? generate(card.newest.nodeId, card.newest.generation?.status === "loading") : undefined,
      };
      return card.kind === "character" ? <CharacterCard {...props} /> : <SceneCard {...props} refinedBy={botRef(card.refinedBy)?.name} />;
    }
    case "shot": {
      const references = card.references.map((one): BoardReference => ({ kind: one.kind, name: one.name, ...(one.picture ? { pictureUrl: url(one.picture)! } : {}) }));
      return (
        <ShotCard
          number={card.number}
          episode={card.episode}
          title={card.title}
          design={card.design}
          seconds={card.seconds}
          startsAt={card.startsAt}
          prompt={card.prompt}
          references={references}
          referenceNames
          takes={card.takes}
          generation={card.generation}
          stale={card.stale}
          onOpen={open}
          onGenerate={generate(card.creationId, card.status === "generating")}
        />
      );
    }
    case "result":
      return (
        <ResultCard
          number={card.number}
          title={card.title}
          takes={card.takes.map((take) => ({ id: take.nodeId, selected: take.selected, ...(take.file ? { videoUrl: url(take.file)! } : {}), ...(take.durationMs ? { durationMs: take.durationMs } : {}), ...(take.stale ? { stale: true } : {}) }))}
          generation={card.generation}
          onOpen={open}
          onGenerate={generate(card.creationId, card.status === "generating")}
          onSelectTake={actions.selectTake}
        />
      );
    case "final": {
      const drafted = card.draft?.state === "written" || card.draft?.state === "kept";
      return (
        <FinalCard
          episode={card.episode}
          title={card.title}
          videoUrl={url(card.film?.file)}
          durationMs={card.film?.durationMs}
          clips={card.clips.map((clip) => ({ number: clip.number, state: clip.state, ...(clip.durationMs ? { durationMs: clip.durationMs } : {}) }))}
          draft={card.draft}
          onOpen={open}
          onOpenDraft={drafted ? actions.openDraft : undefined}
        />
      );
    }
    case "other":
      return <GenericCard node={card.node} fileUrl={url(card.node.metadata?.file)} onOpen={open} onGenerate={card.node.metadata?.status === "error" && card.node.metadata.prompt ? generate(card.node.id, false) : undefined} />;
  }
});
