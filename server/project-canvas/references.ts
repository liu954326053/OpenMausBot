import { join } from "node:path";

import { botNodeId, type CanvasDocument, type CanvasFileRef, type CanvasNode, type CanvasNodeSettings } from "../../shared/project-canvas.ts";
import { IMAGE_MAX_BYTES } from "../attachments.ts";
import { TURN_IMAGE_MAX_BYTES, TURN_IMAGE_MAX_COUNT } from "../turn-images.ts";
import { isProjectPathError, openProjectFile } from "./paths.ts";

export interface ReferenceDeps {
  /** The project folder. */
  folder: string;
  /** Keeps an image as the app's own attachment, which a message may carry; answers where it is. */
  saveImage(bytes: Buffer, mime: string): { path: string };
}

export interface TaskReferences {
  text: string;
  count: number;
}

const MODEL_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const LABEL: Record<Exclude<CanvasNode["type"], "bot" | "group">, string> = {
  text: "Text", shot: "Shot", image: "Image", video: "Video", audio: "Audio", file: "File", config: "Settings",
};

/** Security: every line of a node's words is quoted, so none of them is a standalone attachment tag the message would
 * carry as the person's attachment. */
const quoted = (text: string) => text.split(/\r\n|\r|\n/).map((line) => `> ${line}`).join("\n");

function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;").replaceAll("\r", "&#13;").replaceAll("\n", "&#10;");
}

function settingsLine(settings: CanvasNodeSettings | undefined): string {
  return Object.entries(settings ?? {}).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${key}: ${String(value)}`).join("; ");
}

/** The nodes connected into the bot's node, in the order they were connected, as lines of the person's message: words
 * quoted, images as the model's own input while the turn's image limits allow, other files by their path. */
export async function taskReferences(document: CanvasDocument, botId: string, deps: ReferenceDeps): Promise<TaskReferences> {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const target = botNodeId(botId);
  const sources = document.connections
    .filter((one) => one.kind === "content" && one.toNodeId === target)
    .map((one) => byId.get(one.fromNodeId))
    .filter((node): node is CanvasNode & { type: keyof typeof LABEL } => node !== undefined && node.type !== "bot" && node.type !== "group");
  let images = 0;
  let imageBytes = 0;

  async function fileLine(type: CanvasNode["type"], ref: CanvasFileRef): Promise<string | null> {
    let opened;
    try {
      opened = await openProjectFile(deps.folder, ref.path, Number.POSITIVE_INFINITY);
    } catch (error) {
      if (isProjectPathError(error)) return null;
      throw error;
    }
    try {
      const forModel = type === "image" && MODEL_IMAGES.has(opened.mime) && opened.bytes > 0 && opened.bytes <= IMAGE_MAX_BYTES
        && images < TURN_IMAGE_MAX_COUNT && imageBytes + opened.bytes <= TURN_IMAGE_MAX_BYTES;
      if (forModel) {
        const saved = deps.saveImage(await opened.handle.readFile(), opened.mime);
        images += 1;
        imageBytes += opened.bytes;
        return `<attached-image path="${attribute(saved.path)}" name="${attribute(opened.name)}"/>`;
      }
      return `<attached-file path="${attribute(join(deps.folder, ...opened.path.split("/")))}" name="${attribute(opened.name)}"/>`;
    } finally {
      await opened.handle.close();
    }
  }

  const parts: string[] = [];
  for (const node of sources) {
    const meta = node.metadata ?? {};
    const lines = [`${LABEL[node.type]} ${JSON.stringify(node.title || node.id)}:`];
    if (node.type === "text") lines.push(quoted(meta.content ?? ""));
    if (meta.file) lines.push(await fileLine(node.type, meta.file) ?? `(its file ${JSON.stringify(meta.file.path)} is not in the project folder now)`);
    if (node.type !== "text" && meta.prompt) lines.push(quoted(meta.prompt));
    const settings = settingsLine(meta.settings);
    if (settings) lines.push(settings);
    parts.push(lines.join("\n\n"));
  }
  return { text: parts.join("\n\n"), count: parts.length };
}

export function taskMessage(text: string, references: TaskReferences): string {
  const said = text.trim();
  if (!references.count) return said;
  return `${said}\n\nConnected to your node on the project's canvas:\n\n${references.text}`;
}
