import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  GenerationFailure, GenerationFile, GenerationJob, GenerationJobStatus, GenerationKind, GenerationRequester, GenerationTools,
} from "../../shared/project-generation.ts";
import { failure, GenerationRefused, refused } from "./failure.ts";
import { LONGEST_CALL_MS, type GenerationMcp } from "./mcp-access.ts";
import type { GenerationEndpoint } from "./endpoint.ts";
import { readReferences, removeResults, resultBaseName, resultBytes, saveResult, type ResultSource } from "./project-files.ts";
import type { GenerationStore } from "./store.ts";

export interface JobTiming {
  /** Between two status questions, when the server says nothing about it. */
  pollMs: number;
  minPollMs: number;
  maxPollMs: number;
  statusCallMs: number;
  /** From the job's hand-over to its result. */
  deadlineMs: Record<GenerationKind, number>;
  /** Status questions in a row that may go unanswered before the job fails. */
  pollFailures: number;
}

export const JOB_TIMING: JobTiming = {
  pollMs: 3_000, minPollMs: 500, maxPollMs: 30_000, statusCallMs: 30_000,
  deadlineMs: { image: 15 * 60_000, video: 60 * 60_000 }, pollFailures: 5,
};

export const RUNNING_PER_SERVER = 4;
export const UNFINISHED_PER_PROJECT = 50;
const FINISHED_KEPT = 100;
const CANCEL_CALL_MS = 30_000;

/**
 * Where a job is in its hand-over: `waiting` to be handed over, `submitting` while it is (a restart then cannot tell
 * whether the server took it), `submitted` once the server gave its task id.
 */
type Phase = "waiting" | "submitting" | "submitted";

interface StoredJob {
  job: GenerationJob;
  tools: GenerationTools;
  phase: Phase;
  name?: string;
}

export interface NewJob {
  projectId: string;
  kind: GenerationKind;
  nodeId: string;
  requester: GenerationRequester;
  prompt: string;
  references: GenerationJob["references"];
  settings: GenerationJob["settings"];
  server: string;
  /** The installed plugin's id, when a plugin makes this job. */
  plugin?: string;
  tools: GenerationTools;
  name?: string;
}

export interface JobsDeps {
  store: GenerationStore;
  mcp: GenerationMcp;
  /** The project's folder; throws why nothing can be saved in it. */
  folderOf(projectId: string): string;
  /** The MCP server's own address, from which its results may be fetched. */
  endpointOf(job: GenerationJob, tools: GenerationTools): GenerationEndpoint;
  log(line: string): void;
  now?(): number;
  timing?: Partial<JobTiming>;
}

const ENDED: ReadonlySet<GenerationJobStatus> = new Set(["done", "failed", "cancelled"]);
const ended = (job: GenerationJob) => ENDED.has(job.status);
/** These won't mend by asking again. */
const LASTING: ReadonlySet<GenerationFailure["code"]> = new Set(["server_unusable", "sign_in", "keys", "tool_missing", "bad_answer"]);

const isStoredJob = (value: unknown): value is StoredJob => {
  const stored = value as Partial<StoredJob> | null;
  return Boolean(stored?.job && typeof stored.job.id === "string" && typeof stored.job.projectId === "string" && stored.tools && stored.phase);
};

export class GenerationJobs {
  private readonly projects = new Map<string, StoredJob[]>();
  private readonly running = new Map<string, { stored: StoredJob; control: AbortController }>();
  private readonly callbacks = new Map<string, (job: GenerationJob) => void>();
  private readonly listeners = new Set<(job: GenerationJob) => void>();
  private readonly deps: JobsDeps;
  private readonly timing: JobTiming;
  private readonly now: () => number;
  private closed = false;

  constructor(deps: JobsDeps) {
    this.deps = deps;
    this.timing = { ...JOB_TIMING, ...deps.timing };
    this.now = deps.now ?? Date.now;
  }

  /** After a restart: a job not yet handed over waits again, a task the server holds is followed again from its id. */
  resume(): void {
    for (const projectId of this.deps.store.projectsWithJobs()) {
      for (const stored of this.list(projectId)) {
        if (ended(stored.job)) continue;
        if (stored.phase === "submitting") this.finish(stored, "failed", { failure: failure("interrupted", "interrupted", { server: stored.job.server }) });
        else if (stored.phase === "submitted") void this.run(stored);
      }
    }
    this.pump();
  }

