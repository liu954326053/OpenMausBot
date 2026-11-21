import { Bot, Clapperboard, FileText, Group, Image, Music, Paperclip, SlidersHorizontal, Video, type LucideIcon } from "lucide-react";
import type { CanvasNode, CanvasNodeType } from "../../../shared/project-canvas";
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

/** The name a node shows: its title, or its type when it has none. */
export const nodeLabel = (node: CanvasNode): string => node.title.trim() || nodeTypeLabel(node.type);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t("projectCanvas.file.bytes", { count: bytes });
  if (bytes < 1024 * 1024) return t("projectCanvas.file.kilobytes", { count: Math.round(bytes / 102.4) / 10 });
  return t("projectCanvas.file.megabytes", { count: Math.round(bytes / (1024 * 102.4)) / 10 });
}
