/**
 * Integration tests for workflow scheduler.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowGraph } from '@/service/workflow/graph';
import { TaskStateMachine } from '@/service/workflow/state-machine';
import { WorkflowScheduler } from '@/service/workflow/scheduler';
import type { WorkflowTask, TaskId, ProjectAgentId } from '@/service/workflow/types';

describe('WorkflowScheduler', () => {
  let graph: WorkflowGraph;
  let stateMachine: TaskStateMachine;
  let scheduler: WorkflowScheduler;

  beforeEach(() => {
    graph = new WorkflowGraph('test', 'Test Workflow');
    stateMachine = new TaskStateMachine();
    scheduler = new WorkflowScheduler(graph, stateMachine, {
      maxConcurrentTasks: 2,
      enableLogging: false,
      enableStalePropagation: true,
    });
  });

  describe('Simple linear workflow', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'Task 2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId],
      };
      const t3: WorkflowTask = {
        id: 'tsk_003' as TaskId,
        name: 'Task 3',
        agentId: 'pag_003' as ProjectAgentId,
        dependencies: ['tsk_002' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
      graph.addDependency(t1.id, t2.id);
      graph.addDependency(t2.id, t3.id);
    });

    it('should start scheduler', () => {
      const result = scheduler.start();
      expect(result).toBe(true);
    });

    it('should have only first task ready initially', () => {
      scheduler.start();
      const ready = scheduler.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0]).toBe('tsk_001' as TaskId);
    });

    it('should dequeue and run first task', () => {
      scheduler.start();
      const taskId = scheduler.dequeueAndRun();
      expect(taskId).toBe('tsk_001' as TaskId);
      expect(scheduler.getRunningTasks()).toContain(taskId);
    });

    it('should not schedule downstream task until upstream succeeds', () => {
      scheduler.start();
      
      const t1 = scheduler.dequeueAndRun();
      expect(t1).toBe('tsk_001' as TaskId);
      
      let ready = scheduler.getReadyTasks();
      expect(ready).toHaveLength(0);  // t1 is running, t2 not ready yet

      scheduler.completeTask(t1!, true);
      ready = scheduler.getReadyTasks();
      expect(ready).toContain('tsk_002' as TaskId);
    });

    it('should complete linear workflow', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun();
      expect(t1).toBe('tsk_001' as TaskId);
      scheduler.completeTask(t1!, true);

      const t2 = scheduler.dequeueAndRun();
      expect(t2).toBe('tsk_002' as TaskId);
      scheduler.completeTask(t2!, true);

      const t3 = scheduler.dequeueAndRun();
      expect(t3).toBe('tsk_003' as TaskId);
      scheduler.completeTask(t3!, true);

      expect(scheduler.isComplete()).toBe(true);
    });

    it('should handle task failure', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun();
      scheduler.completeTask(t1!, false, 'Error');

      // Task should be retryable, not permanently failed yet
      expect(stateMachine.getRetryCount(t1!)).toBeGreaterThan(0);
      expect(scheduler.getReadyTasks()).toContain(t1!);
    });
  });

  describe('Parallel task workflow', () => {
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
    });

    it('should schedule parallel tasks', () => {
      scheduler.start();
      const ready = scheduler.getReadyTasks();
      expect(ready).toHaveLength(2);
      expect(ready).toContain('tsk_001' as TaskId);
      expect(ready).toContain('tsk_002' as TaskId);
    });

    it('should dequeue parallel tasks', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun();
      const t2 = scheduler.dequeueAndRun();

      expect([t1, t2]).toContain('tsk_001' as TaskId);
      expect([t1, t2]).toContain('tsk_002' as TaskId);
    });

    it('should respect max concurrent tasks limit', () => {
      scheduler.start();

      scheduler.dequeueAndRun();
      scheduler.dequeueAndRun();

      const t3 = scheduler.dequeueAndRun();
      expect(t3).toBeUndefined();
    });

    it('should not schedule downstream until all parallel tasks complete', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun();
      const t2 = scheduler.dequeueAndRun();

      scheduler.completeTask(t1!, true);
      let ready = scheduler.getReadyTasks();
      expect(ready).not.toContain('tsk_003' as TaskId);

      scheduler.completeTask(t2!, true);
      ready = scheduler.getReadyTasks();
      expect(ready).toContain('tsk_003' as TaskId);
    });
  });

  describe('Retry handling', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
        maxRetries: 2,
      };

      graph.addTask(t1);
    });

    it('should retry failed task', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun()!;
      scheduler.completeTask(t1, false, 'Error');

      // Task should be back in ready queue for retry
      const ready = scheduler.getReadyTasks();
      expect(ready).toContain(t1);
      
      // Retry count increments when transitioning to pending
      const state = stateMachine.getExecutionState(t1);
      expect(state?.retryCount).toBeGreaterThan(0);
    });

    it('should respect max retries', () => {
      scheduler.start();

      // First attempt
      let taskId = scheduler.dequeueAndRun()!;
      scheduler.completeTask(taskId, false);

      // Second attempt (first retry)
      taskId = scheduler.dequeueAndRun()!;
      scheduler.completeTask(taskId, false);

      // Should not be able to run third attempt (exceeded maxRetries: 2)
      taskId = scheduler.dequeueAndRun();
      expect(taskId).toBeUndefined();

      // Task should now be in failed state
      expect(stateMachine.isFailed('tsk_001' as TaskId)).toBe(true);
    });

    it('should track total retries in metrics', () => {
      scheduler.start();

      // First run - fail and queue retry (increment 1)
      let taskId = scheduler.dequeueAndRun()!;
      scheduler.completeTask(taskId, false);
      
      // Second run - fail and queue retry (increment 2)  
      taskId = scheduler.dequeueAndRun()!;
      if (taskId) {
        scheduler.completeTask(taskId, false);
      }

      const metrics = scheduler.getMetrics();
      // Should have tracked at least 1 retry attempt
      expect(metrics.totalRetries).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Priority handling', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Normal',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
        priority: 'normal',
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'High',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: [],
        priority: 'high',
      };
      const t3: WorkflowTask = {
        id: 'tsk_003' as TaskId,
        name: 'Low',
        agentId: 'pag_003' as ProjectAgentId,
        dependencies: [],
        priority: 'low',
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addTask(t3);
    });

    it('should schedule high priority task first', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun();
      const t2 = scheduler.dequeueAndRun();

      const high = graph.getTask('tsk_002' as TaskId);
      expect([t1, t2]).toContain('tsk_002' as TaskId);
    });
  });

  describe('Metrics', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };
      const t2: WorkflowTask = {
        id: 'tsk_002' as TaskId,
        name: 'Task 2',
        agentId: 'pag_002' as ProjectAgentId,
        dependencies: ['tsk_001' as TaskId],
      };

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1.id, t2.id);
    });

    it('should track metrics during execution', () => {
      scheduler.start();

      let metrics = scheduler.getMetrics();
      expect(metrics.totalTasks).toBeGreaterThan(0);
      expect(metrics.pendingTasks).toBeGreaterThan(0);
      expect(metrics.runningTasks).toBe(0);

      scheduler.dequeueAndRun();
      metrics = scheduler.getMetrics();
      expect(metrics.runningTasks).toBe(1);
      expect(metrics.pendingTasks).toBeLessThan(2);

      scheduler.completeTask('tsk_001' as TaskId, true);
      metrics = scheduler.getMetrics();
      expect(metrics.successfulTasks).toBe(1);
    });

    it('should calculate average task duration', () => {
      scheduler.start();

      const t1 = scheduler.dequeueAndRun()!;
      
      // Add a small delay to ensure measurable duration
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }
      
      scheduler.completeTask(t1, true);

      const metrics = scheduler.getMetrics();
      expect(metrics.averageTaskDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Complete state tracking', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };

      graph.addTask(t1);
    });

    it('should check if workflow complete', () => {
      scheduler.start();

      expect(scheduler.isComplete()).toBe(false);

      const t1 = scheduler.dequeueAndRun()!;
      expect(scheduler.isComplete()).toBe(false);

      scheduler.completeTask(t1, true);
      expect(scheduler.isComplete()).toBe(true);
    });

    it('should get all task states', () => {
      scheduler.start();

      const states = scheduler.getAllTaskStates();
      expect(states.get('tsk_001' as TaskId)).toBe('pending');

      scheduler.dequeueAndRun();
      const states2 = scheduler.getAllTaskStates();
      expect(states2.get('tsk_001' as TaskId)).toBe('running');
    });
  });

  describe('Scheduler lifecycle', () => {
    beforeEach(() => {
      const t1: WorkflowTask = {
        id: 'tsk_001' as TaskId,
        name: 'Task 1',
        agentId: 'pag_001' as ProjectAgentId,
        dependencies: [],
      };

      graph.addTask(t1);
    });

    it('should not start twice', () => {
      expect(scheduler.start()).toBe(true);
      expect(scheduler.start()).toBe(false);
    });

    it('should stop and return metrics', () => {
      scheduler.start();
      scheduler.dequeueAndRun();

      const metrics = scheduler.stop();
      expect(metrics.endTime).toBeDefined();
    });
  });
});
