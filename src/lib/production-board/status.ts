import type { ProductionEpisodeStatus, ProductionTaskStatus } from "../../../shared/production";
import type { CanvasBotState, CanvasGenerationStatus } from "../../../shared/project-canvas";
import { t } from "@/lib/i18n";

/** The colour a card's state wears, on the card and on its far-view label. `asking`: something waits on the person. */
export type BoardTone = "idle" | "working" | "done" | "asking" | "failed";

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

/** The mockup's `data-state` for a tone: `done`, `working`, `waiting`, plus `failed`. */
export const toneState = (tone: BoardTone): "done" | "working" | "waiting" | "failed" =>
  (tone === "done" ? "done" : tone === "failed" ? "failed" : tone === "idle" ? "waiting" : "working");
