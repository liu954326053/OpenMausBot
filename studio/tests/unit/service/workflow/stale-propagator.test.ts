/**
 * Unit tests for stale state propagation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowGraph } from '../../src/service/workflow/graph';
import { TaskStateMachine } from '../../src/service/workflow/state-machine';
import { StalePropagator } from '../../src/service/workflow/stale-propagator';
import type { WorkflowTask, TaskId, ProjectAgentId } from '../../src/service/workflow/types';

describe('StalePropagator', () => {
  let graph: WorkflowGraph;
  let stateMachine: TaskStateMachine;
  let propagator: StalePropagator;

  beforeEach(() => {
    graph = new WorkflowGraph('test', 'Test Workflow');
    stateMachine = new TaskStateMachine();
    propagator = new StalePropagator(graph, stateMachine, false);
  });

  describe('Simple linear propagation', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'T2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId],
      };
      const t3: WorkflowTask = {
        id: 'tsk_003' as TaskId,
        name: 'T3',
        agentId: 'pag_003' as ProjectAgentId,
        dependencies: ['tsk_002' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t3.id);

      stateMachine.initialize(t1.id);
      stateMachine.initialize(t2.id);
      stateMachine.initialize(t3.id);

      stateMachine.transition(t1.id, 'running');
      stateMachine.transition(t1.id, 'success');
      stateMachine.transition(t2.id, 'running');
      stateMachine.transition(t2.id, 'success');
      stateMachine.transition(t3.id, 'running');
      stateMachine.transition(t3.id, 'success');
    });

    it('should mark downstream tasks stale', () => {
      const event = propagator.markProductChanged('tsk_001' as TaskId);

      expect(event.sourceTaskId).toBe('tsk_001' as TaskId);
      expect(event.affectedTasks).toContain('tsk_002' as TaskId);
      expect(event.affectedTasks).toContain('tsk_003' as TaskId);
      expect(stateMachine.isStale('tsk_002' as TaskId)).toBe(true);
      expect(stateMachine.isStale('tsk_003' as TaskId)).toBe(true);
    });

    it('should not mark upstream tasks stale', () => {
      propagator.markProductChanged('tsk_003' as TaskId);

      expect(stateMachine.isStale('tsk_001' as TaskId)).toBe(false);
      expect(stateMachine.isStale('tsk_002' as TaskId)).toBe(false);
    });

    it('should calculate propagation depth', () => {
      const event = propagator.markProductChanged('tsk_001' as TaskId);

      expect(event.propagationDepth).toBe(2);
    });

    it('should track in propagation history', () => {
      propagator.markProductChanged('tsk_001' as TaskId);

      const history = propagator.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].sourceTaskId).toBe('tsk_001' as TaskId);
    });
  });

  describe('Parallel task propagation', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'T2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: [],
      };
      const t3: WorkflowTask = {
        id: 'tsk_003' as TaskId,
        name: 'T3',
        agentId: 'pag_003' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId, 'tsk_002' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t3.id);
      graph.addDependency(t2.id, t3.id);

      for (const taskId of [t1.id, t2.id, t3.id]) {
        stateMachine.initialize(taskId);
        stateMachine.transition(taskId, 'running');
        stateMachine.transition(taskId, 'success');
      }
    });

    it('should propagate from one parallel task', () => {
      const event = propagator.markProductChanged('tsk_001' as TaskId);

      expect(event.affectedTasks).toContain('tsk_003' as TaskId);
      expect(stateMachine.isStale('tsk_003' as TaskId)).toBe(true);
    });

    it('should propagate from both parallel tasks independently', () => {
      propagator.markProductChanged('tsk_001' as TaskId);
      expect(stateMachine.isStale('tsk_003' as TaskId)).toBe(true);

      // After first task changes, t3 is now stale
      // Now reset it to pending so it can run again
      stateMachine.reset('tsk_003' as TaskId);
      expect(stateMachine.getState('tsk_003' as TaskId)).toBe('pending');
      
      // Now complete t3 and mark it stale again from t2
      stateMachine.transition('tsk_003' as TaskId, 'running');
      stateMachine.transition('tsk_003' as TaskId, 'success');
      
      // Now mark t2 as changed, which should mark t3 stale again
      propagator.markProductChanged('tsk_002' as TaskId);
      expect(stateMachine.isStale('tsk_003' as TaskId)).toBe(true);
    });

    it('should not affect sibling parallel tasks', () => {
      propagator.markProductChanged('tsk_001' as TaskId);

      expect(stateMachine.isStale('tsk_002' as TaskId)).toBe(false);
    });
  });

  describe('Restorable stale tasks', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'T2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId],
      };
      const t3: WorkflowTask = {
        id: 'tsk_003' as TaskId,
        name: 'T3',
        agentId: 'pag_003' as ProjectAgentId,
        dependencies: ['tsk_002' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t3.id);

      for (const taskId of [t1.id, t2.id, t3.id]) {
        stateMachine.initialize(taskId);
        stateMachine.transition(taskId, 'running');
        stateMachine.transition(taskId, 'success');
      }

      propagator.markProductChanged('tsk_001' as TaskId);
    });

    it('should identify restorable tasks', () => {
      const restorable = propagator.getRestorableFromStaleTasks();

      expect(restorable).toContain('tsk_002' as TaskId);
    });

    it('should not list tasks with stale dependencies as restorable', () => {
      const restorable = propagator.getRestorableFromStaleTasks();

      expect(restorable).not.toContain('tsk_003' as TaskId);
    });

    it('should reset stale tasks on command', () => {
      const reset = propagator.resetStaleTasks('tsk_001' as TaskId);

      expect(reset).toContain('tsk_002' as TaskId);
      expect(reset).toContain('tsk_003' as TaskId);
      expect(stateMachine.getState('tsk_002' as TaskId)).toBe('pending');
      expect(stateMachine.getState('tsk_003' as TaskId)).toBe('pending');
    });
  });

  describe('Affected tasks query', () => {
    beforeEach(() => {
      const tasks: WorkflowTask[] = [
        { id: 'tsk_001' as TaskId, name: 'T1', agentId: 'pag_001' as ProjectAgentId, dependencies: [] },
        { id: 'tsk_002' as TaskId, name: 'T2', agentId: 'pag_002' as ProjectAgentId, dependencies: ['tsk_001' as TaskId] },
        { id: 'tsk_003' as TaskId, name: 'T3', agentId: 'pag_003' as ProjectAgentId, dependencies: ['tsk_001' as TaskId] },
        { id: 'tsk_004' as TaskId, name: 'T4', agentId: 'pag_004' as ProjectAgentId, dependencies: ['tsk_002' as TaskId, 'tsk_003' as TaskId] },
      ];

      for (const task of tasks) {
        graph.addTask(task);
        stateMachine.initialize(task.id);
      }

      graph.addDependency(tasks[0].id, tasks[1].id);
      graph.addDependency(tasks[0].id, tasks[2].id);
      graph.addDependency(tasks[1].id, tasks[3].id);
      graph.addDependency(tasks[2].id, tasks[3].id);
    });

    it('should identify all affected tasks', () => {
      const affected = propagator.getAffectedTasks('tsk_001' as TaskId);

      expect(affected).toContain('tsk_002' as TaskId);
      expect(affected).toContain('tsk_003' as TaskId);
      expect(affected).toContain('tsk_004' as TaskId);
    });

    it('should identify intermediate affected tasks', () => {
      const affected = propagator.getAffectedTasks('tsk_002' as TaskId);

      expect(affected).toContain('tsk_004' as TaskId);
    });

    it('should handle leaf tasks with no dependents', () => {
      const affected = propagator.getAffectedTasks('tsk_004' as TaskId);

      expect(affected).toHaveLength(0);
    });
  });

  describe('Propagation summary', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'T2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId],
      };
      const t3: WorkflowTask = {
        id: 'tsk_003' as TaskId,
        name: 'T3',
        agentId: 'pag_003' as ProjectAgentId,
        dependencies: ['tsk_002' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t3.id);

      for (const taskId of [t1.id, t2.id, t3.id]) {
        stateMachine.initialize(taskId);
        stateMachine.transition(taskId, 'running');
        stateMachine.transition(taskId, 'success');
      }
    });

    it('should report stale summary', () => {
      propagator.markProductChanged('tsk_001' as TaskId);

      const summary = propagator.getStaleSummary();

      expect(summary.totalStaleTasks).toBe(2);
      expect(summary.propagationEvents).toBe(1);
      expect(summary.deepestPropagation).toBe(2);
    });

    it('should report restorable tasks in summary', () => {
      propagator.markProductChanged('tsk_001' as TaskId);

      const summary = propagator.getStaleSummary();

      expect(summary.restorableStaleTasks).toBe(1);
    });
  });

  describe('History tracking', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'T2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);

      stateMachine.initialize(t1.id);
      stateMachine.initialize(t2.id);
      stateMachine.transition(t1.id, 'running');
      stateMachine.transition(t1.id, 'success');
      stateMachine.transition(t2.id, 'running');
      stateMachine.transition(t2.id, 'success');
    });

    it('should track propagation events', () => {
      propagator.markProductChanged('tsk_001' as TaskId);

      const history = propagator.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].sourceTaskId).toBe('tsk_001' as TaskId);
    });

    it('should get task-specific propagation history', () => {
      propagator.markProductChanged('tsk_001' as TaskId);

      const taskHistory = propagator.getTaskPropagationHistory('tsk_002' as TaskId);
      expect(taskHistory).toHaveLength(1);
      expect(taskHistory[0].affectedTasks).toContain('tsk_002' as TaskId);
    });
  });

  describe('Edge cases', () => {
    it('should handle marking stale on non-existent task', () => {
      const task: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };

      graph.addTask(task);

      const event = propagator.markProductChanged('tsk_999' as TaskId);

      expect(event.affectedTasks).toHaveLength(0);
    });

    it('should handle propagation on tasks with no dependents', () => {
      const task: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };

      graph.addTask(task);
      stateMachine.initialize(task.id);

      const event = propagator.markProductChanged('tsk_001' as TaskId);

      expect(event.propagationDepth).toBe(0);
      expect(event.affectedTasks).toHaveLength(0);
    });

    it('should clear history', () => {
      const task: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'T1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };

      graph.addTask(task);
      stateMachine.initialize(task.id);
      propagator.markProductChanged('tsk_001' as TaskId);

      propagator.clearHistory();

      expect(propagator.getHistory()).toHaveLength(0);
    });
  });
});
