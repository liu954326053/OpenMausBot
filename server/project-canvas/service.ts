import {
  botNodeId,
  CANVAS_MAX_NODES,
  CANVAS_NODE_SIZE,
  canvasFileNodeType,
  type CanvasConnection,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeCreator,
  type CanvasNodeMetadata,
  type CanvasOp,
  type CanvasOpsResponse,
  type CanvasReadOnly,
  type CanvasSnapshot,
  type CanvasTaskResponse,
  type ProjectCanvasEvent,
} from "../../shared/project-canvas.ts";
import { nodeStatusOf, type GenerationJob, type GenerationRequester, type ProjectGenerationApi, type Refused } from "../../shared/project-generation.ts";
import type { ServerTextParams } from "../../shared/server-text.ts";
import type { TeamProjectWire, TeamProjectsApi } from "../../shared/team-projects.ts";
import { FILE_MAX_BYTES } from "../attachments.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Message, Store } from "../store.ts";
import { userError, type UserErrorKey } from "../user-errors.ts";
import { BotFactsReader, type OpenCardRow } from "./bot-facts.ts";
import { CanvasConflictError, CanvasRequestError, CanvasUnreadableError, type CanvasChangeOutcome, type CanvasDocuments } from "./document-store.ts";
import { generationInput, generationKindOf } from "./generation.ts";
import { handOver } from "./handover.ts";
import { applyCanvasOps, CanvasOpRefusal, opTargets, parseCanvasOps, type CanvasChangeSet, type CanvasFrame } from "./ops.ts";
import type { ProjectPathError } from "./paths.ts";
import { placeAfter, placeForActor, type BotTree } from "./placement.ts";
import { taskMessage, taskReferences } from "./references.ts";
import { botFrames, buildSnapshot, dispatchConnections } from "./snapshot.ts";

/** A request the canvas does not carry out, and what it is answered with. */
export class CanvasRefusal extends Error {
  readonly status: number;
  readonly body: { error: string } & Record<string, unknown>;
  constructor(status: number, body: { error: string } & Record<string, unknown>) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

const refusal = (status: number, key: UserErrorKey, params?: Record<string, string | number>) => new CanvasRefusal(status, userError(key, params));
const coded = (status: number, code: string, key: UserErrorKey) => new CanvasRefusal(status, { code, ...userError(key) });

export function readOnlyRefusal(): CanvasRefusal {
  return new CanvasRefusal(409, { code: "canvas_read_only", ...userError("serverError.projectCanvas.archived"), reason: "archived" } satisfies CanvasReadOnly);
}

export const tooLargeRefusal = (): CanvasRefusal => refusal(413, "serverError.projectCanvas.tooLarge", { limit: `${Math.round(FILE_MAX_BYTES / (1024 * 1024))} MB` });

export function pathRefusal(error: ProjectPathError, folder: string): CanvasRefusal {
  if (error.code === "folder_missing") return refusal(409, "serverError.projectCanvas.folderMissing", { folder });
  if (error.code === "too_large") return tooLargeRefusal();
  if (error.code === "not_found" || error.code === "not_file" || error.code === "changed") return refusal(404, "serverError.projectCanvas.fileMissing");
  return refusal(error.status, "serverError.projectCanvas.outsideFolder");
}

/** How a refused canvas request is answered; null for an error that is not a refusal. */
export function canvasRefusalOf(error: unknown): { status: number; body: { error: string } } | null {
  if (error instanceof CanvasRefusal || error instanceof CanvasConflictError || error instanceof CanvasUnreadableError) return { status: error.status, body: error.body };
  if (error instanceof CanvasOpRefusal) {
    const body = { error: error.message, code: error.code, ...(error.index >= 0 ? { index: error.index } : {}), ...(error.nodeId ? { nodeId: error.nodeId } : {}) };
    return { status: error.status, body };
  }
  if (error instanceof CanvasRequestError) return { status: error.status, body: { error: error.message } };
  const sent = error as { status?: unknown; body?: unknown } | null;
  if (!(error instanceof Error) || typeof sent?.status !== "number") return null;
  const body = { error: error.message, ...(sent.body && typeof sent.body === "object" ? sent.body : {}) };
  return { status: sent.status, body };
}

export interface ProjectCanvasServiceDeps {
  store: Pick<Store, "bot" | "botByThread" | "tasks" | "taskByThread" | "messagesTail">;
  projects: Pick<TeamProjectsApi, "list">;
  documents: CanvasDocuments;
  broadcast(event: ProjectCanvasEvent): void;
  visibleFor(auth: RequestAuth): { thread(threadId: string): boolean };
  threadBusy(botId: string, threadId: string): boolean;
  /** The conversation a task goes to when the person names none. */
  mainThread(botId: string): string | undefined;
  /** Delivers the person's message to a bot's conversation as their own chat message would be. */
  send(auth: RequestAuth, message: { botId: string; threadId: string; text: string }): Promise<DirectSendReceipt>;
  /** A project bot's superior in the flow. */
  parentOf(projectId: string, botId: string): string | undefined;
  generation: Pick<ProjectGenerationApi, "start" | "job">;
  openCards(): OpenCardRow[];
  queuedThreads(): ReadonlySet<string>;
  /** Keeps an image as the app's own attachment, which a message may carry. */
  saveImage(bytes: Buffer, mime: string): { path: string };
  /** The language the server writes its own lines in: references are named in it when a request names no language. */
  language(): string | undefined;
  newId(): string;
  log(line: string): void;
}

const TASK_MAX_CHARS = 20_000;
const JOB_KEYS = ["status", "jobId", "errorDetails", "errorKey", "errorParams"] as const;
const NOT_A_PROJECT_BOT = "Only the bots of a project have its canvas, and you are not one of a project's bots now.";

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/;

/** The language a person's request names its references in, or none when it names none. */
function requestLanguage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const tag = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!LANGUAGE_TAG.test(tag)) throw new CanvasRefusal(400, { error: "language must be a language tag such as zh or pt-br" });
  return tag;
}

