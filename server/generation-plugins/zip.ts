import { inflateRawSync } from "node:zlib";

// A minimal ZIP reader for plugin uploads: deflate or stored entries, no ZIP64, no encryption. Security invariant: an
// entry's name is checked before anything is written, and an entry that is not a plain file or a plain folder is
// refused, so an archive can neither leave the folder it is unpacked into nor plant a link.

export interface ZipEntry {
  path: string;
  data: Buffer;
}

export class ZipProblem extends Error {
  override name = "ZipProblem";
}

export interface ZipLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const fail = (message: string): never => { throw new ZipProblem(message); };

/** The entry's path, split and checked; null for a folder entry. */
export function safeEntryPath(name: string): string | null {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.includes("\0")) fail("the archive has a file name with an unreadable character");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) fail("the archive has a file with an absolute path");
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) fail("the archive has a file that points outside the plugin's folder");
  if (normalized.endsWith("/")) return null;
  if (parts.length === 0) return null;
  return parts.join("/");
}

export function readZip(buffer: Buffer, limits: ZipLimits): ZipEntry[] {
  if (buffer.length < 22) fail("that file is not a zip archive");
  let at = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD && offset + 22 + buffer.readUInt16LE(offset + 20) <= buffer.length) { at = offset; break; }
  }
  if (at < 0) fail("that file is not a zip archive");
  const count = buffer.readUInt16LE(at + 10);
  const directoryAt = buffer.readUInt32LE(at + 16);
  if (count === 0xffff || directoryAt === 0xffffffff) fail("the archive is in ZIP64, which plugins do not use");
  if (count > limits.maxFiles) fail(`the archive has more than ${limits.maxFiles} files`);
  if (directoryAt + 46 > buffer.length) fail("the archive is cut short");

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let offset = directoryAt;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) fail("the archive's file list is damaged");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const mode = (buffer.readUInt32LE(offset + 38) >>> 16) & 0o170000;
    const localAt = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x1) fail("the archive is password-protected");
    if (method !== 0 && method !== 8) fail(`the archive uses a compression plugins do not use (entry ${name})`);
    if (compressed === 0xffffffff || size === 0xffffffff || localAt === 0xffffffff) fail("the archive is in ZIP64, which plugins do not use");
    if (mode !== 0 && mode !== 0o100000 && mode !== 0o040000) fail(`the archive has an entry that is not a file or folder (${name})`);
    const path = safeEntryPath(name);
    if (path === null) continue;
    if (seen.has(path.toLowerCase())) fail(`the archive has two files named ${path}`);
    seen.add(path.toLowerCase());
    if (size > limits.maxFileBytes) fail(`${path} is larger than a plugin file may be`);
    total += size;
    if (total > limits.maxTotalBytes) fail("the archive unpacks to more than a plugin may hold");
    if (localAt + 30 > buffer.length || buffer.readUInt32LE(localAt) !== LOCAL) fail("the archive's file list is damaged");
    const start = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    if (start + compressed > buffer.length) fail("the archive is cut short");
    const raw = buffer.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else {
      try { data = inflateRawSync(raw, { maxOutputLength: limits.maxFileBytes }); }
      catch { fail(`${path} could not be read`); }
    }
    if (data!.length !== size) fail(`${path} is not the size the archive says`);
    entries.push({ path, data: data! });
  }
  return entries;
}
