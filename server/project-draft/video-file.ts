import type { FileHandle } from "node:fs/promises";

import { sniffVideo } from "../project-generation/project-files.ts";

/** What a video file's own bytes say. Only an MP4 or QuickTime header is read for more than the type. */
export interface VideoFacts {
  mime: "video/mp4" | "video/quicktime" | "video/webm";
  /** Microseconds. */
  durationUs?: number;
  /** As it plays: a picture stored on its side is given turned. */
  width?: number;
  height?: number;
  /** Frames a second, rounded. */
  fps?: number;
}

const HEADER_MAX_BYTES = 32 * 1024 * 1024;
const BOXES_MAX = 10_000;
// A QuickTime track names its data handler in a second `hdlr` inside `minf` (QuickTime File Format, "Handler
// Reference Atoms"), so a track is a video once any of its handlers says so.
const CONTAINERS: ReadonlySet<string> = new Set(["trak", "mdia", "minf", "stbl"]);

interface Box {
  type: string;
  body: Buffer;
}

function* boxesIn(bytes: Buffer): Generator<Box> {
  let at = 0;
  while (at + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(at);
    let head = 8;
    if (size === 1) {
      if (at + 16 > bytes.length) return;
      size = Number(bytes.readBigUInt64BE(at + 8));
      head = 16;
    } else if (size === 0) size = bytes.length - at;
    if (size < head || at + size > bytes.length) return;
    yield { type: bytes.subarray(at + 4, at + 8).toString("latin1"), body: bytes.subarray(at + head, at + size) };
    at += size;
  }
}

/** A version 0 header holds 32-bit times and a version 1 header 64-bit ones (ISO/IEC 14496-12, 8.2.2 and 8.4.2). */
function scaleAndDuration(body: Buffer): { timescale: number; duration: number } | null {
  if (body.length < 4) return null;
  const wide = body[0] === 1;
  const at = wide ? 20 : 12;
  if (body.length < at + (wide ? 12 : 8)) return null;
  const timescale = body.readUInt32BE(at);
  const duration = wide ? Number(body.readBigUInt64BE(at + 4)) : body.readUInt32BE(at + 4);
  return timescale > 0 ? { timescale, duration } : null;
}

function frameSize(tkhd: Buffer): { width: number; height: number } | null {
  if (tkhd.length < 4) return null;
  const matrix = tkhd[0] === 1 ? 52 : 40;
  if (tkhd.length < matrix + 44) return null;
  const width = Math.round(tkhd.readUInt32BE(matrix + 36) / 0x10000);
  const height = Math.round(tkhd.readUInt32BE(matrix + 40) / 0x10000);
  if (width <= 0 || height <= 0) return null;
  const onItsSide = tkhd.readInt32BE(matrix) === 0 && tkhd.readInt32BE(matrix + 16) === 0 && tkhd.readInt32BE(matrix + 4) !== 0 && tkhd.readInt32BE(matrix + 12) !== 0;
  return onItsSide ? { width: height, height: width } : { width, height };
}

function frameCount(stts: Buffer): number {
  if (stts.length < 8) return 0;
  const entries = Math.min(stts.readUInt32BE(4), Math.floor((stts.length - 8) / 8));
  let frames = 0;
  for (let index = 0; index < entries; index += 1) frames += stts.readUInt32BE(8 + index * 8);
  return frames;
}

interface Track {
  video: boolean;
  size: { width: number; height: number } | null;
  media: { timescale: number; duration: number } | null;
  frames: number;
}

function readTrack(trak: Buffer): Track {
  const track: Track = { video: false, size: null, media: null, frames: 0 };
  const walk = (bytes: Buffer) => {
    for (const { type, body } of boxesIn(bytes)) {
      if (CONTAINERS.has(type)) walk(body);
      else if (type === "tkhd") track.size = frameSize(body);
      else if (type === "mdhd") track.media = scaleAndDuration(body);
      else if (type === "hdlr") track.video ||= body.length >= 12 && body.subarray(8, 12).toString("latin1") === "vide";
      else if (type === "stts") track.frames = frameCount(body);
    }
  };
  walk(trak);
  return track;
}

function movieFacts(moov: Buffer): Omit<VideoFacts, "mime"> {
  let movie: { timescale: number; duration: number } | null = null;
  let picture: Track | undefined;
  for (const { type, body } of boxesIn(moov)) {
    if (type === "mvhd") movie = scaleAndDuration(body);
    else if (type === "trak" && !picture) {
      const track = readTrack(body);
      if (track.video) picture = track;
    }
  }
  const facts: Omit<VideoFacts, "mime"> = {};
  const length = movie && movie.duration > 0 ? movie : picture?.media;
  if (length && length.duration > 0) facts.durationUs = Math.round((length.duration * 1_000_000) / length.timescale);
  if (picture?.size) Object.assign(facts, picture.size);
  if (picture?.media && picture.media.duration > 0 && picture.frames > 0) {
    const fps = Math.round((picture.frames * picture.media.timescale) / picture.media.duration);
    if (fps >= 1 && fps <= 240) facts.fps = fps;
  }
  return facts;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(bytes, read, length - read, position + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return bytes.subarray(0, read);
}

async function movieHeader(handle: FileHandle, bytes: number): Promise<Buffer | null> {
  let at = 0;
  for (let seen = 0; seen < BOXES_MAX && at + 8 <= bytes; seen += 1) {
    const head = await readAt(handle, at, 16);
    if (head.length < 8) return null;
    let size = head.readUInt32BE(0);
    let headBytes = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = Number(head.readBigUInt64BE(8));
      headBytes = 16;
    } else if (size === 0) size = bytes - at;
    if (size < headBytes) return null;
    if (head.subarray(4, 8).toString("latin1") === "moov") {
      if (size > HEADER_MAX_BYTES || at + size > bytes) return null;
      return readAt(handle, at + headBytes, size - headBytes);
    }
    at += size;
  }
  return null;
}

/** Security: a file is a video by what its bytes are, never by its name. Null: not a video. */
export async function videoFacts(handle: FileHandle, bytes: number): Promise<VideoFacts | null> {
  const mime = sniffVideo(await readAt(handle, 0, 16));
  if (!mime) return null;
  if (mime === "video/webm") return { mime };
  const moov = await movieHeader(handle, bytes);
  return moov ? { mime, ...movieFacts(moov) } : { mime };
}