  onChange(listener: (job: GenerationJob) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(input: NewJob, onChange?: (job: GenerationJob) => void): GenerationJob {
    const at = this.now();
    const job = {
      id: `gen-${randomUUID()}`, projectId: input.projectId, kind: input.kind, status: "queued", nodeId: input.nodeId, requester: input.requester,
      prompt: input.prompt, references: input.references, settings: input.settings, server: input.server, tool: input.tools.generate,
      ...(input.plugin ? { plugin: input.plugin } : {}),
      files: [], createdAt: at, updatedAt: at,
    } as GenerationJob;
    const stored: StoredJob = { job, tools: input.tools, phase: "waiting", ...(input.name ? { name: input.name } : {}) };
    this.list(input.projectId).unshift(stored);
    if (onChange) this.callbacks.set(job.id, onChange);
    this.save(input.projectId);
    this.logStatus(job);
    this.emit(stored);
    this.pump();
    return structuredClone(job);
  }

  job(projectId: string, jobId: string): GenerationJob | null {
    const stored = this.find(projectId, jobId);
    return stored ? structuredClone(stored.job) : null;
  }

  /** Those that have not ended, then those that have; newest first. */
  jobs(projectId: string): GenerationJob[] {
    const all = this.list(projectId).map((stored) => stored.job);
    const order = (job: GenerationJob) => (ended(job) ? 1 : 0);
    return structuredClone([...all].sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt));
  }

  unfinished(projectId: string): number {
    return this.list(projectId).filter((stored) => !ended(stored.job)).length;
  }

  cancel(projectId: string, jobId: string): GenerationJob | null {
    const stored = this.find(projectId, jobId);
    if (!stored) return null;
    if (ended(stored.job)) return structuredClone(stored.job);
    this.finish(stored, "cancelled");
    if (stored.phase !== "submitting") this.running.get(jobId)?.control.abort();
    if (stored.job.taskId) {
      try { void this.cancelAtServer(stored, stored.job.taskId, this.deps.endpointOf(stored.job, stored.tools)); }
      catch { this.deps.log(`project generation: job ${jobId}'s task could not be cancelled on ${stored.job.server}`); }
    }
    return structuredClone(stored.job);
  }

  /** Stops following jobs without ending them, so the next start picks them up again. */
  close(): void {
    this.closed = true;
    for (const { control } of this.running.values()) control.abort();
  }

  private list(projectId: string): StoredJob[] {
    let jobs = this.projects.get(projectId);
    if (!jobs) {
      jobs = this.deps.store.jobs(projectId).filter(isStoredJob);
      this.projects.set(projectId, jobs);
    }
    return jobs;
  }

  private find(projectId: string, jobId: string): StoredJob | undefined {
    return this.list(projectId).find((stored) => stored.job.id === jobId);
  }

  private save(projectId: string): void {
    const jobs = this.list(projectId);
    const kept = [...jobs.filter((stored) => !ended(stored.job)), ...jobs.filter((stored) => ended(stored.job)).slice(0, FINISHED_KEPT)];
    this.projects.set(projectId, kept);
    this.deps.store.saveJobs(projectId, kept);
  }

  private emit(stored: StoredJob): void {
    const told = [this.callbacks.get(stored.job.id), ...this.listeners];
    for (const listener of told) {
      if (!listener) continue;
      try {
        listener(structuredClone(stored.job));
      } catch (error) {
        this.deps.log(`project generation: a listener of job ${stored.job.id} failed: ${error instanceof Error ? error.name : "error"}`);
      }
    }
  }

  private logStatus(job: GenerationJob): void {
    this.deps.log(`project generation: job ${job.id} of ${job.projectId} (${job.kind}, ${job.server}/${job.tool}) is ${job.status}${job.failure ? ` (${job.failure.code})` : ""}`);
  }

  private changed(stored: StoredJob, patch: Partial<GenerationJob>): void {
    const before = stored.job.status;
    Object.assign(stored.job, patch, { updatedAt: this.now() });
    this.save(stored.job.projectId);
    if (stored.job.status !== before) this.logStatus(stored.job);
    this.emit(stored);
  }

  private finish(stored: StoredJob, status: "done" | "failed" | "cancelled", patch: Partial<GenerationJob> = {}): void {
    if (ended(stored.job)) return;
    this.changed(stored, { ...patch, status, finishedAt: this.now() });
    this.callbacks.delete(stored.job.id);
  }

  private pump(): void {
    if (this.closed) return;
    const waiting = [...this.projects.values()].flat().filter((stored) => stored.job.status === "queued" && stored.phase === "waiting" && !this.running.has(stored.job.id))
      .sort((a, b) => a.job.createdAt - b.job.createdAt);
    for (const stored of waiting) {
      const busy = [...this.running.values()].filter((run) => run.stored.job.server === stored.job.server).length;
      if (busy < RUNNING_PER_SERVER) void this.run(stored);
    }
  }

  /** Runs `use` until `ms` pass or the job is stopped; a call that takes longer is one that went unanswered. */
  private async within<T>(control: AbortController, ms: number, server: string, use: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timer = AbortSignal.timeout(ms);
    try {
      return await use(AbortSignal.any([control.signal, timer]));
    } catch (error) {
      if (timer.aborted && !control.signal.aborted) throw refused("unreachable", "unreachable", { server, detail: `no answer within ${Math.round(ms / 1000)} seconds` });
      throw error;
    }
  }

