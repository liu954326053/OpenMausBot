import type { CanvasFileRef } from "../../shared/project-canvas.ts";
import type { DraftShot, FinishedFilm, ProjectDraftCanvas } from "./canvas.ts";

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

  async addFinal(projectId: string, film: FinishedFilm): Promise<{ nodeId: string }> {
    if (this.refuseFinal) throw this.refuseFinal;
    this.finals.push({ projectId, film });
    this.show(projectId, film.file.path);
    return { nodeId: `final-${this.finals.length}` };
  }
}

export const fileRef = (path: string, bytes = 0): CanvasFileRef => ({ path, mime: "video/mp4", bytes, name: path.split("/").at(-1)! });
