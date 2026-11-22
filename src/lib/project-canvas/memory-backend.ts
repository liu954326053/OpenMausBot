import type { PipelineVideosInput } from "../../../shared/pipeline-run";
import {
  CANVAS_NODE_SIZE,
  CANVAS_UPLOAD_FOLDER,
  botIdOfNode,
  botNodeId,
  canvasFileNodeType,
  replyTitle,
  type CanvasBotState,
  type CanvasConnection,
  type CanvasFileRef,
  type CanvasNode,
  type CanvasOp,
  type CanvasOpsRequest,
  type CanvasOpsResponse,
  type CanvasPoint,
  type CanvasReplyPlaceholder,
  type CanvasSnapshot,
  type CanvasTaskRequest,
} from "../../../shared/project-canvas";
import { connectedReferences, mentionReferences } from "../../../shared/project-canvas-references";
import {
  resolveSettings,
  settingProblems,
  type GenerationFailure,
  type GenerationFailureCode,
  type GenerationJob,
  type GenerationKind,
  type GenerationModel,
  type ImageOverrides,
  type ProjectGenerationSettings,
  type Refused,
  type StartGenerationInput,
  type VideoOverrides,
} from "../../../shared/project-generation";
import { CanvasBackendError, type CanvasBackend } from "./backend";
import { generationInput, nextOutputFrame, takesResultInPlace } from "./generation";
import { applyCanvasOps } from "./ops";
import type { CanvasBotLook, CanvasExchangeMessage } from "./types";

export interface MemoryGenerationOutput {
  file: CanvasFileRef;
  url: string;
  naturalWidth?: number;
  naturalHeight?: number;
  durationMs?: number;
}

/** A bot's task or a generation the backend is working on. */
export type MemoryWork = { kind: "task"; botId: string } | { kind: "generation"; nodeId: string };

export interface MemoryCanvasOptions {
  snapshot: CanvasSnapshot;
  looks?: Record<string, CanvasBotLook>;
  /** Where the page loads each sample file from, by path. */
  fileUrls?: Record<string, string>;
  generation: { settings: ProjectGenerationSettings; servers: string[]; models: Record<string, GenerationModel[]> };
  exchanges?: Record<string, CanvasExchangeMessage[]>;
  /** What a bot answers a task with. */
  reply?: (task: CanvasTaskRequest, bot: CanvasBotState) => string;
  /** The file each result of a generation is. */
  output?: (input: StartGenerationInput, index: number) => MemoryGenerationOutput;
  /** A reason to fail a generation, if it should. */
  fail?: (input: StartGenerationInput) => string | undefined;
  /** What opening the draft in JianYing brings up: the draft itself unless told otherwise. */
  draftOpens?: "draft" | "app";
  /** Where on this computer a picked file is; without it the canvas offers no file to pick. */
  localPathOf?: (file: File) => string;
  /** How long a bot or a generation takes, in milliseconds. */
  delayMs?: number;
  /** Calls `finish` when the work is done and returns what calls it off; by default `ms` later, on a timer. */
  schedule?: (finish: () => void, ms: number, work: MemoryWork) => () => void;
  onOpenChat?: (botId: string, threadId?: string) => void;
}

export interface MemoryCanvasBackend extends CanvasBackend {
  /** The canvas as the "server" holds it. */
  current(): CanvasSnapshot;
  /** Changes what the server derives (bots, members) and tells listeners, as a `bots` event does. */
  updateBots(change: (snapshot: CanvasSnapshot) => void): void;
  readonly openedChats: Array<{ botId: string; threadId?: string }>;
  readonly readConversations: Array<{ botId: string; threadId?: string }>;
  /** The person's answers to the run, in order. */
  readonly videoAnswers: Array<PipelineVideosInput["action"]>;
}

/** A task a bot is on or has queued, with the node its reply becomes when it was written in a text node with text. */
interface BotTask {
  task: CanvasTaskRequest;
  threadId: string;
  beside?: CanvasReplyPlaceholder;
}

const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };

const failure = (code: GenerationFailureCode, error: string, extra: Partial<GenerationFailure> = {}): Refused => ({ refused: { code, error, errorKey: `serverError.generation.${code}`, ...extra } });

function uniquePath(folder: string, name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; ; index += 1) {
    const path = `${folder}/${index === 1 ? name : `${stem} (${index})${extension}`}`;
    if (!taken.has(path)) return path;
  }
}