  private async run(stored: StoredJob): Promise<void> {
    const { job } = stored;
    if (this.running.has(job.id) || this.closed) return;
    const control = new AbortController();
    this.running.set(job.id, { stored, control });
    let server: GenerationEndpoint;
    try {
      server = this.deps.endpointOf(job, stored.tools);
    } catch (error) {
      this.running.delete(job.id);
      this.finish(stored, "failed", {
        failure: error instanceof GenerationRefused ? error.failure : failure("server_unusable", "pluginGone", { plugin: job.plugin ?? job.server }),
      });
      this.pump();
      return;
    }
    try {
      if (stored.phase === "waiting") {
        stored.phase = "submitting";
        this.changed(stored, { status: "running", submittedAt: this.now() });
        const references = readReferences(this.deps.folderOf(job.projectId), job.references);
        const submitted = await this.within(control, LONGEST_CALL_MS, job.server, (signal) => server.generate(job.kind, job.settings, { prompt: job.prompt, references }, signal));
        if (ended(job)) {
          if ("taskId" in submitted) void this.cancelAtServer(stored, submitted.taskId, server);
          return;
        }
        if ("files" in submitted) return await this.collect(stored, submitted.files, server);
        stored.phase = "submitted";
        this.changed(stored, { taskId: submitted.taskId });
      }
      await this.follow(stored, server, control);
    } catch (error) {
      if (this.closed || ended(job)) return;
      if (!(error instanceof GenerationRefused)) this.deps.log(`project generation: job ${job.id} stopped: ${error instanceof Error ? error.name : "error"}`);
      if (error instanceof GenerationRefused && error.failure.code === "timed_out" && job.taskId) void this.cancelAtServer(stored, job.taskId, server);
      this.finish(stored, "failed", {
        failure: error instanceof GenerationRefused ? error.failure : failure("unreachable", "unreachable", { server: job.server, detail: "MagicBot lost track of it" }),
      });
    } finally {
      this.running.delete(job.id);
      this.pump();
    }
  }

  private async follow(stored: StoredJob, server: GenerationEndpoint, control: AbortController): Promise<void> {
    const { job } = stored;
    const deadline = (job.submittedAt ?? job.createdAt) + this.timing.deadlineMs[job.kind];
    let wait = this.timing.pollMs;
    let unanswered = 0;
    for (;;) {
      const left = deadline - this.now();
      if (left <= 0) throw refused("timed_out", "timedOut", { server: job.server, minutes: Math.round(this.timing.deadlineMs[job.kind] / 60_000) });
      await sleep(Math.min(wait, left), undefined, { signal: control.signal });
      let state: TaskState;
      try {
        state = await this.within(control, this.timing.statusCallMs, job.server, (signal) => server.status(job.taskId!, signal));
        unanswered = 0;
      } catch (error) {
        if (control.signal.aborted || !(error instanceof GenerationRefused) || LASTING.has(error.failure.code)) throw error;
        unanswered += 1;
        if (unanswered >= this.timing.pollFailures) throw error;
        wait = this.timing.pollMs;
        continue;
      }
      if (ended(job)) return;
      if (state.status === "succeeded") return this.collect(stored, state.files, server);
      if (state.status === "failed") throw refused("task_failed", "taskFailed", { server: job.server, reason: state.reason }, { reason: state.reason });
      if (state.status === "cancelled") return this.finish(stored, "cancelled");
      if (state.progress !== undefined && state.progress !== job.progress) this.changed(stored, { progress: state.progress });
      wait = Math.min(this.timing.maxPollMs, Math.max(this.timing.minPollMs, state.pollAfterMs ?? this.timing.pollMs));
    }
  }

  private async collect(stored: StoredJob, sources: ResultSource[], endpoint: GenerationEndpoint): Promise<void> {
    const { job } = stored;
    const folder = this.deps.folderOf(job.projectId);
    const saved: GenerationFile[] = [];
    try {
      for (const [index, source] of sources.entries()) {
        const { bytes, mime } = await resultBytes(source, job.kind, endpoint.resultOrigin(), job.server);
        if (ended(job)) break;
        const base = resultBaseName(stored.name, job.kind, job.createdAt, job.id);
        saved.push(saveResult(folder, job.kind, sources.length > 1 ? `${base}-${index + 1}` : base, bytes, mime));
      }
    } catch (error) {
      await removeResults(folder, saved);
      throw error;
    }
    if (ended(job)) return removeResults(folder, saved);
    this.finish(stored, "done", { files: saved, progress: 1 });
  }

  private async cancelAtServer(stored: StoredJob, taskId: string, endpoint: GenerationEndpoint): Promise<void> {
    const { job } = stored;
    try {
      await endpoint.cancel(taskId, AbortSignal.timeout(CANCEL_CALL_MS));
    } catch {
      this.deps.log(`project generation: job ${job.id}'s task could not be cancelled on ${job.server}`);
    }
  }
}
