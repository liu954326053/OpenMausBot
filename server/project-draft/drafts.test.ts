import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { DraftShot } from "./canvas.ts";
import { ProjectDrafts } from "./drafts.ts";
import type { JianyingLookup } from "./jianying.ts";
import { draftRefusalOf } from "./refusal.ts";
import { ProjectTimelines } from "./store.ts";
import { fakeMp4, fileRef, MemoryDraftCanvas, type FakeMp4 } from "./testing.ts";

const OWNER = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
const BOT_SHELL = { kind: "loopback", scopes: ["admin"], trust: "service" } as unknown as RequestAuth;
const PAIRED = { kind: "session", scopes: ["admin"] } as unknown as RequestAuth;
const PHONE = { kind: "loopback", scopes: ["admin"], companionDevice: "phone-1" } as unknown as RequestAuth;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(options: { name?: string; onPersonsComputer?: boolean; timelineFile?: "draft_info.json" | "draft_content.json" } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "omb-drafts-")));
  dirs.push(base);
  const folder = join(base, "project");
  const draftRoot = join(base, "jianying drafts");
  mkdirSync(join(folder, "产出", "视频"), { recursive: true });
  mkdirSync(draftRoot);
  const project: TeamProjectWire = {
    id: "p1", name: options.name ?? "Stand-in bride", folder, section: "Stand-in bride", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "post"], follows: {},
  };
  const projects = [project];
  const canvas = new MemoryDraftCanvas();
  const state = {
    lookup: { state: "ready", install: { version: "11.8.0", app: "/Applications/VideoFusion-macOS.app", bundleId: "com.lemon.lvpro", draftRoot, timelineFile: options.timelineFile ?? "draft_info.json" } } as JianyingLookup,
    launched: [] as string[],
    launches: true,
    clock: 1_750_000_000_000,
    ids: 0,
  };
  const lines: string[] = [];
  const drafts = new ProjectDrafts({
    projects: { list: () => projects },
    canvas,
    store: new ProjectTimelines(join(base, "data", "project-timelines"), (line) => lines.push(line)),
    onPersonsComputer: options.onPersonsComputer ?? true,
    jianying: async () => state.lookup,
    launch: async (install) => {
      state.launched.push(install.app);
      return state.launches;
    },
    now: () => (state.clock += 1000),
    newId: () => `ID-${(state.ids += 1)}`,
    log: (line) => lines.push(line),
  });
  /** A take's video in the project's output folder, and the shot that selected it. */
  const shot = (shotId: string, video: FakeMp4 | null = {}, title = `镜头 ${shotId}`): DraftShot => {
    if (!video) return { shotId, title };
    const path = `产出/视频/${shotId}.mp4`;
    const bytes = fakeMp4(video);
    writeFileSync(join(folder, ...path.split("/")), bytes);
    return { shotId, title, take: { nodeId: `take-${shotId}`, title: `${shotId}.mp4`, file: fileRef(path, bytes.length) } };
  };
  const draftFolders = () => readdirSync(draftRoot).sort();
  const timelineOf = (name: string, file = options.timelineFile ?? "draft_info.json") => JSON.parse(readFileSync(join(draftRoot, name, file), "utf8"));
  const metaOf = (name: string) => JSON.parse(readFileSync(join(draftRoot, name, "draft_meta_info.json"), "utf8"));
  const paths = (name: string) => (timelineOf(name).materials.videos as Array<{ path: string }>).map((one) => one.path);
  return { base, folder, draftRoot, project, projects, canvas, state, lines, drafts, shot, draftFolders, timelineOf, metaOf, paths };
}

async function refusal(run: () => unknown) {
  try {
    await run();
  } catch (error) {
    return draftRefusalOf(error);
  }
  return null;
}

