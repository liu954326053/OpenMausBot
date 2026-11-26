import { episodeCode, shotCode } from "../../../../shared/production";
import type { CanvasNodeType, CanvasSnapshot } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { botStatus, toneState } from "@/lib/production-board/status";
import type { BoardCard } from "@/lib/production-board/types";
import { BotNode } from "./BotNode";
import { BriefNode } from "./BriefNode";
import { CharacterNode } from "./CharacterNode";
import { EpisodeNode } from "./EpisodeNode";
import { EpisodeStackNode } from "./EpisodeStackNode";
import { FinalNode } from "./FinalNode";
import { OtherNode } from "./OtherNode";
import type { NodeContext } from "./parts";
import { ResultNode, VIDEO_STATE } from "./ResultNode";
import { SceneNode } from "./SceneNode";
import { ShotNode } from "./ShotNode";
import { TasksNode } from "./TasksNode";

export { VIDEO_STATE };

export const NODE_CLASS: Readonly<Record<BoardCard["kind"], string>> = {
  bot: "k-bot",
  brief: "k-brief",
  plan: "k-tasks",
  episode: "k-ep",
  stack: "k-epmore",
  character: "k-char",
  scene: "k-scene",
  shot: "k-shot",
  result: "k-result",
  final: "k-final",
  other: "k-other",
};

const otherKind = (type: CanvasNodeType) => (type === "text" || type === "image" || type === "video" || type === "audio" ? type : "file");

function labelOf(card: BoardCard, snapshot: CanvasSnapshot): string {
  const label = (kind: string, title: string) => t("boardCards.label", { kind, title });
  switch (card.kind) {
    case "bot": return label(t("boardPanels.kind.bot"), snapshot.bots[card.botId]?.name ?? card.botId);
    case "brief":
    case "plan": return label(t(`boardPanels.kind.${card.kind}`), card.title);
    case "episode": return label(t("boardPanels.kind.episode"), `${episodeCode(card.episode)} ${card.title}`);
    case "stack": return label(t("boardPanels.kind.episode"), t("boardCards.stack.more", { count: card.episodes.length }));
    case "character":
    case "scene": return label(t(`boardPanels.kind.${card.kind}`), card.name);
    case "shot":
    case "result": return label(t(`boardPanels.kind.${card.kind}`), `${shotCode(card.number)} ${card.title}`);
    case "final": return label(t("boardPanels.kind.final"), `${episodeCode(card.episode)} ${card.title}`);
    case "other": return label(t(`boardPanels.kind.${otherKind(card.node.type)}`), card.node.title);
  }
}

/** The mockup's `data-state` / `data-vstate` of a card, and what a screen reader calls it. */
export function nodeFacts(card: BoardCard, snapshot: CanvasSnapshot): { state?: string; vstate?: string; label: string } {
  const label = labelOf(card, snapshot);
  switch (card.kind) {
    case "bot": return { state: toneState(botStatus(snapshot.bots[card.botId] ?? { status: card.status }, card.jobStatus).tone), label };
    case "result": return { state: VIDEO_STATE[card.status], label };
    case "shot": return { vstate: VIDEO_STATE[card.status], label };
    default: return { label };
  }
}

/** The inside of a card, by its kind. */
export function NodeBody({ card, ctx }: { card: BoardCard; ctx: NodeContext }) {
  switch (card.kind) {
    case "bot": return <BotNode card={card} ctx={ctx} />;
    case "brief": return <BriefNode card={card} ctx={ctx} />;
    case "plan": return <TasksNode card={card} ctx={ctx} />;
    case "episode": return <EpisodeNode card={card} ctx={ctx} />;
    case "stack": return <EpisodeStackNode card={card} ctx={ctx} />;
    case "character": return <CharacterNode card={card} ctx={ctx} />;
    case "scene": return <SceneNode card={card} ctx={ctx} />;
    case "shot": return <ShotNode card={card} ctx={ctx} />;
    case "result": return <ResultNode card={card} ctx={ctx} />;
    case "final": return <FinalNode card={card} ctx={ctx} />;
    case "other": return <OtherNode card={card} ctx={ctx} />;
  }
}
