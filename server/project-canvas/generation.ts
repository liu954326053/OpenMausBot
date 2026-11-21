import { generationInputs, referenceFiles, referenceLabel, type CanvasReference, type CanvasResourceKind, type ReferenceKindKey } from "../../shared/project-canvas-references.ts";
import type { CanvasDocument, CanvasNode } from "../../shared/project-canvas.ts";
import type { GenerationKind, StartGenerationInput } from "../../shared/project-generation.ts";
import { serverLine } from "../server-lines.ts";

/** What generating a node makes: a picture for an image node, a clip for a video node or a shot, and what a config node
 * is set to make. Null for a node that is not generated. */
export function generationKindOf(node: CanvasNode): GenerationKind | null {
  if (node.type === "image") return "image";
  if (node.type === "video" || node.type === "shot") return "video";
  if (node.type === "config") return node.metadata?.generationMode ?? "image";
  return null;
}

/** The prompt a generation is sent: first which label names which image and audio reference, in the words of
 * `language`, the one the person's prompt names them in; then their prompt; then each text reference under its label. */
export function generationPrompt(prompt: string, references: readonly CanvasReference[], language: string | undefined): string {
  const word = (key: ReferenceKindKey) => serverLine(language, key);
  const separator = serverLine(language, "server.projectCanvas.reference.separator");
  const labels = (kind: CanvasResourceKind) => references.filter((one) => one.kind === kind).map((one) => referenceLabel(one, word)).join(separator);
  const images = labels("image");
  const audio = labels("audio");
  const numbering = [
    images ? serverLine(language, "server.projectCanvas.reference.imageLine", { labels: images }) : "",
    audio ? serverLine(language, "server.projectCanvas.reference.audioLine", { labels: audio }) : "",
  ].filter(Boolean).join("\n");
  const texts = references.flatMap((one) => (one.kind === "text" && one.text ? [`【${referenceLabel(one, word)}】\n${one.text}`] : []));
  return [numbering, prompt, ...texts].filter(Boolean).join("\n\n");
}

/** What generation starts for a node, all of it taken from the node and what it takes in: the node's settings are its
 * overrides, its title names the files, and the files of its image and audio references go with a prompt that numbers
 * them as the person saw them. */
export function generationInput(document: CanvasDocument, node: CanvasNode, kind: GenerationKind, prompt: string, language: string | undefined): StartGenerationInput {
  const references = generationInputs(node.id, document.nodes, document.connections);
  const overrides = node.metadata?.settings;
  const name = node.title.trim();
  return {
    kind,
    nodeId: node.id,
    prompt: generationPrompt(prompt, references, language),
    references: referenceFiles(references),
    ...(overrides && Object.keys(overrides).length ? { overrides } : {}),
    ...(name ? { name } : {}),
  };
}