const NONE: CanvasChangeSet = { nodes: [], connections: [] };
const isEmpty = (set: CanvasChangeSet) => !set.nodes.length && !set.connections.length && !set.viewport && !set.backgroundMode;
const madeBy = (node: CanvasNode, botId: string) => node.createdBy?.kind === "bot" && node.createdBy.botId === botId;
const record = (body: unknown): Record<string, unknown> => (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {});

function without(metadata: CanvasNodeMetadata, ...keys: Array<keyof CanvasNodeMetadata>): CanvasNodeMetadata {
  const copy = { ...metadata };
  for (const key of keys) delete copy[key];
  return copy;
}

const nodeError = (said: { error: string; errorKey: string; errorParams?: ServerTextParams }): CanvasNodeMetadata =>
  ({ errorDetails: said.error, errorKey: said.errorKey, ...(said.errorParams ? { errorParams: said.errorParams } : {}) });

/** A bot whose node is where the default layout puts it is stored there once content is placed beside it, so a later
 * change to the layout does not leave it apart from what it made. */
function pinBot(document: CanvasDocument, changed: CanvasChangeSet, botId: string, bots: ReadonlyMap<string, CanvasFrame>): void {
  const id = botNodeId(botId);
  const frame = bots.get(id);
  if (!frame || document.nodes.some((node) => node.id === id)) return;
  document.nodes.push({ id, type: "bot", title: "", position: frame.position, width: frame.width, height: frame.height });
  changed.nodes.push(id);
}

/** An attach_file line: one attachment the bot sent, from a file it had. */
function handedFile(message: Message) {
  const attachment = message.attachments?.length === 1 ? message.attachments[0] : undefined;
  if (message.role !== "bot" || message.kind !== "text" || message.text || !attachment || attachment.kind === "audio" || !attachment.source) return null;
  if (attachment.kind === "image" && attachment.fromTool) return null;
  return { path: attachment.path, mime: attachment.mime, source: attachment.source, ...(attachment.name ? { name: attachment.name } : {}) };
}

export class ProjectCanvasService {
  readonly facts: BotFactsReader;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly deps: ProjectCanvasServiceDeps;
  private lastLines = new Map<string, string>();

