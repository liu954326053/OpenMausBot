/*! Node, connection, viewport and operation shapes adapted from basketikun/infinite-canvas
 * (web/src/types/canvas.ts, web/src/lib/canvas/canvas-agent-ops.ts, web/src/constant/canvas.ts), MIT; modified.
 *
 * MIT License
 *
 * Copyright (c) 2026 basketikun
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { ProductionWire } from "./production.ts";
import type { GenerationKind } from "./project-generation.ts";
import type { ProjectDraftWire } from "./project-draft.ts";
import type { ServerTextParams } from "./server-text.ts";
import type { FlowStage } from "./team-pipeline.ts";
import type { OptionCardData } from "./wire.ts";

export type { CanvasGenerationConfirmation, CanvasGenerationDecision } from "../packages/phone-protocol/src/canvas-generation-card.ts";

export type CanvasNodeType = "bot" | "shot" | "text" | "image" | "video" | "audio" | "file" | "config" | "group";
/** Every type but `bot`: bot nodes come from the project's members and are never added or deleted. */
export type CanvasContentNodeType = Exclude<CanvasNodeType, "bot">;
/** The types a file becomes, by its MIME type. */
export type CanvasFileNodeType = "image" | "video" | "audio" | "file";

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Pan in screen pixels and zoom factor `k`. */
export interface CanvasViewport {
  x: number;
  y: number;
  k: number;
}

/** The view of a canvas nobody has set a view on. */
export const CANVAS_UNSET_VIEWPORT: Readonly<CanvasViewport> = { x: 0, y: 0, k: 1 };

export type CanvasBackgroundMode = "lines" | "dots" | "blank";

/** Who put a node there. A bot changes and deletes only nodes it made; the person changes any content node. */
export type CanvasNodeCreator = { kind: "person" } | { kind: "bot"; botId: string };

/** A file in the project folder. `path` is relative to the folder, `/`-separated, never inside `.magic-team`. */
export interface CanvasFileRef {
  path: string;
  mime: string;
  bytes: number;
  name: string;
}

export type CanvasGenerationStatus = "idle" | "loading" | "success" | "error";

/** Only the generation settings a node overrides; a key that is absent follows the project's settings. Image nodes
 * use `model`, `aspect`, `quality` and `count`; video and shot nodes `model`, `resolution`, `aspect` and `seconds`;
 * a config node the ones of its `generationMode`. */
export interface CanvasNodeSettings {
  model?: string;
  aspect?: string;
  quality?: string;
  count?: number;
  resolution?: string;
  seconds?: number;
}

export const CANVAS_CARD_ROWS_MAX = 12;
export const CANVAS_CARD_TAGS_MAX = 8;
export const CANVAS_CARD_PALETTE_MAX = 6;
export const CANVAS_CARD_TEXT_MAX_CHARS = 200;

/** What a card shows of a brief, an episode, a character or a scene besides its text, as the bot that made it wrote it. */
export interface CanvasCardFacts {
  /** A word or two set apart on the card: a character's part in the drama, such as "lead". */
  badge?: string;
  /** One line under the title: a character's age and occupation, a scene's place and time, an episode's logline. */
  subtitle?: string;
  tags?: string[];
  /** A label and its value each: a brief's lines, a character's look and voice. */
  rows?: Array<[string, string]>;
  /** `#rrggbb` colours. */
  palette?: string[];
}

/** How a shot is filmed, as its storyboard bot wrote it. What it shows is its `prompt`, how long it runs its
 * `settings.seconds`. */
export interface CanvasShotDesign {
  /** The shot size, such as "wide" or "close-up". */
  size?: string;
  /** The camera's move, such as "slow push-in". */
  move?: string;
  /** What is heard: a line of dialogue, sound and music. */
  audio?: string;
}

/** What a node carries besides its frame. Which keys a type takes:
 * - text: `content`, `fontSize`, `card`;
 * - shot: `shot`;
 * - image, video, audio, file: `file`; image and video also `naturalWidth`, `naturalHeight`; audio and video
 *   `durationMs`;
 * - image, video, shot and config: `prompt`, `status`, `errorDetails`, `errorKey`, `errorParams`, `jobId`, `settings`;
 *   config also `generationMode`;
 * - bot and group: none. */
