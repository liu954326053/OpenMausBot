import {
  DRAMA_JOBS, episodeCode, PRODUCTION_JOBS,
  type DramaJob, type EpisodeJob, type ProductionConcurrency, type ProductionEpisodeStatus, type ProductionEpisodeWire, type ProductionJob,
  type ProductionTaskStatus, type ProductionWire,
} from "../../shared/production.ts";
import { botIdOfNode } from "../../shared/project-canvas.ts";
import type { ProjectDraftWire } from "../../shared/project-draft.ts";
import type { FlowLineWire, FlowStage } from "../../shared/team-pipeline.ts";
import type { TeamProjectsApi, TeamProjectWire } from "../../shared/team-projects.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import { intlLocale } from "../language.ts";
import type { ProjectPipeline } from "../project-canvas/flow.ts";
import type { CanvasEpisode, CanvasProfile, PipelineShot, PipelineView } from "../project-canvas/pipeline-api.ts";
import { CanvasRefusal, readOnlyRefusal } from "../project-canvas/service.ts";
import { replyText, roomTurnClosedBy } from "../project-canvas/task-targets.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";
import type { Message, Store } from "../store.ts";
import type { ProjectRoom } from "../team-projects/project-rooms.ts";
import { quietMentions } from "../team-projects/room-send.ts";
import { userError } from "../user-errors.ts";
import { defaultAssignments, type ProductionMember } from "./assign.ts";
import { turnEndOf, type TurnEnd } from "./lines.ts";
import type { ProductionFiles, ProductionTask, StoredEpisode, StoredProduction } from "./store.ts";

/** What the production reads and changes on the project's canvas. */
export interface ProductionCanvas {
  episodes(projectId: string): CanvasEpisode[];
  shots(projectId: string): PipelineShot[];
  profiles(projectId: string): CanvasProfile[];
  /** The three above from one reading of the canvas. */
  view(projectId: string): PipelineView;
  /** Puts the brief the lead agreed on and the node that stands for its split of the work on the canvas, as the lead's. */
  setBrief(projectId: string, leadBotId: string, rows: ReadonlyArray<readonly [string, string]>, titles: { brief: string; plan: string }): void;
  /** The message a task gives a bot: `request`, then what is connected to its node. */
  taskFor(project: TeamProjectWire, botId: string, request: string, language: string | undefined): Promise<string>;
  /** Starts generating a node as the person confirming it would. Null once it started, else why it did not, in
   * English. Never throws. */
  generate(project: TeamProjectWire, nodeId: string): Promise<string | null>;
}

/** What the production asks of each episode's JianYing draft. */
export interface ProductionDrafts {
  /** Never throws. */
  writeDraftIfReady(projectId: string, episode: number): Promise<void>;
  /** The draft as the computer it is on sees it. */
  draft(projectId: string, episode: number): ProjectDraftWire | undefined;
}

export interface ProductionDeps {
  projects: Pick<TeamProjectsApi, "list">;
  store: Pick<Store, "bot" | "botByThread" | "activePath" | "appendMessage">;
  canvas: ProductionCanvas;
  drafts: ProductionDrafts;
  /** The bot that does `job` for `episode`: the one the project has, else a new copy of `templateBotId`. Throws when
   * none can be made. */
  episodeBot(projectId: string, templateBotId: string, episode: number, job: EpisodeJob): Promise<string>;
  concurrency(projectId: string): ProductionConcurrency;
  /**
   * Sends `text` to a bot's conversation for the project's lead, queued behind a turn that runs.
   *
   * Known open risk: it reaches the bot as a message on the person's channel, and so does what other bots wrote,
   * quoted in it as the canvas's references, as a task the person sends from the canvas carries them.
   */
  deliver(message: { botId: string; threadId: string; text: string; leadBotId: string }): Promise<DirectSendReceipt>;
  /** The project's group chat; undefined while it has none. */
  room(project: TeamProjectWire): ProjectRoom | undefined;
  /** The project whose group chat this conversation is in. */
  projectOfRoom(threadId: string): string | undefined;
  /** Sends a line into the project's group chat that each bot it is for answers. The same open risk as `deliver`. */
  deliverToRoom(message: { room: ProjectRoom; to: Array<{ botId: string; text: string }>; leadBotId: string }): Promise<DirectSendReceipt>;
  mainThread(botId: string): string | undefined;
  /** The conversation waits for the person to answer what the bot asked in it since `since`. */
  waitingOnPerson(botId: string, threadId: string, since: number): boolean;
  /** The language the server writes its own lines in. */
  language(): string | undefined;
  files: Pick<ProductionFiles, "read" | "write">;
  /** What the production's wire answers changed: open apps read the canvas again. */
  changed(projectId: string): void;
  now(): number;
  newId(): string;
  log(line: string): void;
}

