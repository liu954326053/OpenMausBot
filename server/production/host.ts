import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { DEFAULT_PRODUCTION_CONCURRENCY } from "../../shared/production.ts";
import type { ProjectGenerationApi } from "../../shared/project-generation.ts";
import type { TeamProjectsApi } from "../../shared/team-projects.ts";
import { DATA_DIR } from "../config.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import { openCardRows } from "../message-db.ts";
import type { ProjectCanvasHost } from "../project-canvas/host.ts";
import { canvasRefusalOf } from "../project-canvas/service.ts";
import type { ProjectDraftHost } from "../project-draft/host.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { Store } from "../store.ts";
import { projectOfRoomThread, projectRoom } from "../team-projects/project-rooms.ts";
import type { RoomMessage } from "../team-projects/room-send.ts";
import { Productions, type ProductionDeps } from "./engine.ts";
import { connectProductionJobs } from "./plans.ts";
import { createProductionRoutes } from "./routes.ts";
import { ProductionFiles } from "./store.ts";

export interface ProductionHostDeps {
  store: Store;
  projects: Pick<TeamProjectsApi, "list" | "episodeBot">;
  canvas: Pick<ProjectCanvasHost, "service" | "pipeline">;
  draft: Pick<ProjectDraftHost, "drafts" | "connectCanvas" | "draftWires" | "writeDraftIfReady" | "onTimelineChange" | "onDraftChange">;
  generation: Pick<ProjectGenerationApi, "settings">;
  deliver: ProductionDeps["deliver"];
  /** A line into a room, for the bots it names, from the lead. */
  sendToRoom(message: RoomMessage): DirectSendReceipt;
  mainThread(botId: string): string | undefined;
  /** The language the server writes its own lines in. */
  language(): string | undefined;
  dataDir?: string;
}

/**
 * Connects the project canvases to the JianYing drafts, shows each project's production and its episodes' drafts on
 * its canvas, says who does what in each project, and runs the productions.
 */
export function startProductions(deps: ProductionHostDeps): { routes: RouteHandler; productions: Productions } {
  const { service, pipeline } = deps.canvas;
  const { drafts } = deps.draft;
  const log = (line: string) => console.error(line);
  deps.draft.connectCanvas({
    shots: (projectId) => pipeline.shots(projectId),
    showsFile: (projectId, path) => service.document(service.project(projectId)).nodes.some((node) => node.metadata?.file?.path === path),
    addFinal: async (projectId, path, _film, episode) => ({ nodeId: (await pipeline.addFinal(projectId, path, episode)).nodeId }),
  });

  const productions = new Productions({
    projects: deps.projects,
    store: deps.store,
    canvas: {
      episodes: (projectId) => pipeline.episodes(projectId),
      shots: (projectId) => pipeline.shots(projectId),
      profiles: (projectId) => pipeline.profiles(projectId),
      view: (projectId) => pipeline.view(projectId),
      setBrief: (projectId, leadBotId, rows, titles) => void pipeline.setBrief(projectId, leadBotId, rows, titles),
      taskFor: (project, botId, request, language) => service.pipelineTask(project, botId, request, language),
      generate: async (project, nodeId) => {
        try {
          const started = await service.generate(project, { kind: "person" }, nodeId);
          return "refused" in started ? started.refused.error : null;
        } catch (error) {
          return canvasRefusalOf(error)?.body.error ?? (error instanceof Error ? error.message : "The generation could not be started.");
        }
      },
    },
    drafts: {
      writeDraftIfReady: (projectId, episode) => deps.draft.writeDraftIfReady(projectId, episode),
      draft: (projectId, episode) => {
        try {
          return drafts.draftAtThisComputer(projectId, episode);
        } catch {
          return undefined;
        }
      },
    },
    episodeBot: (projectId, templateBotId, episode, job) => deps.projects.episodeBot(projectId, templateBotId, episode, job),
    concurrency: (projectId) => deps.generation.settings(projectId)?.concurrency ?? DEFAULT_PRODUCTION_CONCURRENCY,
    deliver: deps.deliver,
    room: (project) => projectRoom(deps.store, project),
    projectOfRoom: (threadId) => projectOfRoomThread(deps.store, () => deps.projects.list(), threadId),
    deliverToRoom: async ({ room, to, leadBotId }) => deps.sendToRoom({
      groupId: room.groupId,
      threadId: room.threadId,
      to: to.map(({ botId, text }) => ({ botId, name: deps.store.bot(botId)?.name ?? botId, text })),
      trigger: { kind: "bot", botId: leadBotId },
    }),
    mainThread: deps.mainThread,
    waitingOnPerson: (botId, threadId, since) => deps.store.taskByThread(botId, threadId)?.activity === "waiting-on-you"
      || openCardRows().some((row) => row.threadId === threadId && row.at >= since && (row.fromBotId ?? botId) === botId),
    language: deps.language,
    files: new ProductionFiles(join(deps.dataDir ?? DATA_DIR, "productions"), log),
    changed: (projectId) => service.refresh(projectId),
    now: Date.now,
    newId: randomUUID,
    log,
  });

  const projectOfBot = (botId: string) => {
    const projectId = deps.store.bot(botId)?.teamProject?.id;
    return projectId ? deps.projects.list().find((project) => project.id === projectId) : undefined;
  };
  connectProductionJobs({
    pipeline: (projectId) => {
      const project = deps.projects.list().find((one) => one.id === projectId);
      return project ? productions.pipeline(project) : { stages: {}, lines: [] };
    },
    stagesOf: (botId) => {
      const project = projectOfBot(botId);
      return project ? productions.pipeline(project).stages[botId] ?? [] : [];
    },
    plan: (projectId, botId, input) => productions.plan(projectId, botId, input),
  });

  service.showAlso((projectId, auth) => {
    const production = productions.wire(projectId);
    if (!production) return {};
    return { production, drafts: deps.draft.draftWires(projectId, auth, production.episodes.map(({ episode }) => episode)) };
  });
  service.onChange((projectId) => productions.poke(projectId));
  pipeline.on((event) => {
    if (event.kind !== "selected") return;
    const episode = pipeline.shots(event.projectId).find((shot) => shot.shotId === event.shotId)?.episode;
    void deps.draft.writeDraftIfReady(event.projectId, episode);
  });
  deps.draft.onDraftChange((projectId) => service.refresh(projectId));
  deps.draft.onTimelineChange((projectId) => service.refresh(projectId));
  deps.store.onChange((change) => {
    if (change.type === "message" || change.type === "message.patch") productions.heard(change.threadId, change.message);
  });
  void productions.resume();
  return { routes: createProductionRoutes(productions), productions };
}