describe("a project's timeline", () => {
  it("is the shots' selected takes in the canvas's order, each measured from its own file", async () => {
    const { drafts, canvas, shot } = harness();
    canvas.set("p1", [shot("s1", { seconds: 4, width: 1920, height: 1080 }), shot("s2", null), shot("s3", { seconds: 2.5, width: 720, height: 1280 })]);
    expect(await drafts.timeline("p1")).toEqual({
      projectId: "p1",
      clips: [
        { shotId: "s1", nodeId: "take-s1", title: "镜头 s1", file: expect.objectContaining({ path: "产出/视频/s1.mp4", mime: "video/mp4" }), durationMs: 4000, width: 1920, height: 1080 },
        { shotId: "s3", nodeId: "take-s3", title: "镜头 s3", file: expect.objectContaining({ path: "产出/视频/s3.mp4" }), durationMs: 2500, width: 720, height: 1280 },
      ],
      missingShots: ["s2"],
    });
  });

  it("counts a shot as having no video when its take's file is gone, is not a video, or is not inside the project folder", async () => {
    const { drafts, canvas, shot, folder, base } = harness();
    const gone = shot("gone");
    rmSync(join(folder, "产出", "视频", "gone.mp4"));
    writeFileSync(join(folder, "产出", "视频", "notes.mp4"), "these are notes");
    writeFileSync(join(base, "outside.mp4"), fakeMp4());
    symlinkSync(join(base, "outside.mp4"), join(folder, "产出", "视频", "link.mp4"));
    const take = (shotId: string, path: string): DraftShot => ({ shotId, title: shotId, take: { nodeId: `take-${shotId}`, title: shotId, file: fileRef(path) } });
    canvas.set("p1", [shot("ok"), gone, take("text", "产出/视频/notes.mp4"), take("link", "产出/视频/link.mp4"), take("climb", "../outside.mp4"), take("absolute", join(base, "outside.mp4"))]);
    const timeline = await drafts.timeline("p1");
    expect(timeline.clips.map((clip) => clip.shotId)).toEqual(["ok"]);
    expect(timeline.missingShots).toEqual(["gone", "text", "link", "climb", "absolute"]);
  });

  it("takes from the canvas what a file does not say, and has no clip for a video of unknown length", async () => {
    const { drafts, canvas, folder } = harness();
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    writeFileSync(join(folder, "产出", "视频", "a.webm"), webm);
    writeFileSync(join(folder, "产出", "视频", "b.webm"), webm);
    canvas.set("p1", [
      { shotId: "s1", title: "One", take: { nodeId: "t1", title: "a", file: fileRef("产出/视频/a.webm"), durationMs: 3200, width: 640, height: 360 } },
      { shotId: "s2", title: "Two", take: { nodeId: "t2", title: "b", file: fileRef("产出/视频/b.webm") } },
    ]);
    const timeline = await drafts.timeline("p1");
    expect(timeline.clips).toEqual([expect.objectContaining({ shotId: "s1", durationMs: 3200, width: 640, height: 360, file: expect.objectContaining({ mime: "video/webm" }) })]);
    expect(timeline.missingShots).toEqual(["s2"]);
  });

  it("plays in the order set, tells who listens, and says which shots are left out", async () => {
    const { drafts, canvas, shot } = harness();
    canvas.set("p1", [shot("s1"), shot("s2"), shot("s3")]);
    const heard: string[] = [];
    drafts.onTimelineChange((projectId) => heard.push(projectId));
    const set = await drafts.setOrder("p1", { shotIds: ["s3", "s1"] });
    expect(set.clips.map((clip) => clip.shotId)).toEqual(["s3", "s1"]);
    expect(set.leftOut).toEqual(["s2"]);
    expect(heard).toEqual(["p1"]);
    canvas.set("p1", [shot("s1"), shot("s2"), shot("s3"), shot("s4")]);
    expect((await drafts.timeline("p1")).clips.map((clip) => clip.shotId)).toEqual(["s3", "s1", "s4"]);
  });

  it("refuses an order for a project that is gone or archived, or with a shot the project does not have", async () => {
    const { drafts, canvas, shot, project } = harness();
    canvas.set("p1", [shot("s1")]);
    expect(await refusal(() => drafts.timeline("nope"))).toMatchObject({ status: 404, body: { errorKey: "serverError.teamProject.notFound" } });
    expect(await refusal(() => drafts.setOrder("p1", { shotIds: ["s9"] }))).toMatchObject({ status: 422 });
    project.archivedAt = 5;
    expect(await refusal(() => drafts.setOrder("p1", { shotIds: ["s1"] }))).toMatchObject({ status: 409, body: { errorKey: "serverError.projectCanvas.archived" } });
    expect((await drafts.timeline("p1")).clips).toHaveLength(1);
  });
});

