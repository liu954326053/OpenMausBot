/**
 * Unit tests for workflow DAG graph implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowGraph } from '@/service/workflow/graph.js';
import type { WorkflowTask, TaskId } from '@/service/workflow/types.js';

describe('WorkflowGraph', () => {
  let graph: WorkflowGraph;

  beforeEach(() => {
    graph = new WorkflowGraph('test', 'Test Graph');
  });

  describe('Task management', () => {
    it('should add tasks to graph', () => {
      const task: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as any,
        dependencies: [],
      };

      const result = graph.addTask(task);
      expect(result).toBe(true);
      expect(graph.getTask(task.id)).toEqual(task);
    });

    it('should not add duplicate tasks', () => {
      const task: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as any,
        dependencies: [],
      };

      graph.addTask(task);
      const result = graph.addTask(task);
      expect(result).toBe(false);
    });

    it('should remove tasks', () => {
      const task: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as any,
        dependencies: [],
      };

      graph.addTask(task);
      const result = graph.removeTask(task.id);
      expect(result).toBe(true);
      expect(graph.getTask(task.id)).toBeUndefined();
    });

    it('should get all tasks', () => {
      const tasks = [
        { id: 'tsk_001' as TaskId, name: 'Task 1', agentId: 'pag_001' as any, dependencies: [] },
        { id: 'tsk_002' as TaskId, name: 'Task 2', agentId: 'pag_001' as any, dependencies: [] },
      ];

      for (const task of tasks) {
        graph.addTask(task);
      }

      const all = graph.getAllTasks();
      expect(all).toHaveLength(2);
    });
  });

  describe('Dependency management', () => {
    it('should add dependencies', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);

      expect(graph.getDependencies(t2.id)).toContain(t1.id);
    });

    it('should get transitive dependencies', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };
      const t3: WorkflowTask = { id: 'tsk_003' as TaskId, name: 'T3', agentId: 'pag_001' as any, dependencies: [] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t3.id);

      const transitive = graph.getTransitiveDependencies(t3.id);
      expect(transitive).toContain(t1.id);
      expect(transitive).toContain(t2.id);
    });

    it('should get dependents', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);

      expect(graph.getDependents(t1.id)).toContain(t2.id);
    });

    it('should remove task and clean up dependencies', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);

      graph.removeTask(t1.id);

      expect(graph.getDependencies(t2.id)).not.toContain(t1.id);
    });
  });

  describe('Cycle detection', () => {
    it('should detect simple cycle', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t1.id);

      const result = graph.validate();
      expect(result.cycleDetected).toBe(true);
      expect(result.cyclePath).toBeDefined();
    });

    it('should detect self-loop', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: ['tsk_001' as TaskId] };

      graph.addTask(t1);

      const result = graph.validate();
      expect(result.selfLoops).toContain(t1.id);
    });

    it('should detect missing dependencies', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: ['tsk_999' as TaskId] };

      graph.addTask(t1);

      const result = graph.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Topological sort', () => {
    it('should sort DAG topologically', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: ['tsk_001' as TaskId] };
      const t3: WorkflowTask = { id: 'tsk_003' as TaskId, name: 'T3', agentId: 'pag_001' as any, dependencies: ['tsk_002' as TaskId] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t3.id);

      const result = graph.topologicalSort();
      expect(result.success).toBe(true);
      expect(result.order).toEqual([t1.id, t2.id, t3.id]);
    });

    it('should fail topological sort on cycle', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t1.id);

      const result = graph.topologicalSort();
      expect(result.success).toBe(false);
    });

    it('should handle parallel tasks', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: [] };
      const t3: WorkflowTask = { id: 'tsk_003' as TaskId, name: 'T3', agentId: 'pag_001' as any, dependencies: ['tsk_001' as TaskId, 'tsk_002' as TaskId] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t3.id);
      graph.addDependency(t2.id, t3.id);

      const result = graph.topologicalSort();
      expect(result.success).toBe(true);
      expect(result.order![2]).toBe(t3.id);
      expect([result.order![0], result.order![1]]).toEqual(expect.arrayContaining([t1.id, t2.id]));
    });
  });

  describe('Validation', () => {
    it('should validate empty graph', () => {
      const result = graph.validate();
      expect(result.valid).toBe(false);
    });

    it('should detect isolated nodes', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: ['tsk_001' as TaskId] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);

      const t3: WorkflowTask = { id: 'tsk_003' as TaskId, name: 'T3', agentId: 'pag_001' as any, dependencies: [] };
      graph.addTask(t3);

      const result = graph.validate();
      expect(result.isolatedNodes).toContain(t3.id);
    });

    it('should validate correct DAG', () => {
      const t1: WorkflowTask = { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as any, dependencies: [] };
      const t2: WorkflowTask = { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_001' as any, dependencies: ['tsk_001' as TaskId] };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);

      const result = graph.validate();
      expect(result.valid).toBe(true);
      expect(result.cycleDetected).toBe(false);
    });
  });
});