const JOB_NAME: Record<ProductionJob, ServerLineKey> = {
  script: "server.production.job.script",
  character: "server.production.job.character",
  scene: "server.production.job.scene",
  storyboard: "server.production.job.storyboard",
  post: "server.production.job.post",
};

const REASON: Record<NonNullable<StoredEpisode["failed"]>, ServerLineKey> = {
  storyboard: "server.production.reason.storyboard",
  noShots: "server.production.reason.noShots",
  videos: "server.production.reason.videos",
  post: "server.production.reason.post",
  bot: "server.production.reason.bot",
};

const TASKS_ON_THE_WIRE = 400;
const PASSED_ON_MAX_CHARS = 6_000;

const failure = (error: unknown) => (error instanceof Error ? error.message : "unknown");

/** How a task's message is known: by its id once its conversation has it, by its place in the queue until then. */
/** A queued room line has no message yet; `at` is when production handed it over, so a turn that ends before the
 * line is posted can still settle the task. The post later overwrites `at` with the message's. */
const sentWith = (receipt: DirectSendReceipt, now: number): Pick<ProductionTask, "queueId" | "requestId" | "at"> =>
  "queued" in receipt ? { queueId: receipt.queueId, at: now } : { requestId: receipt.message.id, at: receipt.message.at };

const sameTask = (task: ProductionTask, job: ProductionJob, episode?: number) => task.job === job && task.episode === episode;

/**
 * Each project's production. The lead plans it once; from there it runs by itself: the script bot adapts the source
 * into episodes, the character and scene bots design what every episode shares side by side, and then, as many
 * episodes at a time as the project allows, each episode gets a storyboard bot of its own, its shots' videos, and a
 * post bot of its own whose work ends with the episode's JianYing draft. A task that fails stops what waits on it and
 * goes back to the lead.
 */
export class Productions {
  private readonly deps: ProductionDeps;
  private readonly productions = new Map<string, StoredProduction | null>();
  private readonly queues = new Map<string, Promise<unknown>>();
  /** By project: the pictures of characters and scenes whose generation did not start, each with why. Forgotten when
   * the person has the job tried again, and at a restart. */
  private readonly refusedPictures = new Map<string, Map<string, string>>();

  constructor(deps: ProductionDeps) {
    this.deps = deps;
  }

  /** The project's production as the app draws it; undefined before its lead planned one. */
  wire(projectId: string): ProductionWire | undefined {
    const production = this.get(projectId);
    if (!production) return undefined;
    const { episodes, shots, profiles } = this.view(projectId);
    const jobs = DRAMA_JOBS.flatMap((job) => {
      const botId = production.plan.assignments[job];
      return botId ? [{ job, botId, status: this.jobStatus(projectId, production, job, profiles) }] : [];
    });
    return {
      plan: { assignments: { ...production.plan.assignments }, ...(production.plan.episodes ? { episodes: production.plan.episodes } : {}), plannedAt: production.plan.plannedAt },
      jobs,
      ready: this.ready(projectId, production, profiles),
      episodes: episodes.map((episode) => this.episodeWire(production, episode, shots)),
      tasks: production.tasks.slice(-TASKS_ON_THE_WIRE).map(({ id, job, botId, episode, at, outcome, endedAt }) => ({
        id, job, botId, ...(episode === undefined ? {} : { episode }), status: outcome === "ok" ? "done" as const : outcome === "failed" ? "failed" as const : "working" as const,
        ...(at === undefined ? {} : { at }), ...(endedAt === undefined ? {} : { endedAt }),
      })),
      startedAt: production.startedAt,
      ...(production.endedAt === undefined ? {} : { endedAt: production.endedAt }),
    };
  }

  /**
   * Who does what in the project, as its canvas and its bots' tools read it: the lead leads, each job's bot has the
   * job, an episode's own bots have theirs, and every other bot stands outside. The bot the episodes' storyboard or
   * post bots are copies of keeps that job for what belongs to no episode. Before a plan, the members' titles say
   * their jobs. The lead's work goes to the script bot, and the script bot's to the character and scene bots.
   */
  pipeline(project: Pick<TeamProjectWire, "id" | "leadBotId" | "botIds" | "episodeBots">): ProjectPipeline {
    const assignments = this.get(project.id)?.plan.assignments ?? defaultAssignments(this.members(project));
    const stages: Record<string, FlowStage[]> = {};
    for (const botId of project.botIds) {
      const own = project.episodeBots[botId];
      const jobs = own ? [own.job] : PRODUCTION_JOBS.filter((job) => assignments[job] === botId);
      if (botId !== project.leadBotId && jobs.length) stages[botId] = jobs;
    }
    const lines: FlowLineWire[] = [];
    const { script, character, scene } = assignments;
    if (script) lines.push({ from: project.leadBotId, to: script });
    for (const to of new Set([character, scene])) if (script && to && to !== script) lines.push({ from: script, to });
    return { stages, lines };
  }