describe("writing a project's draft", () => {
  it("writes nothing while a shot has no selected take, or while there is no shot", async () => {
    const { drafts, canvas, shot, draftFolders } = harness();
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "none" });
    canvas.set("p1", [shot("s1"), shot("s2", null)]);
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "none" });
    expect(draftFolders()).toEqual([]);
  });

  it("writes a draft named after the project whose clips point at the videos in the project folder, in order", async () => {
    const { drafts, canvas, shot, folder, draftRoot, draftFolders, timelineOf, metaOf, paths } = harness();
    canvas.set("p1", [shot("s1", { seconds: 4, width: 1920, height: 1080, fps: 24 }), shot("s2", { seconds: 2 })]);
    const heard: string[] = [];
    drafts.onDraftChange((projectId) => heard.push(projectId));
    const wire = await drafts.writeDraftIfReady("p1");
    expect(wire).toEqual({ state: "written", name: "Stand-in bride", writtenAt: expect.any(Number), exportFolder: join(folder, "产出") });
    expect(draftFolders()).toEqual(["Stand-in bride"]);
    expect(readdirSync(join(draftRoot, "Stand-in bride")).sort()).toEqual(["draft_info.json", "draft_meta_info.json"]);
    expect(paths("Stand-in bride")).toEqual([join(folder, "产出", "视频", "s1.mp4"), join(folder, "产出", "视频", "s2.mp4")]);
    const timeline = timelineOf("Stand-in bride");
    expect(timeline).toMatchObject({ duration: 6_000_000, fps: 24, canvas_config: { width: 1920, height: 1080 } });
    expect(timeline.tracks[0].segments.map((one: { target_timerange: unknown }) => one.target_timerange)).toEqual([{ start: 0, duration: 4_000_000 }, { start: 4_000_000, duration: 2_000_000 }]);
    expect(metaOf("Stand-in bride")).toMatchObject({ draft_name: "Stand-in bride", draft_fold_path: join(draftRoot, "Stand-in bride"), draft_root_path: draftRoot, tm_duration: 6_000_000 });
    expect(heard).toEqual(["p1"]);
    expect(drafts.draftWire("p1", OWNER)).toEqual(wire);
  });

  it("copies no video: the draft folder holds two small files and the project folder is as it was", async () => {
    const { drafts, canvas, shot, folder, draftRoot } = harness();
    canvas.set("p1", [shot("s1", { mediaBytes: 500_000 })]);
    const before = readdirSync(join(folder, "产出", "视频"));
    await drafts.writeDraftIfReady("p1");
    const written = readdirSync(join(draftRoot, "Stand-in bride")).map((name) => readFileSync(join(draftRoot, "Stand-in bride", name)).length);
    expect(Math.max(...written)).toBeLessThan(50_000);
    expect(readdirSync(join(folder, "产出", "视频"))).toEqual(before);
    expect(readdirSync(folder)).toEqual(["产出"]);
  });

  it("writes Windows' timeline file under its own name", async () => {
    const { drafts, canvas, shot, draftRoot } = harness({ timelineFile: "draft_content.json" });
    canvas.set("p1", [shot("s1")]);
    await drafts.writeDraftIfReady("p1");
    expect(readdirSync(join(draftRoot, "Stand-in bride")).sort()).toEqual(["draft_content.json", "draft_meta_info.json"]);
  });

  it("leaves a draft that holds what it wrote alone while nothing changed", async () => {
    const { drafts, canvas, shot, draftRoot } = harness();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    const first = await drafts.writeDraftIfReady("p1");
    const file = join(draftRoot, "Stand-in bride", "draft_info.json");
    const before = readFileSync(file, "utf8");
    const heard: string[] = [];
    drafts.onDraftChange((projectId) => heard.push(projectId));
    expect(await drafts.writeDraftIfReady("p1")).toEqual(first);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(heard).toEqual([]);
  });

  it("writes the draft again in place when the timeline changed and JianYing did not save it", async () => {
    const { drafts, canvas, shot, draftFolders, metaOf, paths, folder } = harness();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    const first = await drafts.writeDraftIfReady("p1");
    const id = metaOf("Stand-in bride").draft_id;
    const created = metaOf("Stand-in bride").tm_draft_create;
    await drafts.setOrder("p1", { shotIds: ["s2", "s1"] });
    expect(draftFolders()).toEqual(["Stand-in bride"]);
    expect(paths("Stand-in bride")).toEqual([join(folder, "产出", "视频", "s2.mp4"), join(folder, "产出", "视频", "s1.mp4")]);
    expect(metaOf("Stand-in bride")).toMatchObject({ draft_id: id, tm_draft_create: created });
    expect(metaOf("Stand-in bride").tm_draft_modified).toBeGreaterThan(created);
    const wire = drafts.draftWire("p1", OWNER);
    expect(wire).toMatchObject({ state: "written", name: "Stand-in bride" });
    expect(wire.writtenAt).toBeGreaterThan(first.writtenAt!);
  });

  it("writes it again when a shot's selected take is another file", async () => {
    const { drafts, canvas, shot, folder, paths } = harness();
    canvas.set("p1", [shot("s1")]);
    await drafts.writeDraftIfReady("p1");
    writeFileSync(join(folder, "产出", "视频", "s1-take2.mp4"), fakeMp4({ seconds: 7 }));
    canvas.set("p1", [{ shotId: "s1", title: "镜头 s1", take: { nodeId: "take-2", title: "take 2", file: fileRef("产出/视频/s1-take2.mp4") } }]);
    await drafts.writeDraftIfReady("p1");
    expect(paths("Stand-in bride")).toEqual([join(folder, "产出", "视频", "s1-take2.mp4")]);
  });

  it("leaves a draft JianYing saved as it is and writes the next one beside it, numbered", async () => {
    const { drafts, canvas, shot, draftRoot, draftFolders, paths, folder } = harness();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    await drafts.writeDraftIfReady("p1");
    const saved = "c42EuxKG16jR2P8e what JianYing writes when it saves";
    writeFileSync(join(draftRoot, "Stand-in bride", "draft_info.json"), saved);
    writeFileSync(join(draftRoot, "Stand-in bride", "draft.extra"), "JianYing's own");
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "written", name: "Stand-in bride" });

    await drafts.setOrder("p1", { shotIds: ["s2", "s1"] });
    expect(draftFolders()).toEqual(["Stand-in bride", "Stand-in bride 2"]);
    expect(readFileSync(join(draftRoot, "Stand-in bride", "draft_info.json"), "utf8")).toBe(saved);
    expect(readdirSync(join(draftRoot, "Stand-in bride")).sort()).toEqual(["draft.extra", "draft_info.json", "draft_meta_info.json"]);
    expect(paths("Stand-in bride 2")).toEqual([join(folder, "产出", "视频", "s2.mp4"), join(folder, "产出", "视频", "s1.mp4")]);
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "kept", name: "Stand-in bride 2" });

    await drafts.setOrder("p1", { shotIds: ["s1", "s2"] });
    expect(draftFolders()).toEqual(["Stand-in bride", "Stand-in bride 2"]);
    expect(paths("Stand-in bride 2")).toEqual([join(folder, "产出", "视频", "s1.mp4"), join(folder, "产出", "视频", "s2.mp4")]);
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "kept", name: "Stand-in bride 2" });

    writeFileSync(join(draftRoot, "Stand-in bride 2", "draft_info.json"), saved);
    await drafts.setOrder("p1", { shotIds: ["s2"] });
    expect(draftFolders()).toEqual(["Stand-in bride", "Stand-in bride 2", "Stand-in bride 3"]);
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "kept", name: "Stand-in bride 3" });
  });

  it("does not bring back a draft the person deleted until the timeline changes", async () => {
    const { drafts, canvas, shot, draftRoot, draftFolders } = harness();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    await drafts.writeDraftIfReady("p1");
    rmSync(join(draftRoot, "Stand-in bride"), { recursive: true });
    await drafts.writeDraftIfReady("p1");
    expect(draftFolders()).toEqual([]);
    await drafts.setOrder("p1", { shotIds: ["s2", "s1"] });
    expect(draftFolders()).toEqual(["Stand-in bride"]);
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "written", name: "Stand-in bride" });
  });

  it("never writes into a folder it did not make: a draft or a link already under the project's name is left alone", async () => {
    const { drafts, canvas, shot, draftRoot, draftFolders, base } = harness();
    mkdirSync(join(draftRoot, "Stand-in bride"));
    writeFileSync(join(draftRoot, "Stand-in bride", "draft_info.json"), "the person's own draft");
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(draftRoot, "Stand-in bride 2"));
    canvas.set("p1", [shot("s1")]);
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "written", name: "Stand-in bride 3" });
    expect(draftFolders()).toEqual(["Stand-in bride", "Stand-in bride 2", "Stand-in bride 3"]);
    expect(readFileSync(join(draftRoot, "Stand-in bride", "draft_info.json"), "utf8")).toBe("the person's own draft");
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("names the folder without the path characters of a project's name, so it stays inside the draft folder", async () => {
    const { drafts, canvas, shot, draftRoot, base, draftFolders } = harness({ name: "../../逃 出/去" });
    canvas.set("p1", [shot("s1")]);
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "written", name: "逃 出去" });
    expect(draftFolders()).toEqual(["逃 出去"]);
    expect(readdirSync(base).sort()).toEqual(["data", "jianying drafts", "project"]);
    expect(readdirSync(dirname(draftRoot)).sort()).toEqual(["data", "jianying drafts", "project"]);
  });

  it("writes one draft when asked twice at once", async () => {
    const { drafts, canvas, shot, draftFolders } = harness();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    const [one, two] = await Promise.all([drafts.writeDraftIfReady("p1"), drafts.writeDraftIfReady("p1")]);
    expect(one).toEqual(two);
    expect(draftFolders()).toEqual(["Stand-in bride"]);
  });

  it("starts a draft in the folder JianYing lists drafts from now, when the person moved it", async () => {
    const { drafts, canvas, shot, state, base, draftFolders } = harness();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    await drafts.writeDraftIfReady("p1");
    const moved = join(base, "moved drafts");
    mkdirSync(moved);
    state.lookup = { state: "ready", install: { version: "11.8.0", app: "/Applications/VideoFusion-macOS.app", draftRoot: moved, timelineFile: "draft_info.json" } };
    await drafts.setOrder("p1", { shotIds: ["s2", "s1"] });
    expect(readdirSync(moved)).toEqual(["Stand-in bride"]);
    expect(draftFolders()).toEqual(["Stand-in bride"]);
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "written", name: "Stand-in bride" });
  });

  it("writes nothing for an archived project, or one whose folder is not there", async () => {
    const { drafts, canvas, shot, project, draftFolders } = harness();
    canvas.set("p1", [shot("s1")]);
    project.archivedAt = 9;
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "none" });
    delete project.archivedAt;
    project.folderState = "missing";
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "none" });
    expect(draftFolders()).toEqual([]);
  });
});

