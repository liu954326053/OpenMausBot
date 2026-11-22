/*! The operations follow applyCanvasAgentOps from basketikun/infinite-canvas
 * (web/src/lib/canvas/canvas-agent-ops.ts), MIT; modified: a batch is checked whole and refused with a reason instead
 * of skipping what does not apply, and a bot changes only what it made.
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

import { z } from "zod";

import {
  botIdOfNode,
  botNodeId,
  CANVAS_CONTENT_MAX_CHARS,
  CANVAS_MAX_CONNECTIONS,
  CANVAS_MAX_NODES,
  CANVAS_MAX_OPS,
  CANVAS_NODE_SIZE,
  CANVAS_PROMPT_MAX_CHARS,
  CANVAS_TITLE_MAX_CHARS,
  type CanvasConnection,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeCreator,
  type CanvasNodeMetadata,
  type CanvasNodeType,
  type CanvasOp,
  type CanvasPoint,
} from "../../shared/project-canvas.ts";
import { IMAGE_COUNT_MAX } from "../../shared/project-generation.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { RemovedNode } from "./document-store.ts";
import { cleanProjectPath } from "./paths.ts";

export type CanvasOpCode = "invalid_op" | "not_found" | "not_yours" | "not_allowed" | "limit";

const STATUS: Record<CanvasOpCode, number> = { invalid_op: 400, not_found: 404, not_yours: 403, not_allowed: 403, limit: 413 };

export class CanvasOpRefusal extends Error {
  readonly status: number;
  readonly code: CanvasOpCode;
  readonly index: number;
  readonly nodeId: string | undefined;
  constructor(code: CanvasOpCode, message: string, index = -1, nodeId?: string) {
    super(index >= 0 ? `operation ${index + 1}: ${message}` : message);
    this.status = STATUS[code];
    this.code = code;
    this.index = index;
    this.nodeId = nodeId;
  }
}

/** What a batch touched, or what changed in a revision. */
export interface CanvasChangeSet {
  nodes: string[];
  connections: string[];
  viewport?: true;
  backgroundMode?: true;
}

export interface CanvasFrame {
  position: CanvasPoint;
  width: number;
  height: number;
}

export interface OpsContext {
  actor: CanvasNodeCreator;
  /** The project's bot nodes by node id, each where it is now: stored, or by the default layout. */
  bots: ReadonlyMap<string, CanvasFrame>;
  newId(): string;
  /** Where a node added without a position goes. */
  place(document: CanvasDocument, node: CanvasNode): CanvasPoint;
  /** A content node deleted lately, by its id: the person adding it back, as undo does, gives it back to its maker
   * and to what it was in the pipeline. */
  removed?(id: string): Pick<RemovedNode, "type" | "createdBy" | "pipeline"> | undefined;
  /** The acting bot's stages in the project's pipeline. */
  stages?: readonly FlowStage[];
}

export interface OpsResult {
  document: CanvasDocument;
  changed: CanvasChangeSet;
  nodeIds: string[];
  connectionIds: string[];
}

const COORDINATE = z.number().finite().min(-1e7).max(1e7);
const point = z.object({ x: COORDINATE, y: COORDINATE }).strict();
const size = z.number().finite().min(16).max(20_000);
const newId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const nodeRef = z.string().regex(/^(?:bot:)?[\w-]{1,128}$/);
const title = z.string().max(CANVAS_TITLE_MAX_CHARS).refine((value) => !/\p{Cc}/u.test(value), "a title is one line");
const short = (max: number) => z.string().max(max);
/** Security: a bot sets the error of a node it made, so the line it names is only ever a generation or canvas error. */
const ERROR_KEY = /^serverError\.project(?:Generation|Canvas)\.\w+$/;
const errorParams = z.record(z.string().regex(/^\w{1,40}$/), z.union([short(2_000), z.number().finite()]))
  .refine((params) => Object.keys(params).length <= 8, "errorParams holds at most 8 values");

