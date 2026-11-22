import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ProjectDraftWire } from "../../shared/project-draft.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { TeamProjectsApi } from "../../shared/team-projects.ts";
import { DATA_DIR } from "../config.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { RouteHandler } from "../routes/table.ts";
import { pipelinePlaceOf } from "../team-flow/flows.ts";
import { NO_CANVAS, type ProjectDraftCanvas } from "./canvas.ts";
import { ProjectDrafts } from "./drafts.ts";
import { defaultJianyingPlaces, findJianying, type JianyingInstall, type JianyingPlaces } from "./jianying.ts";
import { launchJianying } from "./open.ts";
import { createProjectDraftRoutes } from "./routes.ts";
import { ProjectTimelines } from "./store.ts";
import { setProjectDraftToolRoutes } from "./tool-route.ts";
import { createProjectTimelineToolRoutes } from "./tools.ts";

export interface ProjectDraftHostDeps {
  projects: Pick<TeamProjectsApi, "list">;
  store: { bot(botId: string): { teamProject?: { id: string } } | null | undefined };
  /** This server was started by the desktop app, so it runs on the computer the person sits at. A server deployed
   * elsewhere never looks for JianYing: its folders are not the person's. */
  onPersonsComputer: boolean;
  /** The project canvases; `connectCanvas` gives one later. Without one no project has a shot. */
  canvas?: ProjectDraftCanvas;
  dataDir?: string;
  places?: JianyingPlaces;
  launch?(install: JianyingInstall): Promise<boolean>;
  /** A bot's stages in its pipeline; by default the ones the team flows give it. */
  stagesOf?(botId: string): readonly FlowStage[];
  watchEveryMs?: number;
  log?(line: string): void;
}

export interface ProjectDraftHost {
  routes: RouteHandler;
  drafts: ProjectDrafts;
  connectCanvas(canvas: ProjectDraftCanvas): void;
  /** For the canvas's snapshot: the project's draft as `auth` sees it. Undefined for a project that is not there; never throws. */
  draftWire(projectId: string, auth: RequestAuth): ProjectDraftWire | undefined;
  /** Writes the project's draft now if every shot that plays has a selected take, and again only when its clips
   * changed; safe to call on every change to a canvas. Never throws. */
  writeDraftIfReady(projectId: string): Promise<void>;
  /** `listener` runs after a project's order of shots was set. Returns the unsubscribe. */
  onTimelineChange(listener: (projectId: string) => void): () => void;
  /** `listener` runs after a draft was written, so what `draftWire` answers changed. Returns the unsubscribe. */
  onDraftChange(listener: (projectId: string) => void): () => void;
  stop(): void;
}

const OUTPUT_LOOK_MS = 2000;
const JIANYING_LOOK_MS = 60_000;

/** Security: the error's name only; its message can hold a project's folder path. */
const named = (error: unknown) => (error instanceof Error ? error.name : "unknown");

/** The timelines and JianYing drafts of this installation: their routes, the post bots' tools, and the watch on the
 * projects' output folders for the finished film. */
export function createProjectDraftHost(deps: ProjectDraftHostDeps): ProjectDraftHost {
  const log = deps.log ?? ((line: string) => console.error(line));
  const places = deps.places ?? defaultJianyingPlaces();
  let connected = deps.canvas ?? NO_CANVAS;
  const canvas: ProjectDraftCanvas = {
    shots: (projectId) => connected.shots(projectId),
    showsFile: (projectId, path) => connected.showsFile(projectId, path),
    addFinal: (projectId, film) => connected.addFinal(projectId, film),
  };
  const drafts = new ProjectDrafts({
    projects: deps.projects,
    canvas,
    store: new ProjectTimelines(join(deps.dataDir ?? DATA_DIR, "project-timelines"), log),
    onPersonsComputer: deps.onPersonsComputer,
    jianying: () => findJianying(places),
    launch: deps.launch ?? ((install) => launchJianying(install)),
    now: Date.now,
    newId: () => randomUUID().toUpperCase(),
    log,
  });

  const timers: NodeJS.Timeout[] = [];
  if (deps.onPersonsComputer) {
    const lookForJianying = () => void drafts.refreshJianying().catch((error: unknown) => log(`[project-draft] looking for JianYing failed (${named(error)})`));
    let looking = false;
    const lookForFinals = async () => {
      if (looking) return;
      looking = true;
      try {
        await drafts.lookForFinals();
      } catch (error) {
        log(`[project-draft] a look at the projects' output folders failed (${named(error)})`);
      } finally {
        looking = false;
      }
    };
    lookForJianying();
    timers.push(setInterval(lookForJianying, JIANYING_LOOK_MS), setInterval(() => void lookForFinals(), deps.watchEveryMs ?? OUTPUT_LOOK_MS));
    for (const timer of timers) timer.unref();
  }

  setProjectDraftToolRoutes(createProjectTimelineToolRoutes({
    drafts,
    canvas,
    projectOfBot: (botId) => {
      const projectId = deps.store.bot(botId)?.teamProject?.id;
      return projectId ? deps.projects.list().find((project) => project.id === projectId && project.botIds.includes(botId)) : undefined;
    },
    stagesOf: deps.stagesOf ?? ((botId) => pipelinePlaceOf(botId)?.stages ?? []),
  }));

  return {
    routes: createProjectDraftRoutes(drafts),
    drafts,
    connectCanvas: (next) => { connected = next; },
    draftWire: (projectId, auth) => {
      try {
        return drafts.draftWire(projectId, auth);
      } catch {
        return undefined;
      }
    },
    writeDraftIfReady: async (projectId) => {
      try {
        await drafts.writeDraftIfReady(projectId);
      } catch (error) {
        log(`[project-draft] the draft of project ${projectId} could not be written (${named(error)})`);
      }
    },
    onTimelineChange: (listener) => drafts.onTimelineChange(listener),
    onDraftChange: (listener) => drafts.onDraftChange(listener),
    stop: () => {
      for (const timer of timers.splice(0)) clearInterval(timer);
    },
  };
}
