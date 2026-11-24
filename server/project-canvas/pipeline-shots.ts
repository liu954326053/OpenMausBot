import {
  CANVAS_NODE_SIZE,
  type CanvasConnection,
  type CanvasDocument,
  type CanvasFileRef,
  type CanvasGenerationStatus,
  type CanvasNode,
  type CanvasNodeMetadata,
} from "../../shared/project-canvas.ts";
import type { CanvasFrame } from "./ops.ts";
import { creationOf, isCreation, isShot, isTake, shotParts, takesOf } from "./pipeline-nodes.ts";
import { clearSpot, LANE_GAP, placeAfter } from "./placement.ts";

/** What placing a node the server makes needs. */
export interface PlaceContext {
  /** The project's bot nodes by node id, each where it is now. */
  bots: ReadonlyMap<string, CanvasFrame>;
  /** The frames of nodes still to come, where nothing is placed. */
  reserved: readonly CanvasFrame[];
  newId(): string;
}

function without(metadata: CanvasNodeMetadata | undefined, key: keyof CanvasNodeMetadata): CanvasNodeMetadata {
  const copy = { ...metadata };
  delete copy[key];
  return copy;
}

/** Gives a shot its creation node: a video config to the shot's right, the shot's maker's, starting from the settings
 * the shot was given. */
export function addCreation(document: CanvasDocument, shot: CanvasNode, context: PlaceContext, ignore?: ReadonlySet<string>): CanvasNode {
  const size = CANVAS_NODE_SIZE.config;
  const settings = shot.metadata?.settings;
  const creation: CanvasNode = {
    id: context.newId(),
    type: "config",
    title: shot.title,
    position: clearSpot(document, { x: shot.position.x + shot.width + LANE_GAP, y: shot.position.y }, size, context.bots, context.reserved, ignore),
    ...size,
    metadata: {
      generationMode: "video", role: "creation", shotId: shot.id,
      ...(shot.metadata?.episode === undefined ? {} : { episode: shot.metadata.episode }),
      ...(settings && Object.keys(settings).length ? { settings } : {}),
    },
    ...(shot.createdBy ? { createdBy: shot.createdBy } : {}),
  };
  document.nodes.push(creation);
  return creation;
}

/** Makes `take` its shot's selected take; returns the ids of the takes whose mark changed. */
export function selectTake(document: CanvasDocument, take: CanvasNode): string[] {
  const changed: string[] = [];
  for (const other of takesOf(document, take.metadata?.shotId ?? "")) {
    if (other.id === take.id || !other.metadata?.selected) continue;
    other.metadata = without(other.metadata, "selected");
    changed.push(other.id);
  }
  if (!take.metadata?.selected) {
    take.metadata = { ...take.metadata, selected: true };
    changed.push(take.id);
  }
  return changed;
}

/** A video a creation node's job made becomes its shot's newest take: to the creation node's right, below the earlier
 * ones, connected from it and selected. The creation node is no longer stale. */
export function landTake(document: CanvasDocument, creation: CanvasNode, file: CanvasFileRef, context: PlaceContext): { take: CanvasNode; nodes: string[]; connection: CanvasConnection } {
  const size = CANVAS_NODE_SIZE.video;
  const take: CanvasNode = {
    id: context.newId(),
    type: "video",
    title: file.name,
    position: placeAfter(document, creation, size, context.bots, context.reserved),
    ...size,
    metadata: { file, role: "take", shotId: creation.metadata!.shotId!, ...(creation.metadata!.episode === undefined ? {} : { episode: creation.metadata!.episode }) },
    ...(creation.createdBy ? { createdBy: creation.createdBy } : {}),
  };
  const connection: CanvasConnection = { id: context.newId(), fromNodeId: creation.id, toNodeId: take.id, kind: "content", pipeline: true };
  document.nodes.push(take);
  document.connections.push(connection);
  const nodes = [...selectTake(document, take)];
  if (creation.metadata?.stale) {
    creation.metadata = without(creation.metadata, "stale");
    nodes.push(creation.id);
  }
  return { take, nodes: [...new Set([take.id, ...nodes])], connection };
}

/** The node whose videos are a shot's takes when `node` generates: the creation node itself, or the one of the shot. */
export function takeHost(document: CanvasDocument, node: CanvasNode): CanvasNode | undefined {
  if (isCreation(node) && node.metadata?.shotId) return node;
  return isShot(node) ? creationOf(document, node.id) : undefined;
}

/** What generating `node` runs on: a shot that has a creation node generates through it, and a creation node from its
 * shot's prompt and under its shot's title; every other node generates as itself. */
