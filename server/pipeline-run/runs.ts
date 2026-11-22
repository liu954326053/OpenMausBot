import type { PipelineRunWire, PipelineVideosInput } from "../../shared/pipeline-run.ts";
import type { ProjectDraftWire } from "../../shared/project-draft.ts";
import type { PipelineStage } from "../../shared/team-pipeline.ts";
import type { TeamProjectsApi, TeamProjectWire } from "../../shared/team-projects.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import { intlLocale } from "../language.ts";
import type { CanvasFlow } from "../project-canvas/flow.ts";
import type { CanvasPipelineEvent, PipelineShot } from "../project-canvas/pipeline-api.ts";
import { CanvasRefusal, readOnlyRefusal } from "../project-canvas/service.ts";
import { replyText } from "../project-canvas/task-targets.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";
import type { Message, Store } from "../store.ts";
import { userError } from "../user-errors.ts";
import { handBackOf, handOffOf, lastReply, turnEndOf, type TurnEnd } from "./lines.ts";
import { plannedStages, stageNeeds } from "./plan.ts";
import type { PipelineRunFiles, RunStage, RunTask, StoredRun } from "./store.ts";

/** What the run reads and changes on the project's canvas. */
export interface RunCanvas {
  shots(projectId: string): PipelineShot[];
  textNodes(projectId: string): Array<{ nodeId: string; botId?: string }>;
  addText(projectId: string, botId: string, title: string, content: string): { nodeId: string };
  markScript(projectId: string, nodeId: string): unknown;
  /** The message a stage's task gives a bot: `request`, then what is connected to its node. */
  taskFor(project: TeamProjectWire, botId: string, request: string, language: string | undefined): Promise<string>;
  /** Starts generating a shot's video from its creation node, as the person confirming it; false when it did not start. */
  generate(project: TeamProjectWire, creationNodeId: string): Promise<boolean>;
}

/** What the run asks of the project's JianYing draft. */
export interface RunDraft {
  /** Never throws. */
  writeDraftIfReady(projectId: string): Promise<void>;
  /** The film plays these shots only, in their order on the canvas. */
  playOnly(projectId: string, shotIds: readonly string[]): Promise<void>;
  /** The draft as the computer it is on sees it. */
  draft(projectId: string): ProjectDraftWire | undefined;
}

export interface PipelineRunsDeps {
  projects: Pick<TeamProjectsApi, "list">;
  store: Pick<Store, "bot" | "botByThread" | "activePath" | "appendMessage">;
  flowOf(project: TeamProjectWire): Pick<CanvasFlow, "botIds" | "stages">;
  canvas: RunCanvas;
  draft: RunDraft;
  /**
   * Sends `text` to a bot's conversation for the project's lead, queued behind a turn that runs.
   *
   * Known open risk: it reaches the bot as a message on the person's channel, and so does what earlier stages' bots
   * wrote, quoted in it as the canvas's references, as a task the person sends from the canvas carries them.
   */
  deliver(message: { botId: string; threadId: string; text: string; leadBotId: string }): Promise<DirectSendReceipt>;
  mainThread(botId: string): string | undefined;
  /** The conversation waits for the person to answer what the bot asked in it since `since`. */
  waitingOnPerson(botId: string, threadId: string, since: number): boolean;
  /** The language the server writes its own lines in. */
  language(): string | undefined;
  files: Pick<PipelineRunFiles, "read" | "write">;
  /** What the run's wire answers changed: open apps read the canvas again. */
  changed(projectId: string): void;
  now(): number;
  newId(): string;
  log(line: string): void;
}

const STAGE_NAME: Record<PipelineStage, ServerLineKey> = {
  script: "server.pipelineRun.stage.script",
  character: "server.pipelineRun.stage.character",
  storyboard: "server.pipelineRun.stage.storyboard",
  post: "server.pipelineRun.stage.post",
};

const TASK: Record<PipelineStage, ServerLineKey> = {
  script: "server.pipelineRun.task.script",
  character: "server.pipelineRun.task.character",
  storyboard: "server.pipelineRun.task.storyboard",
  post: "server.pipelineRun.task.post",
};

