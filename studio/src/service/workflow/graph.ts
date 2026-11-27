/**
 * Directed Acyclic Graph (DAG) for workflow task dependencies.
 * Implements cycle detection, topological sorting, and dependency resolution.
 */

import type {
  WorkflowTask,
  WorkflowDAG,
  TaskId,
  GraphValidationResult,
  TopologicalSortResult,
} from './types';

export class WorkflowGraph {
  private dag: WorkflowDAG;

  constructor(id: string, name: string, version: string = '1.0.0') {
    this.dag = {
      id,
      name,
      version,
      tasks: new Map(),
      adjacencyList: new Map(),
    };
  }

  /**
   * Adds a task to the DAG.
   */
  addTask(task: WorkflowTask): boolean {
    if (this.dag.tasks.has(task.id)) {
      return false;
    }

    this.dag.tasks.set(task.id, task);

    if (!this.dag.adjacencyList.has(task.id)) {
      this.dag.adjacencyList.set(task.id, []);
    }

    return true;
  }

  /**
   * Adds a dependency edge from source → target.
   * target depends on source (source must complete first).
   */
  addDependency(source: TaskId, target: TaskId): boolean {
    if (!this.dag.tasks.has(source) || !this.dag.tasks.has(target)) {
      return false;
    }

    const task = this.dag.tasks.get(target);
    if (!task) return false;

    if (!task.dependencies.includes(source)) {
      task.dependencies.push(source);
    }

    if (!this.dag.adjacencyList.has(source)) {
      this.dag.adjacencyList.set(source, []);
    }

    const adj = this.dag.adjacencyList.get(source);
    if (adj && !adj.includes(target)) {
      adj.push(target);
    }

    return true;
  }

  /**
   * Removes a task from the DAG.
   */
  removeTask(taskId: TaskId): boolean {
    if (!this.dag.tasks.has(taskId)) {
      return false;
    }

    this.dag.tasks.delete(taskId);
    this.dag.adjacencyList.delete(taskId);

    for (const task of this.dag.tasks.values()) {
      const idx = task.dependencies.indexOf(taskId);
      if (idx >= 0) {
        task.dependencies.splice(idx, 1);
      }
    }

    for (const adj of this.dag.adjacencyList.values()) {
      const idx = adj.indexOf(taskId);
      if (idx >= 0) {
        adj.splice(idx, 1);
      }
    }

    return true;
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: TaskId): WorkflowTask | undefined {
    return this.dag.tasks.get(taskId);
  }

  /**
   * Gets all tasks.
   */
  getAllTasks(): WorkflowTask[] {
    return Array.from(this.dag.tasks.values());
  }

  /**
   * Gets direct dependencies of a task.
   */
  getDependencies(taskId: TaskId): TaskId[] {
    const task = this.dag.tasks.get(taskId);
    return task ? [...task.dependencies] : [];
  }

  /**
   * Gets all tasks that depend on the given task.
   */
  getDependents(taskId: TaskId): TaskId[] {
    const adj = this.dag.adjacencyList.get(taskId);
    return adj ? [...adj] : [];
  }

  /**
   * Gets all transitive dependencies (recursive).
   */
  getTransitiveDependencies(taskId: TaskId): Set<TaskId> {
    const visited = new Set<TaskId>();
    const stack = [taskId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const task = this.dag.tasks.get(current);
      if (!task) continue;

      for (const dep of task.dependencies) {
        if (!visited.has(dep)) {
          visited.add(dep);
          stack.push(dep);
        }
      }
    }

    return visited;
  }

