import type { CanvasDocument, CanvasNode } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";

/** Every bot of a project → its stages. */
export type BotStages = Readonly<Record<string, readonly FlowStage[]>>;

export const botsWith = (stages: BotStages, stage: FlowStage): string[] => Object.keys(stages).filter((botId) => stages[botId]!.includes(stage));

/** The bot that made the node, when a bot did. */
export const makerOf = (node: CanvasNode): string | undefined => (node.createdBy?.kind === "bot" ? node.createdBy.botId : undefined);

export const isShot = (node: CanvasNode): boolean => node.type === "shot";
export const isCreation = (node: CanvasNode): boolean => node.type === "config" && node.metadata?.role === "creation";
export const isTake = (node: CanvasNode): boolean => node.type === "video" && node.metadata?.role === "take";
export const isCharacter = (node: CanvasNode): boolean => node.type === "text" && node.metadata?.role === "character";

/** The node that generates a shot's video. */
export function creationOf(document: Pick<CanvasDocument, "nodes">, shotId: string): CanvasNode | undefined {
  return document.nodes.find((node) => isCreation(node) && node.metadata?.shotId === shotId);
}

/** A shot's takes, in the order they were made. */
export function takesOf(document: Pick<CanvasDocument, "nodes">, shotId: string): CanvasNode[] {
  return document.nodes.filter((node) => isTake(node) && node.metadata?.shotId === shotId);
}
