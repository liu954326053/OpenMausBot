import type { ProductionEpisodeStatus, ProductionJob, ProductionRetryInput, ProductionTaskStatus, ProductionTaskWire } from "../../../shared/production";
import type { CanvasBotStatus, CanvasCardFacts, CanvasFileRef, CanvasNode, CanvasNodeMetadata, CanvasPoint, CanvasShotDesign } from "../../../shared/project-canvas";
import type { ProjectDraftWire } from "../../../shared/project-draft";
import type { BoardStage } from "./overlay";

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

export type RetryTarget = ProductionRetryInput;

/** How a picture or a video is being made: its node's own fields. */
export type BoardGeneration = Pick<CanvasNodeMetadata, "status" | "errorKey" | "errorParams" | "errorDetails">;

export interface BoardProgress {
  unit: "tasks" | "episodes" | "characters" | "scenes" | "videos";
  done: number;
  total: number;
}

export interface BoardCount {
  done: number;
  total: number;
}

/** What an episode's storyboard waits for: only the whole-drama jobs that have a bot. */
export interface BoardGate {
  /** The drama's characters that have a picture, of all of them. */
  characters?: BoardCount;
  scenes?: BoardCount;
  /** Its episode's script is written. */
  script?: boolean;
}

export interface BoardBotCard extends CardBase<"bot"> {
  botId: string;
  lead: boolean;
  status: CanvasBotStatus;
  job?: ProductionJob;
  /** How its job stands: the whole-drama job's, or its episode's task's. */
  jobStatus?: ProductionTaskStatus;
  /** The production's task it is on, else the last one it had. */
  task?: { job: ProductionJob; episode?: number; status: ProductionTaskWire["status"]; at?: number };
  progress?: BoardProgress;
  retry?: RetryTarget;
  /** On an episode's storyboard bot. */
  gate?: BoardGate;
}

export interface BoardBriefCard extends CardBase<"brief"> {
  title: string;
  rows: Array<[string, string]>;
  text: string;
  by?: string;
}

export interface BoardPlanTask {
  job: ProductionJob;
  botId?: string;
  status: ProductionTaskStatus;
  count?: number;
}

export interface BoardPlanCard extends CardBase<"plan"> {
  title: string;
  tasks: BoardPlanTask[];
}

export interface BoardEpisodeCard extends CardBase<"episode"> {
  episode: number;
  title: string;
  logline?: string;
  text: string;
  status?: ProductionEpisodeStatus;
  storyboardBotId?: string;
  shots: number;
  ready: number;
  /** How long its shots run together; absent while one of them has no length. */
  seconds?: number;
}

export interface BoardStackCard extends CardBase<"stack"> {
  episodes: Array<{ episode: number; title: string; nodeId: string; status?: ProductionEpisodeStatus }>;
}

export interface BoardPicture {
  nodeId: string;
  file?: CanvasFileRef;
  generation?: BoardGeneration;
  prompt?: string;
}

export interface BoardShotUse {
  shotId: string;
  episode: number;
  number: number;
}

export interface BoardProfileCard<Kind extends "character" | "scene"> extends CardBase<Kind> {
  name: string;
  facts: CanvasCardFacts;
  text: string;
  /** The picture it shows: the group's selected one, else its first with a file. */
  picture?: BoardPicture;
  /** Its newest picture, the one generating makes again. */
  newest?: BoardPicture;
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
  /** From 1 within its episode. */
  number: number;
  title: string;
  design?: CanvasShotDesign;
  seconds?: number;
  /** Where it starts in its episode, in seconds; absent while a shot before it has no length. */
  startsAt?: number;
  prompt?: string;
  /** The character and scene cards it uses. */
  characters: string[];
  scenes: string[];
  references: Array<{ cardId: string; kind: "character" | "scene"; name: string; picture?: CanvasFileRef }>;
  status: BoardVideoStatus;
  takes: number;
  generation?: BoardGeneration;
  creationId?: string;
  /** Its prompt changed after its videos were made. */
  stale?: boolean;
}

export interface BoardTake {
  nodeId: string;
  file?: CanvasFileRef;
  durationMs?: number;
  selected: boolean;
  /** Made before what it was made from changed. */
  stale?: boolean;
}

export interface BoardResultCard extends CardBase<"result"> {
  shotId: string;
  episode: number;
  number: number;
  title: string;
  creationId?: string;
  /** Oldest first. */
  takes: BoardTake[];
  selectedTakeId?: string;
  status: BoardVideoStatus;
  generation?: BoardGeneration;
}

export interface BoardClip {
  shotId: string;
  number: number;
  state: "ready" | "generating" | "failed" | "missing";
  durationMs?: number;
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
