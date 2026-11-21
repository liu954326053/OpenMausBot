import { join } from "node:path";

import { connectedReferences, REFERENCE_KIND_KEYS, referenceLabel, type CanvasReference } from "../../shared/project-canvas-references.ts";
import { botNodeId, type CanvasDocument, type CanvasFileRef, type CanvasNode, type CanvasNodeSettings } from "../../shared/project-canvas.ts";
import { IMAGE_MAX_BYTES } from "../attachments.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";
import { TURN_IMAGE_MAX_BYTES, TURN_IMAGE_MAX_COUNT } from "../turn-images.ts";
import { isProjectPathError, openProjectFile } from "./paths.ts";

export interface ReferenceDeps {
  /** The project folder. */
  folder: string;
  /** Keeps an image as the app's own attachment, which a message may carry; answers where it is. */
  saveImage(bytes: Buffer, mime: string): { path: string };
  /** The language the person's app names references in. */
  language: string | undefined;
}

export interface TaskReferences {
  text: string;
  count: number;
}

const MODEL_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const NODE_WORD: Record<Exclude<CanvasNode["type"], "bot" | "group">, ServerLineKey> = {
  ...REFERENCE_KIND_KEYS, shot: "server.projectCanvas.node.shot", config: "server.projectCanvas.node.config", file: "server.projectCanvas.node.file",
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

type ContentNode = CanvasNode & { type: keyof typeof NODE_WORD };
const isContent = (node: CanvasNode): node is ContentNode => node.type !== "bot" && node.type !== "group";
type Entry = { node: CanvasNode; reference: CanvasReference } | { node: ContentNode; reference?: undefined };

/** What went into the bot's node, in the order it was connected: each reference the app numbered on the node, a group
 * as its members, and each other node with a file, a prompt or settings to pass on. */
function entries(document: CanvasDocument, nodeId: string): Entry[] {
  const references = connectedReferences(nodeId, document.nodes, document.connections);
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return document.connections.flatMap((connection): Entry[] => {
    const source = connection.kind === "content" && connection.toNodeId === nodeId && !seen.has(connection.fromNodeId) ? byId.get(connection.fromNodeId) : undefined;
    if (!source) return [];
    seen.add(source.id);
    const numbered = references.flatMap((reference) => {
      const node = reference.sourceNodeId === source.id ? byId.get(reference.nodeId) : undefined;
      return node ? [{ node, reference }] : [];
    });
    if (numbered.length || references.some((one) => one.nodeId === source.id)) return numbered;
    const meta = source.metadata ?? {};
    return isContent(source) && (meta.file || meta.prompt || settingsLine(meta.settings)) ? [{ node: source }] : [];
  });
}

/** The references connected into the bot's node, as lines of the person's message, each named by its label and title as
 * the app numbered them: words quoted, images as the model's own input while the turn's image limits allow, other files
 * by their path. */
export async function taskReferences(document: CanvasDocument, botId: string, deps: ReferenceDeps): Promise<TaskReferences> {
  const word = (key: ServerLineKey) => serverLine(deps.language, key);
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
  for (const entry of entries(document, botNodeId(botId))) {
    const { node } = entry;
    const meta = node.metadata ?? {};
    const [name, title] = entry.reference ? [referenceLabel(entry.reference, word), node.title] : [word(NODE_WORD[entry.node.type]), node.title || node.id];
    const lines = [title ? `${name} ${JSON.stringify(title)}:` : `${name}:`];
    if (entry.reference?.text) lines.push(quoted(entry.reference.text));
    if (meta.file) lines.push(await fileLine(node.type, meta.file) ?? serverLine(deps.language, "server.projectCanvas.task.fileGone", { path: JSON.stringify(meta.file.path) }));
    if (node.type !== "text" && meta.prompt) lines.push(quoted(meta.prompt));
    const settings = settingsLine(meta.settings);
    if (settings) lines.push(settings);
    parts.push(lines.join("\n\n"));
  }
  return { text: parts.join("\n\n"), count: parts.length };
}

export function taskMessage(text: string, references: TaskReferences, language: string | undefined): string {
  const said = text.trim();
  if (!references.count) return said;
  return [said, serverLine(language, "server.projectCanvas.task.connected"), references.text].filter(Boolean).join("\n\n");
}
