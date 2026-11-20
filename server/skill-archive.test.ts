import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { readSkillArchive, SKILL_ARCHIVE_LIMITS } from "./skill-archive.ts";
import { SKILL_FOLDER_LIMITS } from "./skill-folder.ts";
import { buildZip } from "./testing/zip-fixture.ts";

const scratchFolders = () => readdirSync(tmpdir()).filter((name) => name.startsWith("magicbot-skill-upload-"));

describe("reading an uploaded skill archive", () => {
  it("reads compressed and stored files by their paths, with which ones may run, and leaves nothing behind", async () => {
    const before = scratchFolders();
    const read = await readSkillArchive(buildZip([
      { name: "pick/", mode: 0o040755, method: 0 },
      { name: "pick/SKILL.md", data: "---\nname: pick\n---\n", mode: 0o100644 },
      { name: "pick/scripts/run.py", data: "print('run')\n", mode: 0o100755 },
      { name: "pick/assets/cover.bin", data: Buffer.from([0, 255, 7]), method: 0 },
      { name: "pick/empty.txt", data: "", method: 0 },
    ]));
    if ("error" in read) throw new Error(read.error);
    expect(read.oversize).toEqual([]);
    expect(read.files.map((file) => [file.path, file.executable])).toEqual([
      ["pick/SKILL.md", false], ["pick/scripts/run.py", true], ["pick/assets/cover.bin", false], ["pick/empty.txt", false],
    ]);
    expect(Buffer.from(read.files[0]!.content).toString("utf8")).toBe("---\nname: pick\n---\n");
    expect([...read.files[2]!.content]).toEqual([0, 255, 7]);
    expect(scratchFolders()).toEqual(before);
  });

  it("leaves out what a Mac adds to an archive, and reads Windows separators as folders", async () => {
    const read = await readSkillArchive(buildZip([
      { name: "pick\\SKILL.md", data: "x" },
      { name: "__MACOSX/pick/._SKILL.md", data: "resource fork" },
      { name: "pick/.DS_Store", data: "finder" },
    ]));
    expect(read).toMatchObject({ files: [{ path: "pick/SKILL.md" }] });
  });

  it("holds one file to the size a skill folder takes", () => {
    expect(SKILL_ARCHIVE_LIMITS.fileBytes).toBe(SKILL_FOLDER_LIMITS.fileBytes);
  });

  it("refuses an archive that unpacks to more than the limit", async () => {
    const piece = "a".repeat(SKILL_ARCHIVE_LIMITS.fileBytes);
    const count = Math.floor(SKILL_ARCHIVE_LIMITS.bytes / SKILL_ARCHIVE_LIMITS.fileBytes) + 1;
    const heavy = buildZip([{ name: "pick/SKILL.md", data: "x" }, ...Array.from({ length: count }, (_, at) => ({ name: `pick/part-${at}.txt`, data: piece }))]);
    expect(await readSkillArchive(heavy)).toMatchObject({ errorKey: "serverError.skillUpload.tooLarge", errorParams: { limit: "64 MB" } });
  });

  it("refuses an archive of more files than one upload may hold", async () => {
    const crowded = buildZip(Array.from({ length: SKILL_ARCHIVE_LIMITS.entries + 1 }, (_, at) => ({ name: `pick/f${at}.md`, data: "", method: 0 as const })));
    expect(await readSkillArchive(crowded)).toMatchObject({ errorKey: "serverError.skillUpload.tooManyFiles", errorParams: { count: 5000 } });
  });

  it("names a file over the size limit without unpacking it", async () => {
    const read = await readSkillArchive(buildZip([
      { name: "pick/SKILL.md", data: "x" },
      { name: "pick/video.mp4", data: "tiny", declaredBytes: SKILL_ARCHIVE_LIMITS.fileBytes + 1 },
    ]));
    expect(read).toMatchObject({ files: [{ path: "pick/SKILL.md" }], oversize: ["pick/video.mp4"] });
  });

  it("refuses what is not a zip archive, and a file that unpacks to more than it declares", async () => {
    const before = scratchFolders();
    expect(await readSkillArchive(Buffer.from("not an archive at all"))).toMatchObject({ errorKey: "serverError.skillUpload.notArchive" });
    const bomb = buildZip([{ name: "pick/SKILL.md", data: "a".repeat(50_000), declaredBytes: 10 }]);
    expect(await readSkillArchive(bomb)).toEqual({
      error: "The archive is damaged at pick/SKILL.md. Make the archive again, then try once more.",
      errorKey: "serverError.skillUpload.damaged",
      errorParams: { path: "pick/SKILL.md" },
    });
    expect(scratchFolders()).toEqual(before);
  });
});
