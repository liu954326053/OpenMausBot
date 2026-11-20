import { afterEach, describe, expect, it, vi } from "vitest";

import { SKILL_UPLOAD_LIMITS, type SkillUploadResult } from "../../shared/skill-import";
import { archiveUpload, folderUpload, sendSkillUpload, skillUploadLines, skillUploadRefusalText } from "./skill-upload";

const picked = (path: string, content: string | number) => {
  const bytes = typeof content === "number" ? new Uint8Array(0) : new TextEncoder().encode(content);
  return {
    name: path.split("/").at(-1)!,
    webkitRelativePath: path,
    size: typeof content === "number" ? content : bytes.length,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
};
const text = (base64: string) => Buffer.from(base64, "base64").toString("utf8");
const result = (parts: Partial<SkillUploadResult>): SkillUploadResult => ({ installed: [], unchanged: [], conflicts: [], errors: [], ...parts });
const answer = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: "", headers: new Headers(), json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe("what a chosen file or folder sends to the skills library", () => {
  it("sends an archive whole, under the file's name", async () => {
    const upload = await archiveUpload({ name: "comics.skill", size: 5, arrayBuffer: async () => new Uint8Array([80, 75, 3, 4, 255]).buffer as ArrayBuffer });
    expect(upload).toEqual({ archive: Buffer.from([80, 75, 3, 4, 255]).toString("base64"), label: "comics.skill" });
  });

  it("sends a folder's files by their paths inside it, under the folder's name", async () => {
    const upload = await folderUpload([
      picked("comics/tomato-pick/SKILL.md", "---\nname: tomato-pick\n---\n"),
      picked("comics/tomato-pick/scripts/rank.py", "print('排名')\n"),
    ]);
    if (typeof upload === "string") throw new Error(upload);
    expect(upload.label).toBe("comics");
    expect(upload.files?.map((file) => [file.path, text(file.content)])).toEqual([
      ["tomato-pick/SKILL.md", "---\nname: tomato-pick\n---\n"], ["tomato-pick/scripts/rank.py", "print('排名')\n"],
    ]);
    expect(upload).not.toHaveProperty("oversize");
  });

  it("leaves hidden entries and caches behind, and names the files too large to send", async () => {
    const upload = await folderUpload([
      picked("pick/SKILL.md", "x"),
      picked("pick/.git/config", "secret"),
      picked("pick/node_modules/dep/index.js", "x"),
      picked("pick/__pycache__/rank.pyc", "x"),
      picked("pick/.DS_Store", "x"),
      picked("pick/video.mp4", SKILL_UPLOAD_LIMITS.fileBytes + 1),
    ]);
    expect(upload).toMatchObject({ files: [{ path: "SKILL.md" }], oversize: ["video.mp4"], label: "pick" });
  });

  it("sends nothing from a folder that holds no skill, or more than one request may carry", async () => {
    expect(await folderUpload([picked("notes/readme.md", "x"), picked("notes/.hidden/SKILL.md", "x")])).toBe("noSkill");
    const part = Math.floor(SKILL_UPLOAD_LIMITS.fileBytes);
    const heavy = [picked("big/SKILL.md", "x"), ...Array.from({ length: SKILL_UPLOAD_LIMITS.bytes / part + 1 }, (_, at) => picked(`big/part-${at}.bin`, part))];
    expect(await folderUpload(heavy)).toBe("tooLarge");
    const many = [picked("many/SKILL.md", "x"), ...Array.from({ length: SKILL_UPLOAD_LIMITS.files }, (_, at) => picked(`many/f${at}.md`, 1))];
    expect(await folderUpload(many)).toBe("tooLarge");
    expect(await archiveUpload({ name: "big.zip", size: SKILL_UPLOAD_LIMITS.bytes + 1, arrayBuffer: async () => new ArrayBuffer(0) })).toBe("tooLarge");
    expect(skillUploadRefusalText("tooLarge")).toBe("That is over 32 MB. Add fewer skills at a time.");
    expect(skillUploadRefusalText("noSkill")).toBe("That folder has no SKILL.md. Choose a skill's own folder, or a folder that holds several skills.");
  });
});

describe("sending an upload", () => {
  it("returns what the library did, and names the skills to replace only when asked", async () => {
    const fetched = vi.fn(async (_path: string, _init?: RequestInit) => answer(201, result({ installed: [{ name: "pick", files: 1, scripts: 0, skipped: [], skippedCount: 0, replaced: false }] })));
    vi.stubGlobal("fetch", fetched);

    expect((await sendSkillUpload({ archive: "UEs=", label: "pick.zip" })).installed).toMatchObject([{ name: "pick" }]);
    expect(fetched).toHaveBeenLastCalledWith("/api/skills-library/upload", expect.objectContaining({ method: "POST", body: '{"archive":"UEs=","label":"pick.zip"}' }));
    await sendSkillUpload({ archive: "UEs=", label: "pick.zip" }, ["pick"]);
    expect(fetched).toHaveBeenLastCalledWith("/api/skills-library/upload", expect.objectContaining({ body: '{"archive":"UEs=","label":"pick.zip","replace":["pick"]}' }));
  });

  it("returns the skills already there under those names as conflicts, and fails on anything else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(409, { ...result({ conflicts: ["pick"] }), error: "already in the library: pick" })));
    expect(await sendSkillUpload({ archive: "UEs=", label: "pick.zip" })).toMatchObject({ conflicts: ["pick"], installed: [] });

    vi.stubGlobal("fetch", vi.fn(async () => answer(422, { error: "No SKILL.md was found.", errorKey: "serverError.skillUpload.noSkill" })));
    await expect(sendSkillUpload({ archive: "UEs=", label: "pick.zip" })).rejects.toThrow("No SKILL.md was found. Choose a skill's own folder, a folder of skills, or an archive of either.");
  });
});

describe("what an upload's result says", () => {
  it("says what came in and to read it, what was already there, and what could not be read", () => {
    expect(skillUploadLines(result({
      installed: [{ name: "tomato-pick", files: 2, scripts: 1, skipped: [{ path: "video.mp4", reason: "large" }], skippedCount: 1, replaced: false }],
      unchanged: ["douyin-pick", "ranker"],
      errors: ["pack/bad: SKILL.md is not UTF-8 text"],
    }))).toEqual([
      "Imported tomato-pick: 2 files and 1 script. Left out: video.mp4 (over 2 MB).",
      "Review each one and turn it on below.",
      "Already in the library with the same files: douyin-pick and ranker.",
      "Not added: pack/bad: SKILL.md is not UTF-8 text",
    ]);
    expect(skillUploadLines(result({ conflicts: ["pick"] }))).toEqual([]);
  });
});