  constructor(deps: ProjectCanvasServiceDeps) {
    this.deps = deps;
    this.facts = new BotFactsReader(deps);
  }

  /** Throws while the list of projects cannot be read. */
  project(projectId: string): TeamProjectWire {
    const project = this.deps.projects.list().find((one) => one.id === projectId);
    if (!project) throw refusal(404, "serverError.teamProject.notFound");
    return project;
  }

  /** The project a bot is one of the bots of; refused for every other bot, the main bot included. */
  projectOfBot(botId: string): TeamProjectWire {
    const projectId = this.deps.store.bot(botId)?.teamProject?.id;
    const project = projectId ? this.deps.projects.list().find((one) => one.id === projectId && one.botIds.includes(botId)) : undefined;
    if (!project) throw new CanvasRefusal(403, { error: NOT_A_PROJECT_BOT });
    return project;
  }

  projectIdOfBot(botId: string): string | undefined {
    return this.deps.store.bot(botId)?.teamProject?.id;
  }

  revisionOf(projectId: string): number | null {
    return this.deps.documents.revisionOf(projectId);
  }

  /** The projects whose canvas draws other lines between its bots than when this was last called, each project on the
   * first call. Throws while the list of projects cannot be read. */
  linesMoved(): string[] {
    const before = this.lastLines;
    this.lastLines = new Map(this.deps.projects.list().map((project) => [project.id, dispatchConnections(this.tree(project)).map((one) => one.id).join(" ")]));
    return [...this.lastLines].filter(([projectId, lines]) => before.get(projectId) !== lines).map(([projectId]) => projectId);
  }

  private tree(project: TeamProjectWire): BotTree {
    return { botIds: project.botIds, leadBotId: project.leadBotId, parentOf: (botId) => this.deps.parentOf(project.id, botId) };
  }

  private view(project: TeamProjectWire, sees: (threadId: string) => boolean): CanvasSnapshot {
    return buildSnapshot({
      document: this.deps.documents.read(project.id),
      project: { id: project.id, name: project.name, leadBotId: project.leadBotId, archived: project.archivedAt !== undefined, folderState: project.folderState },
      bots: this.facts.facts(project.botIds),
      parentOf: (botId) => this.deps.parentOf(project.id, botId),
      sees,
    });
  }

  snapshot(projectId: string, auth: RequestAuth): CanvasSnapshot {
    const project = this.project(projectId);
    const visible = this.deps.visibleFor(auth);
    return this.view(project, (threadId) => visible.thread(threadId));
  }

  /** What a bot reads: the canvas and every bot's status, and nothing taken from a conversation. */
  botView(project: TeamProjectWire): CanvasSnapshot {
    return this.view(project, () => false);
  }

  /** `{ baseRevision?, ops }`; a bot's operations always apply to the canvas as it is. */
  applyRequest(project: TeamProjectWire, actor: CanvasNodeCreator, body: unknown): CanvasOpsResponse {
    const request = record(body);
    const base = actor.kind === "person" ? request.baseRevision : undefined;
    if (base !== undefined && typeof base !== "number") throw new CanvasOpRefusal("invalid_op", "baseRevision must be a number");
    return this.apply(project, actor, parseCanvasOps(request.ops), base);
  }

  apply(project: TeamProjectWire, actor: CanvasNodeCreator, ops: readonly CanvasOp[], baseRevision?: number): CanvasOpsResponse {
    if (project.archivedAt !== undefined) throw readOnlyRefusal();
    const outcome = this.deps.documents.change(project.id, {
      ...(baseRevision === undefined ? {} : { baseRevision }),
      targets: opTargets(ops),
      apply: (document) => {
        const bots = botFrames(document, this.tree(project));
        const result = applyCanvasOps(document, ops, { actor, bots, newId: this.deps.newId, place: (current, node) => placeForActor(current, node, actor, bots) });
        if (actor.kind === "bot" && result.nodeIds.length) pinBot(result.document, result.changed, actor.botId, bots);
        return result;
      },
    });
    this.changed(project.id, outcome);
    return { revision: outcome.revision, nodeIds: outcome.nodeIds, connectionIds: outcome.connectionIds };
  }

