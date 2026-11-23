import type { CanvasNode } from "../../../shared/project-canvas";

/** A row of the canvas's outline: the node it takes you to, and for a shot how long it runs and where it starts. */
export interface OutlineEntry {
  /** The group of a character that has one, else the node itself. */
  nodeId: string;
  node: CanvasNode;
  durationMs?: number;
  /** Where it starts in the film, once every shot before it has a length. */
  fromMs?: number;
}

export interface CanvasOutline {
  characters: OutlineEntry[];
  scenes: OutlineEntry[];
  shots: OutlineEntry[];
}

const byPlace = (a: CanvasNode, b: CanvasNode): number => a.position.y - b.position.y || a.position.x - b.position.x;

const isCharacter = (node: CanvasNode): boolean => node.type === "text" && node.metadata?.role === "character";
const isTake = (node: CanvasNode): boolean => node.type === "video" && node.metadata?.role === "take";
const isCreation = (node: CanvasNode): boolean => node.type === "config" && node.metadata?.role === "creation";

const measured = (node: CanvasNode | undefined): number | undefined => {
  const ms = node?.metadata?.durationMs;
  return typeof ms === "number" && ms > 0 ? ms : undefined;
};

/** How long a shot runs: its selected take's video, else the last take with a length, else the seconds its creation
 * node asks for. */
export function shotLengthMs(nodes: readonly CanvasNode[], shotId: string): number | undefined {
  const takes = nodes.filter((node) => isTake(node) && node.metadata?.shotId === shotId);
  const selected = measured(takes.find((node) => node.metadata?.selected));
  if (selected) return selected;
  for (let index = takes.length - 1; index >= 0; index -= 1) {
    const length = measured(takes[index]);
    if (length) return length;
  }
  const seconds = nodes.find((node) => isCreation(node) && node.metadata?.shotId === shotId)?.metadata?.settings?.seconds;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : undefined;
}

/** `01:05` for a minute in, `1:02:03` past the hour. */
export function filmClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}` : `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}

/** The canvas as a table of contents: its characters, the groups that are not theirs, and its shots from top to bottom,
 * each shot with its length and, while every shot before it has one, where it starts in the film. */
export function canvasOutline(nodes: readonly CanvasNode[]): CanvasOutline {
  const groups = new Map(nodes.filter((node) => node.type === "group").map((node) => [node.id, node]));
  const profiles = nodes.filter(isCharacter).sort(byPlace);
  const characterGroups = new Set(profiles.flatMap((node) => (node.groupId ? [node.groupId] : [])));
  const characters: OutlineEntry[] = [];
  const listed = new Set<string>();
  for (const profile of profiles) {
    const target = (profile.groupId ? groups.get(profile.groupId) : undefined) ?? profile;
    if (listed.has(target.id)) continue;
    listed.add(target.id);
    characters.push({ nodeId: target.id, node: target });
  }
  const scenes: OutlineEntry[] = nodes
    .filter((node) => node.type === "group" && !characterGroups.has(node.id))
    .sort(byPlace)
    .map((node) => ({ nodeId: node.id, node }));
  const shots: OutlineEntry[] = [];
  let clock = 0;
  let timed = true;
  for (const shot of nodes.filter((node) => node.type === "shot").sort(byPlace)) {
    const durationMs = shotLengthMs(nodes, shot.id);
    let fromMs: number | undefined;
    if (durationMs === undefined) timed = false;
    else if (timed) {
      fromMs = clock;
      clock += durationMs;
    }
    shots.push({ nodeId: shot.id, node: shot, ...(durationMs === undefined ? {} : { durationMs }), ...(fromMs === undefined ? {} : { fromMs }) });
  }
  return { characters, scenes, shots };
}