export function generationSource(document: CanvasDocument, node: CanvasNode): { node: CanvasNode; prompt: string | undefined; name: string } {
  const host = takeHost(document, node);
  if (!host) return { node, prompt: node.metadata?.prompt, name: node.title };
  const shot = isShot(node) ? node : document.nodes.find((one) => isShot(one) && one.id === host.metadata?.shotId);
  return { node: host, prompt: shot?.metadata?.prompt, name: shot?.title ?? host.title };
}

/** One take per shot keeps the mark: the one that had it before the change, else the newest. Returns the ids of the
 * takes that lost it. */
export function keepOneSelected(before: CanvasDocument, after: CanvasDocument): string[] {
  const had = new Set(before.nodes.filter((node) => isTake(node) && node.metadata?.selected).map((node) => node.id));
  const byShot = new Map<string, CanvasNode[]>();
  for (const node of after.nodes) {
    if (!isTake(node) || !node.metadata?.selected) continue;
    const shotId = node.metadata.shotId ?? "";
    byShot.set(shotId, [...(byShot.get(shotId) ?? []), node]);
  }
  const changed: string[] = [];
  for (const selected of byShot.values()) {
    if (selected.length < 2) continue;
    const keep = selected.find((node) => had.has(node.id)) ?? selected.at(-1)!;
    for (const node of selected) {
      if (node === keep) continue;
      node.metadata = without(node.metadata, "selected");
      changed.push(node.id);
    }
  }
  return changed;
}

/** A shot whose prompt changed since `before` leaves its takes behind: they and its creation node become stale.
 * Returns the ids of the nodes newly marked. */
export function markOutdatedTakes(before: CanvasDocument, after: CanvasDocument): string[] {
  const was = new Map(before.nodes.filter(isShot).map((node) => [node.id, node.metadata?.prompt?.trim() ?? ""]));
  const changed: string[] = [];
  for (const shot of after.nodes) {
    if (!isShot(shot) || !was.has(shot.id) || was.get(shot.id) === (shot.metadata?.prompt?.trim() ?? "")) continue;
    const takes = takesOf(after, shot.id);
    if (!takes.length) continue;
    const creation = creationOf(after, shot.id);
    for (const node of [...(creation ? [creation] : []), ...takes]) {
      if (node.metadata?.stale) continue;
      node.metadata = { ...node.metadata, stale: true };
      changed.push(node.id);
    }
  }
  return changed;
}

/** A shot's selected take. `durationMs`, `width` and `height` are what an app measured when it showed the video;
 * absent until one has. */
export interface PipelineTake {
  nodeId: string;
  title: string;
  file: CanvasFileRef;
  durationMs?: number;
  width?: number;
  height?: number;
}

/** A shot as the pipeline has it. `status` is its creation node's: `loading` while a take is generated, `error` when
 * the last one failed; `idle` for a shot that has no creation node. */
export interface PipelineShot {
  shotId: string;
  /** The episode it belongs to; absent on a shot of a drama made before episodes. */
  episode?: number;
  title: string;
  prompt: string;
  creationNodeId: string | null;
  status: CanvasGenerationStatus;
  /** How many takes it has. */
  takes: number;
  /** Null: no take of it is selected. */
  take: PipelineTake | null;
}

/** The canvas's shots episode by episode, those of one episode in the order they were added; shots of no episode
 * come first. */
export function listShots(document: CanvasDocument): PipelineShot[] {
  const shots = document.nodes.filter(isShot).map((shot, index) => ({ shot, index }))
    .sort((a, b) => (a.shot.metadata?.episode ?? 0) - (b.shot.metadata?.episode ?? 0) || a.index - b.index).map(({ shot }) => shot);
  const parts = shotParts(document);
  return shots.map((shot) => {
    const creation = parts.creationOf(shot.id);
    const takes = parts.takesOf(shot.id);
    const selected = takes.find((take) => take.metadata?.selected && take.metadata.file);
    const { file, durationMs, naturalWidth, naturalHeight } = selected?.metadata ?? {};
    return {
      shotId: shot.id,
      ...(shot.metadata?.episode === undefined ? {} : { episode: shot.metadata.episode }),
      title: shot.title,
      prompt: shot.metadata?.prompt ?? "",
      creationNodeId: creation?.id ?? null,
      status: creation?.metadata?.status ?? "idle",
      takes: takes.length,
      take: selected && file ? {
        nodeId: selected.id, title: selected.title, file,
        ...(durationMs === undefined ? {} : { durationMs }), ...(naturalWidth === undefined ? {} : { width: naturalWidth }), ...(naturalHeight === undefined ? {} : { height: naturalHeight }),
      } : null,
    };
  });
}
