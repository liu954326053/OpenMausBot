import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CanvasFileRef } from "../../shared/project-canvas.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { DraftShot, FinishedFilm, ProjectDraftCanvas } from "./canvas.ts";
import { ProjectDrafts } from "./drafts.ts";
import type { JianyingLookup } from "./jianying.ts";
import { ProjectTimelines } from "./store.ts";

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

const u32 = (...values: number[]) => {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => out.writeUInt32BE(value, index * 4));
  return out;
};

const UPRIGHT = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
const QUARTER_TURN = [0, 0x10000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000];

export interface FakeMp4 {
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** The picture is stored on its side, as a phone records it. */
  turned?: boolean;
  /** A QuickTime file: its track names a data handler after its media handler. */
  quickTime?: boolean;
  /** Bytes of media after the header. */
  mediaBytes?: number;
  /** The media comes before the header, as in a file not made for streaming. */
  mediaFirst?: boolean;
}

/** A file with an MP4's header and no pictures: enough for what reads a video's length, size and frame rate. */
export function fakeMp4(options: FakeMp4 = {}): Buffer {
  const { seconds = 2, width = 1280, height = 720, fps = 30, turned = false, quickTime = false, mediaBytes = 64, mediaFirst = false } = options;
  const timescale = 600;
  const mediaScale = fps * 1000;
  const frames = Math.round(seconds * fps);
  const mvhd = box("mvhd", u32(0, 0, 0, timescale, Math.round(seconds * timescale)), Buffer.alloc(80));
  const tkhd = box("tkhd", u32(3, 0, 0, 1, 0, Math.round(seconds * timescale), 0, 0, 0, 0), u32(...(turned ? QUARTER_TURN : UPRIGHT)), u32(width * 0x10000, height * 0x10000));
  const mdhd = box("mdhd", u32(0, 0, 0, mediaScale, frames * 1000), Buffer.alloc(4));
  const hdlr = box("hdlr", u32(0, 0), Buffer.from("vide", "latin1"), Buffer.alloc(13));
  const stts = box("stts", u32(0, 1, frames, 1000));
  const dataHandler = quickTime ? [box("hdlr", u32(0), Buffer.from("dhlralis", "latin1"), Buffer.alloc(13))] : [];
  const moov = box("moov", mvhd, box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", ...dataHandler, box("stbl", stts)))));
  const ftyp = box("ftyp", Buffer.from(quickTime ? "qt  " : "isom", "latin1"), u32(0x200), Buffer.from("isomiso2mp41", "latin1"));
  const mdat = box("mdat", Buffer.alloc(mediaBytes, 7));
  return Buffer.concat(mediaFirst ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

/** The canvas as the draft module sees it, held in memory. */
export class MemoryDraftCanvas implements ProjectDraftCanvas {
  readonly finals: Array<{ projectId: string; film: FinishedFilm }> = [];
  private readonly byProject = new Map<string, DraftShot[]>();
  private readonly shown = new Map<string, Set<string>>();
  refuseFinal: Error | null = null;

  set(projectId: string, shots: DraftShot[]): void {
    this.byProject.set(projectId, shots);
  }

  show(projectId: string, path: string): void {
    this.shown.set(projectId, (this.shown.get(projectId) ?? new Set()).add(path));
  }

  shots(projectId: string): DraftShot[] {
    return this.byProject.get(projectId) ?? [];
  }

  showsFile(projectId: string, path: string): boolean {
    return (this.shown.get(projectId)?.has(path) ?? false) || this.shots(projectId).some((shot) => shot.take?.file.path === path);
  }

  async addFinal(projectId: string, path: string, film: FinishedFilm): Promise<{ nodeId: string }> {
    if (this.refuseFinal) throw this.refuseFinal;
    this.finals.push({ projectId, film });
    this.show(projectId, path);
    return { nodeId: `final-${this.finals.length}` };
  }
}

export const fileRef = (path: string, bytes = 0): CanvasFileRef => ({ path, mime: "video/mp4", bytes, name: path.split("/").at(-1)! });

export interface DraftsHarnessOptions {
  name?: string;
  onPersonsComputer?: boolean;
  timelineFile?: "draft_info.json" | "draft_content.json";
}

/** One project in a throwaway folder, a throwaway folder standing for JianYing's drafts, and the drafts over both. */
export function draftsHarness(options: DraftsHarnessOptions = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "omb-drafts-")));
  const folder = join(base, "project");
  const draftRoot = join(base, "jianying drafts");
  mkdirSync(join(folder, "产出", "视频"), { recursive: true });
  mkdirSync(draftRoot);
  const project: TeamProjectWire = {
    id: "p1", name: options.name ?? "Stand-in bride", folder, section: "Stand-in bride", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "post"], follows: {}, episodeBots: {},
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
  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { cleanup, base, folder, draftRoot, project, projects, canvas, state, lines, drafts, shot, draftFolders, timelineOf, metaOf, paths };
}

