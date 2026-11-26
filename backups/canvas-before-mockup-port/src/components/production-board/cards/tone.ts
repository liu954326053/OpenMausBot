import type { ProductionEpisodeStatus, ProductionTaskStatus } from "../../../../shared/production";
import type { CanvasBotState, CanvasGenerationStatus } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";

/** The colour a card's state wears, on the card and on its far-view label. `asking`: something waits on the person. */
export type BoardTone = "idle" | "working" | "done" | "asking" | "failed";

export const TONE_DOT: Readonly<Record<BoardTone, string>> = {
  idle: "bg-ink-tertiary",
  working: "bg-warning",
  done: "bg-success",
  asking: "bg-warning",
  failed: "bg-danger",
};

export const TONE_TEXT: Readonly<Record<BoardTone, string>> = {
  idle: "text-ink-secondary",
  working: "text-warning",
  done: "text-success",
  asking: "text-warning",
  failed: "text-danger",
};

/** Top edge on a bot card: the mockup's three-pixel state band, `line-2` while nothing is under way. */
export const TONE_EDGE: Readonly<Record<BoardTone, string>> = {
  idle: "border-t-board-line-2",
  working: "border-t-board-amber",
  done: "border-t-board-teal",
  asking: "border-t-board-amber",
  failed: "border-t-danger",
};

export interface BoardStatus {
  tone: BoardTone;
  label: string;
}

/** A bot's state as its card says it: a question waiting on the person comes first, then a failure, then its work. */
export function botStatus(bot: Pick<CanvasBotState, "status" | "waiting">, task?: ProductionTaskStatus): BoardStatus {
  if (bot.waiting || bot.status === "waiting") return { tone: "asking", label: t("boardCards.status.asking") };
  if (task === "failed") return { tone: "failed", label: t("boardCards.status.failed") };
  if (bot.status === "error") return { tone: "failed", label: t("boardCards.status.error") };
  if (bot.status === "working") return { tone: "working", label: t("boardCards.status.working") };
  if (bot.status === "queued") return { tone: "working", label: t("boardCards.status.queued") };
  return taskStatus(task) ?? { tone: "idle", label: t("boardCards.status.idle") };
}

export function taskStatus(task: ProductionTaskStatus | undefined): BoardStatus | null {
  switch (task) {
    case "waiting": return { tone: "idle", label: t("boardCards.status.waiting") };
    case "working": return { tone: "working", label: t("boardCards.status.working") };
    case "done": return { tone: "done", label: t("boardCards.status.done") };
    case "failed": return { tone: "failed", label: t("boardCards.status.failed") };
    case undefined: return null;
  }
}

export function episodeStatus(status: ProductionEpisodeStatus | undefined): BoardStatus | null {
  if (!status) return null;
  const tone: BoardTone = status === "done" ? "done" : status === "failed" ? "failed" : status === "waiting" ? "idle" : "working";
  return { tone, label: t(`boardCards.episode.status.${status}`) };
}

export function generationTone(status: CanvasGenerationStatus | undefined): BoardTone {
  switch (status) {
    case "loading": return "working";
    case "error": return "failed";
    case "success": return "done";
    default: return "idle";
  }
}
