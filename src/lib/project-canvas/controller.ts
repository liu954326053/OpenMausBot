import type { CanvasBackgroundMode, CanvasOp, CanvasPoint, CanvasSnapshot, CanvasUploadResponse, CanvasViewport } from "../../../shared/project-canvas";
import type { GenerationFailure, GenerationKind, GenerationModel, GenerationSettingsWire, ProjectGenerationSettings } from "../../../shared/project-generation";
import { randomUuid } from "../random-uuid";
import type { CanvasBackend } from "./backend";
import { emptyHistory, recordHistory, redoHistory, undoHistory } from "./history";
import { addNodeOp, applyCanvasOps, invertCanvasOps } from "./ops";
import { layoutBotTree } from "./tree-layout";
import type { CanvasBotLook, CanvasBotTask, CanvasExchangeMessage } from "./types";

/** How long the view rests before it is stored. */
export const VIEWPORT_SAVE_DELAY_MS = 600;

export interface CanvasState {
  phase: "loading" | "ready" | "failed";
  loadError?: string;
  /** The server's canvas with this person's unsent changes over it. */
  snapshot: CanvasSnapshot | null;
  /** This person's view; a newer snapshot does not move it. */
  viewport: CanvasViewport;
  looks: Record<string, CanvasBotLook>;
  generation: GenerationSettingsWire | null;
  /** By kind; null while unknown, such as without a server. */
  models: Record<GenerationKind, GenerationModel[] | null>;
  modelsRefused: Partial<Record<GenerationKind, GenerationFailure>>;
  canUndo: boolean;
  canRedo: boolean;
  /** Why the last change was not stored. */
  writeError?: string;
  /** Text nodes a bot is writing, by node id. */
  writing: Record<string, { botId: string; since: number }>;
}

interface Batch {
  ops: CanvasOp[];
  /** The server's revision under the canvas this person saw when they made it. */
  seen: number;
  revision?: number;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ARRANGING = new Set(["position", "width", "height"]);

/** Moving and sizing nodes and the view are last-writer-wins: a drag is never refused because the server changed the
 * node meanwhile, as generation does. */
const arranges = (op: CanvasOp) =>
  op.type === "set_viewport" ||
  op.type === "set_background" ||
  (op.type === "update_node" && !op.metadata && Object.keys(op.patch ?? {}).every((key) => ARRANGING.has(key)));

function withIds(ops: readonly CanvasOp[]): CanvasOp[] {
  return ops.map((op) => (op.type === "add_node" || op.type === "connect_nodes") && !op.id ? { ...op, id: randomUuid() } : op);
}

/** The project canvas's state outside React: what the page draws, and every change it makes, through `CanvasBackend`. */
export class CanvasController {
  private state: CanvasState = { phase: "loading", snapshot: null, viewport: { x: 0, y: 0, k: 1 }, looks: {}, generation: null, models: { image: null, video: null }, modelsRefused: {}, canUndo: false, canRedo: false, writing: {} };
  private readonly listeners = new Set<() => void>();
  private server: CanvasSnapshot | null = null;
  /** The newest revision a batch of this person's made. */
  private ownRevision = 0;
  private pending: Batch[] = [];
  private queue: Promise<void> = Promise.resolve();
  private history = emptyHistory();
  private unsubscribe: (() => void) | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private viewportTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(readonly backend: CanvasBackend, readonly projectId: string) {}

  readonly getState = (): CanvasState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    this.unsubscribe = this.backend.subscribe(this.projectId, () => void this.refresh());
    try {
      const [snapshot, looks, generation] = await Promise.all([
        this.backend.readSnapshot(this.projectId),
        this.backend.readBotLooks(this.projectId).catch(() => ({})),
        this.backend.readGenerationSettings(this.projectId).catch(() => null),
      ]);
      if (this.disposed) return;
      this.server = snapshot;
      this.set({ phase: "ready", snapshot, viewport: snapshot.viewport, looks, generation });
      void this.loadModels();
    } catch (error) {
      this.set({ phase: "failed", loadError: messageOf(error) });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    if (this.viewportTimer) {
      clearTimeout(this.viewportTimer);
      this.saveViewport();
    }
  }

