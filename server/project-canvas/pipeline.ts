import { CANVAS_MAX_NODES, type CanvasDocument, type CanvasNode, type CanvasNodeCreator, type CanvasNodeRole } from "../../shared/project-canvas.ts";
import type { CanvasChangeSet, CanvasFrame } from "./ops.ts";
import { settleGroups } from "./pipeline-groups.ts";
import { settleLinks, wantedLinks, type BotEpisodes } from "./pipeline-links.ts";
import { botsWith, creationOf, isCreation, isShot, isTake, makerOf, type BotStages } from "./pipeline-nodes.ts";
import { addCreation, keepOneSelected, markOutdatedTakes } from "./pipeline-shots.ts";
import { upgradeCanvas } from "./pipeline-upgrade.ts";

/** What a change did that other parts of the server act on: a node that newly has a role, and a shot whose selected
 * take is another one, or none (`nodeId: null`). */
export type PipelineChange =
  | { kind: "role"; role: CanvasNodeRole; nodeId: string; shotId?: string }
  | { kind: "selected"; shotId: string; nodeId: string | null };

export interface SettleInput {
  /** The canvas as it was stored before the change. */
  before: CanvasDocument;
  /** The canvas after the change; settled in place. */
  after: CanvasDocument;
  /** Each bot's stages when the canvas's links were last made. */
  beforeStages: BotStages;
  stages: BotStages;
  /** The bots the production made for one episode each. */
  botEpisodes?: BotEpisodes;
  /** Who made the change; absent for one the server made. */
  actor?: CanvasNodeCreator;
  /** `before` was stored before the pipeline: it is brought forward, and every link the pipeline wants is made. */
  upgrade?: boolean;
  bots: ReadonlyMap<string, CanvasFrame>;
  reserved: readonly CanvasFrame[];
  newId(): string;
}

function selectedTakes(document: CanvasDocument): Map<string, string> {
  return new Map(document.nodes.flatMap((node) => (isTake(node) && node.metadata?.selected && node.metadata.shotId ? [[node.metadata.shotId, node.id] as const] : [])));
}

function changesOf(before: CanvasDocument, after: CanvasDocument): PipelineChange[] {
  const was = new Map(before.nodes.map((node) => [node.id, node.metadata?.role]));
  const roles = after.nodes.flatMap((node): PipelineChange[] => {
    const { role, shotId } = node.metadata ?? {};
    return role && was.get(node.id) !== role ? [{ kind: "role", role, nodeId: node.id, ...(shotId ? { shotId } : {}) }] : [];
  });
  const had = selectedTakes(before);
  const has = selectedTakes(after);
  const selections = [...new Set([...had.keys(), ...has.keys()])].flatMap((shotId): PipelineChange[] =>
    (had.get(shotId) === has.get(shotId) ? [] : [{ kind: "selected", shotId, nodeId: has.get(shotId) ?? null }]));
  return [...roles, ...selections];
}

const VERSIONED: ReadonlySet<CanvasNodeRole> = new Set(["brief", "plan", "episode", "character", "scene"]);

const sameWords = (a: CanvasNode, b: CanvasNode) =>
  a.metadata?.content === b.metadata?.content && JSON.stringify(a.metadata?.card ?? null) === JSON.stringify(b.metadata?.card ?? null);

function countVersions(before: CanvasDocument, after: CanvasDocument): string[] {
  const was = new Map(before.nodes.map((node) => [node.id, node]));
  const counted: string[] = [];
  for (const node of after.nodes) {
    const role = node.metadata?.role;
    if (node.type !== "text" || !role || !VERSIONED.has(role)) continue;
    const old = was.get(node.id);
    if (old ? sameWords(old, node) : node.metadata?.version !== undefined) continue;
    node.metadata = { ...node.metadata, version: old ? (old.metadata?.version ?? 1) + 1 : 1 };
    counted.push(node.id);
  }
  return counted;
}

/**
 * What the server does after every change to a canvas, in place on `after`: a shot an episode's storyboard bot added
 * belongs to that episode; a shot a storyboard bot or the person added gets its creation node; a shot a bot deleted
 * takes its creation node with it; takes left behind by a shot's new prompt become stale; one take per shot keeps the
 * selected mark; characters and scenes get their groups and their pictures join them; a brief, a plan, an episode, a
 * character and a scene count their versions; and the pipeline's links go from the ones wanted before to the ones
 * wanted now. Returns what it changed beyond the change itself, and what the change did to the pipeline's nodes.
 */
export function settlePipeline(input: SettleInput): { changed: CanvasChangeSet; events: PipelineChange[] } {
  const { before, after, stages, actor } = input;
  const nodes = new Set<string>();
  const connections = new Set<string>();
  const context = { bots: input.bots, reserved: input.reserved, newId: input.newId };

  if (input.upgrade) {
    const upgraded = upgradeCanvas(after, context);
    for (const id of upgraded.nodes) nodes.add(id);
    for (const id of upgraded.connections) connections.add(id);
  }

  const was = new Set(before.nodes.map((node) => node.id));
  const storyboard = new Set(botsWith(stages, "storyboard"));
  const botEpisodes = input.botEpisodes ?? {};
  for (const shot of after.nodes.filter(isShot)) {
    const maker = makerOf(shot);
    const inPipeline = shot.createdBy?.kind === "person" || (maker !== undefined && storyboard.has(maker));
    if (was.has(shot.id)) continue;
    const episode = maker === undefined ? undefined : botEpisodes[maker];
    if (episode !== undefined && shot.metadata?.episode !== episode) {
      shot.metadata = { ...shot.metadata, episode };
      nodes.add(shot.id);
    }
    if (!inPipeline || creationOf(after, shot.id) || after.nodes.length >= CANVAS_MAX_NODES) continue;
    nodes.add(addCreation(after, shot, context).id);
  }

  if (actor?.kind === "bot") {
    const present = new Set(after.nodes.map((node) => node.id));
    const deleted = new Set(before.nodes.filter((node) => isShot(node) && !present.has(node.id)).map((node) => node.id));
    const orphans = new Set(after.nodes.filter((node) => isCreation(node) && deleted.has(node.metadata?.shotId ?? "")).map((node) => node.id));
    if (orphans.size) {
      for (const id of orphans) nodes.add(id);
      for (const connection of after.connections) if (orphans.has(connection.fromNodeId) || orphans.has(connection.toNodeId)) connections.add(connection.id);
      after.nodes = after.nodes.filter((node) => !orphans.has(node.id));
      after.connections = after.connections.filter((connection) => !orphans.has(connection.fromNodeId) && !orphans.has(connection.toNodeId));
    }
  }

  for (const id of [...markOutdatedTakes(before, after), ...keepOneSelected(before, after), ...settleGroups(before, after, context), ...countVersions(before, after)]) nodes.add(id);

  const wantedBefore = input.upgrade ? [] : wantedLinks(before, input.beforeStages, botEpisodes);
  for (const id of settleLinks(after, wantedBefore, wantedLinks(after, stages, botEpisodes), input.newId)) connections.add(id);

  return { changed: { nodes: [...nodes], connections: [...connections] }, events: changesOf(before, after) };
}
