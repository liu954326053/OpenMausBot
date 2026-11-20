// Security: an id is 16 hex characters and the only name this module makes a folder from. Every folder from
// `templates` down must be a real folder, never a link, before anything in it is opened. A template is read through
// the package gate with no link followed, and nothing is written outside `templates`.
import { randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { AVATAR_ZOOM_MAX, AVATAR_ZOOM_MIN, mascotFaceColorSchema } from "../shared/bot-avatar.ts";
import type { PackageDocument } from "../shared/package-format.ts";
import { MANIFEST_NAMES, readShareFolder, safeFolderPath, writeShareFolder } from "../shared/share-folder.ts";
import { isSkillName } from "../shared/skill-md.ts";
import { isTemplateRoleKey, TEMPLATE_LIMITS, type TemplateKind, type TemplateRoleExtras } from "../shared/template-library.ts";
import { EFFORT_LEVELS } from "../shared/wire.ts";
import { writeFileAtomic } from "./atomic.ts";
import { readFolderFromDisk } from "./share.ts";
import { directoryEntryState, entryExistsWithoutFollowing } from "./skill-storage.ts";

export const TEMPLATE_META_FILE = "magicbot.json";
const META_MAX_BYTES = 256 * 1024;
const KIND_FOLDER = { bot: "bots", team: "teams" } as const satisfies Record<TemplateKind, string>;
const SCOPE = { bot: "bot", team: "department" } as const;
const TEMPLATE_ID = /^[a-f0-9]{16}$/;
const UNDO = /^(bot|team)\.([a-f0-9]{16})\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const INTERRUPTED = /^\.([a-f0-9]{16})\.[0-9a-f-]{36}\.(new|old)$/;
/** Folders of one kind that a listing looks at. */
const LISTED_MAX = TEMPLATE_LIMITS.templates * 2;

const MCP_SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const isMcpServerName = (value: string): boolean => MCP_SERVER_NAME.test(value);
export const templateModelSchema = z.object({
  instanceId: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  effort: z.enum(EFFORT_LEVELS).optional(),
  variant: z.string().min(1).max(100).optional(),
});
export const templateLookExtrasSchema = z.object({
  mascotFaceColor: mascotFaceColorSchema.optional(),
  avatarZoom: z.number().min(AVATAR_ZOOM_MIN).max(AVATAR_ZOOM_MAX).optional(),
  avatarFocusX: z.number().min(0).max(1).optional(),
  avatarFocusY: z.number().min(0).max(1).optional(),
});
const extrasSchema = z.object({
  model: templateModelSchema.optional(),
  librarySkills: z.array(z.string().refine(isSkillName)).max(TEMPLATE_LIMITS.references).default([]),
  mcpServers: z.array(z.string().refine(isMcpServerName)).max(TEMPLATE_LIMITS.references).optional(),
  look: templateLookExtrasSchema.optional(),
});
const metaSchema = z.object({
  version: z.number().int().min(1).max(999_999),
  updatedAt: z.number().int().nonnegative(),
  genre: z.string().max(TEMPLATE_LIMITS.genre).optional(),
  lead: z.string().refine(isTemplateRoleKey).optional(),
  roles: z.record(z.string().refine(isTemplateRoleKey), extrasSchema).default({}),
  retiredKeys: z.array(z.string()).optional().catch(undefined),
});

/** What `magicbot.json` holds: what the template folder format has no field for. */
export interface TemplateMeta {
  version: number;
  updatedAt: number;
  genre?: string;
  lead?: string;
  roles: Record<string, TemplateRoleExtras>;
  /** Keys of roles a team template had once and has no more. */
  retiredKeys?: string[];
}

export interface StoredTemplate {
  document: PackageDocument;
  /** Null: the folder has no `magicbot.json`, or one that cannot be read. */
  meta: TemplateMeta | null;
  /** When the folder's bot.md or team.md was last written. */
  writtenAt: number;
}

export function isTemplateId(value: string): boolean {
  return TEMPLATE_ID.test(value);
}

export const newTemplateId = (): string => randomBytes(8).toString("hex");

export class TemplateStoreError extends Error {}

export function createTemplateStore(root: string) {
  const kindDir = (kind: TemplateKind) => join(root, KIND_FOLDER[kind]);
  const templateDir = (kind: TemplateKind, id: string) => join(kindDir(kind), id);
  const removedDir = join(root, "archive", "removed");
  const recovered = new Set<TemplateKind>();

  function plainDirectory(path: string, create: boolean): boolean {
    const state = directoryEntryState(path);
    if (state === "directory") return true;
    if (state === "unsafe" || !create) return false;
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return directoryEntryState(path) === "directory";
  }

  /** A save swaps two folders; one cut short between the two leaves the old one beside the new, and is put right here. */
  function recover(kind: TemplateKind): void {
    if (recovered.has(kind)) return;
    recovered.add(kind);
    try {
      for (const entry of readdirSync(kindDir(kind), { withFileTypes: true })) {
        const match = entry.isDirectory() ? entry.name.match(INTERRUPTED) : null;
        if (!match) continue;
        const path = join(kindDir(kind), entry.name);
        if (match[2] === "old" && !entryExistsWithoutFollowing(templateDir(kind, match[1]!))) renameSync(path, templateDir(kind, match[1]!));
        else rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // A leftover that can't be tidied is ignored by every reader: its name starts with a dot.
    }
  }

  function kindReady(kind: TemplateKind, create: boolean): boolean {
    if (!plainDirectory(root, create) || !plainDirectory(kindDir(kind), create)) return false;
    recover(kind);
    return true;
  }

  function readMeta(dir: string): TemplateMeta | null {
    const path = join(dir, TEMPLATE_META_FILE);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > META_MAX_BYTES) return null;
      const parsed = metaSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  function readFolder(dir: string, kind: TemplateKind): StoredTemplate | null {
    if (directoryEntryState(dir) !== "directory") return null;
    try {
      const manifest = lstatSync(join(dir, MANIFEST_NAMES[SCOPE[kind]]));
      if (!manifest.isFile()) return null;
      const folder = readShareFolder(readFolderFromDisk(dir));
      if (folder.kind !== "package" || folder.scope !== SCOPE[kind]) return null;
      return { document: folder.document, meta: readMeta(dir), writtenAt: Math.round(manifest.mtimeMs) };
    } catch {
      return null;
    }
  }

  function removed(undo: string): { kind: TemplateKind; id: string; dir: string } | null {
    const match = undo.match(UNDO);
    if (!match || !plainDirectory(root, false) || !plainDirectory(join(root, "archive"), false) || !plainDirectory(removedDir, false)) return null;
    const dir = join(removedDir, undo);
    return directoryEntryState(dir) === "directory" ? { kind: match[1] as TemplateKind, id: match[2]!, dir } : null;
  }

  return {
    /** The ids of the kind's templates, whether or not each can be read. */
    ids(kind: TemplateKind): string[] {
      if (!kindReady(kind, false)) return [];
      try {
        return readdirSync(kindDir(kind), { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && TEMPLATE_ID.test(entry.name))
          .map((entry) => entry.name).sort().slice(0, LISTED_MAX);
      } catch {
        return [];
      }
    },

    /** Null: no such template, or a folder that is damaged, is a link or holds the other kind. */
    read(kind: TemplateKind, id: string): StoredTemplate | null {
      if (!TEMPLATE_ID.test(id) || !kindReady(kind, false)) return null;
      return readFolder(templateDir(kind, id), kind);
    },

    /** Writes the whole folder beside the old one, then swaps them, so a reader sees all of the old or all of the new. */
    write(kind: TemplateKind, id: string, document: PackageDocument, meta: TemplateMeta): void {
      if (!TEMPLATE_ID.test(id)) throw new TemplateStoreError("not a template id");
      if (!kindReady(kind, true)) throw new TemplateStoreError("the templates folder is not a plain folder");
      const dir = templateDir(kind, id);
      const before = directoryEntryState(dir);
      if (before === "unsafe") throw new TemplateStoreError("the template's folder is not a plain folder");
      const files: Record<string, string | Uint8Array> = {
        ...writeShareFolder(document, SCOPE[kind]),
        [TEMPLATE_META_FILE]: `${JSON.stringify({ schema: 1, kind, ...metaSchema.parse(meta) }, null, 2)}\n`,
      };
      const stage = join(kindDir(kind), `.${id}.${randomUUID()}.new`);
      mkdirSync(stage, { mode: 0o700 });
      try {
        for (const [path, value] of Object.entries(files)) {
          if (safeFolderPath(path) !== path) throw new TemplateStoreError("a file of the template has a name a folder can't hold");
          const target = join(stage, ...path.split("/"));
          mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
          writeFileAtomic(target, value, { mode: 0o600 });
        }
        if (before === "directory") {
          const old = join(kindDir(kind), `.${id}.${randomUUID()}.old`);
          renameSync(dir, old);
          try {
            renameSync(stage, dir);
          } catch (error) {
            renameSync(old, dir);
            throw error;
          }
          rmSync(old, { recursive: true, force: true });
        } else renameSync(stage, dir);
      } catch (error) {
        rmSync(stage, { recursive: true, force: true });
        throw error;
      }
    },

    /** Moves the template to the archive, whatever state its files are in; the answer names it for `restore`. */
    remove(kind: TemplateKind, id: string): string | null {
      if (!TEMPLATE_ID.test(id) || !kindReady(kind, false)) return null;
      const dir = templateDir(kind, id);
      if (directoryEntryState(dir) !== "directory") return null;
      if (!plainDirectory(join(root, "archive"), true) || !plainDirectory(removedDir, true)) throw new TemplateStoreError("the archive is not a plain folder");
      const undo = `${kind}.${id}.${randomUUID()}`;
      renameSync(dir, join(removedDir, undo));
      return undo;
    },

    /** The removed template `undo` names, as it was. */
    readRemoved(undo: string): ({ kind: TemplateKind; id: string } & StoredTemplate) | null {
      const found = removed(undo);
      const stored = found && readFolder(found.dir, found.kind);
      return found && stored ? { kind: found.kind, id: found.id, ...stored } : null;
    },

    /** Puts back what `remove` took out, under the id it had. */
    restore(undo: string): { kind: TemplateKind; id: string } | null {
      const found = removed(undo);
      if (!found || !kindReady(found.kind, true) || entryExistsWithoutFollowing(templateDir(found.kind, found.id))) return null;
      renameSync(found.dir, templateDir(found.kind, found.id));
      return { kind: found.kind, id: found.id };
    },
  };
}

export type TemplateStore = ReturnType<typeof createTemplateStore>;
