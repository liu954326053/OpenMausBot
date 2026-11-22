import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ProjectCanvasEvent } from "../../shared/project-canvas.ts";
import type { ProjectGenerationApi } from "../../shared/project-generation.ts";
import type { TeamProjectsApi } from "../../shared/team-projects.ts";
import { saveImage } from "../attachments.ts";
import { DATA_DIR } from "../config.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import { openCardRows } from "../message-db.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createProjectCanvasRoutes } from "../routes/project-canvas.ts";
import type { RouteHandler } from "../routes/table.ts";
import { isSteeredMessageQueued, onSteeredQueueChange, queuedSteerSnapshot } from "../steer-queue.ts";
import type { Store } from "../store.ts";
import { onTeamFlowsChange, projectPipeline } from "../team-flow/flows.ts";
import { onTeamProjectFolderChange } from "../team-projects/folder-watch.ts";
import { createProjectCanvasToolRoutes } from "./agent-tools.ts";
import { CanvasDocuments } from "./document-store.ts";
import type { ProjectPipeline } from "./flow.ts";
import { setCanvasGenerationCardAnswer } from "./card-route.ts";
import { CanvasGenerationCards } from "./generation-card.ts";
import { ProjectCanvasService } from "./service.ts";
import { setProjectCanvasToolRoutes } from "./tool-route.ts";

export interface ProjectCanvasHostDeps {
  store: Store;
  projects: Pick<TeamProjectsApi, "list">;
  /** Reaches the open apps of the owner and admins. */
  broadcast(event: ProjectCanvasEvent): void;
  visibleFor(auth: RequestAuth): { thread(threadId: string): boolean };
  threadBusy(botId: string, threadId: string): boolean;
  mainThread(botId: string): string | undefined;
  send(auth: RequestAuth, message: { botId: string; threadId: string; text: string }): Promise<DirectSendReceipt>;
  /** A project's pipeline; by default the one its team's pipeline gives its copies. */
  pipelineOf?(projectId: string, leadBotId: string): ProjectPipeline;
  generation: ProjectGenerationApi;
  /** Hands a card's decision to the turn parked on it; false when none took it. */
  answerCard(threadId: string, messageId: string, text: string): boolean;
  /** The language the server writes its own lines in. */
  language(): string | undefined;
  dataDir?: string;
}

export interface ProjectCanvasHost {
  routes: RouteHandler;
  service: ProjectCanvasService;
}

const BOTS_SETTLE_MS = 500;

function queuedThreads(): Set<string> {
  return new Set(Object.entries(queuedSteerSnapshot(() => true)).filter(([, items]) => items.length > 0).map(([threadId]) => threadId));
}

/** Makes the canvases, answers their routes and the bots' canvas tools, and tells open apps when a canvas or the state
 * of a project's bots changes. */
export function createProjectCanvasHost(deps: ProjectCanvasHostDeps): ProjectCanvasHost {
  const service = new ProjectCanvasService({
    store: deps.store,
    projects: deps.projects,
    documents: new CanvasDocuments(join(deps.dataDir ?? DATA_DIR, "project-canvases"), (line) => console.error(line)),
    broadcast: deps.broadcast,
    visibleFor: deps.visibleFor,
    threadBusy: deps.threadBusy,
    mainThread: deps.mainThread,
    send: deps.send,
    pipelineOf: deps.pipelineOf ?? projectPipeline,
    generation: deps.generation,
    openCards: openCardRows,
    queuedThreads,
    stillQueued: isSteeredMessageQueued,
    saveImage: (bytes, mime) => saveImage(bytes, mime),
    language: deps.language,
    newId: randomUUID,
    log: (line) => console.error(line),
  });

  const settling = new Map<string, NodeJS.Timeout>();
  const botsChanged = (projectId: string | undefined) => {
    if (!projectId || settling.has(projectId)) return;
    const timer = setTimeout(() => {
      settling.delete(projectId);
      const revision = service.revisionOf(projectId);
      if (revision !== null) deps.broadcast({ kind: "project-canvas", projectId, revision, reason: "bots" });
    }, BOTS_SETTLE_MS);
    timer.unref();
    settling.set(projectId, timer);
  };
  const projectOf = new Map(deps.store.bots.flatMap((bot) => (bot.teamProject ? [[bot.id, bot.teamProject.id] as const] : [])));
  const botChanged = (botId: string | undefined) => {
    if (!botId) return;
    const before = projectOf.get(botId);
    const now = service.projectIdOfBot(botId);
    if (now) projectOf.set(botId, now);
    else projectOf.delete(botId);
    botsChanged(now);
    if (before !== now) botsChanged(before);
  };
  const threadChanged = (threadId: string, botId?: string) => {
    service.facts.forget(threadId);
    botChanged(botId ?? deps.store.botByThread(threadId)?.id);
  };

  deps.store.onChange((change) => {
    if (change.type === "message") {
      threadChanged(change.threadId, change.message.from?.botId);
      service.taskLine(change.threadId, change.message);
      void service.handOverLine(change.threadId, change.message);
    } else if (change.type === "message.patch") {
      threadChanged(change.threadId, change.message.from?.botId);
      service.taskLine(change.threadId, change.message);
    } else if (change.type === "thread") threadChanged(change.threadId);
    else if (change.type === "thread.deleted") {
      service.facts.forget(change.threadId);
      for (const projectId of new Set(projectOf.values())) botsChanged(projectId);
    } else if (change.type === "bot") botChanged(change.botId);
    else if (change.type === "bot.deleted") {
      botsChanged(projectOf.get(change.botId));
      projectOf.delete(change.botId);
    }
  });

  let queued = queuedThreads();
  onSteeredQueueChange(() => {
    const now = queuedThreads();
    for (const threadId of new Set([...queued, ...now])) if (queued.has(threadId) !== now.has(threadId)) botChanged(deps.store.botByThread(threadId)?.id);
    queued = now;
  });

  onTeamFlowsChange(() => {
    try {
      for (const projectId of service.linesMoved()) botsChanged(projectId);
    } catch (error) {
      console.error(`[project-canvas] a change to a team's flow could not be drawn on the canvases (${error instanceof Error ? error.message : "unknown"})`);
    }
  });
  onTeamProjectFolderChange(({ projectId }) => botsChanged(projectId));

  deps.generation.onJobChange((job) => service.jobChanged(job));
  service.reconcileGenerations();
  const cards = new CanvasGenerationCards({ store: deps.store, service, answer: deps.answerCard });
  setCanvasGenerationCardAnswer((threadId, requestId, behavior) => cards.answer(threadId, requestId, behavior));
  setProjectCanvasToolRoutes(createProjectCanvasToolRoutes(service, cards));
  return { routes: createProjectCanvasRoutes(service), service };
}
