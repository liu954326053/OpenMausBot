import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { GENERATION_OUTPUT_FOLDERS, REFERENCE_LIMITS, type GenerationFile, type GenerationKind, type GenerationReferences } from "../../shared/project-generation.ts";
import { addressClass, ownAddresses } from "../browser/egress/policy.ts";
import { sniffRaster } from "../generated-image.ts";
import { teamProjectFolderReady } from "../team-project-folders.ts";
import { fetchPublicPage } from "../wait-probes.ts";
import { refused } from "./failure.ts";

export const RESULT_MAX_BYTES: Readonly<Record<GenerationKind, number>> = { image: 40 * 1024 * 1024, video: 200 * 1024 * 1024 };
const DOWNLOAD_TIMEOUT_MS: Readonly<Record<GenerationKind, number>> = { image: 2 * 60_000, video: 10 * 60_000 };
const NAME_MAX = 60;

const ftypBrand = (bytes: Buffer): string | null =>
  bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp" ? bytes.subarray(8, 12).toString("latin1") : null;

/** What a video's bytes are, never what its sender claims. */
export function sniffVideo(bytes: Buffer): "video/mp4" | "video/quicktime" | "video/webm" | null {
  const brand = ftypBrand(bytes);
  if (brand) return brand === "qt  " ? "video/quicktime" : /^M4[ABP] $/.test(brand) ? null : "video/mp4";
  return bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 ? "video/webm" : null;
}

export function sniffAudio(bytes: Buffer): "audio/mpeg" | "audio/wav" | "audio/mp4" | "audio/ogg" | "audio/flac" | "audio/aac" | null {
  const head = bytes.subarray(0, 4).toString("latin1");
  if (head.startsWith("ID3")) return "audio/mpeg";
  if (head === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (head === "OggS") return "audio/ogg";
  if (head === "fLaC") return "audio/flac";
  if (ftypBrand(bytes)) return "audio/mp4";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

const EXTENSION: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

const sizeText = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** A path relative to the project folder, as on canvas nodes, split into its names; null when it could leave the folder. */
export function projectRelativeParts(path: string): string[] | null {
  if (!path || path.length > 1024 || path.includes("\0") || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split(/[/\\]/).filter((part) => part !== "" && part !== ".");
  return parts.length && parts.every((part) => part !== "..") ? parts : null;
}

export interface ReferenceFile {
  name: string;
  mimeType: string;
  /** base64 */
  data: string;
}

/**
 * Security invariant: a reference is read only when every level from the project folder down to it is a real folder and
 * it is a regular file, so a link left in a project never sends a file from elsewhere to an MCP server.
 */
export function readReference(folder: string, path: string, kind: "image" | "audio"): ReferenceFile {
  const parts = projectRelativeParts(path);
  if (!parts) throw refused("reference_refused", "referenceMissing", { path });
  let dir = folder;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw refused("reference_refused", "referenceMissing", { path });
  }
  const limit = kind === "image" ? REFERENCE_LIMITS.imageBytes : REFERENCE_LIMITS.audioBytes;
  let fd: number;
  try {
    fd = openSync(join(dir, parts.at(-1)!), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw refused("reference_refused", "referenceMissing", { path });
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw refused("reference_refused", "referenceMissing", { path });
    if (stat.size > limit) throw refused("reference_refused", "referenceTooLarge", { path, limit: sizeText(limit) });
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const got = readSync(fd, bytes, read, bytes.length - read, read);
      if (got === 0) break;
      read += got;
    }
    const mimeType = kind === "image" ? sniffRaster(bytes.subarray(0, read)) : sniffAudio(bytes.subarray(0, read));
    if (!mimeType) throw refused("reference_refused", kind === "image" ? "referenceNotImage" : "referenceNotAudio", { path });
    return { name: parts.at(-1)!, mimeType, data: bytes.subarray(0, read).toString("base64") };
  } finally {
    closeSync(fd);
  }
}

export function readReferences(folder: string, references: GenerationReferences): { images: ReferenceFile[]; audio: ReferenceFile[] } {
  const tooMany = () => refused("reference_refused", "referencesTooMany", {
    images: REFERENCE_LIMITS.images, audio: REFERENCE_LIMITS.audio, total: sizeText(REFERENCE_LIMITS.totalBytes),
  });
  if (references.images.length > REFERENCE_LIMITS.images || references.audio.length > REFERENCE_LIMITS.audio) throw tooMany();
  const images = references.images.map((path) => readReference(folder, path, "image"));
  const audio = references.audio.map((path) => readReference(folder, path, "audio"));
  const total = [...images, ...audio].reduce((sum, file) => sum + Math.floor((file.data.length * 3) / 4), 0);
  if (total > REFERENCE_LIMITS.totalBytes) throw tooMany();
  return { images, audio };
}

/** A file the server made, as it handed it over. */
export type ResultSource = { url: string; name?: string } | { data: string; name?: string };

/**
 * Security: a result is fetched from a public https address, or from the MCP server's own address, and nowhere else;
 * every redirect is checked again. Nothing is sent with it, the server's keys least of all.
 */
export async function resultBytes(source: ResultSource, kind: GenerationKind, serverUrl: string | null, server: string): Promise<{ bytes: Buffer; mime: string }> {
  const max = RESULT_MAX_BYTES[kind];
  const fail = (detail: string) => refused("download_failed", "downloadFailed", { server, detail });
  let bytes: Buffer;
  if ("data" in source) {
    const compact = source.data.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length > Math.ceil(max / 3) * 4) throw fail("its data is not a file this size can be");
    bytes = Buffer.from(compact, "base64");
  } else {
    let url: URL;
    try { url = new URL(source.url); } catch { throw fail("its address is not a web address"); }
    const own = serverUrl ? new URL(serverUrl) : null;
    const serverHost = own && url.origin === own.origin ? own.hostname.replace(/^\[|\]$/g, "") : null;
    if (!serverHost && url.protocol !== "https:") throw fail("its address is neither https nor the MCP server's own");
    const page = await fetchPublicPage(url.href, {
      allow: ({ host, address }) => host === serverHost || addressClass(address, ownAddresses()) === "public",
      timeoutMs: DOWNLOAD_TIMEOUT_MS[kind],
      maxBytes: max + 1,
    });
    if (!page.ok) throw fail(page.refused ? "its address points at this computer or a private network" : page.status ? `the address answered ${page.status}` : "the address could not be reached");
    bytes = page.body;
  }
  if (bytes.length > max) throw fail(`it is larger than ${sizeText(max)}`);
  const mime = kind === "image" ? sniffRaster(bytes) : sniffVideo(bytes);
  if (!mime) throw fail(kind === "image" ? "it is not a picture" : "it is not a video");
  return { bytes, mime };
}

/** A name for a result made of `hint`, safe as one file name on every system, without its extension. */
export function resultBaseName(hint: string | undefined, kind: GenerationKind, at: number, jobId: string): string {
  const unsafe = (char: string) => char.codePointAt(0)! < 0x20 || char === "\u007f" || '/\\:*?"<>|'.includes(char);
  const cleaned = [...(hint ?? "").normalize("NFC")].map((char) => (unsafe(char) ? " " : char)).join("")
    .replace(/\s+/g, " ").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  const base = [...cleaned].slice(0, NAME_MAX).join("").trim() || (kind === "image" ? "image" : "video");
  const time = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  const stamp = `${time.getFullYear()}${two(time.getMonth() + 1)}${two(time.getDate())}-${two(time.getHours())}${two(time.getMinutes())}${two(time.getSeconds())}`;
  return `${base}-${stamp}-${jobId.replace(/[^A-Za-z0-9]/g, "").slice(-6)}`;
}

/** Security invariant: no level is made with a recursive mkdir, and a level that is a link or a file is refused. */
function realFolder(dir: string): void {
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw refused("project_unavailable", "projectFolderMissing");
    if (code !== "EEXIST") throw refused("download_failed", "saveFailed", { detail: `the folder ${basename(dir)} could not be made` });
  }
  if (!lstatSync(dir).isDirectory()) throw refused("download_failed", "saveFailed", { detail: `${basename(dir)} is not a folder` });
}