  /**
   * Gets all transitive dependents (recursive).
   */
  getTransitiveDependents(taskId: TaskId): Set<TaskId> {
    const visited = new Set<TaskId>();
    const stack = [taskId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const dependents = this.dag.adjacencyList.get(current);
      if (!dependents) continue;

      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          stack.push(dep);
        }
      }
    }

    return visited;
  }

  /**
   * Detects cycles using DFS (depth-first search).
   * Returns the first cycle found or empty array if no cycle.
   */
  private detectCycle(): TaskId[] {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<TaskId, number>();
    const parent = new Map<TaskId, TaskId>();

    for (const taskId of this.dag.tasks.keys()) {
      color.set(taskId, WHITE);
    }

    const dfs = (node: TaskId): TaskId[] => {
      color.set(node, GRAY);

      const task = this.dag.tasks.get(node);
      if (!task) return [];

      for (const neighbor of task.dependencies) {
        const neighborColor = color.get(neighbor) ?? WHITE;

        if (neighborColor === GRAY) {
          const cycle: TaskId[] = [neighbor];
          let current: TaskId | undefined = node;
          while (current && current !== neighbor) {
            cycle.push(current);
            current = parent.get(current);
          }
          cycle.push(neighbor);
          return cycle;
        }

        if (neighborColor === WHITE) {
          parent.set(neighbor, node);
          const cyclePath = dfs(neighbor);
          if (cyclePath.length > 0) {
            return cyclePath;
          }
        }
      }

      color.set(node, BLACK);
      return [];
    };

    for (const taskId of this.dag.tasks.keys()) {
      if ((color.get(taskId) ?? WHITE) === WHITE) {
        const cycle = dfs(taskId);
        if (cycle.length > 0) {
          return cycle;
        }
      }
    }

    return [];
  }

  /**
   * Finds self-loop tasks.
   */
  private findSelfLoops(): TaskId[] {
    const selfLoops: TaskId[] = [];

    for (const task of this.dag.tasks.values()) {
      if (task.dependencies.includes(task.id)) {
        selfLoops.push(task.id);
      }
    }

    return selfLoops;
  }

  /**
   * Finds isolated nodes (no dependencies, no dependents).
   */
  private findIsolatedNodes(): TaskId[] {
    const isolated: TaskId[] = [];

    for (const task of this.dag.tasks.values()) {
      const hasDeps = task.dependencies.length > 0;
      const hasDependents = (this.dag.adjacencyList.get(task.id) ?? []).length > 0;

      if (!hasDeps && !hasDependents) {
        isolated.push(task.id);
      }
    }

    return isolated;
  }

  /**
   * Validates the DAG for correctness.
   */
  validate(): GraphValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (this.dag.tasks.size === 0) {
      errors.push('DAG contains no tasks');
    }

    const cyclePath = this.detectCycle();
    const cycleDetected = cyclePath.length > 0;
    if (cycleDetected) {
      errors.push(`Cycle detected: ${cyclePath.join(' → ')}`);
    }

    const selfLoops = this.findSelfLoops();
    if (selfLoops.length > 0) {
      errors.push(`Self-loops detected: ${selfLoops.join(', ')}`);
    }

    const isolated = this.findIsolatedNodes();
    if (isolated.length > 0) {
      warnings.push(`Isolated task(s): ${isolated.join(', ')}`);
    }

    for (const task of this.dag.tasks.values()) {
      for (const depId of task.dependencies) {
        if (!this.dag.tasks.has(depId)) {
          errors.push(`Task ${task.id} depends on non-existent task ${depId}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      cycleDetected,
      cyclePath: cycleDetected ? cyclePath : undefined,
      selfLoops,
      isolatedNodes: isolated,
    };
  }

  /**
   * Topological sort using Kahn's algorithm (BFS-based).
   * Returns tasks in order that respects all dependencies.
   */
  topologicalSort(): TopologicalSortResult {
    const inDegree = new Map<TaskId, number>();
    const result: TaskId[] = [];
    const queue: TaskId[] = [];

    for (const taskId of this.dag.tasks.keys()) {
      inDegree.set(taskId, 0);
    }

    for (const task of this.dag.tasks.values()) {
      for (const dep of task.dependencies) {
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      }
    }

    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const dependents = this.dag.adjacencyList.get(current) ?? [];
      for (const dep of dependents) {
        const newDegree = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, newDegree);

        if (newDegree === 0) {
          queue.push(dep);
        }
      }
    }

    if (result.length !== this.dag.tasks.size) {
      return {
        success: false,
        error: 'Cycle detected - cannot perform topological sort',
      };
    }

    return { success: true, order: result };
  }

  /**
   * Gets the DAG for inspection.
   */
  getDAG(): WorkflowDAG {
    return {
      id: this.dag.id,
      name: this.dag.name,
      version: this.dag.version,
      tasks: new Map(this.dag.tasks),
      adjacencyList: new Map(
        Array.from(this.dag.adjacencyList).map(([k, v]) => [k, [...v]])
      ),
    };
  }
}
