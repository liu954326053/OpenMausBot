import { createHash } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";

import { CANVAS_OUTPUT_FOLDER, canvasFileNodeType, type CanvasDocument, type CanvasFileNodeType, type CanvasFileRef } from "../../shared/project-canvas.ts";
import { createProjectFile, isProjectPathError, openProjectFile, projectPathOf } from "./paths.ts";

/** A file a bot attached: the app's copy at `path`, and where the bot had it, `source`. */
export interface HandedFile {
  path: string;
  mime: string;
  name?: string;
  source?: string;
}

export type Handover =
  | { existing: string }
  | { add: { nodeType: CanvasFileNodeType; title: string; file: CanvasFileRef } };

async function digest(handle: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The node a handed-over file is shown by: one already showing it, or a new one. A file in the project folder is
 * shown where it is, the same path once. Any other file is copied into `产出`, and bytes a node already shows are
 * not copied again. */
export async function handOver(document: CanvasDocument, folder: string, file: HandedFile): Promise<Handover> {
  const shown = document.nodes.flatMap((node) => (node.metadata?.file ? [{ id: node.id, file: node.metadata.file }] : []));
  const inFolder = file.source ? await projectPathOf(folder, file.source) : null;
  if (inFolder) {
    const existing = shown.find((one) => one.file.path === inFolder);
    if (existing) return { existing: existing.id };
    const opened = await openProjectFile(folder, inFolder, Number.POSITIVE_INFINITY);
    await opened.handle.close();
    return { add: { nodeType: canvasFileNodeType(opened.mime), title: opened.name, file: { path: opened.path, mime: opened.mime, bytes: opened.bytes, name: opened.name } } };
  }

  const copy = await open(file.path, "r");
  try {
    const bytes = (await copy.stat()).size;
    const sameSize = shown.filter((one) => one.file.bytes === bytes);
    const wanted = sameSize.length ? await digest(copy) : "";
    for (const one of sameSize) {
      let other;
      try {
        other = await openProjectFile(folder, one.file.path, bytes);
      } catch (error) {
        if (isProjectPathError(error)) continue;
        throw error;
      }
      try {
        if (other.bytes === bytes && await digest(other.handle) === wanted) return { existing: one.id };
      } finally {
        await other.handle.close();
      }
    }
    const created = await createProjectFile(folder, CANVAS_OUTPUT_FOLDER, file.name || basename(file.source ?? file.path));
    try {
      await pipeline(copy.createReadStream({ start: 0, autoClose: false }), created.handle.createWriteStream());
    } catch (error) {
      await unlink(created.absolute).catch(() => undefined);
      throw error;
    } finally {
      await created.handle.close().catch(() => undefined);
    }
    return { add: { nodeType: canvasFileNodeType(file.mime), title: created.name, file: { path: created.path, mime: file.mime, bytes, name: created.name } } };
  } finally {
    await copy.close();
  }
}