  /** A change the server makes on someone's behalf, never refused for what changed since. */
  private serverChange(project: TeamProjectWire, make: (document: CanvasDocument, bots: ReadonlyMap<string, CanvasFrame>) => CanvasChangeSet | null): void {
    const outcome = this.deps.documents.change(project.id, {
      targets: NONE,
      apply: (document) => ({ document, changed: make(document, botFrames(document, this.tree(project))) ?? NONE, nodeIds: [], connectionIds: [] }),
    });
    this.changed(project.id, outcome);
  }

  private changed(projectId: string, outcome: CanvasChangeOutcome): void {
    if (!isEmpty(outcome.changed)) this.deps.broadcast({ kind: "project-canvas", projectId, revision: outcome.revision, reason: "document" });
  }

  private serial(projectId: string, work: () => Promise<void>): Promise<void> {
    const run = (this.queues.get(projectId) ?? Promise.resolve()).then(work, work);
    const settled = run.catch(() => undefined);
    this.queues.set(projectId, settled);
    void settled.then(() => {
      if (this.queues.get(projectId) === settled) this.queues.delete(projectId);
    });
    return run;
  }

  /** A file a project's bot attached becomes a node in its lane, connected from its node, unless a node shows it. */
  handOverLine(threadId: string, message: Message): Promise<void> {
    const file = handedFile(message);
    if (!file) return Promise.resolve();
    const botId = message.from?.botId ?? this.deps.store.botByThread(threadId)?.id;
    const projectId = botId ? this.projectIdOfBot(botId) : undefined;
    if (!botId || !projectId) return Promise.resolve();
    return this.serial(projectId, async () => {
      const project = this.deps.projects.list().find((one) => one.id === projectId);
      if (!project || project.archivedAt !== undefined || project.folderState !== "ready" || !project.botIds.includes(botId)) return;
      const handed = await handOver(this.deps.documents.read(project.id), project.folder, file);
      if ("existing" in handed) return;
      const { nodeType, title, file: ref } = handed.add;
      this.serverChange(project, (document, bots) => {
        if (document.nodes.length >= CANVAS_MAX_NODES || document.nodes.some((node) => node.metadata?.file?.path === ref.path)) return null;
        const actor: CanvasNodeCreator = { kind: "bot", botId };
        const node: CanvasNode = { id: this.deps.newId(), type: nodeType, title, position: { x: 0, y: 0 }, ...CANVAS_NODE_SIZE[nodeType], metadata: { file: ref }, createdBy: actor };
        node.position = placeForActor(document, node, actor, bots);
        const connection: CanvasConnection = { id: this.deps.newId(), fromNodeId: botNodeId(botId), toNodeId: node.id, kind: "content" };
        document.nodes.push(node);
        document.connections.push(connection);
        const changed: CanvasChangeSet = { nodes: [node.id], connections: [connection.id] };
        pinBot(document, changed, botId, bots);
        return changed;
      });
    }).catch((error: unknown) => {
      this.deps.log(`[project-canvas] ${projectId}: a file ${botId} attached could not be put on the canvas (${error instanceof Error ? error.message : "unknown"})`);
    });
  }

