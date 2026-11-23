import { CANVAS_PROFILE_ROLES, type CanvasDocument, type CanvasNode } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";

/** Every bot of a project that has a job → its jobs. */
export type BotStages = Readonly<Record<string, readonly FlowStage[]>>;

export const botsWith = (stages: BotStages, stage: FlowStage): string[] => Object.keys(stages).filter((botId) => stages[botId]!.includes(stage));

/** The bot that made the node, when a bot did. */
export const makerOf = (node: CanvasNode): string | undefined => (node.createdBy?.kind === "bot" ? node.createdBy.botId : undefined);

export const isShot = (node: CanvasNode): boolean => node.type === "shot";
export const isCreation = (node: CanvasNode): boolean => node.type === "config" && node.metadata?.role === "creation";
export const isTake = (node: CanvasNode): boolean => node.type === "video" && node.metadata?.role === "take";
export const isCharacter = (node: CanvasNode): boolean => node.type === "text" && node.metadata?.role === "character";
/** A character's or a scene's profile: the text node its group and its pictures gather around. */
export const isProfile = (node: CanvasNode): boolean => node.type === "text" && (CANVAS_PROFILE_ROLES as readonly (string | undefined)[]).includes(node.metadata?.role);
/** An episode's script, its number told. */
export const isEpisode = (node: CanvasNode): boolean => node.type === "text" && node.metadata?.role === "episode" && typeof node.metadata.episode === "number";
export const isFinal = (node: CanvasNode): boolean => node.type === "video" && node.metadata?.role === "final";

/** The node that generates a shot's video. */
export function creationOf(document: Pick<CanvasDocument, "nodes">, shotId: string): CanvasNode | undefined {
  return document.nodes.find((node) => isCreation(node) && node.metadata?.shotId === shotId);
}

/** A shot's takes, in the order they were made. */
export function takesOf(document: Pick<CanvasDocument, "nodes">, shotId: string): CanvasNode[] {
  return document.nodes.filter((node) => isTake(node) && node.metadata?.shotId === shotId);
}

/** The episodes' scripts by number; of two that claim one number the first added is it. */
export function episodesOf(document: Pick<CanvasDocument, "nodes">): CanvasNode[] {
  const seen = new Set<number>();
  const episodes = document.nodes.filter((node) => {
    const number = node.metadata?.episode;
    if (!isEpisode(node) || seen.has(number!)) return false;
    seen.add(number!);
    return true;
  });
  return episodes.sort((a, b) => a.metadata!.episode! - b.metadata!.episode!);
}
