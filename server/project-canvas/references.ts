import { join } from "node:path";

import { connectedReferences, isReferenceNode, mentionReferences, REFERENCE_KIND_KEYS, referenceLabel, type CanvasReference } from "../../shared/project-canvas-references.ts";
import { botIdOfNode, type CanvasDocument, type CanvasFileRef, type CanvasNode, type CanvasNodeSettings } from "../../shared/project-canvas.ts";
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
  /** A text node's own text under its label, which the task revises. */
  source?: string;
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

/** The references as the app's panel for the node numbers them: a bot's by what is connected into its node, a text
 * node's by what its prompt can name. Then each other node connected in with a file, a prompt or settings to pass on. */
function entries(document: CanvasDocument, nodeId: string): Entry[] {
  const { nodes, connections } = document;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const references = botIdOfNode(nodeId) === null ? mentionReferences(nodeId, nodes, connections) : connectedReferences(nodeId, nodes, connections);
  const numbered = references.flatMap((reference): Entry[] => {
    const node = byId.get(reference.nodeId);
    return node ? [{ node, reference }] : [];
  });
  const sources = new Set(connections.flatMap((connection) => (connection.kind === "content" && connection.toNodeId === nodeId ? [connection.fromNodeId] : [])));
  const others = [...sources].flatMap((id): Entry[] => {
    const node = byId.get(id);
    const meta = node?.metadata ?? {};
    return node && isContent(node) && !isReferenceNode(node, nodes) && (meta.file || meta.prompt || settingsLine(meta.settings)) ? [{ node }] : [];
  });
  return [...numbered, ...others];
}

function heading(document: CanvasDocument, nodeId: string, language: string | undefined): string {
  if (botIdOfNode(nodeId) !== null) return serverLine(language, "server.projectCanvas.task.connected");
  const title = document.nodes.find((node) => node.id === nodeId)?.title || nodeId;
  return serverLine(language, "server.projectCanvas.task.textNode", { title: JSON.stringify(title) });
}

/** The references of the node a task was written in, a bot's node or a text node, under a line saying whose they are:
 * each named by its label and title as the app numbered them, words quoted, images as the model's own input while the
 * turn's image limits allow, other files by their path. A text node's own text, its first reference, is the `source`
 * instead. */
export async function taskReferences(document: CanvasDocument, nodeId: string, deps: ReferenceDeps): Promise<TaskReferences> {
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
  let source: string | undefined;
  for (const entry of entries(document, nodeId)) {
    const { node } = entry;
    const meta = node.metadata ?? {};
    const [name, title] = entry.reference ? [referenceLabel(entry.reference, word), node.title] : [word(NODE_WORD[entry.node.type]), node.title || node.id];
    const lines = [title ? `${name} ${JSON.stringify(title)}:` : `${name}:`];
    if (entry.reference?.text) lines.push(quoted(entry.reference.text));
    if (meta.file) lines.push(await fileLine(node.type, meta.file) ?? serverLine(deps.language, "server.projectCanvas.task.fileGone", { path: JSON.stringify(meta.file.path) }));
    if (node.type !== "text" && meta.prompt) lines.push(quoted(meta.prompt));
    const settings = settingsLine(meta.settings);
    if (settings) lines.push(settings);
    if (node.id === nodeId) source = lines.join("\n\n");
    else parts.push(lines.join("\n\n"));
  }
  return { ...(source ? { source } : {}), text: parts.length ? [heading(document, nodeId, deps.language), ...parts].join("\n\n") : "", count: parts.length };
}

/** The person's words, framed in `language` as the revision of the node's own text when the task has a `source`, then
 * the references. */
export function taskMessage(text: string, references: TaskReferences, language: string | undefined): string {
  const request = text.trim();
  const asked = references.source ? serverLine(language, "server.projectCanvas.task.editText", { source: references.source, prompt: request }) : request;
  return [asked, references.text].filter(Boolean).join("\n\n");
}
