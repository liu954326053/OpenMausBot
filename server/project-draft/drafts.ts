import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CANVAS_OUTPUT_FOLDER, type CanvasReadOnly } from "../../shared/project-canvas.ts";
import type { ProjectDraftOpenResult, ProjectDraftWire, ProjectFinalResult, ProjectTimelineWire, TimelineClip } from "../../shared/project-draft.ts";
import type { TeamProjectsApi, TeamProjectWire } from "../../shared/team-projects.ts";
import { writeFileAtomic } from "../atomic.ts";
import { isProjectPathError, openProjectFile, type ProjectPathError } from "../project-canvas/paths.ts";
import type { RequestAuth } from "../request-auth.ts";
import { userError } from "../user-errors.ts";
import type { DraftShot, FinishedFilm, ProjectDraftCanvas } from "./canvas.ts";
import { buildDraft, draftFolderName, draftFormatFor, numberedDraftName } from "./draft-file.ts";
import type { JianyingInstall, JianyingLookup } from "./jianying.ts";
import { DraftRefusal, refuse } from "./refusal.ts";
import type { ProjectTimelines, WrittenDraft } from "./store.ts";
import { arrangedShots, orderFrom } from "./timeline.ts";
import { videoFacts, type VideoFacts } from "./video-file.ts";

export interface ProjectDraftsDeps {
  projects: Pick<TeamProjectsApi, "list">;
  canvas: ProjectDraftCanvas;
  store: ProjectTimelines;
  /** This server runs on the computer the person sits at, so JianYing's folders here are the person's. */
  onPersonsComputer: boolean;
  jianying(): Promise<JianyingLookup>;
  /** Brings JianYing to the front; false when it did not start. */
  launch(install: JianyingInstall): Promise<boolean>;
  now(): number;
  newId(): string;
  log(line: string): void;
}

interface ReadClip extends TimelineClip {
  /** Where the file really is. */
  absolute: string;
  durationUs: number;
  fps?: number;
}

interface ReadTimeline {
  clips: ReadClip[];
  missing: string[];
  leftOut: string[];
}

const META_FILE = "draft_meta_info.json";
const TIMELINE_MAX_BYTES = 64 * 1024 * 1024;
const NUMBERS_TRIED = 1000;

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** The desktop app's own window, or a trusted caller on this machine: never a paired device, a phone that came in
 * through the companion, or a bot's shell. */
const atThisComputer = (auth: RequestAuth) => auth.kind === "loopback" && auth.trust !== "service" && auth.companionDevice === undefined;

function pathRefusal(error: ProjectPathError, folder: string): DraftRefusal {
  if (error.code === "folder_missing") return refuse(409, "serverError.projectCanvas.folderMissing", { folder });
  if (error.code === "not_found" || error.code === "not_file" || error.code === "changed") return refuse(404, "serverError.projectCanvas.fileMissing");
  return refuse(error.status, "serverError.projectCanvas.outsideFolder");
}

const archivedRefusal = () => new DraftRefusal(409, { code: "canvas_read_only", ...userError("serverError.projectCanvas.archived"), reason: "archived" } satisfies CanvasReadOnly);

/** A project's timeline, its JianYing draft and its finished film. */
export class ProjectDrafts {
  private readonly deps: ProjectDraftsDeps;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timelineListeners = new Set<(projectId: string) => void>();
  private readonly draftListeners = new Set<(projectId: string) => void>();
  /** By project, each file of its output folder as last looked at. */
  private readonly outputs = new Map<string, Map<string, { size: number; mtimeMs: number; settled: boolean }>>();
  private lookup: JianyingLookup | null = null;

  constructor(deps: ProjectDraftsDeps) {
    this.deps = deps;
  }

  /** `listener` runs after a project's order of shots was set. Returns the unsubscribe. */
  onTimelineChange(listener: (projectId: string) => void): () => void {
    this.timelineListeners.add(listener);
    return () => void this.timelineListeners.delete(listener);
  }

  /** `listener` runs after what `draftWire` answers for a project changed: a draft was written. Returns the unsubscribe. */
  onDraftChange(listener: (projectId: string) => void): () => void {
    this.draftListeners.add(listener);
    return () => void this.draftListeners.delete(listener);
  }

  /** Looks for JianYing again; `draftWire` answers from the last look. */
  async refreshJianying(): Promise<JianyingLookup> {
    this.lookup = await this.deps.jianying();
    return this.lookup;
  }

  async timeline(projectId: string): Promise<ProjectTimelineWire> {
    const project = this.project(projectId);
    const { clips, missing, leftOut } = await this.read(project);
    return {
      projectId,
      clips: clips.map(({ shotId, nodeId, title, file, durationMs, width, height }) => ({ shotId, nodeId, title, file, durationMs, width, height })),
      missingShots: missing,
      ...(leftOut.length ? { leftOut } : {}),
    };
  }

