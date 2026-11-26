import type { ProductionJob } from "../../../../shared/production";
import type { CanvasFileRef, CanvasSnapshot } from "../../../../shared/project-canvas";
import type { BoardTake, RetryTarget } from "@/lib/production-board/types";
import type { CanvasBotLook } from "@/lib/project-canvas/types";

export interface NodeActions {
  /** Brings a card into view; a bot's also opens its chat. */
  focusCard(cardId: string): void;
  openChat(botId: string): void;
  openStack(): void;
  generate?(nodeId: string): void;
  selectTake?(nodeId: string): void;
  retry?(target: RetryTarget): void;
  openDraft?(): void;
}

export interface NodeContext {
  snapshot: CanvasSnapshot;
  looks: Readonly<Record<string, CanvasBotLook>>;
  fileUrl(file: CanvasFileRef): string;
  /** The take of a shot the film uses, else its newest; none while it has no video. */
  takeOf(shotId: string): BoardTake | undefined;
  actions: NodeActions;
}

export type JobKey = ProductionJob | "lead" | "other";
