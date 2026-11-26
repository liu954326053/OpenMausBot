import type { CanvasFileRef } from "./project-canvas.ts";

/** One shot's selected take, in the order the film plays. */
export interface TimelineClip {
  shotId: string;
  /** The take's node. */
  nodeId: string;
  title: string;
  file: CanvasFileRef;
  durationMs: number;
  width: number;
  height: number;
}

/** `GET /api/team-projects/:id/timeline?episode=N`: an episode's clips in order, and its shots that have no selected
 * take. The order is the one its shots were added in until its post bot or the person sets one. Without `episode` it
 * is the timeline of a drama made before episodes. */
export interface ProjectTimelineWire {
  projectId: string;
  episode?: number;
  clips: TimelineClip[];
  missingShots: string[];
  /** The shots someone left out of the film; absent when there is none. Naming one in the order brings it back. */
  leftOut?: string[];
}

/** `PUT /api/team-projects/:id/timeline`: the shots in the order the film plays; a shot left out is left out of the
 * film. Every id must be a shot of the project. */
export interface ProjectTimelineInput {
  shotIds: string[];
}

/** One kind of sound or words laid along an episode's film in JianYing. */
export interface DraftTrackWire {
  kind: "voice" | "subtitle" | "music";
  /** In the order they play. */
  segments: Array<{ startMs: number; durationMs: number }>;
}

/**
 * `unavailable`: no JianYing on this computer, or this server is not on the person's computer. `none`: not written
 * yet. `written`: the draft holds what this app wrote. `kept`: JianYing saved over an older draft, which was left as
 * it is, and `name` is the newer one this app wrote beside it.
 */
export interface ProjectDraftWire {
  state: "unavailable" | "none" | "written" | "kept";
  /** With `unavailable`. */
  reason?: "not-installed" | "remote" | "unsupported-version";
  /** The draft's name in JianYing's list. */
  name?: string;
  writtenAt?: number;
  /** The folder the person exports the film to, absolute: the project's output folder. */
  exportFolder: string;
  /** What the person or the post bot laid along the film in JianYing: voice, subtitles, music. Absent when there is none. */
  tracks?: DraftTrackWire[];
}

/** `POST /api/team-projects/:id/draft/open`: brings JianYing to the front; the answer says whether it opened the
 * draft itself or only the app. */
export interface ProjectDraftOpenResult {
  opened: "draft" | "app";
}

/** `POST /api/team-projects/:id/final`: a video file in the project folder becomes an episode's finished film. */
export interface ProjectFinalInput {
  /** Relative to the project folder. */
  path: string;
  episode?: number;
}

/** What `POST /api/team-projects/:id/final` answers: the finished film's node. */
export interface ProjectFinalResult {
  nodeId: string;
}