  /** `ProjectTimelineInput`. The draft follows when every shot that plays has a selected take. */
  async setOrder(projectId: string, body: unknown): Promise<ProjectTimelineWire> {
    const project = this.project(projectId);
    if (project.archivedAt !== undefined) throw archivedRefusal();
    await this.serial(projectId, async () => {
      const next = orderFrom(this.deps.canvas.shots(projectId), body);
      this.deps.store.write(projectId, { ...this.deps.store.read(projectId), ...next });
    });
    for (const listener of this.timelineListeners) listener(projectId);
    await this.writeDraftIfReady(projectId).catch((error: unknown) => {
      this.deps.log(`[project-draft] the draft of project ${projectId} could not be written after its order changed (${error instanceof Error ? error.name : "unknown"})`);
    });
    return this.timeline(projectId);
  }

  /**
   * Writes the project's draft now if every shot that plays has a selected take: the first time, and again whenever
   * the clips are not the ones the draft was written from. A draft JianYing saved since is left as it is and the new
   * one goes beside it, numbered. Does nothing, and costs little, when nothing changed, so it can be called on every
   * change to the canvas. Answers the draft as the person at this computer sees it.
   */
  async writeDraftIfReady(projectId: string): Promise<ProjectDraftWire> {
    const project = this.project(projectId);
    return this.serial(projectId, async () => {
      await this.write(project);
      return this.wireOf(project, true);
    });
  }

  /** The draft as `auth` sees it, for the canvas's snapshot. */
  draftWire(projectId: string, auth: RequestAuth): ProjectDraftWire {
    return this.wireOf(this.project(projectId), atThisComputer(auth));
  }

  /** The draft as the person at this computer sees it: what a bot of the project is told. */
  draftAtThisComputer(projectId: string): ProjectDraftWire {
    return this.wireOf(this.project(projectId), true);
  }

  async open(projectId: string, auth: RequestAuth): Promise<ProjectDraftOpenResult> {
    this.project(projectId);
    if (!this.deps.onPersonsComputer || !atThisComputer(auth)) throw refuse(409, "serverError.projectDraft.remote");
    const lookup = await this.refreshJianying();
    if (lookup.state !== "ready") throw refuse(409, lookup.reason === "not-installed" ? "serverError.projectDraft.notInstalled" : "serverError.projectDraft.unsupportedVersion");
    if (!(await this.deps.launch(lookup.install))) throw refuse(502, "serverError.projectDraft.openFailed");
    return { opened: "app" };
  }

  /** `ProjectFinalInput`: the file the person names becomes the finished film. */
  async final(projectId: string, body: unknown): Promise<ProjectFinalResult> {
    const project = this.project(projectId);
    if (project.archivedAt !== undefined) throw archivedRefusal();
    const path = body && typeof body === "object" ? (body as { path?: unknown }).path : undefined;
    let film: FinishedFilm | null;
    try {
      film = await this.filmAt(project, typeof path === "string" ? path : "");
    } catch (error) {
      throw isProjectPathError(error) ? pathRefusal(error, project.folder) : error;
    }
    if (!film) throw refuse(422, "serverError.projectDraft.notVideo");
    return this.deps.canvas.addFinal(projectId, film);
  }

  /**
   * One look at the output folder of every project that has a draft. A video there that no node of the canvas shows,
   * that is newer than the project's first draft and whose size and time did not change since the look before goes
   * to the canvas as the finished film. Only the folder itself is looked at: what this app generates goes into its
   * subfolders.
   */
  async lookForFinals(): Promise<void> {
    if (!this.deps.onPersonsComputer) return;
    const watched = new Set<string>();
    for (const project of this.deps.projects.list()) {
      if (project.archivedAt !== undefined || project.folderState !== "ready") continue;
      const draft = this.storedDraft(project.id);
      if (!draft) continue;
      watched.add(project.id);
      await this.lookAtOutput(project, draft.firstWrittenAt);
    }
    for (const projectId of this.outputs.keys()) if (!watched.has(projectId)) this.outputs.delete(projectId);
  }

  private project(projectId: string): TeamProjectWire {
    const project = this.deps.projects.list().find((one) => one.id === projectId);
    if (!project) throw refuse(404, "serverError.teamProject.notFound");
    return project;
  }