/** Saves a result under the kind's output folder with a name no other file has, made only here: it never replaces one. */
export function saveResult(folder: string, kind: GenerationKind, baseName: string, bytes: Buffer, mime: string): GenerationFile {
  if (!teamProjectFolderReady(folder)) throw refused("project_unavailable", "projectFolderMissing");
  let dir = folder;
  for (const level of GENERATION_OUTPUT_FOLDERS[kind]) realFolder(dir = join(dir, level));
  const extension = EXTENSION[mime] ?? "bin";
  for (let copy = 1; copy <= 100; copy += 1) {
    const name = `${baseName}${copy === 1 ? "" : `-${copy}`}.${extension}`;
    const path = join(dir, name);
    let fd: number;
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw refused("download_failed", "saveFailed", { detail: (error as NodeJS.ErrnoException).code ?? "it could not be written" });
    }
    try {
      for (let written = 0; written < bytes.length;) written += writeSync(fd, bytes, written, bytes.length - written);
    } catch (error) {
      void rm(path, { force: true }).catch(() => undefined);
      throw refused("download_failed", "saveFailed", { detail: (error as NodeJS.ErrnoException).code ?? "it could not be written" });
    } finally {
      closeSync(fd);
    }
    return { path: [...GENERATION_OUTPUT_FOLDERS[kind], name].join("/"), mime, bytes: bytes.length, name };
  }
  throw refused("download_failed", "saveFailed", { detail: "too many files have this name" });
}

/** Removes results a job saved before it failed; they were never handed to anyone. */
export async function removeResults(folder: string, files: readonly GenerationFile[]): Promise<void> {
  for (const file of files) {
    const parts = projectRelativeParts(file.path);
    if (parts) await rm(join(folder, ...parts), { force: true }).catch(() => undefined);
  }
}
