import type {
  CanvasConflict,
  CanvasFileRef,
  CanvasGenerateResponse,
  CanvasOpsRequest,
  CanvasReadOnly,
  CanvasOpsResponse,
  CanvasPoint,
  CanvasSnapshot,
  CanvasTaskRequest,
  CanvasTaskResponse,
  CanvasUploadResponse,
} from "../../../shared/project-canvas";
import type {
  GenerationKind,
  GenerationModelsWire,
  GenerationSettingsWire,
  ProjectGenerationSettings,
  Refused,
} from "../../../shared/project-generation";
import type { CanvasBotLook, CanvasExchangeMessage } from "./types";

/** A refusal the server explained: the 409 body of a conflict or of a canvas that takes no change. */
export class CanvasBackendError extends Error {
  constructor(message: string, readonly body?: CanvasConflict | CanvasReadOnly) {
    super(message);
    this.name = "CanvasBackendError";
  }
}

/**
 * Everything the project canvas reads and changes. The canvas keeps nothing in the browser: each call names the
 * project. A promise rejects with an `Error` whose message the canvas may show the person; a generation the server
 * refuses resolves to `Refused` instead.
 */
export interface CanvasBackend {
  /** `GET /api/team-projects/:id/canvas`. */
  readSnapshot(projectId: string): Promise<CanvasSnapshot>;
  /** `POST /api/team-projects/:id/canvas/ops`. */
  applyOps(projectId: string, request: CanvasOpsRequest): Promise<CanvasOpsResponse>;
  /** Calls `onChange` when what the canvas draws may have changed: on the project's `ProjectCanvasEvent`s, when a bot's
   * look changes, and when the app missed live events. Returns the way to stop listening. */
  subscribe(projectId: string, onChange: () => void): () => void;

  /** `POST /api/team-projects/:id/canvas/files`: the file goes into `素材/` and the server adds its node at `at`. */
  uploadFile(projectId: string, file: File, at?: CanvasPoint): Promise<CanvasUploadResponse>;
  /** Where the page loads a project file from (`GET /api/team-projects/:id/canvas/files?path=`). */
  fileUrl(projectId: string, file: CanvasFileRef): string;

  /** How each bot of the project looks, by bot id. */
  readBotLooks(projectId: string): Promise<Record<string, CanvasBotLook>>;
  /** `POST /api/team-projects/:id/canvas/tasks`; the server adds what is connected into the bot's node. */
  sendTask(projectId: string, task: CanvasTaskRequest): Promise<CanvasTaskResponse>;
  stopBot(projectId: string, botId: string): Promise<void>;
  /** The bot's latest exchange in the project, oldest first. */
  readExchange(projectId: string, botId: string): Promise<CanvasExchangeMessage[]>;
  /** Opens the bot's conversation of this project in the app: `threadId`, or the one it has open. */
  openChat(projectId: string, botId: string, threadId?: string): void;

  /** `GET /api/team-projects/:id/generation/settings`. */
  readGenerationSettings(projectId: string): Promise<GenerationSettingsWire>;
  /** `PUT /api/team-projects/:id/generation/settings`. */
  saveGenerationSettings(projectId: string, settings: ProjectGenerationSettings): Promise<GenerationSettingsWire | Refused>;
  /** `GET /api/team-projects/:id/generation/models`; `preview` names a server not saved yet. */
  listModels(projectId: string, kind: GenerationKind, preview?: { server: string }): Promise<GenerationModelsWire | Refused>;
  /** `POST /api/team-projects/:id/canvas/generate`: generation starts from the node's saved prompt and settings and the
   * files connected into it, and the node shows the job as it goes. */
  startGeneration(projectId: string, nodeId: string): Promise<CanvasGenerateResponse | Refused>;
  /** `POST /api/team-projects/:id/generation/jobs/:jobId/cancel`. */
  cancelGeneration(projectId: string, jobId: string): Promise<void>;
}