describe("where there is no JianYing to write for", () => {
  it("writes nothing on a server that is not on the person's own computer, and says so", async () => {
    const { drafts, canvas, shot, draftFolders, folder } = harness({ onPersonsComputer: false });
    canvas.set("p1", [shot("s1")]);
    expect(await drafts.writeDraftIfReady("p1")).toEqual({ state: "unavailable", reason: "remote", exportFolder: join(folder, "产出") });
    expect(draftFolders()).toEqual([]);
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "unavailable", reason: "remote" });
  });

  it("tells a person who is not at this computer that the draft is elsewhere, written or not", async () => {
    const { drafts, canvas, shot } = harness();
    canvas.set("p1", [shot("s1")]);
    await drafts.writeDraftIfReady("p1");
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "written" });
    for (const auth of [PAIRED, BOT_SHELL, PHONE]) expect(drafts.draftWire("p1", auth)).toEqual({ state: "unavailable", reason: "remote", exportFolder: expect.any(String) });
  });

  it("writes nothing without JianYing, or for a version the writer does not know", async () => {
    const { drafts, canvas, shot, state, draftFolders } = harness();
    canvas.set("p1", [shot("s1")]);
    state.lookup = { state: "unavailable", reason: "not-installed" };
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "unavailable", reason: "not-installed" });
    state.lookup = { state: "unavailable", reason: "unsupported-version", version: "12.0.0" };
    expect(await drafts.writeDraftIfReady("p1")).toMatchObject({ state: "unavailable", reason: "unsupported-version" });
    expect(draftFolders()).toEqual([]);
  });

  it("answers not installed before it has looked for JianYing", () => {
    const { drafts } = harness();
    expect(drafts.draftWire("p1", OWNER)).toMatchObject({ state: "unavailable", reason: "not-installed" });
  });
});