const COUNTED = {
  confirm: ["server.pipelineRun.note.confirm.one", "server.pipelineRun.note.confirm.many"],
  videosFailed: ["server.pipelineRun.note.videosFailed.one", "server.pipelineRun.note.videosFailed.many"],
  videosSkipped: ["server.pipelineRun.note.videosSkipped.one", "server.pipelineRun.note.videosSkipped.many"],
} as const satisfies Record<string, readonly [ServerLineKey, ServerLineKey]>;

const counted = (lines: keyof typeof COUNTED, count: number): ServerLineKey => COUNTED[lines][count === 1 ? 0 : 1];

const ACTIONS = ["start", "retry", "skip"] as const satisfies ReadonlyArray<PipelineVideosInput["action"]>;

const failure = (error: unknown) => (error instanceof Error ? error.message : "unknown");

/**
 * Each project's pipeline run: it starts when the project's lead hands the first stage its task, takes each stage's
 * end from its bots' turns, gives the next stages their tasks in the bots' main conversations, asks the person before
 * the shots' videos are generated, and writes the JianYing draft before post and once more at the end. A stage that
 * fails stops the run and goes back to the lead, who decides what happens next.
 */
export class PipelineRuns {
  private readonly deps: PipelineRunsDeps;
  private readonly runs = new Map<string, StoredRun | null>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(deps: PipelineRunsDeps) {
    this.deps = deps;
  }

  /** The project's latest run as the app draws it; undefined before its first. */
  wire(projectId: string): PipelineRunWire | undefined {
    const run = this.run(projectId);
    if (!run) return undefined;
    const shots = this.shots(projectId);
    const missing = shots.filter((shot) => !shot.take);
    const failed = run.videos.status === "failed" ? missing.filter((shot) => shot.status !== "loading") : missing.filter((shot) => shot.status === "error");
    return {
      id: run.id,
      startedAt: run.startedAt,
      ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
      stages: run.stages.map(({ stage, botIds, status }) => ({ stage, botIds: [...botIds], status })),
      videos: { status: run.videos.status, shots: shots.length, ready: shots.length - missing.length, failed: failed.length },
    };
  }

  /** A line of a conversation, new or changed. */
  heard(threadId: string, message: Message): void {
    const relevant = handOffOf(message) || handBackOf(message) || (message.role === "user" && message.queueId) || turnEndOf(message);
    if (!relevant) return;
    const projectId = this.deps.store.botByThread(threadId)?.teamProject?.id;
    if (!projectId) return;
    void this.serially(projectId, () => this.hear(projectId, threadId, message)).catch((error: unknown) => {
      this.deps.log(`[pipeline-run] ${projectId}: a line could not be followed (${failure(error)})`);
    });
  }

  /** What happened to the pipeline's nodes on a canvas. */
  canvasEvent(event: CanvasPipelineEvent): void {
    const followed = event.kind === "take" || event.kind === "selected" || (event.kind === "role" && event.role === "final");
    if (!followed) return;
    void this.serially(event.projectId, async () => {
      const project = this.project(event.projectId);
      const run = this.run(event.projectId);
      if (!project || !run || run.endedAt !== undefined) return;
      if (event.kind === "role") this.note(project, "server.pipelineRun.note.final");
      else await this.videosSettled(project, run);
    }).catch((error: unknown) => {
      this.deps.log(`[pipeline-run] ${event.projectId}: a ${event.kind} on the canvas could not be followed (${failure(error)})`);
    });
  }

  /** The person's answer to the shots' videos: generate them, generate the failed ones again, or go on without them. */
  answerVideos(projectId: string, body: unknown): Promise<PipelineRunWire> {
    const action = body && typeof body === "object" ? (body as Record<string, unknown>).action : undefined;
    const chosen = ACTIONS.find((one) => one === action);
    if (!chosen) return Promise.reject(new CanvasRefusal(400, userError("serverError.pipelineRun.actionInvalid")));
    return this.serially(projectId, async () => {
      const project = this.project(projectId);
      if (!project) throw new CanvasRefusal(404, userError("serverError.teamProject.notFound"));
      if (project.archivedAt !== undefined) throw readOnlyRefusal();
      const run = this.run(projectId);
      if (!run || run.endedAt !== undefined || run.videos.status !== (chosen === "start" ? "confirm" : "failed")) {
        throw new CanvasRefusal(409, userError("serverError.pipelineRun.notWaiting"));
      }
      if (chosen === "skip") await this.skipVideos(project, run);
      else await this.generateVideos(project, run);
      this.deps.changed(projectId);
      return this.wire(projectId)!;
    });
  }

