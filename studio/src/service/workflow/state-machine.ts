/**
 * Task state machine for workflow execution.
 * Manages valid state transitions and state change events.
 */

import type { TaskId, TaskState, TaskStateChange, TaskExecutionState } from './types';

export class TaskStateMachine {
  private states: Map<TaskId, TaskExecutionState> = new Map();
  private history: TaskStateChange[] = [];

  /**
   * Valid state transitions (from → to).
   */
  private readonly validTransitions: Record<TaskState, Set<TaskState>> = {
    pending: new Set(['running', 'failed', 'stale']),
    running: new Set(['success', 'failed', 'stale']),
    success: new Set(['stale']),
    failed: new Set(['pending', 'stale']),
    stale: new Set(['pending']),
  };

  /**
   * Initializes a task in the state machine.
   */
  initialize(taskId: TaskId): boolean {
    if (this.states.has(taskId)) {
      return false;
    }

    this.states.set(taskId, {
      taskId,
      state: 'pending',
      createdAt: new Date().toISOString(),
      retryCount: 0,
      upstreamProductChanged: false,
    });

    return true;
  }

  /**
   * Gets current state of a task.
   */
  getState(taskId: TaskId): TaskState | undefined {
    return this.states.get(taskId)?.state;
  }

  /**
   * Gets full execution state of a task.
   */
  getExecutionState(taskId: TaskId): TaskExecutionState | undefined {
    const state = this.states.get(taskId);
    return state ? { ...state } : undefined;
  }

  /**
   * Checks if a state transition is valid.
   */
  canTransition(from: TaskState, to: TaskState): boolean {
    return this.validTransitions[from]?.has(to) ?? false;
  }

  /**
   * Attempts to transition a task to a new state.
   */
  transition(taskId: TaskId, nextState: TaskState, error?: string): boolean {
    const state = this.states.get(taskId);
    if (!state) {
      return false;
    }

    if (!this.canTransition(state.state, nextState)) {
      return false;
    }

    const previousState = state.state;
    const timestamp = new Date().toISOString();

    state.state = nextState;

    switch (nextState) {
      case 'running':
        state.startedAt = timestamp;
        break;
      case 'success':
      case 'failed':
      case 'stale':
        state.completedAt = timestamp;
        if (error) {
          state.errorMessage = error;
        }
        break;
      case 'pending':
        state.retryCount++;
        break;
    }

    this.history.push({
      taskId,
      previousState,
      nextState,
      timestamp,
      error,
      retryCount: state.retryCount,
    });

    return true;
  }

  /**
   * Marks a task as stale due to upstream product change.
   */
  markStale(taskId: TaskId): boolean {
    const state = this.states.get(taskId);
    if (!state) {
      return false;
    }

    state.upstreamProductChanged = true;

    // Transition to stale if currently in a state that allows it
    if (this.canTransition(state.state, 'stale')) {
      return this.transition(taskId, 'stale');
    }

    return true;
  }

  /**
   * Checks if a task can run (all dependencies met).
   */
  canRun(taskId: TaskId): boolean {
    const state = this.states.get(taskId);
    if (!state) {
      return false;
    }

    return state.state === 'pending' || state.state === 'failed';
  }

  /**
   * Checks if a task has completed (success, failed, or stale).
   */
  isCompleted(taskId: TaskId): boolean {
    const state = this.states.get(taskId);
    if (!state) {
      return false;
    }

    return ['success', 'failed', 'stale'].includes(state.state);
  }

  /**
   * Checks if a task succeeded.
   */
  isSuccessful(taskId: TaskId): boolean {
    return this.getState(taskId) === 'success';
  }

  /**
   * Checks if a task failed.
   */
  isFailed(taskId: TaskId): boolean {
    return this.getState(taskId) === 'failed';
  }

  /**
   * Checks if a task is stale.
   */
  isStale(taskId: TaskId): boolean {
    return this.getState(taskId) === 'stale';
  }

  /**
   * Gets all tasks in a specific state.
   */
  getTasksByState(state: TaskState): TaskId[] {
    const tasks: TaskId[] = [];
    for (const [taskId, taskState] of this.states) {
      if (taskState.state === state) {
        tasks.push(taskId);
      }
    }
    return tasks;
  }

  /**
   * Gets retry count for a task.
   */
  getRetryCount(taskId: TaskId): number {
    return this.states.get(taskId)?.retryCount ?? 0;
  }

  /**
   * Resets a task to pending (for retry).
   */
  reset(taskId: TaskId): boolean {
    const state = this.states.get(taskId);
    if (!state) {
      return false;
    }

    if (!this.canTransition(state.state, 'pending')) {
      return false;
    }

    return this.transition(taskId, 'pending');
  }

  /**
   * Gets state change history.
   */
  getHistory(): TaskStateChange[] {
    return [...this.history];
  }

  /**
   * Gets state change history for a specific task.
   */
  getTaskHistory(taskId: TaskId): TaskStateChange[] {
    return this.history.filter(change => change.taskId === taskId);
  }

  /**
   * Clears history (for testing).
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Gets all tracked task IDs.
   */
  getAllTasks(): TaskId[] {
    return Array.from(this.states.keys());
  }

  /**
   * Gets statistics about all tasks.
   */
  getStatistics() {
    const stats = {
      total: this.states.size,
      pending: 0,
      running: 0,
      success: 0,
      failed: 0,
      stale: 0,
      withUpstreamChanges: 0,
      totalRetries: 0,
      averageRetries: 0,
    };

    // Track tasks that have ever been in each state (from history)
    const failedTasks = new Set<TaskId>();
    for (const change of this.history) {
      if (change.nextState === 'failed') {
        failedTasks.add(change.taskId);
      }
    }

    for (const state of this.states.values()) {
      stats[state.state]++;
      if (state.upstreamProductChanged) {
        stats.withUpstreamChanges++;
      }
      stats.totalRetries += state.retryCount;
    }

    // Count tasks that have failed (even if they were retried)
    stats.failed = failedTasks.size;

    if (stats.total > 0) {
      stats.averageRetries = stats.totalRetries / stats.total;
    }

    return stats;
  }

  /**
   * Removes a task from the state machine.
   */
  remove(taskId: TaskId): boolean {
    return this.states.delete(taskId);
  }
}
