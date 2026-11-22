import { Bot, Clapperboard, FileText, Group, Image, Music, Paperclip, SlidersHorizontal, Video, type LucideIcon } from "lucide-react";
import { botIdOfNode, type CanvasNode, type CanvasNodeType, type CanvasSnapshot } from "../../../shared/project-canvas";
import type { FlowStage } from "../../../shared/team-pipeline";
import { t } from "@/lib/i18n";

export const NODE_ICONS: Record<CanvasNodeType, LucideIcon> = {
  bot: Bot,
  shot: Clapperboard,
  text: FileText,
  image: Image,
  video: Video,
  audio: Music,
  file: Paperclip,
  config: SlidersHorizontal,
  group: Group,
};

export function nodeTypeLabel(type: CanvasNodeType): string {
  switch (type) {
    case "bot": return t("projectCanvas.nodeType.bot");
    case "shot": return t("projectCanvas.nodeType.shot");
    case "text": return t("projectCanvas.nodeType.text");
    case "image": return t("projectCanvas.nodeType.image");
    case "video": return t("projectCanvas.nodeType.video");
    case "audio": return t("projectCanvas.nodeType.audio");
    case "file": return t("projectCanvas.nodeType.file");
    case "config": return t("projectCanvas.nodeType.config");
    case "group": return t("projectCanvas.nodeType.group");
  }
}

export function addNodeLabel(type: Exclude<CanvasNodeType, "bot" | "audio" | "file">): string {
  switch (type) {
    case "shot": return t("projectCanvas.toolbar.addShot");
    case "text": return t("projectCanvas.toolbar.addText");
    case "image": return t("projectCanvas.toolbar.addImage");
    case "video": return t("projectCanvas.toolbar.addVideo");
    case "config": return t("projectCanvas.toolbar.addConfig");
    case "group": return t("projectCanvas.toolbar.addGroup");
  }
}

/** A stage's name; nothing for `other`, which is no stage of the pipeline. */
export function stageLabel(stage: FlowStage): string | null {
  switch (stage) {
    case "lead": return t("projectCanvas.stage.lead");
    case "script": return t("projectCanvas.stage.script");
    case "character": return t("projectCanvas.stage.character");
    case "storyboard": return t("projectCanvas.stage.storyboard");
    case "post": return t("projectCanvas.stage.post");
    case "other": return null;
  }
}

/** What a node is in the project's pipeline, for the small label above it: a bot's stages, or what a content node
 * holds. Nothing for a node that is neither, and for a take, which says whether it is the one its shot uses. */
export function pipelineLabel(node: CanvasNode, snapshot: Pick<CanvasSnapshot, "nodes" | "bots">): string | null {
  if (node.type === "bot") {
    const stages = snapshot.bots[botIdOfNode(node.id) ?? ""]?.stages ?? [];
    return stages.flatMap((stage) => stageLabel(stage) ?? []).join(" · ") || null;
  }
  switch (node.metadata?.role) {
    case "script": return t("projectCanvas.role.script");
    case "character": return t("projectCanvas.role.character");
    case "creation": return t("projectCanvas.role.creation");
    case "final": return t("projectCanvas.role.final");
    default: break;
  }
  const holdsCharacter = node.type === "group" && snapshot.nodes.some((member) => member.groupId === node.id && member.metadata?.role === "character");
  return holdsCharacter ? t("projectCanvas.role.characterGroup") : null;
}

/** The shot a creation node or a take belongs to, while that shot is on the canvas. */
export const shotOf = (node: CanvasNode, nodes: readonly CanvasNode[]): CanvasNode | undefined =>
  node.metadata?.shotId ? nodes.find((candidate) => candidate.type === "shot" && candidate.id === node.metadata?.shotId) : undefined;

/** The name a node shows: its title, or its type when it has none. */
export const nodeLabel = (node: CanvasNode): string => node.title.trim() || nodeTypeLabel(node.type);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t("projectCanvas.file.bytes", { count: bytes });
  if (bytes < 1024 * 1024) return t("projectCanvas.file.kilobytes", { count: Math.round(bytes / 102.4) / 10 });
  return t("projectCanvas.file.megabytes", { count: Math.round(bytes / (1024 * 102.4)) / 10 });
}