describe("opening JianYing", () => {
  it("brings the app to the front and says it opened the app, not the draft", async () => {
    const { drafts, canvas, shot, state } = harness();
    canvas.set("p1", [shot("s1")]);
    await drafts.writeDraftIfReady("p1");
    expect(await drafts.open("p1", OWNER)).toEqual({ opened: "app" });
    expect(state.launched).toEqual(["/Applications/VideoFusion-macOS.app"]);
  });

  it("is refused for a person at another computer, without JianYing, and when JianYing does not start", async () => {
    const { drafts, state } = harness();
    expect(await refusal(() => drafts.open("p1", PAIRED))).toMatchObject({ status: 409, body: { errorKey: "serverError.projectDraft.remote" } });
    state.lookup = { state: "unavailable", reason: "not-installed" };
    expect(await refusal(() => drafts.open("p1", OWNER))).toMatchObject({ status: 409, body: { errorKey: "serverError.projectDraft.notInstalled" } });
    state.lookup = { state: "unavailable", reason: "unsupported-version" };
    expect(await refusal(() => drafts.open("p1", OWNER))).toMatchObject({ status: 409, body: { errorKey: "serverError.projectDraft.unsupportedVersion" } });
    expect(state.launched).toEqual([]);
    const working = harness();
    working.state.launches = false;
    expect(await refusal(() => working.drafts.open("p1", OWNER))).toMatchObject({ status: 502, body: { errorKey: "serverError.projectDraft.openFailed" } });
    expect(await refusal(() => working.drafts.open("nope", OWNER))).toMatchObject({ status: 404 });
  });
});