  /** After a restart: the turns that ended while the server was down end their tasks, and generations that ended
   * settle the videos. */
  async resume(): Promise<void> {
    for (const project of this.deps.projects.list()) {
      if (project.archivedAt !== undefined) continue;
      const run = this.run(project.id);
      if (!run || run.endedAt !== undefined) continue;
      await this.serially(project.id, async () => {
        for (const stage of run.stages.filter((one) => one.status === "working")) {
          for (const task of stage.tasks.filter((one) => !one.outcome)) {
            const end = this.endSince(project, task);
            if (end) await this.ended(project, run, stage, task, end);
          }
        }
        await this.videosSettled(project, run);
      }).catch((error: unknown) => {
        this.deps.log(`[pipeline-run] ${project.id}: the run could not be resumed (${failure(error)})`);
      });
    }
  }

  private serially<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectId) ?? Promise.resolve()).then(work, work);
    const settled = next.catch(() => undefined);
    this.queues.set(projectId, settled);
    void settled.then(() => {
      if (this.queues.get(projectId) === settled) this.queues.delete(projectId);
    });
    return next;
  }

  private project(projectId: string): TeamProjectWire | undefined {
    return this.deps.projects.list().find((project) => project.id === projectId);
  }

  private run(projectId: string): StoredRun | null {
    if (!this.runs.has(projectId)) this.runs.set(projectId, this.deps.files.read(projectId));
    return this.runs.get(projectId) ?? null;
  }

  private save(projectId: string, run: StoredRun): void {
    this.runs.set(projectId, run);
    try {
      this.deps.files.write(projectId, run);
    } catch (error) {
      this.deps.log(`[pipeline-run] ${projectId}: the run could not be saved (${failure(error)})`);
    }
    this.deps.changed(projectId);
  }

  private shots(projectId: string): PipelineShot[] {
    try {
      return this.deps.canvas.shots(projectId);
    } catch {
      return [];
    }
  }

  private names(botIds: readonly string[]): string {
    return new Intl.ListFormat(intlLocale(this.deps.language()), { type: "conjunction" }).format(botIds.map((botId) => this.deps.store.bot(botId)?.name ?? botId));
  }

  private async hear(projectId: string, threadId: string, message: Message): Promise<void> {
    const project = this.project(projectId);
    const bot = this.deps.store.botByThread(threadId);
    if (!project || !bot || project.archivedAt !== undefined || !project.botIds.includes(bot.id)) return;
    const handed = handOffOf(message);
    if (handed) {
      this.handed(project, bot.id, threadId, handed.fromBotId, message.at);
      return;
    }
    const run = this.run(projectId);
    if (!run || run.endedAt !== undefined) return;
    const back = handBackOf(message);
    if (back) {
      if (bot.id !== project.leadBotId) return;
      const found = this.taskOf(run, (task) => task.via === "handoff" && task.botId === back.botId && task.threadId === back.threadId && !task.outcome);
      if (!found) return;
      const end: TurnEnd = back.ok ? { ok: true, reply: lastReply(this.deps.store.activePath(back.threadId), found.task.at ?? 0) } : { ok: false };
      await this.ended(project, run, found.stage, found.task, end);
      return;
    }
    if (message.role === "user") {
      const { queueId } = message;
      const found = queueId ? this.taskOf(run, (task) => task.threadId === threadId && task.queueId === queueId && task.requestId === undefined) : null;
      if (!found) return;
      found.task.requestId = message.id;
      found.task.at = message.at;
      this.save(projectId, run);
      return;
    }
    const end = turnEndOf(message);
    if (!end) return;
    const found = this.taskOf(run, (task, stage) => task.via === "relay" && task.threadId === threadId && task.at !== undefined && task.at <= message.at
      && (!task.outcome || (end.ok && task.outcome === "failed" && stage.status === "failed")));
    if (!found || (end.ok && this.deps.waitingOnPerson(bot.id, threadId, found.task.at!))) return;
    await this.ended(project, run, found.stage, found.task, end);
  }

  private taskOf(run: StoredRun, match: (task: RunTask, stage: RunStage) => boolean): { stage: RunStage; task: RunTask } | null {
    for (const stage of run.stages) {
      const task = stage.tasks.find((one) => match(one, stage));
      if (task) return { stage, task };
    }
    return null;
  }

  /** The lead handed a bot of the first stage its task: a run starts, unless one is under way, or the task joins it. */
  private handed(project: TeamProjectWire, botId: string, threadId: string, fromBotId: string, at: number): void {
    if (fromBotId !== project.leadBotId || botId === project.leadBotId) return;
    const planned = plannedStages(this.deps.flowOf(project));
    if (!planned[0]?.botIds.includes(botId)) return;
    const current = this.run(project.id);
    const parked = current !== null && (current.endedAt !== undefined || current.stages.some((stage) => stage.status === "failed")
      || current.videos.status === "confirm" || current.videos.status === "failed");
    let run = current;
    if (!run || parked) {
      const before = this.textNodeIds(project.id);
      run = {
        id: this.deps.newId(),
        startedAt: this.deps.now(),
        stages: planned.map(({ stage, botIds }, index) => ({
          stage, botIds, status: index === 0 ? "working" : "waiting", tasks: [], ...(index === 0 ? { textNodesBefore: before } : {}),
        })),
        videos: { status: "waiting" },
      };
    }
    const first = run.stages[0];
    if (first?.stage !== planned[0]!.stage || first.status !== "working") return;
    if (first.tasks.some((task) => task.botId === botId && task.threadId === threadId && !task.outcome)) return;
    first.tasks = [...first.tasks.filter((task) => task.botId !== botId), { botId, threadId, via: "handoff", at }];
    this.save(project.id, run);
  }

  private textNodeIds(projectId: string): string[] {
    try {
      return this.deps.canvas.textNodes(projectId).map((node) => node.nodeId);
    } catch {
      return [];
    }
  }

  /** The end of a turn that ends nothing yet, found in its conversation. */
  private endSince(project: TeamProjectWire, task: RunTask): TurnEnd | null {
    if (task.at === undefined) return null;
    if (task.via === "handoff") {
      const lead = this.deps.mainThread(project.leadBotId);
      const back = lead ? this.deps.store.activePath(lead).map(handBackOf).find((one) => one?.botId === task.botId && one.threadId === task.threadId) : undefined;
      if (!back) return null;
      return back.ok ? { ok: true, reply: lastReply(this.deps.store.activePath(task.threadId), task.at) } : { ok: false };
    }
    const path = this.deps.store.activePath(task.threadId);
    for (const message of path) {
      if (message.at < task.at) continue;
      const end = turnEndOf(message);
      if (end && !(end.ok && this.deps.waitingOnPerson(task.botId, task.threadId, task.at))) return end;
    }
    return null;
  }

  private async ended(project: TeamProjectWire, run: StoredRun, stage: RunStage, task: RunTask, end: TurnEnd): Promise<void> {
    task.outcome = end.ok ? "ok" : "failed";
    if (end.ok && end.reply) task.reply = replyText(end.reply);
    else delete task.reply;
    this.save(project.id, run);
    await this.settle(project, run, stage);
  }

  /** A stage whose every task ended: failed when one did not end well, done otherwise, and then the run goes on. */
  private async settle(project: TeamProjectWire, run: StoredRun, stage: RunStage): Promise<void> {
    if (!stage.tasks.length || stage.tasks.some((task) => !task.outcome)) return;
    const language = this.deps.language();
    const stageName = serverLine(language, STAGE_NAME[stage.stage]);
    const failed = stage.tasks.filter((task) => task.outcome === "failed");
    if (failed.length) {
      if (stage.status === "failed") return;
      stage.status = "failed";
      this.save(project.id, run);
      await this.tellLead(project, "server.pipelineRun.lead.stageFailed", { stage: stageName, bots: this.names(failed.map((task) => task.botId)) });
      return;
    }
    stage.status = "done";
    this.save(project.id, run);
    if (stage.stage === "script") this.placeScript(project, stage);
    this.note(project, "server.pipelineRun.note.stageDone", { stage: stageName });
    await this.advance(project, run);
  }

  /** The script is the newest text node a script bot added during the stage, or else a new one holding its reply. */
  private placeScript(project: TeamProjectWire, stage: RunStage): void {
    const before = new Set(stage.textNodesBefore ?? []);
    const title = serverLine(this.deps.language(), "server.pipelineRun.scriptTitle");
    for (const task of stage.tasks) {
      try {
        const added = this.deps.canvas.textNodes(project.id).filter((node) => node.botId === task.botId && !before.has(node.nodeId)).at(-1)?.nodeId;
        const nodeId = added ?? (task.reply ? this.deps.canvas.addText(project.id, task.botId, title, task.reply).nodeId : undefined);
        if (nodeId) this.deps.canvas.markScript(project.id, nodeId);
      } catch (error) {
        this.deps.log(`[pipeline-run] ${project.id}: the script of ${task.botId} could not be marked (${failure(error)})`);
      }
    }
  }

  /** Starts every waiting stage whose stages before it are done, and the videos once the storyboard is; ends the run when
   * nothing is left. */
  private async advance(project: TeamProjectWire, run: StoredRun): Promise<void> {
    const staffed = run.stages.map(({ stage }) => stage);
    const statusOf = (stage: PipelineStage) => run.stages.find((one) => one.stage === stage)?.status;
    const storyboard = run.stages.find((one) => one.stage === "storyboard");
    for (let moved = true; moved && run.endedAt === undefined;) {
      moved = false;
      if (storyboard?.status === "done" && run.videos.status === "waiting") {
        await this.shotsMade(project, run, storyboard);
        moved = true;
        continue;
      }
      const ready = run.stages.find((stage) => {
        if (stage.status !== "waiting") return false;
        const needs = stageNeeds(stage.stage, staffed);
        return needs.stages.every((one) => statusOf(one) === "done") && (!needs.videos || run.videos.status === "done");
      });
      if (ready) {
        await this.start(project, run, ready);
        moved = true;
      }
    }
    const finished = run.stages.every((stage) => stage.status === "done") && (!storyboard || run.videos.status === "done");
    if (finished && run.endedAt === undefined) await this.finish(project, run);
  }

  /** The storyboard is done: with no shot it failed; with every shot generated the videos are done; otherwise the person
   * is asked before they are generated. */
  private async shotsMade(project: TeamProjectWire, run: StoredRun, storyboard: RunStage): Promise<void> {
    const shots = this.shots(project.id);
    if (!shots.length) {
      storyboard.status = "failed";
      this.save(project.id, run);
      await this.tellLead(project, "server.pipelineRun.lead.noShots", { bots: this.names(storyboard.botIds) });
      return;
    }
    const missing = shots.filter((shot) => !shot.take).length;
    run.videos = { status: missing ? "confirm" : "done" };
    this.save(project.id, run);
    if (missing) this.note(project, counted("confirm", missing), { count: missing });
    else this.note(project, "server.pipelineRun.note.videosDone");
  }

  private async start(project: TeamProjectWire, run: StoredRun, stage: RunStage): Promise<void> {
    stage.status = "working";
    stage.textNodesBefore = this.textNodeIds(project.id);
    this.save(project.id, run);
    if (stage.stage === "post") await this.deps.draft.writeDraftIfReady(project.id);
    const language = this.deps.language();
    const request = this.request(project, stage.stage, language);
    for (const botId of stage.botIds) {
      const threadId = this.deps.mainThread(botId) ?? this.deps.store.bot(botId)?.threadId;
      if (!threadId) {
        stage.tasks.push({ botId, threadId: botId, via: "relay", outcome: "failed" });
        continue;
      }
      try {
        const text = await this.deps.canvas.taskFor(project, botId, request, language);
        const receipt = await this.deps.deliver({ botId, threadId, text, leadBotId: project.leadBotId });
        const sent = "queued" in receipt ? { queueId: receipt.queueId } : { requestId: receipt.message.id, at: receipt.message.at };
        stage.tasks.push({ botId, threadId: receipt.threadId, via: "relay", ...sent });
      } catch (error) {
        this.deps.log(`[pipeline-run] ${project.id}: the ${stage.stage} task did not reach ${botId} (${failure(error)})`);
        stage.tasks.push({ botId, threadId, via: "relay", outcome: "failed" });
      }
    }
    this.save(project.id, run);
    this.note(project, "server.pipelineRun.note.started", { stage: serverLine(language, STAGE_NAME[stage.stage]), bots: this.names(stage.botIds) });
    await this.settle(project, run, stage);
  }

  private request(project: TeamProjectWire, stage: PipelineStage, language: string | undefined): string {
    const params = { project: project.name, lead: this.names([project.leadBotId]) };
    if (stage !== "post") return serverLine(language, TASK[stage], params);
    const draft = this.deps.draft.draft(project.id);
    return draft?.name && (draft.state === "written" || draft.state === "kept")
      ? serverLine(language, TASK.post, { ...params, draft: draft.name })
      : serverLine(language, "server.pipelineRun.task.postNoDraft", params);
  }

  private async generateVideos(project: TeamProjectWire, run: StoredRun): Promise<void> {
    run.videos = { status: "working" };
    this.save(project.id, run);
    for (const shot of this.shots(project.id)) {
      if (shot.take || !shot.creationNodeId || shot.status === "loading") continue;
      try {
        if (!await this.deps.canvas.generate(project, shot.creationNodeId)) this.deps.log(`[pipeline-run] ${project.id}: shot ${shot.shotId} did not start generating`);
      } catch (error) {
        this.deps.log(`[pipeline-run] ${project.id}: shot ${shot.shotId} could not be generated (${failure(error)})`);
      }
    }
    await this.videosSettled(project, run);
  }

  private async skipVideos(project: TeamProjectWire, run: StoredRun): Promise<void> {
    const shots = this.shots(project.id);
    const kept = shots.filter((shot) => shot.take).map((shot) => shot.shotId);
    run.videos = { status: "done", skipped: true };
    this.save(project.id, run);
    try {
      await this.deps.draft.playOnly(project.id, kept);
    } catch (error) {
      this.deps.log(`[pipeline-run] ${project.id}: the shots without a video could not be left out (${failure(error)})`);
    }
    this.note(project, counted("videosSkipped", shots.length - kept.length), { count: shots.length - kept.length });
    await this.advance(project, run);
  }

  /** Once no shot is generating: every shot has its take and the run goes on, or the person decides about the rest. A
   * run waiting for the person goes on too once every shot has a take. */
  private async videosSettled(project: TeamProjectWire, run: StoredRun): Promise<void> {
    if (run.endedAt !== undefined || !["working", "confirm", "failed"].includes(run.videos.status)) return;
    const shots = this.shots(project.id);
    if (shots.some((shot) => shot.status === "loading")) {
      this.deps.changed(project.id);
      return;
    }
    const missing = shots.filter((shot) => !shot.take).length;
    if (shots.length && !missing) {
      run.videos = { status: "done" };
      this.save(project.id, run);
      this.note(project, "server.pipelineRun.note.videosDone");
      await this.advance(project, run);
      return;
    }
    if (run.videos.status !== "working") {
      this.deps.changed(project.id);
      return;
    }
    run.videos = { status: "failed" };
    this.save(project.id, run);
    this.note(project, counted("videosFailed", missing), { count: missing });
  }

  private async finish(project: TeamProjectWire, run: StoredRun): Promise<void> {
    await this.deps.draft.writeDraftIfReady(project.id);
    run.endedAt = this.deps.now();
    this.save(project.id, run);
    const draft = this.deps.draft.draft(project.id);
    const written = draft?.name && (draft.state === "written" || draft.state === "kept") ? draft.name : undefined;
    await this.tellLead(project, written ? "server.pipelineRun.lead.done" : "server.pipelineRun.lead.doneNoDraft", { project: project.name, ...(written ? { draft: written } : {}) });
  }

  /** A turn of the lead's, in its main conversation, that decides what happens next. */
  private async tellLead(project: TeamProjectWire, key: ServerLineKey, params: Record<string, string | number>): Promise<void> {
    const threadId = this.deps.mainThread(project.leadBotId);
    if (!threadId) return;
    try {
      await this.deps.deliver({ botId: project.leadBotId, threadId, text: serverLine(this.deps.language(), key, { project: project.name, ...params }), leadBotId: project.leadBotId });
    } catch (error) {
      this.deps.log(`[pipeline-run] ${project.id}: the lead could not be told (${failure(error)})`);
    }
  }

  /** A row in the lead's main conversation that says where the run is, and starts no turn. */
  private note(project: TeamProjectWire, key: ServerLineKey, params?: Record<string, string | number>): void {
    const threadId = this.deps.mainThread(project.leadBotId);
    if (!threadId) return;
    try {
      this.deps.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: serverLine(this.deps.language(), key, params), ok: true } });
    } catch (error) {
      this.deps.log(`[pipeline-run] ${project.id}: the lead's conversation could not be told (${failure(error)})`);
    }
  }
}