const settings = z.object({
  model: short(200).optional(),
  aspect: short(40).optional(),
  quality: short(40).optional(),
  count: z.number().int().min(1).max(IMAGE_COUNT_MAX).optional(),
  resolution: short(40).optional(),
  seconds: z.number().finite().min(1).max(600).optional(),
}).strict();

const file = z.object({
  path: z.string().refine((value) => cleanProjectPath(value) === value, "a path relative to the project folder"),
  mime: short(200),
  bytes: z.number().int().min(0),
  name: short(255),
}).strict();

const METADATA_FIELDS = {
  content: z.string().max(CANVAS_CONTENT_MAX_CHARS),
  fontSize: z.number().finite().min(6).max(200),
  file,
  naturalWidth: z.number().int().min(1).max(100_000),
  naturalHeight: z.number().int().min(1).max(100_000),
  durationMs: z.number().finite().min(0).max(1e9),
  prompt: z.string().max(CANVAS_PROMPT_MAX_CHARS),
  status: z.enum(["idle", "loading", "success", "error"]),
  errorDetails: short(2_000),
  errorKey: z.string().regex(ERROR_KEY, "errorKey is a serverError.projectGeneration or serverError.projectCanvas key"),
  errorParams,
  jobId: short(200),
  settings,
  generationMode: z.enum(["image", "video"]),
  role: z.enum(["script", "character", "creation", "take", "final"]),
  shotId: short(200),
  selected: z.boolean(),
  stale: z.boolean(),
} satisfies { [Key in keyof CanvasNodeMetadata]-?: z.ZodType };

type MetadataKey = keyof typeof METADATA_FIELDS;
const metadataKeys = Object.keys(METADATA_FIELDS) as MetadataKey[];

const metadata = z.object(Object.fromEntries(metadataKeys.map((key) => [key, METADATA_FIELDS[key].optional()]))).strict();
const metadataPatch = z.object(Object.fromEntries(metadataKeys.map((key) => [key, METADATA_FIELDS[key].nullable().optional()]))).strict();

const CONTENT_TYPES = ["shot", "text", "image", "video", "audio", "file", "config", "group"] as const;
const idList = z.array(nodeRef).min(1).max(500);

const opSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_node"), id: newId.optional(), nodeType: z.enum(CONTENT_TYPES), title: title.optional(), position: point.optional(),
    width: size.optional(), height: size.optional(), metadata: metadata.optional(), groupId: nodeRef.optional(),
  }).strict(),
  z.object({
    type: z.literal("update_node"), id: nodeRef,
    patch: z.object({ title: title.optional(), position: point.optional(), width: size.optional(), height: size.optional(), groupId: nodeRef.nullable().optional() }).strict().optional(),
    metadata: metadataPatch.optional(),
  }).strict(),
  z.object({ type: z.literal("delete_node"), id: nodeRef.optional(), ids: idList.optional() }).strict()
    .refine((op) => op.id !== undefined || op.ids !== undefined, "name the node with id or ids"),
  z.object({ type: z.literal("connect_nodes"), id: newId.optional(), fromNodeId: nodeRef, toNodeId: nodeRef }).strict(),
  z.object({ type: z.literal("delete_connections"), id: nodeRef.optional(), ids: idList.optional() }).strict()
    .refine((op) => op.id !== undefined || op.ids !== undefined, "name the connection with id or ids"),
  z.object({ type: z.literal("set_viewport"), viewport: z.object({ x: z.number().finite().min(-1e8).max(1e8), y: z.number().finite().min(-1e8).max(1e8), k: z.number().finite().min(0.01).max(100) }).strict() }).strict(),
  z.object({ type: z.literal("set_background"), backgroundMode: z.enum(["lines", "dots", "blank"]) }).strict(),
]);