  /** Shows a change at once and sends it after the ones before; `record: false` keeps it out of undo. */
  apply(ops: readonly CanvasOp[], { record = true }: { record?: boolean } = {}): CanvasOp[] {
    const shown = this.state.snapshot;
    if (!shown || shown.readOnly || !ops.length) return [];
    const batch: Batch = { ops: withIds(ops), seen: this.server?.revision ?? 0 };
    if (record) this.history = recordHistory(this.history, { forward: batch.ops, inverse: invertCanvasOps(shown, batch.ops) });
    this.pending.push(batch);
    this.recompute();
    this.queue = this.queue.then(() => this.send(batch));
    return batch.ops;
  }

  undo(): void {
    const step = undoHistory(this.history);
    if (!step || this.state.snapshot?.readOnly) return;
    this.history = step.history;
    this.apply(step.entry.inverse, { record: false });
  }

  redo(): void {
    const step = redoHistory(this.history);
    if (!step || this.state.snapshot?.readOnly) return;
    this.history = step.history;
    this.apply(step.entry.forward, { record: false });
  }

  /** Resolves once every change made so far was sent. */
  settled(): Promise<void> {
    return this.queue;
  }

  setViewport(viewport: CanvasViewport): void {
    this.set({ viewport });
    if (this.viewportTimer) clearTimeout(this.viewportTimer);
    this.viewportTimer = setTimeout(() => this.saveViewport(), VIEWPORT_SAVE_DELAY_MS);
  }

  setBackground(backgroundMode: CanvasBackgroundMode): void {
    this.apply([{ type: "set_background", backgroundMode }], { record: false });
  }

  /** Lays the bots out as their tree, with what each made beside it, as one change. */
  tidy(): void {
    const shown = this.state.snapshot;
    if (!shown) return;
    const byId = new Map(shown.nodes.map((node) => [node.id, node]));
    const ops: CanvasOp[] = [];
    for (const [id, position] of layoutBotTree(shown)) {
      const node = byId.get(id);
      if (node && (node.position.x !== position.x || node.position.y !== position.y)) ops.push({ type: "update_node", id, patch: { position } });
    }
    this.apply(ops);
  }

  async upload(file: File, at?: CanvasPoint): Promise<CanvasUploadResponse> {
    const response = await this.backend.uploadFile(this.projectId, file, at);
    await this.refresh();
    const node = this.server?.nodes.find((candidate) => candidate.id === response.nodeId);
    if (node) {
      this.history = recordHistory(this.history, { forward: [addNodeOp(node)], inverse: [{ type: "delete_node", id: node.id }] });
      this.recompute();
    }
    return response;
  }

  /** Stores the prompt when it changed, then asks the server to generate the node as it has it; resolves to its refusal,
   * if any. */
  async generate(nodeId: string, prompt: string): Promise<GenerationFailure | null> {
    const node = this.state.snapshot?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return null;
    if ((node.metadata?.prompt ?? "") !== prompt) this.apply([{ type: "update_node", id: nodeId, metadata: { prompt } }]);
    await this.settled();
    const result = await this.backend.startGeneration(this.projectId, nodeId);
    return "refused" in result ? result.refused : null;
  }

  async cancelGeneration(nodeId: string): Promise<void> {
    const jobId = this.state.snapshot?.nodes.find((node) => node.id === nodeId)?.metadata?.jobId;
    if (jobId) await this.backend.cancelGeneration(this.projectId, jobId);
  }

  async sendTask(task: CanvasBotTask) {
    await this.settled();
    const response = await this.backend.sendTask(this.projectId, task);
    if (task.targetNodeId) this.set({ writing: { ...this.state.writing, [task.targetNodeId]: { botId: task.botId, since: Date.now() } } });
    return response;
  }

  stopBot(botId: string): Promise<void> {
    return this.backend.stopBot(this.projectId, botId);
  }

