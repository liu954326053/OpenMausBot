import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanProjectPath, createProjectFile, openProjectFile, safeFileName } from "./paths.ts";

let dir: string;
let project: string;
let outside: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-paths-")));
  project = join(dir, "Stand-in bride");
  outside = join(dir, "outside");
  mkdirSync(join(project, ".magic-team"), { recursive: true });
  mkdirSync(join(project, "素材"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(project, "素材", "bride.png"), "png bytes");
  writeFileSync(join(project, ".magic-team", "team.json"), "{}");
  writeFileSync(join(outside, "secret.txt"), "not yours");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const { status, code } = error as { status: number; code: string };
    return { status, code };
  }
  throw new Error("expected a refusal");
}

describe("a path a person or a bot names in the project folder", () => {
  it("is kept when it is relative and stays inside", () => {
    expect(cleanProjectPath("素材/bride.png")).toBe("素材/bride.png");
    expect(cleanProjectPath("episode 1/shots/one.mp4")).toBe("episode 1/shots/one.mp4");
  });

  it.each([
    ["", "empty"],
    ["/etc/passwd", "absolute"],
    ["C:/Windows/win.ini", "a drive"],
    ["..", "the parent"],
    ["素材/../../outside/secret.txt", "a parent step"],
    ["./素材/bride.png", "a dot step"],
    ["素材//bride.png", "an empty step"],
    ["素材\\bride.png", "a backslash"],
    ["素材/bride.png\n", "a control character"],
    [".magic-team/team.json", "the app's own folder"],
    [".Magic-Team/team.json", "the app's own folder in other letters"],
    ["notes/.magicbot-secrets/key", "a secret folder"],
  ])("is refused when it is %j (%s)", (input) => {
    expect(cleanProjectPath(input)).toBeNull();
  });

  it("is refused when it is not text", () => {
    expect(cleanProjectPath(undefined)).toBeNull();
    expect(cleanProjectPath(["素材/bride.png"])).toBeNull();
  });
});

describe("reading a file of the project", () => {
  it("opens a file inside the folder", async () => {
    const opened = await openProjectFile(project, "素材/bride.png", 1024);
    try {
      expect(opened.bytes).toBe("png bytes".length);
      expect(opened.name).toBe("bride.png");
      expect(opened.mime).toBe("image/png");
      expect(opened.path).toBe("素材/bride.png");
    } finally {
      await opened.handle.close();
    }
  });

  it("follows a link that stays inside the folder", async () => {
    symlinkSync(join(project, "素材", "bride.png"), join(project, "cover.png"));
    const opened = await openProjectFile(project, "cover.png", 1024);
    await opened.handle.close();
    expect(opened.path).toBe("素材/bride.png");
  });

  it("refuses a link that leads out of the folder", async () => {
    symlinkSync(join(outside, "secret.txt"), join(project, "素材", "secret.txt"));
    expect(await refusal(openProjectFile(project, "素材/secret.txt", 1024))).toEqual({ status: 403, code: "outside_project" });
  });

  it("refuses a folder link that leads out of the folder", async () => {
    symlinkSync(outside, join(project, "elsewhere"));
    expect(await refusal(openProjectFile(project, "elsewhere/secret.txt", 1024))).toEqual({ status: 403, code: "outside_project" });
  });

  it("refuses a link into the app's own folder", async () => {
    symlinkSync(join(project, ".magic-team"), join(project, "team"));
    expect(await refusal(openProjectFile(project, "team/team.json", 1024))).toEqual({ status: 403, code: "team_folder" });
  });

  it("refuses a path that leaves the folder, before touching the disk", async () => {
    expect(await refusal(openProjectFile(project, "../outside/secret.txt", 1024))).toEqual({ status: 400, code: "invalid_path" });
    expect(await refusal(openProjectFile(project, join(outside, "secret.txt"), 1024))).toEqual({ status: 400, code: "invalid_path" });
  });

  it("refuses a folder, a missing file, a file over the limit and a missing project folder", async () => {
    expect(await refusal(openProjectFile(project, "素材", 1024))).toEqual({ status: 400, code: "not_file" });
    expect(await refusal(openProjectFile(project, "素材/none.png", 1024))).toEqual({ status: 404, code: "not_found" });
    expect(await refusal(openProjectFile(project, "素材/bride.png", 3))).toEqual({ status: 413, code: "too_large" });
    expect(await refusal(openProjectFile(join(dir, "gone"), "素材/bride.png", 1024))).toEqual({ status: 409, code: "folder_missing" });
  });
});

describe("writing a new file into the project", () => {
  it("makes the folder when it is missing and never replaces a file", async () => {
    const first = await createProjectFile(project, "产出", "shot 1.mp4");
    await first.handle.writeFile("one");
    await first.handle.close();
    const second = await createProjectFile(project, "产出", "shot 1.mp4");
    await second.handle.writeFile("two");
    await second.handle.close();
    expect(first.path).toBe("产出/shot 1.mp4");
    expect(second.path).toBe("产出/shot 1-2.mp4");
    expect(readFileSync(join(project, "产出", "shot 1.mp4"), "utf8")).toBe("one");
    expect(readFileSync(join(project, "产出", "shot 1-2.mp4"), "utf8")).toBe("two");
  });

  it("never writes through a link that already holds the name", async () => {
    symlinkSync(join(outside, "secret.txt"), join(project, "素材", "notes.txt"));
    const created = await createProjectFile(project, "素材", "notes.txt");
    await created.handle.writeFile("mine");
    await created.handle.close();
    expect(created.path).toBe("素材/notes-2.txt");
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("not yours");
  });

  it("refuses a target folder that is a link leading out", async () => {
    rmSync(join(project, "素材"), { recursive: true });
    symlinkSync(outside, join(project, "素材"));
    expect(await refusal(createProjectFile(project, "素材", "bride.png"))).toEqual({ status: 403, code: "outside_project" });
    expect(readdirSync(outside)).toEqual(["secret.txt"]);
  });

  it("refuses the app's own folder and a missing project folder", async () => {
    expect(await refusal(createProjectFile(project, ".magic-team", "x.txt"))).toEqual({ status: 400, code: "invalid_path" });
    expect(await refusal(createProjectFile(join(dir, "gone"), "素材", "x.txt"))).toEqual({ status: 409, code: "folder_missing" });
    expect(existsSync(join(dir, "gone"))).toBe(false);
  });
});

describe("the name a new file gets", () => {
  it("keeps only the last part of what was asked, visible and bounded", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\bride.png")).toBe("bride.png");
    expect(safeFileName(".env")).toBe("env");
    expect(safeFileName("a\u0000b\nc.txt")).toBe("abc.txt");
    expect(safeFileName("")).toBe("file");
    expect(safeFileName("..")).toBe("file");
    expect(safeFileName("con.txt")).toBe("_con.txt");
    expect(safeFileName("what?.png")).toBe("what_.png");
    const long = safeFileName(`${"镜".repeat(200)}.mp4`);
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(180);
    expect(long.endsWith(".mp4")).toBe(true);
  });
});
