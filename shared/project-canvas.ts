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

import type { OptionCardData } from "./wire.ts";

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

/** What a node carries besides its frame. Which keys a type takes:
 * - text: `content`, `fontSize`;
 * - image, video, audio, file: `file`; image and video also `naturalWidth`, `naturalHeight`; audio and video
 *   `durationMs`;
 * - image, video, shot and config: `prompt`, `status`, `errorDetails`, `jobId`, `settings`; config also
 *   `generationMode`;
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
  errorDetails?: string;
  jobId?: string;
  settings?: CanvasNodeSettings;
  generationMode?: "image" | "video";
}

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
}

/** `content`: the upstream node is reference material for the downstream one. `dispatch`: from a bot to its direct
 * subordinate, derived from the project's flow on every read, never stored and never changed by an operation. */
export interface CanvasConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "content" | "dispatch";
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
  revision: number;
  changed: { nodes: string[]; connections: string[]; viewport?: true; backgroundMode?: true };
}

/** The 409 body when the canvas takes no change: the project is archived. */
export interface CanvasReadOnly {
  code: "canvas_read_only";
  error: string;
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
  status: CanvasBotStatus;
  /** While working: the step it is on, in the words of its chat's activity line. */
  doing?: string;
  /** Its newest reply, secrets redacted, at most `CANVAS_OUTPUT_MAX_CHARS` characters. */
  output?: { text: string; truncated?: true; threadId: string; messageId: string; at: number };
  /** The question or approval card it waits on the person with. */
  waiting?: { threadId: string; messageId: string; card: OptionCardData };
  /** The person or a bot set its node's position. False: the position is the server's default layout, which the
   * app may replace with its own by storing positions. */
  placed: boolean;
}

/** `GET /api/team-projects/:id/canvas`. `nodes` hold a node for every bot of the project, `connections` the
 * dispatch connections and only the content connections whose two ends are on the canvas. */
export interface CanvasSnapshot extends CanvasDocument {
  project: { id: string; name: string; leadBotId: string; archived: boolean; folderState: "ready" | "missing" };
  /** Why the canvas takes no change now; absent when it does. */
  readOnly?: "archived";
  /** By bot id; the node is `bot:<botId>`. */
  bots: Record<string, CanvasBotState>;
}

/** On `/api/events`, to the owner and admins, when a project's canvas changes. `document`: the stored canvas has a new
 * revision. `bots`: what the snapshot derives changed (a status, an output, a member). Read the snapshot again. */
export interface ProjectCanvasEvent {
  kind: "project-canvas";
  projectId: string;
  revision: number;
  reason: "document" | "bots";
}

/** `POST /api/team-projects/:id/canvas/tasks`: the person's task for one bot of the project. What is connected into
 * the bot's node goes with it: a text node's text, a shot's fields, media and other files as attachments. Without
 * `threadId` it goes to the conversation the bot has open. */
export interface CanvasTaskRequest {
  botId: string;
  text: string;
  threadId?: string;
}

export interface CanvasTaskResponse {
  threadId: string;
  /** The sent message, unless it waits in the bot's queue. */
  messageId?: string;
  queued?: true;
  /** How many connected nodes went with it. */
  references: number;
}

/** `POST /api/team-projects/:id/canvas/files?name=<file name>[&x=&y=]`, the raw bytes as the body and their type as
 * `content-type`: the file goes into the project folder's `素材` folder and a node of its type is added for it.
 * `GET /api/team-projects/:id/canvas/files?path=<path relative to the project folder>` answers a file's bytes. */
export interface CanvasUploadResponse {
  revision: number;
  nodeId: string;
  file: CanvasFileRef;
}

/** What the canvas asks of generation for one node: everything is taken from the node and what is connected into
 * it, so a model never rewrites it. `references` are the files of the image and audio nodes connected into it. */
export interface CanvasGenerationRequest {
  projectId: string;
  nodeId: string;
  kind: "image" | "video";
  prompt: string;
  settings: CanvasNodeSettings;
  references: CanvasFileRef[];
  by: CanvasNodeCreator;
}

/** What generation reports for a job, at each change. `outputs` come with `success`: files it saved in the project
 * folder. An empty image or video node takes the first; the others, and every output of a node that already shows
 * a file or of a shot, become new nodes to its right, connected from it, below the ones made before. */
export interface CanvasGenerationUpdate {
  projectId: string;
  nodeId: string;
  jobId: string;
  status: CanvasGenerationStatus;
  errorDetails?: string;
  outputs?: CanvasFileRef[];
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

const BOT_NODE_PREFIX = "bot:";

export const botNodeId = (botId: string): string => `${BOT_NODE_PREFIX}${botId}`;

export const botIdOfNode = (nodeId: string): string | null =>
  nodeId.startsWith(BOT_NODE_PREFIX) && nodeId.length > BOT_NODE_PREFIX.length ? nodeId.slice(BOT_NODE_PREFIX.length) : null;

export const dispatchConnectionId = (parentBotId: string, childBotId: string): string => `dispatch:${parentBotId}:${childBotId}`;

export function canvasFileNodeType(mime: string): CanvasFileNodeType {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}