  /**
   * The lead's plan: the brief goes on the canvas and the production starts, or goes on with other bots for the jobs
   * when it runs already. Answers what the lead reads as its tool's result.
   */
  plan(projectId: string, botId: string, input: unknown): Promise<string> {
    return this.serially(projectId, async () => {
      const project = this.project(projectId);
      if (!project) throw new CanvasRefusal(404, userError("serverError.teamProject.notFound"));
      if (project.archivedAt !== undefined) throw readOnlyRefusal();
      if (botId !== project.leadBotId) throw new CanvasRefusal(403, { error: "Only the project's lead plans its production." });
      const { brief, episodes, assignments } = this.planInput(project, input);
      const language = this.deps.language();
      this.deps.canvas.setBrief(projectId, botId, brief, {
        brief: serverLine(language, "server.production.briefTitle"),
        plan: serverLine(language, "server.production.planTitle"),
      });
      const current = this.get(projectId);
      const now = this.deps.now();
      const plan = { assignments, ...(episodes ? { episodes } : {}), plannedAt: now };
      const production: StoredProduction = current && current.endedAt === undefined
        ? { ...current, plan }
        : { startedAt: now, plan, tasks: [], episodes: {} };
      this.save(projectId, production);
      this.note(project, "server.production.note.planned");
      await this.advance(project, production);
      const named = PRODUCTION_JOBS.map((job) => `${job}: ${assignments[job] ? this.deps.store.bot(assignments[job])?.name ?? assignments[job] : "nobody"}`).join("; ");
      return `The production is planned (${named}). It runs by itself from here: each bot gets its task when what it needs is ready, every episode gets its own storyboard and post bot, and videos are generated as the project's settings allow. You are told when a task fails and when every episode is done. Tell the person in one or two sentences what happens next, and end your turn.`;
    });
  }

  /** A line of a conversation, new or changed. */
  heard(threadId: string, message: Message): void {
    const relevant = (message.role === "user" && message.queueId) || turnEndOf(message) || roomTurnClosedBy(message);
    if (!relevant) return;
    const projectId = this.deps.store.botByThread(threadId)?.teamProject?.id ?? this.deps.projectOfRoom(threadId);
    if (!projectId) return;
    void this.serially(projectId, () => this.hear(projectId, threadId, message)).catch((error: unknown) => {
      this.deps.log(`[production] ${projectId}: a line could not be followed (${failure(error)})`);
    });
  }

  /** Something the production waits on may have changed, such as the project's canvas: it goes on as far as it can. */
  poke(projectId: string): void {
    void this.serially(projectId, async () => {
      const project = this.project(projectId);
      const production = this.get(projectId);
      if (project && production && project.archivedAt === undefined) await this.advance(project, production);
    }).catch((error: unknown) => {
      this.deps.log(`[production] ${projectId}: the production could not go on (${failure(error)})`);
    });
  }

  /**
   * The person asks for what stopped to be tried again: `{ job }` gives a whole-drama job's task to its bot again,
   * `{ episode }` takes an episode up where it stopped.
   */
  retry(projectId: string, body: unknown): Promise<ProductionWire> {
    const asked = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const job = DRAMA_JOBS.find((one) => one === asked.job);
    const episode = typeof asked.episode === "number" && Number.isInteger(asked.episode) && asked.episode > 0 ? asked.episode : undefined;
    if ((job === undefined) === (episode === undefined)) return Promise.reject(new CanvasRefusal(400, { error: "retry takes { job } or { episode }" }));
    return this.serially(projectId, async () => {
      const project = this.project(projectId);
      if (!project) throw new CanvasRefusal(404, userError("serverError.teamProject.notFound"));
      if (project.archivedAt !== undefined) throw readOnlyRefusal();
      const production = this.get(projectId);
      if (!production) throw new CanvasRefusal(409, userError("serverError.production.notPlanned"));
      const stopped = job ? this.jobStatus(projectId, production, job) : this.episodeStatus(production, episode!);
      if (stopped !== "failed") throw new CanvasRefusal(409, userError("serverError.production.notStopped"));
      if (job) {
        production.tasks = production.tasks.filter((task) => !(sameTask(task, job) && task.outcome === "failed"));
        if (job === "script") delete production.noEpisodes;
        this.refusedPictures.delete(projectId);
      } else {
        const stored = production.episodes[String(episode)];
        const why = stored?.failed;
        if (stored) delete stored.failed;
        production.tasks = production.tasks.filter((task) => !(task.episode === episode && task.outcome === "failed"));
        if (why === "videos") {
          for (const shot of this.shots(projectId).filter((one) => one.episode === episode && !one.take && one.status === "error")) await this.generate(project, shot);
        }
      }
      this.save(projectId, production);
      await this.advance(project, production);
      return this.wire(projectId)!;
    });
  }