describe("the finished film the person names", () => {
  it("goes to the canvas as the file it is, whatever its name says", async () => {
    const { drafts, canvas, folder } = harness();
    const bytes = fakeMp4({ seconds: 61, width: 1080, height: 1920 });
    writeFileSync(join(folder, "产出", "成片.bin"), bytes);
    expect(await drafts.final("p1", { path: "产出/成片.bin" })).toEqual({ nodeId: "final-1" });
    expect(canvas.finals).toEqual([{
      projectId: "p1",
      film: { file: { path: "产出/成片.bin", mime: "video/mp4", bytes: bytes.length, name: "成片.bin" }, durationMs: 61_000, width: 1080, height: 1920 },
    }]);
  });

  it("is refused outside the project folder, when it is not there, and when it is not a video", async () => {
    const { drafts, canvas, folder, base, project } = harness();
    writeFileSync(join(base, "outside.mp4"), fakeMp4());
    symlinkSync(join(base, "outside.mp4"), join(folder, "产出", "link.mp4"));
    writeFileSync(join(folder, "产出", "film.mp4"), "words, not pictures");
    expect(await refusal(() => drafts.final("p1", { path: "../outside.mp4" }))).toMatchObject({ status: 400, body: { errorKey: "serverError.projectCanvas.outsideFolder" } });
    expect(await refusal(() => drafts.final("p1", { path: join(base, "outside.mp4") }))).toMatchObject({ status: 400, body: { errorKey: "serverError.projectCanvas.outsideFolder" } });
    expect(await refusal(() => drafts.final("p1", { path: "产出/link.mp4" }))).toMatchObject({ status: 403, body: { errorKey: "serverError.projectCanvas.outsideFolder" } });
    expect(await refusal(() => drafts.final("p1", { path: "产出/none.mp4" }))).toMatchObject({ status: 404, body: { errorKey: "serverError.projectCanvas.fileMissing" } });
    expect(await refusal(() => drafts.final("p1", { path: "产出/film.mp4" }))).toMatchObject({ status: 422, body: { errorKey: "serverError.projectDraft.notVideo" } });
    expect(await refusal(() => drafts.final("p1", {}))).toMatchObject({ status: 400 });
    project.archivedAt = 3;
    writeFileSync(join(folder, "产出", "real.mp4"), fakeMp4());
    expect(await refusal(() => drafts.final("p1", { path: "产出/real.mp4" }))).toMatchObject({ status: 409, body: { errorKey: "serverError.projectCanvas.archived" } });
    expect(canvas.finals).toEqual([]);
  });

  it("answers as the canvas does when the canvas refuses it", async () => {
    const { drafts, canvas, folder } = harness();
    writeFileSync(join(folder, "产出", "film.mp4"), fakeMp4());
    canvas.refuseFinal = Object.assign(new Error("The canvas is full."), { status: 409, body: { code: "canvas_full" } });
    expect(await refusal(() => drafts.final("p1", { path: "产出/film.mp4" }))).toEqual({ status: 409, body: { error: "The canvas is full.", code: "canvas_full" } });
  });
});