export interface CanvasNodeMetadata {
  content?: string;
  fontSize?: number;
  file?: CanvasFileRef;
  naturalWidth?: number;
  naturalHeight?: number;
  durationMs?: number;
  prompt?: string;
  status?: CanvasGenerationStatus;
  /** The English line: what a bot reads, and what a client shows when it doesn't know `errorKey`. */
  errorDetails?: string;
  /** A `serverError.projectGeneration.*` or `serverError.projectCanvas.*` key a client shows instead of `errorDetails`.
   * The three error fields change together: setting or clearing any of them drops the others. */
  errorKey?: string;
  /** Values for the placeholders of `errorKey`. */
  errorParams?: ServerTextParams;
  jobId?: string;
  settings?: CanvasNodeSettings;
  generationMode?: "image" | "video";
  /** What the node is in the project's production; absent on a node that is none of these. Set by the server, never
   * by an operation of the person; a bot gives a text node it adds the role of its own job: `episode` from the script
   * bot, `character` from the character bot, `scene` from the scene bot. */
  role?: CanvasNodeRole;
  /** On an `episode`: its number, from 1. On a shot, a `creation`, a `take` and a `final`: the episode it belongs to. */
  episode?: number;
  card?: CanvasCardFacts;
  shot?: CanvasShotDesign;
  /** On a `creation` and a `take`: the shot it belongs to. */
  shotId?: string;
  /** On a `take`: it is the one of its shot that goes to post. One take of a shot at most. */
  selected?: boolean;
  /** Something it was made from changed after it was made. Cleared when it is made again. */
  stale?: boolean;
}

/**
 * `brief`: the text node holding what the lead agreed with the person. `plan`: the text node that stands for the
 * lead's split of the work. `episode`: a text node holding one episode's script. `script`: a script written before a
 * drama had episodes, read as its only episode. `character` and `scene`: a text node holding one character's or one
 * scene's profile; it and the pictures generated from it sit in one group. `creation`: the config node that generates
 * a shot's video. `take`: a video generated for a shot. `final`: an episode's finished film.
 */
export type CanvasNodeRole = "brief" | "plan" | "episode" | "script" | "character" | "scene" | "creation" | "take" | "final";

/** The roles a bot gives a text node it adds, each by the bot of that job. */
export const CANVAS_PROFILE_ROLES = ["character", "scene"] as const satisfies readonly CanvasNodeRole[];

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  position: CanvasPoint;
  width: number;
  height: number;
  metadata?: CanvasNodeMetadata;
  /** Absent on bot nodes. */
  createdBy?: CanvasNodeCreator;
  /** The group node this node sits in. */
  groupId?: string;
  /** The person moved it on the production board, which then draws it at `position` instead of laying it out. */
  arranged?: true;
}

/** `content`: the upstream node is reference material for the downstream one. `dispatch`: a line of the project's
 * pipeline, from a bot to a bot its work goes to, derived on every read, never stored and never changed by an
 * operation; several may run into one bot. */
export interface CanvasConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "content" | "dispatch";
  /** A content connection the server made because the pipeline says so. A bot cannot delete it; the person can, and
   * it then stays away until what it joined changes. */
  pipeline?: true;
}

/** A project's canvas. As stored, bot nodes keep only their frame (`title` is empty) and there are no dispatch
 * connections; a snapshot fills in both. `revision` rises by one with every change to what is stored. */
export interface CanvasDocument {
  projectId: string;
  revision: number;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  viewport: CanvasViewport;
  backgroundMode: CanvasBackgroundMode;
}

/** `null` removes the key. `settings` and `file` are replaced whole. */
export type CanvasNodeMetadataPatch = { [Key in keyof CanvasNodeMetadata]?: CanvasNodeMetadata[Key] | null };

/** A bot node takes only `position`, `width` and `height`. `groupId: null` takes a node out of its group. */
export interface CanvasNodePatch {
  title?: string;
  position?: CanvasPoint;
  width?: number;
  height?: number;
  groupId?: string | null;
}