  private serial<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).then(run, run);
    const tail = next.catch(() => undefined);
    this.queues.set(projectId, tail);
    void tail.then(() => {
      if (this.queues.get(projectId) === tail) this.queues.delete(projectId);
    });
    return next;
  }

  private storedDraft(projectId: string): WrittenDraft | undefined {
    try {
      return this.deps.store.read(projectId).draft;
    } catch {
      return undefined;
    }
  }

  private wireOf(project: TeamProjectWire, here: boolean): ProjectDraftWire {
    const exportFolder = join(project.folder, CANVAS_OUTPUT_FOLDER);
    if (!this.deps.onPersonsComputer || !here) return { state: "unavailable", reason: "remote", exportFolder };
    if (this.lookup?.state !== "ready") return { state: "unavailable", reason: this.lookup?.reason ?? "not-installed", exportFolder };
    const draft = this.storedDraft(project.id);
    if (!draft) return { state: "none", exportFolder };
    return { state: draft.kept ? "kept" : "written", name: draft.name, writtenAt: draft.writtenAt, exportFolder };
  }

  /** Security: a clip is a file that really is inside the project folder and whose bytes are a video; a take that is
   * neither leaves its shot without a video. */
  private async read(project: TeamProjectWire): Promise<ReadTimeline> {
    const { playing, leftOut } = arrangedShots(this.deps.canvas.shots(project.id), this.deps.store.read(project.id));
    const clips: ReadClip[] = [];
    const missing: string[] = [];
    for (const shot of playing) {
      const clip = await this.clipOf(project, shot);
      if (clip) clips.push(clip);
      else missing.push(shot.shotId);
    }
    return { clips, missing, leftOut: leftOut.map((shot) => shot.shotId) };
  }

  private async clipOf(project: TeamProjectWire, shot: DraftShot): Promise<ReadClip | null> {
    const take = shot.take;
    if (!take) return null;
    const video = await this.videoAt(project, take.file.path).catch((error: unknown) => {
      if (isProjectPathError(error)) return null;
      throw error;
    });
    if (!video) return null;
    const durationUs = video.facts.durationUs ?? Math.round((take.durationMs ?? 0) * 1000);
    const width = video.facts.width ?? take.width ?? 0;
    const height = video.facts.height ?? take.height ?? 0;
    if (!(durationUs > 0 && width > 0 && height > 0)) return null;
    return {
      shotId: shot.shotId, nodeId: take.nodeId, title: shot.title || take.title, file: video.file, durationMs: Math.round(durationUs / 1000), width, height,
      absolute: video.absolute, durationUs, ...(video.facts.fps ? { fps: video.facts.fps } : {}),
    };
  }

  /** Null: the file is there and is not a video. Throws a `ProjectPathError` for a path that is not a file of the folder. */
  private async videoAt(project: TeamProjectWire, path: string): Promise<{ file: FinishedFilm["file"]; facts: VideoFacts; absolute: string } | null> {
    const opened = await openProjectFile(project.folder, path, Number.POSITIVE_INFINITY);
    try {
      const facts = await videoFacts(opened.handle, opened.bytes);
      if (!facts) return null;
      const absolute = join(await realpath(project.folder), ...opened.path.split("/"));
      return { file: { path: opened.path, mime: facts.mime, bytes: opened.bytes, name: opened.name }, facts, absolute };
    } finally {
      await opened.handle.close().catch(() => undefined);
    }
  }

  private async filmAt(project: TeamProjectWire, path: string): Promise<FinishedFilm | null> {
    const video = await this.videoAt(project, path);
    if (!video) return null;
    const { durationUs, width, height } = video.facts;
    return { file: video.file, ...(durationUs ? { durationMs: Math.round(durationUs / 1000) } : {}), ...(width && height ? { width, height } : {}) };
  }

  private async write(project: TeamProjectWire): Promise<void> {
    if (!this.deps.onPersonsComputer) return;
    const lookup = await this.refreshJianying();
    if (lookup.state !== "ready" || project.archivedAt !== undefined || project.folderState !== "ready") return;
    const { install } = lookup;
    const format = draftFormatFor(install.version);
    if (!format) return;
    const { clips, missing } = await this.read(project);
    if (missing.length || !clips.length) return;
    const fps = clips[0]!.fps;
    const clipsHash = sha256(JSON.stringify({ versions: format.versions, fps: fps ?? null, clips: clips.map((clip) => [clip.absolute, clip.durationUs, clip.width, clip.height, clip.file.bytes]) }));
    const stored = this.deps.store.read(project.id);
    const root = install.draftRoot;
    const previous = stored.draft && dirname(stored.draft.folder) === root ? stored.draft : undefined;
    const held = previous ? await this.heldBy(previous, install.timelineFile) : "gone";
    if (previous && held !== "saved" && previous.clipsHash === clipsHash) return;
    const now = this.deps.now();
    let place: Pick<WrittenDraft, "name" | "number" | "folder" | "draftId" | "createdUs" | "kept">;
    if (previous && held === "written") place = previous;
    else if (previous && held === "gone" && (await this.claim(previous.folder))) place = previous;
    else {
      const fresh = await this.freshFolder(root, draftFolderName(project.name), previous ? previous.number + 1 : 1);
      const kept = previous && held === "saved" ? previous.name : previous?.kept;
      place = { ...fresh, draftId: this.deps.newId(), createdUs: now * 1000, ...(kept ? { kept } : {}) };
    }
    const built = buildDraft(format, {
      name: place.name, root, folder: place.folder, fps, draftId: place.draftId, createdUs: place.createdUs, modifiedUs: now * 1000,
      clips: clips.map((clip) => ({ path: clip.absolute, name: clip.file.name, bytes: clip.file.bytes, durationUs: clip.durationUs, width: clip.width, height: clip.height })),
    }, this.deps.newId);
    writeFileAtomic(join(place.folder, install.timelineFile), built.timeline);
    writeFileAtomic(join(place.folder, META_FILE), built.meta);
    const draft: WrittenDraft = {
      name: place.name, number: place.number, folder: place.folder, draftId: place.draftId, createdUs: place.createdUs, writtenAt: now,
      firstWrittenAt: stored.draft?.firstWrittenAt ?? now, fileHash: sha256(built.timeline), clipsHash, ...(place.kept ? { kept: place.kept } : {}),
    };
    this.deps.store.write(project.id, { ...stored, draft });
    for (const listener of this.draftListeners) listener(project.id);
  }

  /** `written`: the draft's timeline file is the one this app wrote. `gone`: its folder is not there. `saved`:
   * anything else is there, so JianYing or the person changed it. */
  private async heldBy(draft: WrittenDraft, timelineFile: string): Promise<"written" | "gone" | "saved"> {
    const folder = await lstat(draft.folder).catch(() => null);
    if (!folder) return "gone";
    if (!folder.isDirectory()) return "saved";
    const file = join(draft.folder, timelineFile);
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile() || info.size > TIMELINE_MAX_BYTES) return "saved";
    const bytes = await readFile(file).catch(() => null);
    return bytes && sha256(bytes) === draft.fileHash ? "written" : "saved";
  }

  /** Makes the folder; false when something already has its name. */
  private async claim(folder: string): Promise<boolean> {
    try {
      await mkdir(folder);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  /** Security: a draft is written only into a folder this call made, directly inside the draft folder: a folder, file
   * or link that already has the name is passed over for the next number. */
  private async freshFolder(root: string, base: string, from: number): Promise<{ name: string; number: number; folder: string }> {
    for (let number = from; number < from + NUMBERS_TRIED; number += 1) {
      const name = numberedDraftName(base, number);
      const folder = join(root, name);
      if (dirname(folder) !== root) break;
      if (await this.claim(folder)) return { name, number, folder };
    }
    throw new Error("no free name for the draft's folder");
  }

  private async lookAtOutput(project: TeamProjectWire, since: number): Promise<void> {
    const dir = join(project.folder, CANVAS_OUTPUT_FOLDER);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const before = this.outputs.get(project.id);
    const now = new Map<string, { size: number; mtimeMs: number; settled: boolean }>();
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const info = await stat(join(dir, entry.name)).catch(() => null);
      if (!info?.isFile()) continue;
      const last = before?.get(entry.name);
      const still = last !== undefined && last.size === info.size && last.mtimeMs === info.mtimeMs;
      if (still && !last.settled && info.mtimeMs >= since) await this.offer(project, `${CANVAS_OUTPUT_FOLDER}/${entry.name}`);
      now.set(entry.name, { size: info.size, mtimeMs: info.mtimeMs, settled: still });
    }
    this.outputs.set(project.id, now);
  }

  /** A file is offered once for each size and time it settles at, so a film the canvas refused is not tried again
   * every look. An MP4 without its header is an export still being written: it is offered again when it changes. */
  private async offer(project: TeamProjectWire, path: string): Promise<void> {
    if (this.deps.canvas.showsFile(project.id, path)) return;
    const video = await this.videoAt(project, path).catch(() => null);
    if (!video || (video.facts.mime !== "video/webm" && video.facts.durationUs === undefined)) return;
    const { durationUs, width, height } = video.facts;
    const film: FinishedFilm = { file: video.file, ...(durationUs ? { durationMs: Math.round(durationUs / 1000) } : {}), ...(width && height ? { width, height } : {}) };
    try {
      await this.deps.canvas.addFinal(project.id, film);
    } catch (error) {
      // Security: the error's name only; its message can hold the project's folder path.
      this.deps.log(`[project-draft] the finished film of project ${project.id} could not be put on the canvas (${error instanceof Error ? error.name : "unknown"})`);
    }
  }
}