describe("the finished film appearing in the output folder", () => {
  const settle = async (drafts: ProjectDrafts) => {
    await drafts.lookForFinals();
    await drafts.lookForFinals();
  };
  async function written() {
    const made = harness();
    made.canvas.set("p1", [made.shot("s1")]);
    await made.drafts.writeDraftIfReady("p1");
    return made;
  }

  it("is handed to the canvas once its size has stopped changing", async () => {
    const { drafts, canvas, folder } = await written();
    const film = join(folder, "产出", "成片.mp4");
    const whole = fakeMp4({ seconds: 30, mediaBytes: 4000, mediaFirst: true });
    writeFileSync(film, whole.subarray(0, 2000));
    await drafts.lookForFinals();
    writeFileSync(film, whole.subarray(0, 3500));
    await drafts.lookForFinals();
    expect(canvas.finals).toEqual([]);
    writeFileSync(film, whole);
    await drafts.lookForFinals();
    expect(canvas.finals).toEqual([]);
    await drafts.lookForFinals();
    expect(canvas.finals).toEqual([{ projectId: "p1", film: { file: { path: "产出/成片.mp4", mime: "video/mp4", bytes: whole.length, name: "成片.mp4" }, durationMs: 30_000, width: 1280, height: 720 } }]);
    await settle(drafts);
    expect(canvas.finals).toHaveLength(1);
  });

  it("waits for an MP4 whose export stalled before its header was written", async () => {
    const { drafts, canvas, folder } = await written();
    const film = join(folder, "产出", "成片.mp4");
    const whole = fakeMp4({ mediaBytes: 4000, mediaFirst: true });
    writeFileSync(film, whole.subarray(0, 3000));
    await settle(drafts);
    await settle(drafts);
    expect(canvas.finals).toEqual([]);
    writeFileSync(film, whole);
    await settle(drafts);
    expect(canvas.finals).toHaveLength(1);
  });

  it("knows a video by its content: a text file named .mp4 is no film, a video with no extension is", async () => {
    const { drafts, canvas, folder } = await written();
    writeFileSync(join(folder, "产出", "notes.mp4"), "the shooting notes");
    writeFileSync(join(folder, "产出", "成片"), fakeMp4());
    await settle(drafts);
    expect(canvas.finals.map((one) => one.film.file.path)).toEqual(["产出/成片"]);
  });

  it("passes over a file a node of the canvas already shows, and what this app generated into the output's own folders", async () => {
    const { drafts, canvas, folder } = await written();
    writeFileSync(join(folder, "产出", "handed-over.mp4"), fakeMp4());
    canvas.show("p1", "产出/handed-over.mp4");
    writeFileSync(join(folder, "产出", "视频", "generated-later.mp4"), fakeMp4());
    await settle(drafts);
    expect(canvas.finals).toEqual([]);
  });

  it("passes over a video that was in the output folder before the first draft was written", async () => {
    const made = harness();
    const old = join(made.folder, "产出", "old.mp4");
    writeFileSync(old, fakeMp4());
    utimesSync(old, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    made.canvas.set("p1", [made.shot("s1")]);
    await made.drafts.writeDraftIfReady("p1");
    await settle(made.drafts);
    expect(made.canvas.finals).toEqual([]);
  });

  it("looks at no project without a draft, and at none that is archived", async () => {
    const made = harness();
    writeFileSync(join(made.folder, "产出", "film.mp4"), fakeMp4());
    await settle(made.drafts);
    expect(made.canvas.finals).toEqual([]);
    const { drafts, canvas, folder, project } = await written();
    project.archivedAt = 4;
    writeFileSync(join(folder, "产出", "film.mp4"), fakeMp4());
    await settle(drafts);
    expect(canvas.finals).toEqual([]);
  });

  it("does not follow a link out of the project folder", async () => {
    const { drafts, canvas, folder, base } = await written();
    writeFileSync(join(base, "outside.mp4"), fakeMp4());
    symlinkSync(join(base, "outside.mp4"), join(folder, "产出", "link.mp4"));
    await settle(drafts);
    expect(canvas.finals).toEqual([]);
  });

  it("tries a film the canvas refused once, and again only when the file changes", async () => {
    const { drafts, canvas, folder, lines } = await written();
    const film = join(folder, "产出", "成片.mp4");
    writeFileSync(film, fakeMp4());
    canvas.refuseFinal = new Error("no room");
    await settle(drafts);
    await settle(drafts);
    expect(lines.filter((line) => line.includes("finished film"))).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(folder);
    canvas.refuseFinal = null;
    await settle(drafts);
    expect(canvas.finals).toEqual([]);
    writeFileSync(film, fakeMp4({ seconds: 9 }));
    await settle(drafts);
    expect(canvas.finals).toHaveLength(1);
  });
});

describe("what a draft's record tells", () => {
  it("remembers the hash of the timeline file it wrote", async () => {
    const { drafts, canvas, shot, draftRoot, base } = harness();
    canvas.set("p1", [shot("s1")]);
    await drafts.writeDraftIfReady("p1");
    const stored = JSON.parse(readFileSync(join(base, "data", "project-timelines", "p1.json"), "utf8"));
    const hash = createHash("sha256").update(readFileSync(join(draftRoot, "Stand-in bride", "draft_info.json"))).digest("hex");
    expect(stored.draft).toMatchObject({ name: "Stand-in bride", number: 1, folder: join(draftRoot, "Stand-in bride"), fileHash: hash });
    expect(existsSync(join(base, "project", ".magic-team"))).toBe(false);
  });
});