  async task(projectId: string, auth: RequestAuth, body: unknown): Promise<CanvasTaskResponse> {
    const project = this.project(projectId);
    if (project.archivedAt !== undefined) throw readOnlyRefusal();
    if (project.folderState !== "ready") throw refusal(409, "serverError.projectCanvas.folderMissing", { folder: project.folder });
    const request = record(body);
    const { botId, text, targetNodeId } = request;
    const asked = request.threadId;
    if (typeof botId !== "string" || typeof text !== "string" || text.length > TASK_MAX_CHARS || (asked !== undefined && typeof asked !== "string")
      || (targetNodeId !== undefined && typeof targetNodeId !== "string")) {
      throw new CanvasRefusal(400, { error: `a task is { botId, text, threadId?, targetNodeId?, language? }, its text at most ${TASK_MAX_CHARS} characters` });
    }
    const language = requestLanguage(request.language) ?? this.deps.language();
    if (!project.botIds.includes(botId)) throw refusal(404, "serverError.projectCanvas.notMember");
    const threadId = asked ?? this.deps.mainThread(botId) ?? this.deps.store.bot(botId)?.threadId;
    if (!threadId || !this.deps.store.taskByThread(botId, threadId) || !this.deps.visibleFor(auth).thread(threadId)) {
      throw new CanvasRefusal(404, { error: "That is not a conversation of this bot you can open." });
    }
    const document = this.deps.documents.read(project.id);
    if (targetNodeId !== undefined && document.nodes.find((node) => node.id === targetNodeId)?.type !== "text") {
      throw new CanvasRefusal(404, { error: "A reply goes into a text node of this canvas, and that is not one." });
    }
    const references = await taskReferences(document, targetNodeId ?? botNodeId(botId), { folder: project.folder, saveImage: this.deps.saveImage, language });
    const message = taskMessage(text, references);
    if (!message) throw new CanvasRefusal(400, { error: "Write the task, or connect something to the bot's node." });
    const receipt = await this.deps.send(auth, { botId, threadId, text: message });
    return "queued" in receipt
      ? { threadId: receipt.threadId, queued: true, references: references.count }
      : { threadId: receipt.threadId, messageId: receipt.message.id, references: references.count };
  }

  nodeOf(projectId: string, nodeId: string): CanvasNode | undefined {
    return this.deps.documents.read(projectId).nodes.find((one) => one.id === nodeId);
  }

  private patchNode(project: TeamProjectWire, nodeId: string, next: (metadata: CanvasNodeMetadata) => CanvasNodeMetadata | null): void {
    this.serverChange(project, (document) => {
      const node = document.nodes.find((one) => one.id === nodeId);
      const metadata = node && next(node.metadata ?? {});
      if (!node || !metadata) return null;
      node.metadata = metadata;
      return { nodes: [node.id], connections: [] };
    });
  }

  /** Starts the project's generation for a shot, image, video or config node, which shows `loading` until its job ends.
   * A bot starts only its own nodes. A refusal leaves the node as it was. `language` is the one a person's request names
   * its references in; a bot's request names none. */
  async generate(project: TeamProjectWire, requester: GenerationRequester, nodeId: unknown, language?: unknown): Promise<{ job: GenerationJob } | Refused> {
    if (project.archivedAt !== undefined) throw readOnlyRefusal();
    if (typeof nodeId !== "string") throw new CanvasOpRefusal("invalid_op", "nodeId is required");
    const named = requestLanguage(language) ?? this.deps.language();
    const document = this.deps.documents.read(project.id);
    const node = document.nodes.find((one) => one.id === nodeId);
    if (!node) throw coded(404, "not_found", "serverError.projectCanvas.nodeMissing");
    const kind = generationKindOf(node);
    if (!kind) throw new CanvasOpRefusal("invalid_op", "only shot, image, video and config nodes are generated");
    if (requester.kind === "bot" && !madeBy(node, requester.botId)) throw new CanvasOpRefusal("not_yours", `${nodeId} was not put there by you; ask the person to generate it`);
    if (node.metadata?.status === "loading") throw coded(409, "generating", "serverError.projectCanvas.alreadyGenerating");
    const prompt = node.metadata?.prompt?.trim();
    if (!prompt) throw coded(400, "no_prompt", "serverError.projectCanvas.noPrompt");
    const before = Object.fromEntries(JOB_KEYS.flatMap((key) => (node.metadata?.[key] === undefined ? [] : [[key, node.metadata[key]]]))) as CanvasNodeMetadata;
    const reserved = (metadata: CanvasNodeMetadata) => metadata.status === "loading" && metadata.jobId === undefined;
    const restore = () => this.patchNode(project, node.id, (metadata) => (reserved(metadata) ? { ...without(metadata, ...JOB_KEYS), ...before } : null));
    this.patchNode(project, node.id, (metadata) => ({ ...without(metadata, ...JOB_KEYS), status: "loading" }));
    let started: { job: GenerationJob } | Refused;
    try {
      started = await this.deps.generation.start(project.id, generationInput(document, node, kind, prompt, named), { requester });
    } catch (error) {
      restore();
      throw error;
    }
    if ("refused" in started) {
      restore();
      return started;
    }
    const { job } = started;
    this.patchNode(project, node.id, (metadata) => (reserved(metadata) ? { ...metadata, jobId: job.id } : null));
    this.jobChanged(this.deps.generation.job(project.id, job.id) ?? job);
    return started;
  }

