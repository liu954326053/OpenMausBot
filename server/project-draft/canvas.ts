import type { CanvasFileRef } from "../../shared/project-canvas.ts";

/** A shot's selected take as the canvas holds it. What the canvas does not know of the video is read from the file. */
export interface DraftTake {
  /** The take's node. */
  nodeId: string;
  title: string;
  file: CanvasFileRef;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface DraftShot {
  shotId: string;
  title: string;
  /** Absent or null while the shot has no selected take. */
  take?: DraftTake | null;
}

/** The finished film the person exported, as a file of the project folder and what its own bytes say of it. */
export interface FinishedFilm {
  file: CanvasFileRef;
  durationMs?: number;
  width?: number;
  height?: number;
}

/** What the draft module asks of a project's canvas. */
export interface ProjectDraftCanvas {
  /** The project's shots in the canvas's own order, top to bottom, each with its selected take. */
  shots(projectId: string): DraftShot[];
  /** Whether a node of the canvas shows the file at this path, relative to the project folder. */
  showsFile(projectId: string, path: string): boolean;
  /** Puts the finished film on the canvas as the `final` node: a video file of the project folder, by its path
   * relative to it. `film` is the same file as the draft module read it. Throws when the canvas takes no change. */
  addFinal(projectId: string, path: string, film: FinishedFilm): Promise<{ nodeId: string }>;
}

/** The canvas of a server whose canvas is not connected to the draft module: no project has a shot. */
export const NO_CANVAS: ProjectDraftCanvas = {
  shots: () => [],
  showsFile: () => false,
  addFinal: async () => {
    throw new Error("the canvas is not connected to the draft module");
  },
};
