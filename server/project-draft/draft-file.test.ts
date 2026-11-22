import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildDraft, draftFolderName, draftFormatFor, numberedDraftName, WRITABLE_JIANYING_VERSIONS, type DraftPlan } from "./draft-file.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** JSON without the spaces Python's writer puts between its parts. */
function compact(text: string): string {
  let out = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString && char === "\\") {
      out += char + text[index + 1]!;
      index += 1;
    } else if (char === "\"") {
      inString = !inString;
      out += char;
    } else if (inString || !/\s/.test(char)) out += char;
  }
  return out;
}

const ROOT = "/Users/me/Movies/JianyingPro/User Data/Projects/com.lveditor.draft";
const LISTED: DraftPlan = {
  name: "MagicBot测试草稿",
  root: ROOT,
  folder: `${ROOT}/MagicBot测试草稿`,
  clips: [
    { path: "/dramas/Stand-in bride/产出/视频/镜头1.mp4", name: "镜头1.mp4", bytes: 696_555, durationUs: 113_643_000, width: 900, height: 578 },
    { path: "/dramas/Stand-in bride/产出/视频/镜头2.mp4", name: "镜头2.mp4", bytes: 3_376_885, durationUs: 14_033_333, width: 1592, height: 1524 },
  ],
  fps: 30,
  draftId: "C1A7A5E0-58BC-4596-BDAC-60EB0F9AF024",
  createdUs: 1_795_318_433_110_108,
  modifiedUs: 1_795_318_433_110_108,
};
const LISTED_IDS = [
  "5EC6BBED-6C88-4AD8-A56A-2EE615FC2B6D", "744F9E38-A49B-4190-B90D-613A599A65F7", "E09E712C-A4E0-44FA-8A41-FE048EE98ABD",
  "41E2AB2A-741C-4CCE-ACA8-55B351111DAC", "C6D26401-1663-492B-B21F-C281C5A421A6", "BF7378BA-DD5E-44FC-9F24-B6AD9AC796EC",
  "775FF90F-A023-4BD6-9E6E-B30E3969C8BA", "4410820A-BE12-4A88-8867-0E4DD762305E",
];
const idsFrom = (ids: string[]) => {
  const left = [...ids];
  return () => left.shift() ?? `ID-${left.length}`;
};
const format = draftFormatFor("11.8.0")!;