/** One change, as infinite-canvas's `canvas_apply_ops` takes it. An `add_node` without `position` is placed by the
 * server: a bot's to the right of its own node and below what it already made there, a person's at the right of
 * the canvas. An `id` given to `add_node` or `connect_nodes` must be new; without one the server makes it. Deleting a
 * node deletes its connections and leaves the nodes of a deleted group ungrouped. */
export type CanvasOp =
  | {
    type: "add_node";
    id?: string;
    nodeType: CanvasContentNodeType;
    title?: string;
    position?: CanvasPoint;
    width?: number;
    height?: number;
    metadata?: CanvasNodeMetadata;
    groupId?: string;
  }
  | { type: "update_node"; id: string; patch?: CanvasNodePatch; metadata?: CanvasNodeMetadataPatch }
  | { type: "delete_node"; id?: string; ids?: string[] }
  | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
  | { type: "delete_connections"; id?: string; ids?: string[] }
  | { type: "set_viewport"; viewport: CanvasViewport }
  | { type: "set_background"; backgroundMode: CanvasBackgroundMode };

/** `POST /api/team-projects/:id/canvas/ops`. Without `baseRevision` the operations apply to the canvas as it is.
 * With an older one they apply when nothing they touch changed since, and are refused whole otherwise. */
export interface CanvasOpsRequest {
  baseRevision?: number;
  ops: CanvasOp[];
}

/** The new revision, and the ids of the nodes and connections the operations added, in order. */
export interface CanvasOpsResponse {
  revision: number;
  nodeIds: string[];
  connectionIds: string[];
}

/** The 409 body for operations made against an old revision that touch something changed since: the ids of what
 * they touch that changed (deleted ones included). `stale`: the revision is older than the history kept, so what
 * changed is not known; read the snapshot again. */
export interface CanvasConflict {
  code: "canvas_conflict" | "canvas_stale";
  error: string;
  /** A `serverError.*` catalog key a client may show instead of `error`. */
  errorKey?: string;
  revision: number;
  changed: { nodes: string[]; connections: string[]; viewport?: true; backgroundMode?: true };
}

/** The 409 body when the canvas takes no change: the project is archived. */
export interface CanvasReadOnly {
  code: "canvas_read_only";
  error: string;
  /** A `serverError.*` catalog key a client may show instead of `error`. */
  errorKey?: string;
  reason: "archived";
}

/** `working`: a conversation of the bot runs a turn. `queued`: a message waits for it to be free. `waiting`: a
 * question or approval waits on the person. `error`: its last turn failed. */
export type CanvasBotStatus = "working" | "queued" | "waiting" | "idle" | "error";

/** What the server derives for a bot's node. Text comes only from conversations the viewer may open. */
export interface CanvasBotState {
  botId: string;
  name: string;
  /** Its job title. */
  title: string;
  lead: boolean;
  /** Its jobs in the project's production, in order; `["other"]` for a bot that has none. */
  stages: FlowStage[];
  /** The episode the production made it for; absent on a bot that works on the whole drama. */
  episode?: number;
  status: CanvasBotStatus;
  /** While working: the step it is on, in the words of its chat's activity line. */
  doing?: string;
  /** Its latest steps in its open conversation, oldest first, in the words of its chat's activity lines. */
  steps?: Array<{ text: string; at: number }>;
  /** Its newest reply, secrets redacted, at most `CANVAS_OUTPUT_MAX_CHARS` characters. */
  output?: { text: string; truncated?: true; threadId: string; messageId: string; at: number };
  /** The question or approval card it waits on the person with. */
  waiting?: { threadId: string; messageId: string; card: OptionCardData };
  /** The person or a bot set its node's position. False: the position is the server's default layout, moved down
   * clear of the canvas's other nodes, which the app may replace with its own by storing positions. */
  placed: boolean;
  /** Text nodes a task running or waiting in its queue was written in that had no text when it was sent: its reply
   * goes into each. */
  writingInto?: string[];
  /** The new nodes the replies to tasks running or waiting in its queue become, beside the text nodes the tasks were
   * written in that had text when each was sent, in the order they were sent. */
  writingBeside?: CanvasReplyPlaceholder[];
}