  readExchange(botId: string): Promise<CanvasExchangeMessage[]> {
    return this.backend.readExchange(this.projectId, botId);
  }

  openChat(botId: string, threadId?: string): void {
    this.backend.openChat(this.projectId, botId, threadId);
  }

  fileUrl(file: Parameters<CanvasBackend["fileUrl"]>[1]): string {
    return this.backend.fileUrl(this.projectId, file);
  }

  async saveGeneration(settings: ProjectGenerationSettings): Promise<GenerationFailure | null> {
    const result = await this.backend.saveGenerationSettings(this.projectId, settings);
    if ("refused" in result) return result.refused;
    this.set({ generation: result });
    await this.loadModels();
    return null;
  }

  /** The models a server lists, before it is saved as the project's. */
  previewModels(kind: GenerationKind, server: string) {
    return this.backend.listModels(this.projectId, kind, { server });
  }

  async loadModels(): Promise<void> {
    const settings = this.state.generation?.settings;
    const kinds: GenerationKind[] = ["image", "video"];
    const results = await Promise.all(kinds.map(async (kind) => {
      if (!settings?.[kind].server) return null;
      return this.backend.listModels(this.projectId, kind).catch((error: unknown) => ({ refused: { code: "unreachable" as const, error: messageOf(error), errorKey: "" } }));
    }));
    const models = { ...this.state.models };
    const modelsRefused: CanvasState["modelsRefused"] = {};
    kinds.forEach((kind, index) => {
      const result = results[index];
      models[kind] = result && "models" in result ? result.models : null;
      if (result && "refused" in result) modelsRefused[kind] = result.refused;
    });
    this.set({ models, modelsRefused });
  }

  dismissWriteError(): void {
    this.set({ writeError: undefined });
  }

  /** Reads the snapshot, then the bots' looks, so a bot the snapshot names has its look; calls that overlap share one
   * read and one more after it. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          const snapshot = await this.backend.readSnapshot(this.projectId);
          const looks = await this.backend.readBotLooks(this.projectId).catch(() => this.state.looks);
          if (this.disposed) return;
          if (!this.server || snapshot.revision >= this.server.revision) this.server = snapshot;
          this.recompute({ looks });
        } catch (error) {
          this.set({ writeError: messageOf(error) });
        }
      } while (this.refreshAgain && !this.disposed);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async send(batch: Batch): Promise<void> {
    try {
      const request = batch.ops.every(arranges) ? { ops: batch.ops } : { baseRevision: Math.max(batch.seen, this.ownRevision), ops: batch.ops };
      batch.revision = (await this.backend.applyOps(this.projectId, request)).revision;
      this.ownRevision = Math.max(this.ownRevision, batch.revision);
    } catch (error) {
      this.pending = this.pending.filter((candidate) => candidate !== batch);
      this.set({ writeError: messageOf(error) });
      this.recompute();
      void this.refresh();
    }
  }

  private saveViewport(): void {
    this.viewportTimer = null;
    if (this.state.snapshot && !this.state.snapshot.readOnly) this.apply([{ type: "set_viewport", viewport: this.state.viewport }], { record: false });
  }

  private recompute(change: Partial<CanvasState> = {}): void {
    const server = this.server;
    if (!server) return;
    this.pending = this.pending.filter((batch) => batch.revision === undefined || batch.revision > server.revision);
    const snapshot = this.pending.length ? applyCanvasOps(server, this.pending.flatMap((batch) => batch.ops)) : server;
    const writing = Object.fromEntries(Object.entries(this.state.writing).filter(([nodeId, { botId, since }]) => {
      const bot = snapshot.bots[botId];
      return snapshot.nodes.some((node) => node.id === nodeId) && bot && bot.status !== "error" && !(bot.output && bot.output.at >= since && bot.status !== "working" && bot.status !== "queued");
    }));
    this.set({ ...change, snapshot, writing, canUndo: this.history.past.length > 0, canRedo: this.history.future.length > 0 });
  }

  private set(change: Partial<CanvasState>): void {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
}