  /** A job's change, on its node: `loading` while it runs, then the files it made, or its failure as the node's error.
   * An empty image or video node takes the first file of its kind; each other file becomes a node to its right,
   * connected from it. A node given another job since, or none, is left as it is. Kept for an archived project too: the
   * job began before. */
  jobChanged(job: GenerationJob): void {
    const project = this.deps.projects.list().find((one) => one.id === job.projectId);
    if (!project) return;
    try {
      this.serverChange(project, (document, bots) => {
        const node = document.nodes.find((one) => one.id === job.nodeId);
        const metadata = node?.metadata;
        if (!node || !metadata || metadata.jobId !== job.id) return null;
        const status = nodeStatusOf(job.status);
        const failure = status === "error" ? job.failure : undefined;
        if (metadata.status === status && metadata.errorDetails === failure?.error && metadata.errorKey === failure?.errorKey) return null;
        node.metadata = { ...without(metadata, "errorDetails", "errorKey", "errorParams"), status, ...(failure ? nodeError(failure) : {}) };
        const changed: CanvasChangeSet = { nodes: [node.id], connections: [] };
        for (const file of status === "success" ? job.files : []) {
          if (document.nodes.some((one) => one.metadata?.file?.path === file.path)) continue;
          const type = canvasFileNodeType(file.mime);
          if (type === node.type && !node.metadata.file) {
            node.metadata = { ...node.metadata, file };
            continue;
          }
          if (document.nodes.length >= CANVAS_MAX_NODES) break;
          const made: CanvasNode = { id: this.deps.newId(), type, title: file.name, position: { x: 0, y: 0 }, ...CANVAS_NODE_SIZE[type], metadata: { file }, ...(node.createdBy ? { createdBy: node.createdBy } : {}) };
          made.position = placeAfter(document, node, made, bots);
          const connection: CanvasConnection = { id: this.deps.newId(), fromNodeId: node.id, toNodeId: made.id, kind: "content" };
          document.nodes.push(made);
          document.connections.push(connection);
          changed.nodes.push(made.id);
          changed.connections.push(connection.id);
        }
        return changed;
      });
    } catch (error) {
      this.deps.log(`[project-canvas] ${job.projectId}: job ${job.id} could not be shown on the canvas (${error instanceof Error ? error.message : "unknown"})`);
    }
  }

  /** At start, each node still loading follows its job as generation has it now, since a change made while nobody
   * listened is not told again. A node whose job is gone shows that; one that never got a job is no longer loading. */
  reconcileGenerations(): void {
    try {
      for (const project of this.deps.projects.list()) {
        try {
          for (const node of this.deps.documents.read(project.id).nodes) {
            if (node.metadata?.status !== "loading") continue;
            const { jobId } = node.metadata;
            const job = jobId ? this.deps.generation.job(project.id, jobId) : null;
            if (job) this.jobChanged(job);
            else this.patchNode(project, node.id, (metadata) => {
              if (metadata.status !== "loading" || metadata.jobId !== jobId) return null;
              return jobId ? { ...metadata, status: "error", ...nodeError(userError("serverError.projectGeneration.jobGone")) } : without(metadata, "status");
            });
          }
        } catch (error) {
          this.deps.log(`[project-canvas] ${project.id}: its generations could not be followed again (${error instanceof Error ? error.message : "unknown"})`);
        }
      }
    } catch (error) {
      this.deps.log(`[project-canvas] generations could not be followed again (${error instanceof Error ? error.message : "unknown"})`);
    }
  }
}