describe("the draft JianYing 11.8 reads", () => {
  it("is, for the same two clips, the plain draft JianYing 11.8.0 listed, float for float", () => {
    const built = buildDraft(format, LISTED, idsFrom(LISTED_IDS));
    expect(built.timeline).toBe(compact(fixture("listed-draft_info.json")));
    expect(built.meta).toBe(compact(fixture("listed-draft_meta_info.json")));
  });

  it("puts the clips end to end on one video track, whole and at speed 1, each pointing at its file", () => {
    const timeline = JSON.parse(buildDraft(format, LISTED, idsFrom(LISTED_IDS)).timeline);
    expect(timeline.tracks).toHaveLength(1);
    expect(timeline.tracks[0].type).toBe("video");
    const segments = timeline.tracks[0].segments as Array<Record<string, any>>;
    expect(segments.map((one) => [one.target_timerange, one.source_timerange, one.speed])).toEqual([
      [{ start: 0, duration: 113_643_000 }, { start: 0, duration: 113_643_000 }, 1],
      [{ start: 113_643_000, duration: 14_033_333 }, { start: 0, duration: 14_033_333 }, 1],
    ]);
    expect(timeline.duration).toBe(127_676_333);
    const videos = timeline.materials.videos as Array<Record<string, any>>;
    expect(videos.map((one) => one.path)).toEqual(LISTED.clips.map((clip) => clip.path));
    expect(segments.map((one) => one.material_id)).toEqual(videos.map((one) => one.id));
    expect(segments.map((one) => one.extra_material_refs)).toEqual(timeline.materials.speeds.map((one: { id: string }) => [one.id]));
    expect(timeline.materials.speeds.every((one: { speed: number }) => one.speed === 1)).toBe(true);
  });

  it("takes the canvas size from the first clip and a frame rate JianYing offers, the nearest to the first clip's", () => {
    const rate = (fps: number | undefined) => JSON.parse(buildDraft(format, { ...LISTED, fps }, idsFrom([])).timeline).fps;
    expect(JSON.parse(buildDraft(format, LISTED, idsFrom([])).timeline).canvas_config).toMatchObject({ width: 900, height: 578 });
    expect([rate(53), rate(24), rate(29), rate(120), rate(12), rate(undefined)]).toEqual([50, 24, 30, 60, 24, 30]);
  });

  it("keeps every key of JianYing's own blank timeline, and builds each draft from a fresh one", () => {
    const blank = Object.keys(format.blank);
    const first = JSON.parse(buildDraft(format, LISTED, idsFrom([])).timeline);
    expect(Object.keys(first)).toEqual(blank);
    expect(Object.keys(first.materials)).toEqual(Object.keys(format.blank.materials as object));
    const empty = JSON.parse(buildDraft(format, { ...LISTED, clips: [LISTED.clips[1]!] }, idsFrom([])).timeline);
    expect(empty.materials.videos).toHaveLength(1);
    expect((format.blank.materials as { videos: unknown[] }).videos).toEqual([]);
  });

  it("writes paths with forward slashes, as JianYing on Windows does", () => {
    const plan: DraftPlan = {
      ...LISTED, root: "C:\\Users\\me\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
      folder: "C:\\Users\\me\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft\\Bride",
      clips: [{ ...LISTED.clips[0]!, path: "D:\\dramas\\Bride\\产出\\视频\\镜头1.mp4" }],
    };
    const built = buildDraft(format, plan, idsFrom([]), "win32");
    expect(JSON.parse(built.timeline).materials.videos[0].path).toBe("D:/dramas/Bride/产出/视频/镜头1.mp4");
    expect(JSON.parse(built.meta)).toMatchObject({
      draft_fold_path: "C:/Users/me/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft/Bride",
      draft_root_path: "C:/Users/me/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft",
    });
  });
});

describe("which JianYing the writer writes for", () => {
  it("knows 11.8 and nothing else", () => {
    expect(WRITABLE_JIANYING_VERSIONS).toEqual(["11.8"]);
    expect(draftFormatFor("11.8.0")).not.toBeNull();
    expect(draftFormatFor("11.8.3.1234")).not.toBeNull();
    for (const version of ["11.9.0", "11.80.0", "12.0.0", "5.9.0", "", "eleven"]) expect(draftFormatFor(version), version).toBeNull();
  });
});

describe("a draft folder's name", () => {
  it("is the project's name without anything that could leave the draft folder", () => {
    expect(draftFolderName("Stand-in bride")).toBe("Stand-in bride");
    expect(draftFolderName("替身新娘 第一集")).toBe("替身新娘 第一集");
    expect(draftFolderName("../../etc/passwd")).toBe("etcpasswd");
    expect(draftFolderName("..\\..\\Config")).toBe("Config");
    expect(draftFolderName("a/b\\c:d*e?f\"g<h>i|j")).toBe("abcdefghij");
    expect(draftFolderName("  .hidden. ")).toBe("hidden");
    expect(draftFolderName("line\nbreak\u0000")).toBe("linebreak");
  });

  it("is never empty, a Windows device or longer than a folder name may be", () => {
    expect(draftFolderName("")).toBe("MagicBot");
    expect(draftFolderName("...")).toBe("MagicBot");
    expect(draftFolderName("/")).toBe("MagicBot");
    expect(draftFolderName("CON")).toBe("_CON");
    expect(draftFolderName("nul.txt")).toBe("_nul.txt");
    expect([...draftFolderName("长".repeat(300))]).toHaveLength(80);
  });

  it("carries a number from the second draft on", () => {
    expect(numberedDraftName("Bride", 1)).toBe("Bride");
    expect(numberedDraftName("Bride", 2)).toBe("Bride 2");
    expect(numberedDraftName("Bride", 13)).toBe("Bride 13");
  });
});
