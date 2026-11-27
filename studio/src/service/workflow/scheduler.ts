/**
 * Workflow task scheduler.
 * Orchestrates parallel/serial task execution based on DAG dependencies.
 * Manages task queues, priorities, retries, and timeouts.
 */

import type {
  WorkflowTask,
  TaskId,
  SchedulerConfig,
  SchedulerMetrics,
  SchedulingDecision,
  TaskState,
  ProjectAgentId,
} from './types';
import { WorkflowGraph } from './graph';
import { TaskStateMachine } from './state-machine';
import { StalePropagator } from './stale-propagator';

interface QueuedTask {
  task: WorkflowTask;
  priority: number;
  enqueuedAt: number;
  attempts: number;
}

export class WorkflowScheduler {
  private graph: WorkflowGraph;
  private stateMachine: TaskStateMachine;
  private propagator: StalePropagator;
  private config: Required<SchedulerConfig>;
  private readyQueue: QueuedTask[] = [];
  private runningTasks: Map<TaskId, QueuedTask> = new Map();
  private metrics: SchedulerMetrics;
  private startTime: number = 0;

  constructor(
    graph: WorkflowGraph,
    stateMachine: TaskStateMachine,
    config: SchedulerConfig = {}
  ) {
    this.graph = graph;
    this.stateMachine = stateMachine;
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks ?? 10,
      defaultTaskTimeout: config.defaultTaskTimeout ?? 300000,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      enableLogging: config.enableLogging ?? false,
      enableStalePropagation: config.enableStalePropagation ?? true,
    };

    this.propagator = new StalePropagator(
      graph,
      stateMachine,
      this.config.enableLogging
    );