/** The operations in a request or a tool call, checked for shape and limits; whole or refused. */
export function parseCanvasOps(input: unknown): CanvasOp[] {
  if (!Array.isArray(input)) throw new CanvasOpRefusal("invalid_op", "ops must be a list of operations");
  if (input.length > CANVAS_MAX_OPS) throw new CanvasOpRefusal("limit", `at most ${CANVAS_MAX_OPS} operations at a time`);
  return input.map((raw, index) => {
    const parsed = opSchema.safeParse(raw);
    if (parsed.success) return parsed.data as CanvasOp;
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new CanvasOpRefusal("invalid_op", `${where}${issue?.message ?? "not an operation"}`, index);
  });
}

const ERROR_FIELDS = ["errorDetails", "errorKey", "errorParams"] as const;
const GENERATION: readonly MetadataKey[] = ["prompt", "status", ...ERROR_FIELDS, "jobId", "settings"];
const TYPE_KEYS: Record<CanvasNodeType, readonly MetadataKey[]> = {
  bot: [],
  group: [],
  text: ["content", "fontSize"],
  file: ["file"],
  audio: ["file", "durationMs"],
  image: ["file", "naturalWidth", "naturalHeight", ...GENERATION],
  video: ["file", "naturalWidth", "naturalHeight", "durationMs", ...GENERATION],
  shot: GENERATION,
  config: [...GENERATION, "generationMode"],
};
const IMAGE_SETTINGS = new Set(["model", "aspect", "quality", "count"]);
const VIDEO_SETTINGS = new Set(["model", "resolution", "aspect", "seconds"]);
const SETTINGS_OF: Partial<Record<CanvasNodeType, ReadonlySet<string>>> = { image: IMAGE_SETTINGS, video: VIDEO_SETTINGS, shot: VIDEO_SETTINGS };
const BOT_ADDS: ReadonlySet<CanvasNodeType> = new Set(["text", "shot"]);
/** What a node is in the pipeline: the server's to set. */
const PIPELINE_KEYS = ["role", "shotId", "selected", "stale"] as const satisfies readonly MetadataKey[];
const PIPELINE_IS_THE_SERVERS = "role, shotId, selected and stale are set by the server";

function checkMetadata(type: CanvasNodeType, values: { settings?: unknown }, index: number): void {
  for (const key of Object.keys(values)) {
    if (!TYPE_KEYS[type].includes(key as MetadataKey)) throw new CanvasOpRefusal("invalid_op", `a ${type} node takes no ${key}`, index);
  }
  const allowed = SETTINGS_OF[type];
  const chosen = values.settings;
  if (allowed && chosen && typeof chosen === "object") {
    for (const key of Object.keys(chosen)) {
      if (!allowed.has(key)) throw new CanvasOpRefusal("invalid_op", `a ${type} node's settings take no ${key}`, index);
    }
  }
}

function mergeMetadata(current: CanvasNodeMetadata | undefined, patch: Record<string, unknown>): CanvasNodeMetadata | undefined {
  const next: Record<string, unknown> = { ...current };
  if (ERROR_FIELDS.some((key) => patch[key] !== undefined)) for (const key of ERROR_FIELDS) delete next[key];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return Object.keys(next).length ? next as CanvasNodeMetadata : undefined;
}

const ordered = (values: Iterable<string>) => [...new Set(values)];

/** The nodes and connections a batch names, and whether it sets the view: what must not have changed since the
 * revision it was made against. */
export function opTargets(ops: readonly CanvasOp[]): CanvasChangeSet {
  const nodes: string[] = [];
  const connections: string[] = [];
  let viewport = false;
  let backgroundMode = false;
  for (const op of ops) {
    if (op.type === "add_node" && op.id) nodes.push(op.id);
    if (op.type === "update_node") nodes.push(op.id);
    if (op.type === "delete_node") nodes.push(...(op.ids ?? [op.id!]));
    if (op.type === "connect_nodes" && op.id) connections.push(op.id);
    if (op.type === "delete_connections") connections.push(...(op.ids ?? [op.id!]));
    if (op.type === "set_viewport") viewport = true;
    if (op.type === "set_background") backgroundMode = true;
  }
  return { nodes: ordered(nodes), connections: ordered(connections), ...(viewport ? { viewport: true } : {}), ...(backgroundMode ? { backgroundMode: true } : {}) };
}

