/**
 * Workflow scheduler types and interfaces.
 * Defines DAG structures, task states, and scheduling contracts.
 */

import type { TaskId, ProjectAgentId } from '../../shared/types';

/**
 * Task state machine: pending → running → (success/failed/stale)
 */
export type TaskState = 'pending' | 'running' | 'success' | 'failed' | 'stale';

/**
 * Task state transition event.
 */
export interface TaskStateChange {
  taskId: TaskId;
  previousState: TaskState;
  nextState: TaskState;
  timestamp: string;
  error?: string;
  retryCount?: number;
}

/**
 * Task definition in a workflow DAG.
 */
export interface WorkflowTask {
  id: TaskId;
  name: string;
  agentId: ProjectAgentId;
  
  /* Task dependencies: other task IDs that must succeed before this task runs */
  dependencies: TaskId[];
  
  /* Execution parameters */
  timeout?: number;
  maxRetries?: number;
  priority?: 'low' | 'normal' | 'high';
  
  /* Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Task execution state and history.
 */
export interface TaskExecutionState {
  taskId: TaskId;
  state: TaskState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  errorMessage?: string;
  upstreamProductChanged: boolean;
}

/**
 * Workflow DAG definition.
 */
export interface WorkflowDAG {
  id: string;
  name: string;
  version: string;
  tasks: Map<TaskId, WorkflowTask>;
  
  /* Adjacency list: taskId → [dependent taskIds] */
  adjacencyList: Map<TaskId, TaskId[]>;
}

/**
 * Scheduler configuration options.
 */
export interface SchedulerConfig {
  /* Maximum concurrent tasks to run simultaneously */
  maxConcurrentTasks?: number;
  
  /* Task execution timeout in milliseconds */
  defaultTaskTimeout?: number;
  
  /* Default max retry attempts */
  defaultMaxRetries?: number;
  
  /* Enable state change logging */
  enableLogging?: boolean;
  
  /* Enable automatic stale state propagation */
  enableStalePropagation?: boolean;
}

/**
 * Scheduler execution metrics.
 */
export interface SchedulerMetrics {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  staleTasks: number;
  pendingTasks: number;
  runningTasks: number;
  totalRetries: number;
  averageTaskDurationMs: number;
  startTime: string;
  endTime?: string;
}

/**
 * Graph validation result.
 */
export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cycleDetected: boolean;
  cyclePath?: TaskId[];
  selfLoops: TaskId[];
  isolatedNodes: TaskId[];
}

/**
 * Topological sort result.
 */
export interface TopologicalSortResult {
  success: boolean;
  order?: TaskId[];
  error?: string;
}

/**
 * Task scheduling decision.
 */
export interface SchedulingDecision {
  taskId: TaskId;
  canRun: boolean;
  reason: string;
  readyDependencies: TaskId[];
  pendingDependencies: TaskId[];
}
