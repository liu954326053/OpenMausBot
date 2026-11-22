import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { TeamProjectsApi } from "../../shared/team-projects.ts";
import { DATA_DIR } from "../config.ts";
import { openCardRows } from "../message-db.ts";
import type { ProjectCanvasHost } from "../project-canvas/host.ts";
import type { ProjectDraftHost } from "../project-draft/host.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { Store } from "../store.ts";
import { createPipelineRunRoutes } from "./routes.ts";
import { PipelineRuns, type PipelineRunsDeps } from "./runs.ts";
import { PipelineRunFiles } from "./store.ts";

export interface PipelineRunHostDeps {
  store: Store;
  projects: Pick<TeamProjectsApi, "list">;
  canvas: Pick<ProjectCanvasHost, "service" | "pipeline">;
  draft: Pick<ProjectDraftHost, "drafts" | "connectCanvas" | "draftWire" | "writeDraftIfReady" | "onTimelineChange" | "onDraftChange">;
  deliver: PipelineRunsDeps["deliver"];
  mainThread(botId: string): string | undefined;
  /** The language the server writes its own lines in. */
  language(): string | undefined;
  dataDir?: string;
}

/** Connects the project canvases to the JianYing drafts, shows each project's run and draft on its canvas, and relays
 * the pipeline's runs from stage to stage. */
export function startPipelineRuns(deps: PipelineRunHostDeps): { routes: RouteHandler; runs: PipelineRuns } {
  const { service, pipeline } = deps.canvas;
  const { drafts } = deps.draft;
  const log = (line: string) => console.error(line);
  deps.draft.connectCanvas({
    shots: (projectId) => pipeline.shots(projectId),
    showsFile: (projectId, path) => service.document(service.project(projectId)).nodes.some((node) => node.metadata?.file?.path === path),
    addFinal: async (projectId, path) => ({ nodeId: (await pipeline.addFinal(projectId, path)).nodeId }),
  });

  const runs = new PipelineRuns({
    projects: deps.projects,
    store: deps.store,
    flowOf: (project) => service.flow(project),
    canvas: {
      shots: (projectId) => pipeline.shots(projectId),
      textNodes: (projectId) => pipeline.textNodes(projectId),
      addText: (projectId, botId, title, content) => pipeline.addText(projectId, botId, title, content),
      markScript: (projectId, nodeId) => pipeline.markScript(projectId, nodeId),
      taskFor: (project, botId, request, language) => service.pipelineTask(project, botId, request, language),
      generate: async (project, creationNodeId) => "job" in await service.generate(project, { kind: "person" }, creationNodeId),
    },
    draft: {
      writeDraftIfReady: (projectId) => deps.draft.writeDraftIfReady(projectId),
      playOnly: async (projectId, shotIds) => {
        await drafts.setOrder(projectId, { shotIds });
      },
      draft: (projectId) => {
        try {
          return drafts.draftAtThisComputer(projectId);
        } catch {
          return undefined;
        }
      },
    },
    deliver: deps.deliver,
    mainThread: deps.mainThread,
    waitingOnPerson: (botId, threadId, since) => deps.store.taskByThread(botId, threadId)?.activity === "waiting-on-you"
      || openCardRows().some((row) => row.threadId === threadId && row.at >= since),
    language: deps.language,
    files: new PipelineRunFiles(join(deps.dataDir ?? DATA_DIR, "pipeline-runs"), log),
    changed: (projectId) => service.refresh(projectId),
    now: Date.now,
    newId: randomUUID,
    log,
  });

  service.showAlso((projectId, auth) => {
    const run = runs.wire(projectId);
    const draft = deps.draft.draftWire(projectId, auth);
    return { ...(run ? { run } : {}), ...(draft ? { draft } : {}) };
  });
  service.onChange((projectId) => void deps.draft.writeDraftIfReady(projectId));
  pipeline.on((event) => runs.canvasEvent(event));
  deps.draft.onDraftChange((projectId) => service.refresh(projectId));
  deps.draft.onTimelineChange((projectId) => service.refresh(projectId));
  deps.store.onChange((change) => {
    if (change.type === "message" || change.type === "message.patch") runs.heard(change.threadId, change.message);
  });
  void runs.resume();
  return { routes: createPipelineRunRoutes(runs), runs };
}