/** Applies a batch to a copy of the document; the document passed in is never changed. The revision is the store's. */
export function applyCanvasOps(source: CanvasDocument, ops: readonly CanvasOp[], context: OpsContext): OpsResult {
  const document = structuredClone(source);
  const changedNodes = new Set<string>();
  const changedConnections = new Set<string>();
  let viewport = false;
  let backgroundMode = false;
  const nodeIds: string[] = [];
  const connectionIds: string[] = [];
  const actor = context.actor;
  const ownBotNode = actor.kind === "bot" ? botNodeId(actor.botId) : null;

  const nodeAt = (id: string) => document.nodes.findIndex((node) => node.id === id);
  const exists = (id: string) => context.bots.has(id) || nodeAt(id) >= 0;
  const isBotNode = (id: string) => botIdOfNode(id) !== null;
  const madeByActor = (node: CanvasNode) => actor.kind === "bot" && node.createdBy?.kind === "bot" && node.createdBy.botId === actor.botId;
  const restored = (id: string | undefined, type: CanvasNodeType) => {
    const removed = actor.kind === "person" && id ? context.removed?.(id) : undefined;
    return removed?.type === type ? removed : undefined;
  };
  const makerOf = (id: string | undefined, type: CanvasNodeType): CanvasNodeCreator =>
    (actor.kind === "bot" ? { kind: "bot", botId: actor.botId } : restored(id, type)?.createdBy ?? { kind: "person" });

  /** What an added node is in the pipeline. It is never taken from the person's operation, which a paste or an undo
   * fills with a copy, and from a bot's only a character's profile. */
  function addedRole(op: Extract<CanvasOp, { type: "add_node" }>, index: number): CanvasNodeMetadata {
    if (actor.kind === "person") return restored(op.id, op.nodeType)?.pipeline ?? {};
    const { role, shotId, selected, stale } = op.metadata ?? {};
    if (shotId !== undefined || selected !== undefined || stale !== undefined || (role !== undefined && role !== "character")) {
      throw new CanvasOpRefusal("not_allowed", `${PIPELINE_IS_THE_SERVERS}; the one role you can give is character, to a text node you add`, index);
    }
    if (role === undefined) return {};
    if (op.nodeType !== "text" || !context.stages?.includes("character")) {
      throw new CanvasOpRefusal("not_allowed", "only a bot of the character stage adds a character, as a text node", index);
    }
    return { role };
  }

  const actorOwnsEnd = (id: string) => {
    if (actor.kind === "person") return true;
    if (id === ownBotNode) return true;
    const node = document.nodes[nodeAt(id)];
    return node !== undefined && madeByActor(node);
  };

  function contentNode(id: string, index: number, change: "change" | "delete"): number {
    if (isBotNode(id)) {
      if (!context.bots.has(id)) throw new CanvasOpRefusal("not_found", `no node ${id} on this canvas`, index, id);
      if (change === "delete") throw new CanvasOpRefusal("invalid_op", `${id} is a bot's node; bot nodes can't be deleted`, index, id);
    }
    const at = nodeAt(id);
    if (at < 0 && !isBotNode(id)) throw new CanvasOpRefusal("not_found", `no node ${id} on this canvas`, index, id);
    if (actor.kind === "bot" && (at < 0 || !madeByActor(document.nodes[at]!))) {
      throw new CanvasOpRefusal("not_yours", `${id} was not put there by you; you can change and delete only the nodes you made`, index, id);
    }
    return at;
  }

  function groupFor(groupId: string, index: number): void {
    const group = document.nodes[nodeAt(groupId)];
    if (!group || group.type !== "group") throw new CanvasOpRefusal("not_found", `no group ${groupId} on this canvas`, index, groupId);
  }

  function connect(fromNodeId: string, toNodeId: string, id: string | undefined, index: number): void {
    for (const end of [fromNodeId, toNodeId]) {
      if (!exists(end)) throw new CanvasOpRefusal("not_found", `no node ${end} on this canvas`, index, end);
    }
    if (fromNodeId === toNodeId) throw new CanvasOpRefusal("invalid_op", "a node can't be connected to itself", index);
    if (isBotNode(fromNodeId) && isBotNode(toNodeId)) throw new CanvasOpRefusal("invalid_op", "bots are connected by the team's flow, not here", index);
    if (!actorOwnsEnd(fromNodeId) && !actorOwnsEnd(toNodeId)) {
      throw new CanvasOpRefusal("not_yours", "connect only to or from your own node or a node you made", index);
    }
    const existing = document.connections.find((one) => one.fromNodeId === fromNodeId && one.toNodeId === toNodeId);
    if (existing) {
      connectionIds.push(existing.id);
      return;
    }
    if (id && document.connections.some((one) => one.id === id)) throw new CanvasOpRefusal("invalid_op", `connection ${id} is already there`, index);
    if (document.connections.length >= CANVAS_MAX_CONNECTIONS) throw new CanvasOpRefusal("limit", `a canvas holds at most ${CANVAS_MAX_CONNECTIONS} connections`, index);
    const connection: CanvasConnection = { id: id ?? context.newId(), fromNodeId, toNodeId, kind: "content" };
    document.connections.push(connection);
    changedConnections.add(connection.id);
    connectionIds.push(connection.id);
  }

  ops.forEach((op, index) => {
    if (op.type === "add_node") {
      if (actor.kind === "bot" && !BOT_ADDS.has(op.nodeType)) throw new CanvasOpRefusal("not_allowed", "you can add text and shot nodes; files you attach become nodes on their own", index);
      if (actor.kind === "bot" && op.groupId) throw new CanvasOpRefusal("not_allowed", "grouping is the person's", index);
      if (op.id && (exists(op.id) || isBotNode(op.id))) throw new CanvasOpRefusal("invalid_op", `node ${op.id} is already there`, index, op.id);
      if (document.nodes.length >= CANVAS_MAX_NODES) throw new CanvasOpRefusal("limit", `a canvas holds at most ${CANVAS_MAX_NODES} nodes`, index);
      const { role: _role, shotId: _shotId, selected: _selected, stale: _stale, ...own } = op.metadata ?? {};
      checkMetadata(op.nodeType, own, index);
      const added: CanvasNodeMetadata = { ...own, ...addedRole(op, index) };
      if (op.groupId) {
        if (op.nodeType === "group") throw new CanvasOpRefusal("invalid_op", "a group can't sit in a group", index);
        groupFor(op.groupId, index);
      }
      const spec = CANVAS_NODE_SIZE[op.nodeType];
      const node: CanvasNode = {
        id: op.id ?? context.newId(),
        type: op.nodeType,
        title: op.title ?? "",
        position: { x: 0, y: 0 },
        width: op.width ?? spec.width,
        height: op.height ?? spec.height,
        ...(Object.keys(added).length ? { metadata: added } : {}),
        createdBy: makerOf(op.id, op.nodeType),
        ...(op.groupId ? { groupId: op.groupId } : {}),
      };
      node.position = op.position ?? context.place(document, node);
      document.nodes.push(node);
      changedNodes.add(node.id);
      nodeIds.push(node.id);
      if (ownBotNode && context.bots.has(ownBotNode)) connect(ownBotNode, node.id, undefined, index);
      return;
    }
    if (op.type === "update_node") {
      const at = contentNode(op.id, index, "change");
      if (isBotNode(op.id)) {
        if (op.metadata || op.patch?.title !== undefined || op.patch?.groupId !== undefined) {
          throw new CanvasOpRefusal("invalid_op", "a bot's node can only be moved and sized", index, op.id);
        }
        const frame = at >= 0 ? document.nodes[at]! : { id: op.id, type: "bot" as const, title: "", ...context.bots.get(op.id)! };
        const next: CanvasNode = { id: op.id, type: "bot", title: "", position: op.patch?.position ?? frame.position, width: op.patch?.width ?? frame.width, height: op.patch?.height ?? frame.height };
        if (at >= 0) document.nodes[at] = next;
        else document.nodes.push(next);
        changedNodes.add(op.id);
        return;
      }
      const current = document.nodes[at]!;
      if (op.metadata && PIPELINE_KEYS.some((key) => op.metadata![key] !== undefined)) throw new CanvasOpRefusal("not_allowed", PIPELINE_IS_THE_SERVERS, index, op.id);
      if (op.metadata) checkMetadata(current.type, Object.fromEntries(Object.entries(op.metadata).filter(([, value]) => value !== null)), index);
      const { groupId, ...frame } = op.patch ?? {};
      const next: CanvasNode = { ...current, ...frame };
      if (groupId === null) delete next.groupId;
      if (typeof groupId === "string") {
        if (actor.kind === "bot") throw new CanvasOpRefusal("not_allowed", "grouping is the person's", index);
        if (current.type === "group" || groupId === current.id) throw new CanvasOpRefusal("invalid_op", "a group can't sit in a group", index);
        groupFor(groupId, index);
        next.groupId = groupId;
      }
      if (op.metadata) {
        const merged = mergeMetadata(current.metadata, op.metadata);
        if (merged) next.metadata = merged;
        else delete next.metadata;
      }
      document.nodes[at] = next;
      changedNodes.add(op.id);
      return;
    }
    if (op.type === "delete_node") {
      const ids = ordered(op.ids ?? [op.id!]);
      for (const id of ids) contentNode(id, index, "delete");
      const gone = new Set(ids);
      document.nodes = document.nodes.filter((node) => !gone.has(node.id));
      for (const node of document.nodes) {
        if (node.groupId && gone.has(node.groupId)) {
          delete node.groupId;
          changedNodes.add(node.id);
        }
      }
      for (const connection of document.connections) {
        if (gone.has(connection.fromNodeId) || gone.has(connection.toNodeId)) changedConnections.add(connection.id);
      }
      document.connections = document.connections.filter((connection) => !gone.has(connection.fromNodeId) && !gone.has(connection.toNodeId));
      for (const id of ids) changedNodes.add(id);
      return;
    }
    if (op.type === "connect_nodes") {
      connect(op.fromNodeId, op.toNodeId, op.id, index);
      return;
    }
    if (op.type === "delete_connections") {
      const ids = ordered(op.ids ?? [op.id!]);
      for (const id of ids) {
        const connection = document.connections.find((one) => one.id === id);
        if (!connection) throw new CanvasOpRefusal("not_found", `no connection ${id} to delete; connections between bots come from the team's flow`, index);
        if (!actorOwnsEnd(connection.fromNodeId) && !actorOwnsEnd(connection.toNodeId)) {
          throw new CanvasOpRefusal("not_yours", `connection ${id} is not to or from a node of yours`, index);
        }
        if (actor.kind === "bot" && connection.pipeline) {
          throw new CanvasOpRefusal("not_allowed", `connection ${id} was made by the pipeline; it changes when what it joins does`, index);
        }
      }
      const gone = new Set(ids);
      document.connections = document.connections.filter((connection) => !gone.has(connection.id));
      for (const id of ids) changedConnections.add(id);
      return;
    }
    if (actor.kind === "bot") throw new CanvasOpRefusal("not_allowed", "the view of the canvas is the person's", index);
    if (op.type === "set_viewport") {
      document.viewport = op.viewport;
      viewport = true;
      return;
    }
    document.backgroundMode = op.backgroundMode;
    backgroundMode = true;
  });

  return {
    document,
    changed: { nodes: [...changedNodes], connections: [...changedConnections], ...(viewport ? { viewport: true } : {}), ...(backgroundMode ? { backgroundMode: true } : {}) },
    nodeIds,
    connectionIds,
  };
}
