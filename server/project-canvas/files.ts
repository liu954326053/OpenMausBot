import type { IncomingMessage, ServerResponse } from "node:http";
import { unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { CANVAS_UPLOAD_FOLDER, canvasFileNodeType, type CanvasFileRef, type CanvasUploadResponse } from "../../shared/project-canvas.ts";
import { FILE_MAX_BYTES, parseAudioRange } from "../attachments.ts";
import { messageFileDisposition, mimeFor } from "../message-file.ts";
import { cappedMediaRange, STREAMABLE_MEDIA_MIMES } from "../message-media-links.ts";
import { parseCanvasOps } from "./ops.ts";
import { createProjectFile, isProjectPathError, openProjectFile } from "./paths.ts";
import { CanvasRefusal, pathRefusal, readOnlyRefusal, tooLargeRefusal, type ProjectCanvasService } from "./service.ts";

const SHOWN_IMAGES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

function position(query: URLSearchParams): { x: number; y: number } | undefined {
  const x = Number(query.get("x"));
  const y = Number(query.get("y"));
  return query.has("x") && query.has("y") && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/** The body's bytes go into a new file in the project folder's `素材` folder, never over one already there, and a
 * node of the file's type is added for it where the person dropped it. */
export async function uploadToCanvas(service: ProjectCanvasService, projectId: string, req: IncomingMessage, query: URLSearchParams): Promise<CanvasUploadResponse> {
  const project = service.project(projectId);
  const refuse = (error: unknown) => {
    req.resume();
    return isProjectPathError(error) ? pathRefusal(error, project.folder) : error;
  };
  if (project.archivedAt !== undefined) throw refuse(readOnlyRefusal());
  if (Number(req.headers["content-length"]) > FILE_MAX_BYTES) throw refuse(tooLargeRefusal());
  let created;
  try {
    created = await createProjectFile(project.folder, CANVAS_UPLOAD_FOLDER, query.get("name") ?? "");
  } catch (error) {
    throw refuse(error);
  }
  let bytes = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > FILE_MAX_BYTES ? tooLargeRefusal() : null, chunk);
    },
  });
  try {
    await pipeline(req, counted, created.handle.createWriteStream());
    if (!bytes) throw new CanvasRefusal(400, { error: "The file is empty." });
    const file: CanvasFileRef = { path: created.path, mime: mimeFor(created.name), bytes, name: created.name };
    const at = position(query);
    const ops = parseCanvasOps([{ type: "add_node", nodeType: canvasFileNodeType(file.mime), title: file.name, ...(at ? { position: at } : {}), metadata: { file } }]);
    const outcome = service.apply(project, { kind: "person" }, ops);
    return { revision: outcome.revision, nodeId: outcome.nodeIds[0]!, file };
  } catch (error) {
    await unlink(created.absolute).catch(() => undefined);
    throw error;
  } finally {
    await created.handle.close().catch(() => undefined);
  }
}

/** Security: only images and the players' audio and video are shown in the app; every other file, SVG and HTML
 * included, is sent as a download that runs nothing on the app's origin. */
export async function serveCanvasFile(service: ProjectCanvasService, projectId: string, req: IncomingMessage, res: ServerResponse, query: URLSearchParams): Promise<void> {
  const project = service.project(projectId);
  let file;
  try {
    file = await openProjectFile(project.folder, query.get("path") ?? "", Number.POSITIVE_INFINITY);
  } catch (error) {
    throw isProjectPathError(error) ? pathRefusal(error, project.folder) : error;
  }
  const media = STREAMABLE_MEDIA_MIMES.has(file.mime);
  const shown = media || SHOWN_IMAGES.has(file.mime);
  const rawRange = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range;
  const range = media ? cappedMediaRange(parseAudioRange(rawRange, file.bytes)) : { kind: "none" as const };
  const guarded = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };
  if (range.kind === "unsatisfiable") {
    await file.handle.close();
    res.writeHead(416, { "content-range": `bytes */${file.bytes}`, ...guarded });
    res.end();
    return;
  }
  const [start, end] = range.kind === "range" ? [range.start, range.end] : [0, file.bytes - 1];
  res.writeHead(range.kind === "range" ? 206 : 200, {
    "content-type": shown ? file.mime : "application/octet-stream",
    "content-length": String(Math.max(0, end - start + 1)),
    ...(range.kind === "range" ? { "content-range": `bytes ${start}-${end}/${file.bytes}` } : {}),
    ...(media ? { "accept-ranges": "bytes" } : {}),
    "content-disposition": messageFileDisposition(file.name, shown ? "inline" : "attachment"),
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    ...guarded,
  });
  if (file.bytes === 0) {
    await file.handle.close();
    res.end();
    return;
  }
  const stream = file.handle.createReadStream({ start, end, autoClose: true });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