/** Where a reply being written beside the text node `nodeId` goes: the id, position and size of the node it becomes
 * once its turn ends well. No node the server places is put there until then. */
export interface CanvasReplyPlaceholder {
  id: string;
  nodeId: string;
  position: CanvasPoint;
  width: number;
  height: number;
}

/** `GET /api/team-projects/:id/canvas`. `nodes` hold a node for every bot of the project, `connections` the
 * dispatch connections and only the content connections whose two ends are on the canvas. */
export interface CanvasSnapshot extends CanvasDocument {
  project: { id: string; name: string; leadBotId: string; archived: boolean; folderState: "ready" | "missing" };
  /** Why the canvas takes no change now; absent when it does. */
  readOnly?: "archived";
  /** By bot id; the node is `bot:<botId>`. */
  bots: Record<string, CanvasBotState>;
  /** The project's production, once its lead planned it. */
  production?: ProductionWire;
  /** Each episode's JianYing draft by episode number, and where its finished film is expected. */
  drafts?: Record<number, ProjectDraftWire>;
}

/** On `/api/events`, to the owner and admins, when a project's canvas changes. `document`: the stored canvas has a new
 * revision. `bots`: what the snapshot derives changed (a status, an output, a member, a line or a stage of the
 * pipeline). Read the snapshot again. */
export interface ProjectCanvasEvent {
  kind: "project-canvas";
  projectId: string;
  revision: number;
  reason: "document" | "bots";
}

/** `POST /api/team-projects/:id/canvas/tasks`: the person's task for one bot of the project. What is connected into
 * the bot's node goes with it, each reference named by the label `connectedReferences` gives it and its title: a text
 * node's text, a shot's fields, media and other files as attachments. Without `threadId` it goes to the conversation
 * the bot has open. With `targetNodeId` the bot's reply, once its turn ends well, secrets redacted and cut to
 * `CANVAS_CONTENT_MAX_CHARS`, becomes the text of that node when it had none as the task was sent and still has none,
 * and otherwise a new text node to its right, connected from it and titled by `replyTitle`. For a node that had text,
 * that new node is the one the bot's `writingBeside` shows from the moment the task is sent, which the reply takes
 * exactly. A stopped or failed turn, a turn the task joined while it ran, a turn for a message queued after the task
 * that it was merged into, or a server restart before the reply adds nothing and ends what `writingInto` or
 * `writingBeside` showed for it. */
export interface CanvasTaskRequest {
  botId: string;
  text: string;
  threadId?: string;
  /** A text node of this canvas the person wrote the task in. What goes with the task is then that node's, labelled
   * as its panel labels them: the references `mentionReferences` gives it and the other nodes connected into it. Its
   * own text, its first reference, goes first, with `text` as the request to revise it. */
  targetNodeId?: string;
  /** Content nodes of this canvas the person named for the task. Each goes with it as if it were connected into the
   * node the task was written in: words quoted, pictures as the model's input. */
  references?: string[];
  /** The language the person's app shows, a tag such as "zh" or "pt-br", whose words name the references their text
   * mentions ("图片 1"). Without it, the language the server writes its own lines in. */
  language?: string;
}

export interface CanvasTaskResponse {
  threadId: string;
  /** The sent message, unless it waits in the bot's queue. */
  messageId?: string;
  queued?: true;
  /** How many connected nodes went with it. */
  references: number;
}

/** The title of the node a task's reply becomes beside the text node it was written in: the request's first words. */
export const replyTitle = (request: string): string => Array.from(request.trim().replace(/\s+/g, " ")).slice(0, 32).join("");

/** `POST /api/team-projects/:id/canvas/files?name=<file name>[&x=&y=]`, the raw bytes as the body and their type as
 * `content-type`: the file goes into the project folder's `素材` folder and a node of its type is added for it.
 * `GET /api/team-projects/:id/canvas/files?path=<path relative to the project folder>` answers a file's bytes. */
export interface CanvasUploadResponse {
  revision: number;
  nodeId: string;
  file: CanvasFileRef;
}