/** A `CanvasBackend` that keeps one project's canvas in memory and plays the server's part, for previews and tests. */
export function createMemoryCanvasBackend(options: MemoryCanvasOptions): MemoryCanvasBackend {
  let snapshot = structuredClone(options.snapshot);
  let looks = structuredClone(options.looks ?? {});
  let generation = structuredClone(options.generation.settings);
  const projectId = snapshot.project.id;
  const fileUrls = new Map(Object.entries(options.fileUrls ?? {}));
  const exchanges = new Map(Object.entries(structuredClone(options.exchanges ?? {})));
  const listeners = new Set<() => void>();
  const cancelTask = new Map<string, () => void>();
  const botTasks = new Map<string, BotTask[]>();
  const cancelJob = new Map<string, () => void>();
  const jobs = new Map<string, GenerationJob>();
  const delay = options.delayMs ?? 900;
  const schedule = options.schedule ?? ((finish: () => void, ms: number) => {
    const timer = setTimeout(finish, ms);
    return () => clearTimeout(timer);
  });
  const scheduleTask = (botId: string) => cancelTask.set(botId, schedule(() => finishTask(botId), delay, { kind: "task", botId }));
  const openedChats: Array<{ botId: string; threadId?: string }> = [];
  const readConversations: Array<{ botId: string; threadId?: string }> = [];
  const videoAnswers: Array<PipelineVideosInput["action"]> = [];
  let counter = 0;
  const newId = (prefix: string) => `${prefix}-${++counter}`;

  const emit = () => {
    queueMicrotask(() => listeners.forEach((listener) => listener()));
  };
  /** `settle` changes what an operation cannot: the marks and lines only the server sets. */
  const commit = (ops: CanvasOp[], settle?: () => void) => {
    snapshot = { ...applyCanvasOps(snapshot, ops), revision: snapshot.revision + 1 };
    settle?.();
    emit();
  };
  const ensureProject = (id: string) => {
    if (id !== projectId) throw new Error(`No project ${id}`);
  };
  const ensureWritable = () => {
    if (snapshot.readOnly) throw new CanvasBackendError("This project is archived, so its canvas can't change.", { code: "canvas_read_only", error: "This project is archived.", reason: "archived" });
  };
  const nodeById = (id: string) => snapshot.nodes.find((node) => node.id === id);
  const shotOf = (node: CanvasNode) => snapshot.nodes.find((candidate) => candidate.type === "shot" && candidate.id === node.metadata?.shotId);
  const postBots = () => Object.values(snapshot.bots).filter((bot) => bot.stages.includes("post")).map((bot) => botNodeId(bot.botId));
  const pipelineLink = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: newId("connection"), fromNodeId, toNodeId, kind: "content", pipeline: true });
  /** The take becomes its shot's selected one, alone, and the shot's line into the post stage comes from it. */
  const markSelected = (takeId: string, shotId: string) => {
    const takes = new Set(snapshot.nodes.filter((node) => node.metadata?.role === "take" && node.metadata.shotId === shotId).map((node) => node.id));
    const posts = postBots();
    const nodes = snapshot.nodes.map((node) => {
      if (!takes.has(node.id)) return node;
      const { selected: _was, ...metadata } = node.metadata ?? {};
      return { ...node, metadata: node.id === takeId ? { ...metadata, selected: true as const } : metadata };
    });
    const kept = snapshot.connections.filter((connection) => !(connection.pipeline && takes.has(connection.fromNodeId) && posts.includes(connection.toNodeId)));
    snapshot = { ...snapshot, nodes, connections: [...kept, ...posts.map((post) => pipelineLink(takeId, post))] };
  };
  const rightEdge = () => Math.max(0, ...snapshot.nodes.map((node) => node.position.x + node.width)) + 96;
  const setBot = (botId: string, change: Partial<CanvasBotState>) => {
    const bot = snapshot.bots[botId];
    if (!bot) return;
    snapshot = { ...snapshot, bots: { ...snapshot.bots, [botId]: { ...bot, ...change } } };
    emit();
  };

  const pendingTasks = (botId: string) => (botTasks.get(botId) ?? []).filter((one) => one.task.targetNodeId && nodeById(one.task.targetNodeId));
  const showTasks = (botId: string, change: Partial<CanvasBotState>) => {
    const pending = pendingTasks(botId);
    const into = pending.flatMap((one) => (!one.beside && one.task.targetNodeId ? [one.task.targetNodeId] : []));
    const beside = pending.flatMap((one) => (one.beside ? [{ ...one.beside }] : []));
    setBot(botId, { ...change, writingInto: into.length ? into : undefined, writingBeside: beside.length ? beside : undefined });
  };
  const comingReplies = () => [...botTasks.keys()].flatMap((botId) => pendingTasks(botId).flatMap((one) => (one.beside ? [one.beside] : [])));
  const replyNode = (source: CanvasNode): CanvasReplyPlaceholder => ({ id: newId("node"), nodeId: source.id, ...nextOutputFrame(source, "text", snapshot.nodes, snapshot.connections, comingReplies()) });
  const addReply = (source: CanvasNode, task: CanvasTaskRequest, text: string, at: CanvasReplyPlaceholder) => {
    const made: CanvasNode = { id: at.id, type: "text", title: replyTitle(task.text), position: at.position, width: at.width, height: at.height, metadata: { content: text }, createdBy: { kind: "bot", botId: task.botId } };
    const connection: CanvasConnection = { id: newId("connection"), fromNodeId: source.id, toNodeId: made.id, kind: "content" };
    snapshot = { ...snapshot, revision: snapshot.revision + 1, nodes: [...snapshot.nodes, made], connections: [...snapshot.connections, connection] };
    emit();
  };
  const finishTask = (botId: string) => {
    cancelTask.delete(botId);
    const [done, ...rest] = botTasks.get(botId) ?? [];
    const bot = snapshot.bots[botId];
    if (!done || !bot) return;
    botTasks.set(botId, rest);
    const { task, threadId, beside } = done;
    const text = options.reply?.(task, bot) ?? `Done: ${task.text}`;
    const replyId = newId("message");
    exchanges.set(botId, [...(exchanges.get(botId) ?? []), { id: replyId, role: "bot", text, at: Date.now() }]);
    const into = task.targetNodeId ? nodeById(task.targetNodeId) : undefined;
    if (into && (beside || into.metadata?.content?.trim())) addReply(into, task, text, beside ?? replyNode(into));
    else if (into) commit([{ type: "update_node", id: into.id, metadata: { content: text } }]);
    if (rest.length) scheduleTask(botId);
    looks = { ...looks, [botId]: { ...(looks[botId] ?? { color: "silver" }), unread: true } };
    showTasks(botId, { ...(rest.length ? {} : { status: "idle" as const, doing: undefined }), output: { text, threadId, messageId: replyId, at: Date.now() } });
  };

  const finishJob = (job: GenerationJob, input: StartGenerationInput) => {
    cancelJob.delete(job.id);
    const node = nodeById(job.nodeId);
    const reason = options.fail?.(input);
    if (!node || reason) {
      jobs.set(job.id, { ...job, status: "failed", updatedAt: Date.now() });
      const said = reason ? { errorDetails: `${job.server} couldn't make it: ${reason}`, errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: job.server, reason } } : {};
      if (node) commit([{ type: "update_node", id: node.id, metadata: { status: "error", ...said, jobId: null } }]);
      return;
    }
    const count = job.kind === "image" ? job.settings.count : 1;
    const outputs = Array.from({ length: count }, (_, index) => options.output?.(input, index) ?? {
      file: { path: `产出/${job.kind === "image" ? "图片" : "视频"}/${input.name ?? "result"}-${job.id}-${index + 1}.${job.kind === "image" ? "png" : "mp4"}`, mime: job.kind === "image" ? "image/png" : "video/mp4", bytes: 1, name: `result-${index + 1}` },
      url: "",
    });
    const ops: CanvasOp[] = [];
    const shot = node.metadata?.role === "creation" ? shotOf(node) : undefined;
    const takeIds: string[] = [];
    let document = snapshot;
    let inPlace = takesResultInPlace(node);
    outputs.forEach((output) => {
      if (output.url) fileUrls.set(output.file.path, output.url);
      const media = { file: output.file, ...(output.naturalWidth ? { naturalWidth: output.naturalWidth, naturalHeight: output.naturalHeight } : {}), ...(output.durationMs ? { durationMs: output.durationMs } : {}) };
      if (inPlace) {
        inPlace = false;
        ops.push({ type: "update_node", id: node.id, metadata: media });
        return;
      }
      const frame = nextOutputFrame(node, job.kind, document.nodes, document.connections, comingReplies());
      const id = newId("node");
      if (shot) takeIds.push(id);
      const steps: CanvasOp[] = [
        { type: "add_node", id, nodeType: job.kind, title: shot ? node.title : output.file.name, ...frame, metadata: shot ? { ...media, role: "take", shotId: shot.id } : media },
        { type: "connect_nodes", id: newId("connection"), fromNodeId: node.id, toNodeId: id },
      ];
      ops.push(...steps);
      document = applyCanvasOps(document, steps);
    });
    ops.push({ type: "update_node", id: node.id, metadata: { status: "success", errorDetails: null, errorKey: null, errorParams: null, jobId: null } });
    jobs.set(job.id, { ...job, status: "done", updatedAt: Date.now(), files: outputs.map((output) => output.file) });
    commit(ops, () => {
      if (!shot || !takeIds.length) return;
      snapshot = { ...snapshot, connections: snapshot.connections.map((connection) => (connection.fromNodeId === node.id && takeIds.includes(connection.toNodeId) ? { ...connection, pipeline: true as const } : connection)) };
      markSelected(takeIds.at(-1)!, shot.id);
    });
  };

  const backend: MemoryCanvasBackend = {
    openedChats,
    readConversations,
    videoAnswers,
    ...(options.localPathOf ? { localPathOf: options.localPathOf } : {}),
    current: () => structuredClone(snapshot),
    updateBots(change) {
      const next = structuredClone(snapshot);
      change(next);
      snapshot = next;
      emit();
    },

    async readSnapshot(id) {
      ensureProject(id);
      return structuredClone(snapshot);
    },

    async applyOps(id, request: CanvasOpsRequest): Promise<CanvasOpsResponse> {
      ensureProject(id);
      ensureWritable();
      const nodeIds: string[] = [];
      const connectionIds: string[] = [];
      const ops = request.ops.map((op): CanvasOp => {
        if (op.type === "add_node") {
          if (op.id && nodeById(op.id)) throw new Error(`Node ${op.id} already exists.`);
          const added = { ...op, id: op.id ?? newId("node"), position: op.position ?? { x: rightEdge(), y: 0 } };
          nodeIds.push(added.id);
          return added;
        }
        if (op.type === "connect_nodes") {
          const added = { ...op, id: op.id ?? newId("connection") };
          connectionIds.push(added.id);
          return added;
        }
        if (op.type === "delete_node" && [...(op.ids ?? []), ...(op.id ? [op.id] : [])].some((nodeId) => nodeById(nodeId)?.type === "bot")) throw new Error("A bot's node can't be deleted.");
        return op;
      });
      const moved = ops.flatMap((op) => (op.type === "update_node" && op.patch?.position ? [botIdOfNode(op.id)] : [])).filter((botId): botId is string => botId !== null && botId in snapshot.bots);
      commit(ops);
      for (const botId of moved) snapshot = { ...snapshot, bots: { ...snapshot.bots, [botId]: { ...snapshot.bots[botId]!, placed: true } } };
      return { revision: snapshot.revision, nodeIds, connectionIds };
    },

    subscribe(id, onChange) {
      ensureProject(id);
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },

    async uploadFile(id, file, at?: CanvasPoint) {
      ensureProject(id);
      ensureWritable();
      if (snapshot.project.folderState === "missing") throw new Error("The project's folder isn't there, so files can't be added.");
      const taken = new Set(snapshot.nodes.flatMap((node) => (node.metadata?.file ? [node.metadata.file.path] : [])));
      const ref: CanvasFileRef = { path: uniquePath(CANVAS_UPLOAD_FOLDER, file.name, taken), mime: file.type || "application/octet-stream", bytes: file.size, name: file.name };
      const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
      if (url) fileUrls.set(ref.path, url);
      const nodeType = canvasFileNodeType(ref.mime);
      const nodeId = newId("node");
      commit([{ type: "add_node", id: nodeId, nodeType, title: file.name, position: at ?? { x: rightEdge(), y: 0 }, ...CANVAS_NODE_SIZE[nodeType], metadata: { file: ref } }]);
      return { revision: snapshot.revision, nodeId, file: ref };
    },

    fileUrl(id, file) {
      return fileUrls.get(file.path) ?? `/api/team-projects/${encodeURIComponent(id)}/canvas/files?path=${encodeURIComponent(file.path)}`;
    },

    async readBotLooks(id) {
      ensureProject(id);
      return structuredClone(looks);
    },

    async sendTask(id, task) {
      ensureProject(id);
      ensureWritable();
      const bot = snapshot.bots[task.botId];
      if (!bot) throw new Error("That bot isn't in this project.");
      const target = task.targetNodeId ? nodeById(task.targetNodeId) : undefined;
      if (task.targetNodeId && target?.type !== "text") throw new Error("A reply goes into a text node of this canvas, and that is not one.");
      const threadId = task.threadId ?? bot.output?.threadId ?? `thread-${task.botId}`;
      const messageId = newId("message");
      const references = target
        ? mentionReferences(target.id, snapshot.nodes, snapshot.connections).filter((reference) => reference.nodeId !== target.id).length
        : connectedReferences(botNodeId(task.botId), snapshot.nodes, snapshot.connections).length;
      exchanges.set(task.botId, [...(exchanges.get(task.botId) ?? []), { id: messageId, role: "person", text: task.text, at: Date.now() }]);
      const queue = botTasks.get(task.botId) ?? [];
      botTasks.set(task.botId, [...queue, { task, threadId, ...(target?.metadata?.content?.trim() ? { beside: replyNode(target) } : {}) }]);
      if (!queue.length) scheduleTask(task.botId);
      showTasks(task.botId, { status: "working", doing: "Reading what you sent", waiting: undefined });
      return { threadId, messageId, references };
    },

    async stopBot(id, botId) {
      ensureProject(id);
      cancelTask.get(botId)?.();
      cancelTask.delete(botId);
      const queued = (botTasks.get(botId) ?? []).slice(1);
      botTasks.set(botId, queued);
      if (queued.length) scheduleTask(botId);
      showTasks(botId, queued.length ? {} : { status: "idle", doing: undefined });
    },

    async readExchange(id, botId) {
      ensureProject(id);
      const messages = exchanges.get(botId) ?? [];
      const lastAsk = messages.findLastIndex((message) => message.role === "person");
      return structuredClone(lastAsk < 0 ? messages.slice(-1) : messages.slice(lastAsk));
    },

    openChat(id, botId, threadId) {
      ensureProject(id);
      openedChats.push({ botId, ...(threadId ? { threadId } : {}) });
      options.onOpenChat?.(botId, threadId);
    },

    readConversation(id, botId, threadId) {
      ensureProject(id);
      readConversations.push({ botId, ...(threadId ? { threadId } : {}) });
      const look = looks[botId];
      if (!look?.unread) return;
      const { unread: _read, ...read } = look;
      looks = { ...looks, [botId]: read };
      emit();
    },

    async readGenerationSettings(id) {
      ensureProject(id);
      return { settings: structuredClone(generation), servers: [...options.generation.servers] };
    },

    async saveGenerationSettings(id, settings) {
      ensureProject(id);
      for (const kind of ["image", "video"] as const) {
        const server = settings[kind].server;
        const models = server ? options.generation.models[server] ?? [] : [];
        if (!server || !settings[kind].defaults.model) continue;
        const problems = settingProblems(kind, settings[kind].defaults, models);
        if (problems.length) return failure(problems[0]!.key === "model" ? "model_unknown" : "setting_refused", "The model doesn't offer that setting.", { problems });
      }
      generation = structuredClone(settings);
      return { settings: structuredClone(generation), servers: [...options.generation.servers] };
    },

    async listModels(id, kind, preview) {
      ensureProject(id);
      const server = preview?.server ?? generation[kind].server;
      if (!server) return failure("no_server", "Choose an MCP server for this project first.");
      const models = options.generation.models[server];
      if (!models) return failure("server_unusable", `The MCP server ${server} can't be used.`, { errorParams: { server } });
      return { models: models.filter((model) => model.kind === kind) };
    },

    async startGeneration(id, { nodeId }) {
      ensureProject(id);
      ensureWritable();
      const node = nodeById(nodeId);
      if (!node) throw new Error(`No node ${nodeId} on this canvas.`);
      const own = node.metadata?.prompt?.trim();
      const prompt = own || (node.metadata?.role === "creation" ? shotOf(node)?.metadata?.prompt?.trim() : undefined) || "";
      const input = generationInput(node, snapshot.nodes, snapshot.connections, prompt);
      if (!input) throw new Error("Only shot, image, video and config nodes are generated.");
      if (node.metadata?.status === "loading") throw new Error(`${nodeId} is being generated already.`);
      if (!input.prompt) throw new Error(`${nodeId} has no prompt; give it one first.`);
      const kind: GenerationKind = input.kind;
      const server = generation[kind].server;
      if (!server) return failure("no_server", "Choose an MCP server for this project first.");
      const settings = resolveSettings(kind, generation[kind].defaults, input.overrides);
      if (!settings.model) return failure("no_model", "Choose a model first.");
      const references = { images: input.references?.images ?? [], audio: input.references?.audio ?? [] };
      const problems = settingProblems(kind, settings, options.generation.models[server] ?? [], { images: references.images.length, audio: references.audio.length });
      if (problems.length) return failure(problems[0]!.key === "model" ? "model_unknown" : "setting_refused", "The model doesn't offer that setting.", { problems });
      const now = Date.now();
      const base = { id: newId("job"), projectId, status: "queued" as const, nodeId: node.id, requester: { kind: "person" as const }, prompt: input.prompt, references, server, tool: generation[kind].tools.generate, files: [], createdAt: now, updatedAt: now };
      const job: GenerationJob = kind === "image"
        ? { ...base, kind, settings: resolveSettings(kind, generation.image.defaults, input.overrides as ImageOverrides) }
        : { ...base, kind, settings: resolveSettings(kind, generation.video.defaults, input.overrides as VideoOverrides) };
      jobs.set(job.id, job);
      commit([{ type: "update_node", id: node.id, metadata: { status: "loading", jobId: job.id, errorDetails: null, errorKey: null, errorParams: null } }]);
      cancelJob.set(job.id, schedule(() => finishJob(job, input), delay * 2, { kind: "generation", nodeId: node.id }));
      return { jobId: job.id };
    },

    async cancelGeneration(id, jobId) {
      ensureProject(id);
      cancelJob.get(jobId)?.();
      cancelJob.delete(jobId);
      const job = jobs.get(jobId);
      if (!job) return;
      jobs.set(jobId, { ...job, status: "cancelled", updatedAt: Date.now() });
      const node = nodeById(job.nodeId);
      if (node?.metadata?.jobId === jobId) commit([{ type: "update_node", id: node.id, metadata: { status: node.metadata.file ? "success" : "idle", jobId: null } }]);
    },

    async selectTake(id, nodeId) {
      ensureProject(id);
      ensureWritable();
      const take = nodeById(nodeId);
      const shotId = take?.metadata?.role === "take" ? take.metadata.shotId : undefined;
      if (!take || !shotId) throw new Error(`${nodeId} is not a take of a shot.`);
      commit([], () => markSelected(take.id, shotId));
      return { revision: snapshot.revision };
    },

    async answerVideos(id, { action }) {
      ensureProject(id);
      ensureWritable();
      const run = snapshot.run;
      if (!run) throw new Error("This project has no run.");
      if (run.videos.status !== (action === "start" ? "confirm" : "failed")) throw new Error("The run isn't waiting for that answer.");
      videoAnswers.push(action);
      const videos = action === "skip" ? { ...run.videos, status: "done" as const } : { ...run.videos, status: "working" as const, failed: 0 };
      snapshot = { ...snapshot, run: { ...run, videos } };
      emit();
    },

    async openDraft(id) {
      ensureProject(id);
      const state = snapshot.draft?.state;
      if (state !== "written" && state !== "kept") throw new Error("There is no draft to open yet.");
      return { opened: options.draftOpens ?? "draft" };
    },

    async setFinalFilm(id, { path }) {
      ensureProject(id);
      ensureWritable();
      const parts = path.split("/");
      const name = parts.at(-1);
      if (!name || path.startsWith("/") || parts.includes("..")) throw new Error("The finished film has to be a file in the project folder.");
      const mime = VIDEO_TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()];
      if (!mime) throw new Error(`${name} is not a video.`);
      const file: CanvasFileRef = { path, mime, bytes: 0, name };
      const film = snapshot.nodes.find((node) => node.metadata?.role === "final");
      if (film) return commit([{ type: "update_node", id: film.id, patch: { title: name }, metadata: { file } }]);
      const post = postBots().map(nodeById).find((node) => node !== undefined);
      const frame = post ? nextOutputFrame(post, "video", snapshot.nodes, snapshot.connections, comingReplies()) : { position: { x: rightEdge(), y: 0 }, ...CANVAS_NODE_SIZE.video };
      const nodeId = newId("node");
      commit([{ type: "add_node", id: nodeId, nodeType: "video", title: name, ...frame, metadata: { role: "final", file } }], () => {
        if (post) snapshot = { ...snapshot, connections: [...snapshot.connections, pipelineLink(post.id, nodeId)] };
      });
    },
  };
  return backend;
}
