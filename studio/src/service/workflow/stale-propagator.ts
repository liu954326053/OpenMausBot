/**
 * Stale state propagator for workflow DAG.
 * Propagates stale status to downstream tasks when upstream products change.
 * Does NOT automatically re-run tasks, only marks them as stale.
 */

import type { TaskId } from './types.js';
import { WorkflowGraph } from './graph.js';
import { TaskStateMachine } from './state-machine.js';

export interface StalePropagationEvent {
  sourceTaskId: TaskId;
  affectedTasks: TaskId[];
  propagationDepth: number;
  timestamp: string;
}

export class StalePropagator {
  private graph: WorkflowGraph;
  private stateMachine: TaskStateMachine;
  private propagationHistory: StalePropagationEvent[] = [];
  private enableLogging: boolean;

  constructor(
    graph: WorkflowGraph,
    stateMachine: TaskStateMachine,
    enableLogging: boolean = false
  ) {
    this.graph = graph;
    this.stateMachine = stateMachine;
    this.enableLogging = enableLogging;
  }

  /**
   * Marks a task's output as changed and propagates stale state downstream.
   * This triggers stale marking for all dependent tasks.
   */
  markProductChanged(sourceTaskId: TaskId): StalePropagationEvent {
    const affectedTasks: TaskId[] = [];
    const timestamp = new Date().toISOString();

    const transitiveDependents = this.graph.getTransitiveDependents(sourceTaskId);

    for (const dependentId of transitiveDependents) {
      const success = this.stateMachine.markStale(dependentId);
      if (success) {
        affectedTasks.push(dependentId);
      }
    }

    const depth = this.calculatePropagationDepth(sourceTaskId, affectedTasks);

    const event: StalePropagationEvent = {
      sourceTaskId,
      affectedTasks,
      propagationDepth: depth,
      timestamp,
    };

    this.propagationHistory.push(event);

    if (this.enableLogging) {
      console.log(
        `[StalePropagator] Marked ${affectedTasks.length} tasks stale due to ${sourceTaskId}`
      );
    }

    return event;
  }

  /**
   * Checks if a task should be marked stale based on its dependencies.
   * Returns true if any direct dependency changed product.
   */
  shouldMarkStale(taskId: TaskId, changedUpstreamTasks: Set<TaskId>): boolean {
    const dependencies = this.graph.getDependencies(taskId);
    return dependencies.some(dep => changedUpstreamTasks.has(dep));
  }

  /**
   * Gets all tasks that would be affected by marking a source task's product as changed.
   */
  getAffectedTasks(sourceTaskId: TaskId): TaskId[] {
    return Array.from(this.graph.getTransitiveDependents(sourceTaskId));
  }

  /**
   * Calculates the maximum depth of propagation (longest path in dependent chain).
   */
  private calculatePropagationDepth(sourceTaskId: TaskId, affectedTasks: TaskId[]): number {
    if (affectedTasks.length === 0) {
      return 0;
    }

    let maxDepth = 0;

    for (const affectedId of affectedTasks) {
      const dist = this.distanceBetweenTasks(sourceTaskId, affectedId);
      maxDepth = Math.max(maxDepth, dist);
    }

    return maxDepth;
  }

  /**
   * Calculates distance (number of edges) between two tasks in the DAG.
   */
  private distanceBetweenTasks(source: TaskId, target: TaskId): number {
    const visited = new Set<TaskId>();
    const queue: [TaskId, number][] = [[source, 0]];

    while (queue.length > 0) {
      const [current, distance] = queue.shift()!;

      if (current === target) {
        return distance;
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const dependents = this.graph.getDependents(current);
      for (const dep of dependents) {
        queue.push([dep, distance + 1]);
      }
    }

    return -1;
  }

  /**
   * Gets all stale tasks that have an upstream dependency that is not stale.
   * These are tasks eligible for re-execution (after user/system decision).
   */
  getRestorableFromStaleTasks(): TaskId[] {
    const staleTasks = this.stateMachine.getTasksByState('stale');
    const restorableTasks: TaskId[] = [];

    for (const staleTaskId of staleTasks) {
      const dependencies = this.graph.getDependencies(staleTaskId);
      let canRestore = true;

      for (const depId of dependencies) {
        const depState = this.stateMachine.getState(depId);
        if (depState === 'stale') {
          canRestore = false;
          break;
        }
      }

      if (canRestore) {
        restorableTasks.push(staleTaskId);
      }
    }

    return restorableTasks;
  }

  /**
   * Resets all stale tasks in a dependent chain back to pending.
   * This is an explicit operation and requires user consent.
   */
  resetStaleTasks(sourceTaskId: TaskId): TaskId[] {
    const affectedTasks = this.getAffectedTasks(sourceTaskId);
    const resetTasks: TaskId[] = [];

    for (const taskId of affectedTasks) {
      if (this.stateMachine.isStale(taskId)) {
        const success = this.stateMachine.reset(taskId);
        if (success) {
          resetTasks.push(taskId);
        }
      }
    }

    if (this.enableLogging) {
      console.log(`[StalePropagator] Reset ${resetTasks.length} stale tasks to pending`);
    }

    return resetTasks;
  }

  /**
   * Gets propagation history.
   */
  getHistory(): StalePropagationEvent[] {
    return [...this.propagationHistory];
  }

  /**
   * Gets propagation events for a specific task.
   */
  getTaskPropagationHistory(taskId: TaskId): StalePropagationEvent[] {
    return this.propagationHistory.filter(
      event => event.sourceTaskId === taskId || event.affectedTasks.includes(taskId)
    );
  }

  /**
   * Gets summary of stale propagation impact.
   */
  getStaleSummary() {
    const staleTasks = this.stateMachine.getTasksByState('stale');
    const restorable = this.getRestorableFromStaleTasks();

    return {
      totalStaleTasks: staleTasks.length,
      restorableStaleTasks: restorable.length,
      propagationEvents: this.propagationHistory.length,
      deepestPropagation: this.propagationHistory.length > 0
        ? Math.max(...this.propagationHistory.map(e => e.propagationDepth))
        : 0,
    };
  }

  /**
   * Clears propagation history (for testing).
   */
  clearHistory(): void {
    this.propagationHistory = [];
  }
}
