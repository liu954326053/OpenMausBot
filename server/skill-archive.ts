// A zip archive a person uploads to the skills library, unpacked into memory through a temporary copy.
// Security: the archive is untrusted. Its files are only read here, never written where a bot or the library could use
// them; nothing over the limits is unpacked, and a file that unpacks to more than it declares is refused.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SKILL_UPLOAD_LIMITS } from "../shared/skill-import.ts";
import type { UploadedFile } from "./skill-upload.ts";
import { userError, type UserError } from "./user-errors.ts";
import { extractZipMember, readZipDirectory } from "./zip-archive.ts";

/** `bytes` is what the archive may unpack to, which is more than it may weigh packed. */
export const SKILL_ARCHIVE_LIMITS = { entries: SKILL_UPLOAD_LIMITS.files, fileBytes: SKILL_UPLOAD_LIMITS.fileBytes, bytes: 2 * SKILL_UPLOAD_LIMITS.bytes } as const;

/** The most entries a zip's directory can declare without ZIP64, which the reader refuses. */
const ZIP_ENTRIES_MAX = 0xffff;

/** A Mac's zip tool adds a `__MACOSX` folder of resource forks and Finder's `.DS_Store` files; neither is content. */
const macExtra = (path: string) => path.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store");

/** Every file in the archive within the limits, and the paths of the ones over the per-file limit, which are not
 * unpacked. Folders are implied by the paths. */
export async function readSkillArchive(bytes: Uint8Array): Promise<{ files: UploadedFile[]; oversize: string[] } | UserError> {
  const scratch = await mkdtemp(join(tmpdir(), "magicbot-skill-upload-"));
  try {
    const archive = join(scratch, "upload.zip");
    await writeFile(archive, bytes, { mode: 0o600 });
    let members;
    try {
      members = await readZipDirectory(archive, ZIP_ENTRIES_MAX);
    } catch {
      return userError("serverError.skillUpload.notArchive");
    }
    if (members.length > SKILL_ARCHIVE_LIMITS.entries) return userError("serverError.skillUpload.tooManyFiles", { count: SKILL_ARCHIVE_LIMITS.entries });
    const files: UploadedFile[] = [];
    const oversize: string[] = [];
    let total = 0;
    for (const [index, member] of members.entries()) {
      const path = member.name.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
      if (!path || path.endsWith("/") || macExtra(path)) continue;
      if (member.uncompressedBytes > SKILL_ARCHIVE_LIMITS.fileBytes) {
        oversize.push(path);
        continue;
      }
      total += member.uncompressedBytes;
      if (total > SKILL_ARCHIVE_LIMITS.bytes) return userError("serverError.skillUpload.tooLarge", { limit: `${SKILL_ARCHIVE_LIMITS.bytes / (1024 * 1024)} MB` });
      const unpacked = join(scratch, `member-${index}`);
      try {
        await extractZipMember(archive, member, unpacked, 0o600);
        files.push({ path, content: await readFile(unpacked), executable: ((member.externalAttributes >>> 16) & 0o111) !== 0 });
      } catch {
        return userError("serverError.skillUpload.damaged", { path: path.slice(0, 200) });
      }
    }
    return { files, oversize };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