    this.metrics = this.initializeMetrics();
  }

  /**
   * Initializes metrics.
   */
  private initializeMetrics(): SchedulerMetrics {
    return {
      totalTasks: this.graph.getAllTasks().length,
      successfulTasks: 0,
      failedTasks: 0,
      staleTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      totalRetries: 0,
      averageTaskDurationMs: 0,
      startTime: new Date().toISOString(),
    };
  }

  /**
   * Starts the scheduler and initializes all tasks.
   */
  start(): boolean {
    if (this.startTime > 0) {
      return false;
    }

    this.startTime = Date.now();

    const validation = this.graph.validate();
    if (!validation.valid) {
      if (this.config.enableLogging) {
        console.error('[Scheduler] Validation errors:', validation.errors);
      }
      return false;
    }

    for (const task of this.graph.getAllTasks()) {
      this.stateMachine.initialize(task.id);
    }

    // Re-initialize metrics with actual task count
    this.metrics = this.initializeMetrics();
    this.updateMetrics();
    this.scheduleReadyTasks();

    if (this.config.enableLogging) {
      console.log(`[Scheduler] Started with ${this.metrics.totalTasks} tasks`);
    }

    return true;
  }

  /**
   * Gets the next ready task to execute.
   * Priority: high > normal > low, then FIFO within priority.
   */
  private getNextReadyTask(): QueuedTask | undefined {
    if (this.readyQueue.length === 0) {
      return undefined;
    }

    this.readyQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.enqueuedAt - b.enqueuedAt;
    });

    return this.readyQueue.shift();
  }

  /**
   * Schedules all tasks that are ready to run (all dependencies met).
   */
  private scheduleReadyTasks(): void {
    for (const task of this.graph.getAllTasks()) {
      if (this.canTaskRun(task.id)) {
        const decision = this.makeSchedulingDecision(task.id);
        if (decision.canRun && !this.readyQueue.some(qt => qt.task.id === task.id)) {
          const priority = this.getPriority(task.priority ?? 'normal');
          this.readyQueue.push({
            task,
            priority,
            enqueuedAt: Date.now(),
            attempts: 0,
          });
        }
      }
    }
  }

  /**
   * Checks if a task can run (all dependencies satisfied).
   */
  private canTaskRun(taskId: TaskId): boolean {
    if (!this.stateMachine.canRun(taskId)) {
      return false;
    }

    const dependencies = this.graph.getDependencies(taskId);

    for (const depId of dependencies) {
      const depState = this.stateMachine.getState(depId);
      if (!depState || !this.isAllowedDependencyState(depState)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Checks if a dependency state allows downstream tasks to run.
   */
  private isAllowedDependencyState(state: TaskState): boolean {
    return state === 'success';
  }

  /**
   * Makes a scheduling decision for a task.
   */
  private makeSchedulingDecision(taskId: TaskId): SchedulingDecision {
    const dependencies = this.graph.getDependencies(taskId);
    const readyDeps: TaskId[] = [];
    const pendingDeps: TaskId[] = [];

    for (const depId of dependencies) {
      const depState = this.stateMachine.getState(depId);
      if (depState === 'success') {
        readyDeps.push(depId);
      } else {
        pendingDeps.push(depId);
      }
    }

    const canRun = readyDeps.length === dependencies.length;

    return {
      taskId,
      canRun,
      reason: canRun
        ? 'All dependencies satisfied'
        : `${pendingDeps.length} dependencies pending`,
      readyDependencies: readyDeps,
      pendingDependencies: pendingDeps,
    };
  }

  /**
   * Attempts to dequeue and run the next ready task.
   * Returns the task ID if a task was started, undefined otherwise.
   */
  dequeueAndRun(): TaskId | undefined {
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
      return undefined;
    }

    const queued = this.getNextReadyTask();
    if (!queued) {
      return undefined;
    }

    const { task } = queued;
    this.runningTasks.set(task.id, queued);

    const success = this.stateMachine.transition(task.id, 'running');
    if (!success) {
      this.runningTasks.delete(task.id);
      return undefined;
    }

    this.updateMetrics();

    if (this.config.enableLogging) {
      console.log(`[Scheduler] Running task ${task.id} (attempt ${queued.attempts + 1})`);
    }

    return task.id;
  }

  /**
   * Marks a running task as completed successfully.
   */
  completeTask(taskId: TaskId, success: boolean, error?: string): boolean {
    const queued = this.runningTasks.get(taskId);
    if (!queued) {
      return false;
    }

    this.runningTasks.delete(taskId);

    if (success) {
      const transitioned = this.stateMachine.transition(taskId, 'success');
      if (!transitioned) {
        return false;
      }

      if (this.config.enableStalePropagation) {
        this.propagator.markProductChanged(taskId);
      }
    } else {
      const maxRetries = this.getMaxRetries(queued.task);
      queued.attempts++;

      if (queued.attempts < maxRetries) {
        // For retries: running -> failed -> pending
        const failedTransition = this.stateMachine.transition(
          taskId,
          'failed',
          `Retry attempt ${queued.attempts}/${maxRetries}`
        );

        if (!failedTransition) {
          return false;
        }

        const pendingTransition = this.stateMachine.transition(taskId, 'pending');
        if (!pendingTransition) {
          return false;
        }

        queued.enqueuedAt = Date.now();
        this.readyQueue.push(queued);
        this.metrics.totalRetries++;
      } else {
        const transitioned = this.stateMachine.transition(
          taskId,
          'failed',
          error ?? 'Max retries exceeded'
        );

        if (!transitioned) {
          return false;
        }
      }
    }

    this.updateMetrics();
    this.scheduleReadyTasks();

    if (this.config.enableLogging) {
      console.log(`[Scheduler] Task ${taskId} ${success ? 'succeeded' : 'failed'}`);
    }

    return true;
  }

  /**
   * Gets maximum retry attempts for a task.
   */
  private getMaxRetries(task: WorkflowTask): number {
    return task.maxRetries ?? this.config.defaultMaxRetries;
  }

  /**
   * Gets timeout for a task in milliseconds.
   */
  getTimeout(task: WorkflowTask): number {
    return task.timeout ?? this.config.defaultTaskTimeout;
  }

  /**
   * Converts priority string to numeric value.
   */
  private getPriority(priority: 'low' | 'normal' | 'high'): number {
    const priorities: Record<string, number> = {
      low: 1,
      normal: 2,
      high: 3,
    };
    return priorities[priority] ?? 2;
  }

  /**
   * Gets all tasks ready to run (queued + can run).
   */
  getReadyTasks(): TaskId[] {
    const ready = new Set(this.readyQueue.map(qt => qt.task.id));

    for (const task of this.graph.getAllTasks()) {
      if (this.canTaskRun(task.id) && !this.runningTasks.has(task.id)) {
        ready.add(task.id);
      }
    }

    return Array.from(ready);
  }

  /**
   * Gets all currently running tasks.
   */
  getRunningTasks(): TaskId[] {
    return Array.from(this.runningTasks.keys());
  }

  /**
   * Gets the queue of tasks waiting to run.
   */
  getQueuedTasks(): TaskId[] {
    return this.readyQueue.map(qt => qt.task.id);
  }

  /**
   * Updates metrics based on current state.
   */
  private updateMetrics(): void {
    const stats = this.stateMachine.getStatistics();

    this.metrics.pendingTasks = stats.pending;
    this.metrics.runningTasks = stats.running;
    this.metrics.successfulTasks = stats.success;
    this.metrics.failedTasks = stats.failed;
    this.metrics.staleTasks = stats.stale;

    if (stats.success > 0) {
      this.metrics.averageTaskDurationMs = Math.floor(
        (Date.now() - this.startTime) / stats.success
      );
    }
  }

  /**
   * Gets current scheduler metrics.
   */
  getMetrics(): SchedulerMetrics {
    return { ...this.metrics };
  }

  /**
   * Checks if all tasks are completed.
   */
  isComplete(): boolean {
    return (
      this.readyQueue.length === 0 &&
      this.runningTasks.size === 0 &&
      this.metrics.pendingTasks === 0
    );
  }

  /**
   * Stops the scheduler and returns final metrics.
   */
  stop(): SchedulerMetrics {
    this.metrics.endTime = new Date().toISOString();
    return this.getMetrics();
  }

  /**
   * Gets all tasks with their current states.
   */
  getAllTaskStates(): Map<TaskId, TaskState | undefined> {
    const states = new Map<TaskId, TaskState | undefined>();

    for (const task of this.graph.getAllTasks()) {
      states.set(task.id, this.stateMachine.getState(task.id));
    }

    return states;
  }

  /**
   * Gets the propagator for stale state management.
   */
  getPropagator(): StalePropagator {
    return this.propagator;
  }

  /**
   * Gets the state machine for state inspection.
   */
  getStateMachine(): TaskStateMachine {
    return this.stateMachine;
  }

  /**
   * Gets the graph for dependency inspection.
   */
  getGraph(): WorkflowGraph {
    return this.graph;
  }
}
