import type { CanvasSnapshot } from "../../../shared/project-canvas";
import type { CanvasBackend } from "../project-canvas/backend";

/** A card's box on the screen, in CSS pixels from the top-left corner of the board's viewport. */
export interface BoardAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The board's bands from left to right, as its stage bar names them. */
export const BOARD_STAGES = ["brief", "script", "library", "storyboard", "post"] as const;

export type BoardStage = (typeof BOARD_STAGES)[number];

/** What a click on the board, or in a panel over it, opened. */
export type BoardOpened =
  | { kind: "bot"; botId: string; references?: readonly string[] }
  | { kind: "asset"; nodeId: string };

/** What the board hands the layer drawn over it: the side panel, a bot's chat window and an asset's details. */
export interface BoardOverlayProps {
  projectId: string;
  snapshot: CanvasSnapshot;
  backend: CanvasBackend;
  opened: BoardOpened | null;
  open(what: BoardOpened): void;
  close(): void;
  /** Null when the node has no card on the screen now, as inside a collapsed episode or out of view. */
  anchorOf(nodeId: string): BoardAnchor | null;
  /** Calls `listener` whenever the camera or a card moves; returns the way to stop listening. */
  subscribeView(listener: () => void): () => void;
  focusNode(nodeId: string): void;
  /** Unfolds the episode when it is folded, and brings it into view. */
  focusEpisode(episode: number): void;
  focusStage(stage: BoardStage): void;
}