/** `POST /api/team-projects/:id/canvas/generate`: the project's generation starts for a shot, image, video or config
 * node, from its prompt, its `settings` and the files of the image and audio among the references `mentionReferences`
 * gives it, so a model never rewrites the request. The prompt sent begins with which label names which of those files,
 * in the words of `language`, and ends with each text reference under its label. Answered 202; a refusal is answered
 * with generation's own `GenerationFailure`, or, for a node that is gone, has no prompt or is generating already, with
 * the canvas's `ServerErrorBody`. The node shows `loading` while the job runs. On success an empty image or video node
 * takes the first file of its kind, and each other file the job made becomes a node to its right, connected from it,
 * below the ones made before; on failure `errorDetails`, `errorKey` and `errorParams` say why. A bot past its ceiling
 * is asked about on a card instead (`OptionCardData.canvasGeneration`), which its node shows in `waiting` until the
 * person answers. */
export interface CanvasGenerateRequest {
  nodeId: string;
  /** As in `CanvasTaskRequest`. */
  language?: string;
}

export interface CanvasGenerateResponse {
  jobId: string;
}

/** `POST /api/team-projects/:id/canvas/select-take`: a take of the project, a video generated for a shot, becomes its
 * shot's selected take, and the shot's other takes lose the mark. Refused for a node that is no take with
 * `code: "not_a_take"`, and for an archived project with `CanvasReadOnly`. */
export interface CanvasSelectTakeRequest {
  nodeId: string;
}

/** The canvas's revision once the take is selected; the one it had when the take was selected already. */
export interface CanvasSelectTakeResponse {
  revision: number;
}

/** Uploads go here, in the project folder. */
export const CANVAS_UPLOAD_FOLDER = "素材";
/** Generated images and videos, and files a bot hands over from outside the project folder, go here. */
export const CANVAS_OUTPUT_FOLDER = "产出";
export const CANVAS_OUTPUT_MAX_CHARS = 2_000;
export const CANVAS_TITLE_MAX_CHARS = 200;
export const CANVAS_CONTENT_MAX_CHARS = 20_000;
export const CANVAS_PROMPT_MAX_CHARS = 8_000;
export const CANVAS_MAX_NODES = 2_000;
export const CANVAS_MAX_CONNECTIONS = 4_000;
export const CANVAS_MAX_OPS = 200;

/** The size a node of each type gets when nobody gave one. */
export const CANVAS_NODE_SIZE: Readonly<Record<CanvasNodeType, { width: number; height: number }>> = {
  bot: { width: 300, height: 180 },
  shot: { width: 340, height: 240 },
  text: { width: 340, height: 240 },
  image: { width: 340, height: 240 },
  video: { width: 420, height: 236 },
  audio: { width: 340, height: 120 },
  file: { width: 340, height: 120 },
  config: { width: 340, height: 240 },
  group: { width: 760, height: 480 },
};

/** The tallest a text node is: longer text scrolls inside it. */
export const CANVAS_TEXT_MAX_HEIGHT = 480;

/** A node's height as its type allows it: a text node no taller than `CANVAS_TEXT_MAX_HEIGHT`. */
export const allowedNodeHeight = (type: CanvasNodeType, height: number): number =>
  type === "text" ? Math.min(height, CANVAS_TEXT_MAX_HEIGHT) : height;

const BOT_NODE_PREFIX = "bot:";

export const botNodeId = (botId: string): string => `${BOT_NODE_PREFIX}${botId}`;

export const botIdOfNode = (nodeId: string): string | null =>
  nodeId.startsWith(BOT_NODE_PREFIX) && nodeId.length > BOT_NODE_PREFIX.length ? nodeId.slice(BOT_NODE_PREFIX.length) : null;

export const dispatchConnectionId = (fromBotId: string, toBotId: string): string => `dispatch:${fromBotId}:${toBotId}`;

export function canvasFileNodeType(mime: string): CanvasFileNodeType {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

/** What generating a node makes: a picture for an image node, a clip for a video node or a shot, and what a config node
 * is set to make. Null for a node that is not generated. */
export function generationKindOf(node: CanvasNode): GenerationKind | null {
  if (node.type === "image") return "image";
  if (node.type === "video" || node.type === "shot") return "video";
  if (node.type === "config") return node.metadata?.generationMode ?? "image";
  return null;
}