  /** After a restart: the turns that ended while the server was down end their tasks, and the production goes on. */
  async resume(): Promise<void> {
    for (const project of this.deps.projects.list()) {
      if (project.archivedAt !== undefined) continue;
      const production = this.get(project.id);
      if (!production || production.endedAt !== undefined) continue;
      await this.serially(project.id, async () => {
        for (const task of production.tasks.filter((one) => !one.outcome)) {
          const end = this.endSince(project, task);
          if (end) this.end(production, task, end);
        }
        this.save(project.id, production);
        await this.advance(project, production);
      }).catch((error: unknown) => {
        this.deps.log(`[production] ${project.id}: the production could not be resumed (${failure(error)})`);
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

  private get(projectId: string): StoredProduction | null {
    if (!this.productions.has(projectId)) this.productions.set(projectId, this.deps.files.read(projectId));
    return this.productions.get(projectId) ?? null;
  }

  private save(projectId: string, production: StoredProduction): void {
    this.productions.set(projectId, production);
    try {
      this.deps.files.write(projectId, production);
    } catch (error) {
      this.deps.log(`[production] ${projectId}: the production could not be saved (${failure(error)})`);
    }
    this.deps.changed(projectId);
  }

  private members(project: Pick<TeamProjectWire, "leadBotId" | "botIds" | "episodeBots">): ProductionMember[] {
    return project.botIds.flatMap((botId) => {
      const bot = botId === project.leadBotId || project.episodeBots[botId] ? undefined : this.deps.store.bot(botId);
      return bot ? [{ id: bot.id, name: bot.name, title: bot.title ?? "", description: bot.description ?? "" }] : [];
    });
  }

  private planInput(project: TeamProjectWire, input: unknown): { brief: Array<[string, string]>; episodes?: number; assignments: Partial<Record<ProductionJob, string>> } {
    const asked = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const invalid = (error: string) => new CanvasRefusal(400, { error });
    const rows = Array.isArray(asked.brief) ? asked.brief : null;
    const row = (one: unknown): one is [string, string] => Array.isArray(one) && one.length === 2 && one.every((cell) => typeof cell === "string" && cell.trim().length > 0 && cell.length <= 200);
    if (!rows?.length || rows.length > 12 || !rows.every(row)) throw invalid("brief takes 1 to 12 rows, each [label, value] of at most 200 characters");
    const { episodes } = asked;
    if (episodes !== undefined && !(typeof episodes === "number" && Number.isInteger(episodes) && episodes >= 1 && episodes <= 500)) throw invalid("episodes is a whole number from 1 to 500");
    const members = this.members(project);
    const assignments = defaultAssignments(members);
    const named = asked.assignments && typeof asked.assignments === "object" && !Array.isArray(asked.assignments) ? asked.assignments as Record<string, unknown> : {};
    for (const [job, value] of Object.entries(named)) {
      const known = PRODUCTION_JOBS.find((one) => one === job);
      const botId = typeof value === "string" ? botIdOfNode(value) ?? value : "";
      if (!known) throw invalid(`assignments takes ${PRODUCTION_JOBS.join(", ")}`);
      if (!members.some((member) => member.id === botId)) throw invalid(`${String(value)} is not a bot of this project that can take a job; the project's bots are ${members.map((member) => `bot:${member.id} (${member.name})`).join(", ") || "only you"}`);
      assignments[known] = botId;
    }
    if (!assignments.script) throw invalid("Nobody in this project writes scripts. Name the bot that adapts the source in assignments.script.");
    return { brief: rows.map(([label, value]) => [label.trim(), value.trim()]), ...(episodes === undefined ? {} : { episodes }), assignments };
  }

  private shots(projectId: string): PipelineShot[] {
    try {
      return this.deps.canvas.shots(projectId);
    } catch {
      return [];
    }
  }

  private episodes(projectId: string): CanvasEpisode[] {
    try {
      return this.deps.canvas.episodes(projectId);
    } catch {
      return [];
    }
  }

  private profiles(projectId: string): CanvasProfile[] {
    try {
      return this.deps.canvas.profiles(projectId);
    } catch {
      return [];
    }
  }

  private view(projectId: string): PipelineView {
    try {
      return this.deps.canvas.view(projectId);
    } catch {
      return { episodes: [], shots: [], profiles: [] };
    }
  }

  private names(botIds: readonly string[]): string {
    return new Intl.ListFormat(intlLocale(this.deps.language()), { type: "conjunction" }).format(botIds.map((botId) => this.deps.store.bot(botId)?.name ?? botId));
  }

  private latest(production: StoredProduction, job: ProductionJob, episode?: number): ProductionTask | undefined {
    return production.tasks.findLast((task) => sameTask(task, job, episode));
  }

  private jobStatus(projectId: string, production: StoredProduction, job: DramaJob, profiles?: readonly CanvasProfile[]): ProductionTaskStatus {
    const task = this.latest(production, job);
    if (!task) return "waiting";
    if (!task.outcome) return "working";
    if (task.outcome === "failed" || (job === "script" && production.noEpisodes)) return "failed";
    if (job === "script") return "done";
    // Character/scene stay working until every profile has a picture node that finished (or one was refused): a turn that
    // only wrote the text cards used to flip the job to done with nothing left to generate.
    const ofJob = (profiles ?? this.profiles(projectId)).filter((profile) => profile.role === job);
    const pictures = ofJob.flatMap((profile) => profile.pictures);
    const refused = this.refusedPictures.get(projectId);
    if (pictures.some((picture) => picture.state === "empty" && refused?.has(picture.nodeId))) return "failed";
    if (!ofJob.length || ofJob.some((profile) => profile.pictures.length === 0)
      || pictures.some((picture) => picture.state === "loading" || picture.state === "empty")) return "working";
    return "done";
  }

  /** Every whole-drama job that has a bot is done, the pictures of its characters and scenes included. */
  private ready(projectId: string, production: StoredProduction, profiles?: readonly CanvasProfile[]): boolean {
    return DRAMA_JOBS.every((job) => !production.plan.assignments[job] || this.jobStatus(projectId, production, job, profiles) === "done");
  }

  private episodeStatus(production: StoredProduction, episode: number): ProductionEpisodeStatus {
    const stored = production.episodes[String(episode)];
    if (stored?.failed) return "failed";
    if (stored?.done) return "done";
    if (this.latest(production, "post", episode)) return "post";
    const storyboard = this.latest(production, "storyboard", episode);
    if (storyboard) return storyboard.outcome === "ok" ? "videos" : "storyboard";
    return stored?.opened ? "videos" : "waiting";
  }

  private episodeWire(production: StoredProduction, episode: CanvasEpisode, shots: readonly PipelineShot[]): ProductionEpisodeWire {
    const own = shots.filter((shot) => shot.episode === episode.episode);
    const stored = production.episodes[String(episode.episode)];
    return {
      episode: episode.episode,
      nodeId: episode.nodeId,
      title: episode.title,
      status: this.episodeStatus(production, episode.episode),
      ...(stored?.storyboardBotId ? { storyboardBotId: stored.storyboardBotId } : {}),
      ...(stored?.postBotId ? { postBotId: stored.postBotId } : {}),
      shots: own.length,
      ready: own.filter((shot) => shot.take).length,
      generating: own.filter((shot) => shot.status === "loading").length,
      failed: own.filter((shot) => !shot.take && shot.status === "error").length,
    };
  }

  private async hear(projectId: string, threadId: string, message: Message): Promise<void> {
    const project = this.project(projectId);
    const production = this.get(projectId);
    if (!project || project.archivedAt !== undefined || !production) return;
    const inRoom = this.deps.projectOfRoom(threadId) === projectId;
    const owner = inRoom ? undefined : this.deps.store.botByThread(threadId);
    if (!inRoom && (!owner || !project.botIds.includes(owner.id))) return;
    if (message.role === "user") {
      const { queueId } = message;
      const joined = queueId ? production.tasks.filter((task) => task.threadId === threadId && task.queueId === queueId && task.requestId === undefined) : [];
      if (!joined.length) return;
      for (const task of joined) Object.assign(task, { requestId: message.id, at: message.at });
      this.save(projectId, production);
      return;
    }
    const closedBy = owner ? null : roomTurnClosedBy(message);
    const end: TurnEnd | null = closedBy ? { ok: false } : turnEndOf(message);
    const speaker = owner?.id ?? closedBy ?? message.from?.botId;
    if (!end || (!speaker && end.ok)) return;
    const waiting = production.tasks.filter((task) => task.threadId === threadId && task.at !== undefined && task.at <= message.at
      && (speaker === undefined || task.botId === speaker)
      && (!task.outcome || (end.ok && task.outcome === "failed" && this.latest(production, task.job, task.episode) === task)));
    const ended = speaker === undefined ? waiting : waiting.slice(0, 1);
    if (!ended.length) return;
    if (speaker !== undefined && (end.ok || closedBy) && this.deps.waitingOnPerson(speaker, threadId, ended[0]!.at!)) return;
    for (const task of ended) this.end(production, task, end);
    this.save(projectId, production);
    await this.advance(project, production);
  }

  /** The end of a turn that ends nothing yet, found in its conversation. */
  private endSince(project: TeamProjectWire, task: ProductionTask): TurnEnd | null {
    if (task.at === undefined) return null;
    const inRoom = this.deps.projectOfRoom(task.threadId) === project.id;
    for (const message of this.deps.store.activePath(task.threadId)) {
      if (message.at < task.at || (inRoom && message.from?.botId !== task.botId)) continue;
      const end: TurnEnd | null = inRoom && roomTurnClosedBy(message) ? { ok: false } : turnEndOf(message);
      if (end && !(end.ok && this.deps.waitingOnPerson(task.botId, task.threadId, task.at))) return end;
    }
    return null;
  }

  private end(production: StoredProduction, task: ProductionTask, end: TurnEnd): void {
    task.outcome = end.ok ? "ok" : "failed";
    task.endedAt = this.deps.now();
    if (end.ok && end.reply) task.reply = replyText(end.reply);
    else delete task.reply;
    const stored = task.episode === undefined ? undefined : production.episodes[String(task.episode)];
    if (end.ok && stored && (stored.failed === "storyboard" || stored.failed === "post")) delete stored.failed;
    if (end.ok && task.job === "script") delete production.noEpisodes;
  }

  /**
   * Takes the production as far as it goes now: gives each whole-drama job its task once what it needs is there,
   * generates the pictures of characters and scenes, opens as many episodes as may run at once, and takes each open
   * episode from its storyboard through its videos to its post and its draft.
   */
  private async advance(project: TeamProjectWire, production: StoredProduction): Promise<void> {
    if (production.endedAt !== undefined) return;
    const { assignments } = production.plan;
    const script = this.latest(production, "script");
    if (!script) {
      if (assignments.script) await this.dispatch(project, production, "script", assignments.script);
      return;
    }
    if (script.outcome !== "ok") {
      if (script.outcome === "failed") await this.jobFailed(project, production, script);
      return;
    }
    const episodes = this.episodes(project.id);
    if (!episodes.length) {
      if (!production.noEpisodes) {
        production.noEpisodes = true;
        this.save(project.id, production);
        await this.tellLead(project, "server.production.lead.noEpisodes", { bots: this.names([script.botId]) });
      }
      return;
    }
    for (const job of ["character", "scene"] as const) {
      const botId = assignments[job];
      const task = this.latest(production, job);
      if (botId && !task) await this.dispatch(project, production, job, botId, undefined, script.reply);
      else if (task?.outcome === "failed") await this.jobFailed(project, production, task);
    }
    await this.generatePictures(project);
    if (!this.ready(project.id, production)) return;

    const { episodes: atOnce } = this.deps.concurrency(project.id);
    const open = () => episodes.filter((one) => ["storyboard", "videos", "post"].includes(this.episodeStatus(production, one.episode))).length;
    const goOn = async (episode: CanvasEpisode) => {
      if (this.episodeStatus(production, episode.episode) === "storyboard") await this.storyboardEnded(project, production, episode);
      if (this.episodeStatus(production, episode.episode) === "videos") await this.videos(project, production, episode);
      if (this.episodeStatus(production, episode.episode) === "post") await this.postEnded(project, production, episode);
    };
    for (const episode of episodes) await goOn(episode);
    for (const episode of episodes) {
      if (this.episodeStatus(production, episode.episode) !== "waiting" || open() >= atOnce) continue;
      await this.openEpisode(project, production, episode);
      await goOn(episode);
    }
    if (episodes.every((one) => this.episodeStatus(production, one.episode) === "done")) {
      production.endedAt = this.deps.now();
      this.save(project.id, production);
      this.note(project, "server.production.note.ended");
      await this.tellLead(project, "server.production.lead.done", {});
    }
  }

  /** The lead hears of a failed task once. */
  private async jobFailed(project: TeamProjectWire, production: StoredProduction, task: ProductionTask): Promise<void> {
    if (task.told) return;
    task.told = true;
    this.save(project.id, production);
    await this.tellLead(project, "server.production.lead.jobFailed", { job: serverLine(this.deps.language(), JOB_NAME[task.job]), bots: this.names([task.botId]) });
  }

  /** Starts the pictures of characters and scenes that wait for their first, as many at once as the project allows.
   * The lead hears once of pictures that do not start; what waits on them waits until the person has it tried again. */
  private async generatePictures(project: TeamProjectWire): Promise<void> {
    const pictures = this.profiles(project.id).flatMap((profile) => profile.pictures);
    const refused = this.refusedPictures.get(project.id) ?? new Map<string, string>();
    const told = refused.size > 0;
    let free = this.deps.concurrency(project.id).images - pictures.filter((picture) => picture.state === "loading").length;
    for (const picture of pictures) {
      if (free <= 0) break;
      if (picture.state !== "empty" || refused.has(picture.nodeId)) continue;
      const why = await this.deps.canvas.generate(project, picture.nodeId);
      if (why === null) free -= 1;
      else refused.set(picture.nodeId, why);
    }
    if (!refused.size || told) return;
    this.refusedPictures.set(project.id, refused);
    this.deps.changed(project.id);
    await this.tellLead(project, "server.production.lead.picturesRefused", { why: [...new Set(refused.values())].join(" ") });
  }

  private async openEpisode(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode): Promise<void> {
    const template = production.plan.assignments.storyboard;
    const stored = production.episodes[String(episode.episode)] ??= {};
    if (!template) {
      stored.opened = true;
      this.save(project.id, production);
      return;
    }
    const botId = await this.episodeBotOf(project, production, episode, "storyboard", template);
    if (!botId) return;
    const library = this.profiles(project.id).map((profile) => `- ${profile.nodeId} · ${profile.title}${profile.subtitle ? ` (${profile.subtitle})` : ""}${profile.pictures.length ? ` · ${profile.pictures.filter((picture) => picture.state === "ready").map((picture) => picture.nodeId).join(", ")}` : ""}`).join("\n");
    stored.storyboardBotId = botId;
    await this.dispatch(project, production, "storyboard", botId, episode.episode, library);
  }

  /** The episode's own bot for `job`; undefined, with the episode stopped, when none could be made. */
  private async episodeBotOf(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode, job: EpisodeJob, template: string): Promise<string | undefined> {
    try {
      return await this.deps.episodeBot(project.id, template, episode.episode, job);
    } catch (error) {
      this.deps.log(`[production] ${project.id}: ${episodeCode(episode.episode)} got no ${job} bot (${failure(error)})`);
      await this.episodeFailed(project, production, episode.episode, "bot");
      return undefined;
    }
  }

  /** The episode stops and the lead hears why, once. `detail`: what the generation said, in English. */
  private async episodeFailed(project: TeamProjectWire, production: StoredProduction, episode: number, reason: NonNullable<StoredEpisode["failed"]>, detail?: string): Promise<void> {
    const stored = production.episodes[String(episode)] ??= {};
    if (stored.failed) return;
    stored.failed = reason;
    this.save(project.id, production);
    const said = serverLine(this.deps.language(), REASON[reason]);
    await this.tellLead(project, "server.production.lead.episodeFailed", { episode: episodeCode(episode), reason: detail ? `${said} (${detail})` : said });
  }

  private async storyboardEnded(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode): Promise<void> {
    const task = this.latest(production, "storyboard", episode.episode);
    if (task?.outcome === "failed") await this.episodeFailed(project, production, episode.episode, "storyboard");
  }

  /** An episode whose shots are designed: their videos are generated as many at once as the project allows; with every
   * shot's video chosen it goes to its post bot, or is done when the project has none. */
  private async videos(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode): Promise<void> {
    const all = this.shots(project.id);
    const shots = all.filter((shot) => shot.episode === episode.episode);
    if (!shots.length) {
      if (this.latest(production, "storyboard", episode.episode)) await this.episodeFailed(project, production, episode.episode, "noShots");
      return;
    }
    const missing = shots.filter((shot) => !shot.take);
    if (!missing.length) {
      await this.toPost(project, production, episode);
      return;
    }
    let free = this.deps.concurrency(project.id).videos - all.filter((shot) => shot.status === "loading").length;
    const refused = new Map<string, string>();
    let asked = false;
    for (const shot of missing) {
      if (free <= 0) break;
      if (shot.status === "loading" || shot.status === "error") continue;
      asked = true;
      const why = await this.generate(project, shot);
      if (why === null) free -= 1;
      else refused.set(shot.shotId, why);
    }
    const after = (asked ? this.shots(project.id) : all).filter((shot) => shot.episode === episode.episode && !shot.take);
    const stopped = (shot: PipelineShot) => shot.status === "error" || (refused.has(shot.shotId) && shot.status !== "loading");
    if (after.length && after.every(stopped)) await this.episodeFailed(project, production, episode.episode, "videos", [...new Set(refused.values())].join(" ") || undefined);
  }

  private generate(project: TeamProjectWire, shot: PipelineShot): Promise<string | null> {
    return shot.creationNodeId ? this.deps.canvas.generate(project, shot.creationNodeId) : Promise.resolve("The shot has no node that generates its video.");
  }

  private async toPost(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode): Promise<void> {
    const stored = production.episodes[String(episode.episode)] ??= {};
    await this.deps.drafts.writeDraftIfReady(project.id, episode.episode);
    const template = production.plan.assignments.post;
    if (!template) {
      await this.episodeDone(project, production, episode);
      return;
    }
    const botId = await this.episodeBotOf(project, production, episode, "post", template);
    if (!botId) return;
    stored.postBotId = botId;
    const draft = this.deps.drafts.draft(project.id, episode.episode);
    const written = draft?.name && (draft.state === "written" || draft.state === "kept") ? draft.name : undefined;
    await this.dispatch(project, production, "post", botId, episode.episode, written);
  }

  private async postEnded(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode): Promise<void> {
    const task = this.latest(production, "post", episode.episode);
    if (task?.outcome === "failed") await this.episodeFailed(project, production, episode.episode, "post");
    else if (task?.outcome === "ok") await this.episodeDone(project, production, episode);
  }

  private async episodeDone(project: TeamProjectWire, production: StoredProduction, episode: CanvasEpisode): Promise<void> {
    await this.deps.drafts.writeDraftIfReady(project.id, episode.episode);
    (production.episodes[String(episode.episode)] ??= {}).done = true;
    this.save(project.id, production);
    this.note(project, "server.production.note.episodeDone", { episode: episodeCode(episode.episode) });
  }

  /** What a job's task says. `more` is what the task passes on: the script bot's lists for the character and scene
   * bots, the drama's characters and scenes for a storyboard bot, the draft's name for a post bot. */
  private request(project: TeamProjectWire, production: StoredProduction, job: ProductionJob, episode: number | undefined, more: string | undefined, language: string | undefined): string {
    const params = { project: project.name, lead: this.names([project.leadBotId]) };
    const code = episode === undefined ? "" : episodeCode(episode);
    const passed = (more ?? "").slice(0, PASSED_ON_MAX_CHARS) || "-";
    if (job === "script") {
      return production.plan.episodes
        ? serverLine(language, "server.production.task.script", { ...params, count: production.plan.episodes })
        : serverLine(language, "server.production.task.scriptAny", params);
    }
    if (job === "character") return serverLine(language, "server.production.task.character", { ...params, list: passed });
    if (job === "scene") return serverLine(language, "server.production.task.scene", { ...params, list: passed });
    if (job === "storyboard") return serverLine(language, "server.production.task.storyboard", { ...params, episode: code, library: passed });
    return more
      ? serverLine(language, "server.production.task.post", { ...params, episode: code, draft: more })
      : serverLine(language, "server.production.task.postNoDraft", { ...params, episode: code });
  }

  /** Gives a bot its task: in the project's group chat when the bot is in it, else in its main conversation. */
  private async dispatch(project: TeamProjectWire, production: StoredProduction, job: ProductionJob, botId: string, episode?: number, more?: string): Promise<void> {
    const language = this.deps.language();
    const task: ProductionTask = { id: this.deps.newId(), job, botId, ...(episode === undefined ? {} : { episode }), threadId: botId };
    try {
      const text = await this.deps.canvas.taskFor(project, botId, this.request(project, production, job, episode, more, language), language);
      const room = this.deps.room(project);
      const receipt = room?.memberIds.includes(botId)
        ? await this.deps.deliverToRoom({ room, to: [{ botId, text: quietMentions(text) }], leadBotId: project.leadBotId })
        : await this.deliverAlone(project, botId, text);
      Object.assign(task, { threadId: receipt.threadId }, sentWith(receipt, this.deps.now()));
    } catch (error) {
      this.deps.log(`[production] ${project.id}: the ${job} task did not reach ${botId} (${failure(error)})`);
      Object.assign(task, { outcome: "failed", endedAt: this.deps.now() });
    }
    production.tasks.push(task);
    this.save(project.id, production);
    const jobName = serverLine(language, JOB_NAME[job]);
    if (episode === undefined) this.note(project, "server.production.note.started", { job: jobName, bots: this.names([botId]) });
    else this.note(project, "server.production.note.episodeStarted", { episode: episodeCode(episode), job: jobName, bots: this.names([botId]) });
    if (task.outcome === "failed") {
      if (episode === undefined) await this.jobFailed(project, production, task);
      else await this.episodeFailed(project, production, episode, job === "post" ? "post" : "storyboard");
    }
  }

  private async deliverAlone(project: TeamProjectWire, botId: string, text: string): Promise<DirectSendReceipt> {
    const threadId = this.deps.mainThread(botId) ?? this.deps.store.bot(botId)?.threadId;
    if (!threadId) throw new Error("the bot has no conversation");
    return this.deps.deliver({ botId, threadId, text, leadBotId: project.leadBotId });
  }

  /** A turn of the lead's that decides what happens next: in the project's group chat, else in its main conversation. */
  private async tellLead(project: TeamProjectWire, key: ServerLineKey, params: Record<string, string | number>): Promise<void> {
    const text = serverLine(this.deps.language(), key, { project: project.name, ...params });
    const room = this.deps.room(project);
    try {
      if (room?.memberIds.includes(project.leadBotId)) {
        await this.deps.deliverToRoom({ room, to: [{ botId: project.leadBotId, text }], leadBotId: project.leadBotId });
        return;
      }
      await this.deliverAlone(project, project.leadBotId, text);
    } catch (error) {
      this.deps.log(`[production] ${project.id}: the lead could not be told (${failure(error)})`);
    }
  }

  /** A row that says where the production is and starts no turn: in the project's group chat, else in the lead's main
   * conversation. */
  private note(project: TeamProjectWire, key: ServerLineKey, params?: Record<string, string | number>): void {
    const threadId = this.deps.room(project)?.threadId ?? this.deps.mainThread(project.leadBotId);
    if (!threadId) return;
    try {
      this.deps.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: serverLine(this.deps.language(), key, params), ok: true } });
    } catch (error) {
      this.deps.log(`[production] ${project.id}: the production's line could not be written (${failure(error)})`);
    }
  }
}
