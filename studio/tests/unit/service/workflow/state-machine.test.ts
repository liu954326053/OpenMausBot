/**
 * Unit tests for task state machine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStateMachine } from '@/service/workflow/state-machine';
import type { TaskId } from '@/service/workflow/types';

describe('TaskStateMachine', () => {
  let sm: TaskStateMachine;
  const taskId = 'tsk_001' as TaskId;

  beforeEach(() => {
    sm = new TaskStateMachine();
  });

  describe('Initialization', () => {
    it('should initialize task in pending state', () => {
      const result = sm.initialize(taskId);
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('pending');
    });

    it('should not reinitialize existing task', () => {
      sm.initialize(taskId);
      const result = sm.initialize(taskId);
      expect(result).toBe(false);
    });

    it('should track execution state', () => {
      sm.initialize(taskId);
      const state = sm.getExecutionState(taskId);
      expect(state).toBeDefined();
      expect(state?.taskId).toBe(taskId);
      expect(state?.retryCount).toBe(0);
    });
  });

  describe('Valid state transitions', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should transition pending → running', () => {
      const result = sm.transition(taskId, 'running');
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('running');
    });

    it('should transition running → success', () => {
      sm.transition(taskId, 'running');
      const result = sm.transition(taskId, 'success');
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('success');
    });

    it('should transition running → failed', () => {
      sm.transition(taskId, 'running');
      const result = sm.transition(taskId, 'failed');
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('failed');
    });

    it('should transition failed → pending (retry)', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed');
      const result = sm.transition(taskId, 'pending');
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('pending');
      expect(sm.getRetryCount(taskId)).toBe(1);
    });

    it('should transition to stale from success', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      const result = sm.transition(taskId, 'stale');
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('stale');
    });

    it('should transition stale → pending', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      sm.transition(taskId, 'stale');
      const result = sm.transition(taskId, 'pending');
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('pending');
    });
  });

  describe('Invalid state transitions', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should not transition success → running', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      const result = sm.transition(taskId, 'running');
      expect(result).toBe(false);
    });

    it('should not transition failed → running', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed');
      const result = sm.transition(taskId, 'running');
      expect(result).toBe(false);
    });

    it('should not transition pending → success directly', () => {
      const result = sm.transition(taskId, 'success');
      expect(result).toBe(false);
    });
  });

  describe('Stale marking', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should mark successful task as stale', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      
      const result = sm.markStale(taskId);
      expect(result).toBe(true);
      expect(sm.isStale(taskId)).toBe(true);
    });

    it('should mark failed task as stale', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed');
      
      const result = sm.markStale(taskId);
      expect(result).toBe(true);
      expect(sm.isStale(taskId)).toBe(true);
    });

    it('should track upstream product change', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      sm.markStale(taskId);

      const state = sm.getExecutionState(taskId);
      expect(state?.upstreamProductChanged).toBe(true);
    });
  });

  describe('Query methods', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should check if task can run', () => {
      expect(sm.canRun(taskId)).toBe(true);
      sm.transition(taskId, 'running');
      expect(sm.canRun(taskId)).toBe(false);
    });

    it('should check if task is completed', () => {
      expect(sm.isCompleted(taskId)).toBe(false);
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      expect(sm.isCompleted(taskId)).toBe(true);
    });

    it('should check if task is successful', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      expect(sm.isSuccessful(taskId)).toBe(true);
    });

    it('should check if task failed', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed');
      expect(sm.isFailed(taskId)).toBe(true);
    });
  });

  describe('Retry tracking', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should track retry count', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed');
      sm.transition(taskId, 'pending');

      expect(sm.getRetryCount(taskId)).toBe(1);
    });

    it('should increment retry count on each retry', () => {
      for (let i = 0; i < 3; i++) {
        sm.transition(taskId, 'running');
        sm.transition(taskId, 'failed');
        sm.transition(taskId, 'pending');
      }

      expect(sm.getRetryCount(taskId)).toBe(3);
    });
  });

  describe('History tracking', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should record state changes', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');

      const history = sm.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].previousState).toBe('pending');
      expect(history[0].nextState).toBe('running');
    });

    it('should get task-specific history', () => {
      const taskId2 = 'tsk_002' as TaskId;
      sm.initialize(taskId2);

      sm.transition(taskId, 'running');
      sm.transition(taskId2, 'running');

      const history = sm.getTaskHistory(taskId);
      expect(history.length).toBe(1);
      expect(history[0].taskId).toBe(taskId);
    });

    it('should track errors in history', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed', 'Timeout');

      const history = sm.getHistory();
      expect(history[1].error).toBe('Timeout');
    });
  });

  describe('State queries', () => {
    beforeEach(() => {
      sm.initialize('tsk_001' as TaskId);
      sm.initialize('tsk_002' as TaskId);
      sm.initialize('tsk_003' as TaskId);
    });

    it('should get tasks by state', () => {
      sm.transition('tsk_001' as TaskId, 'running');
      sm.transition('tsk_002' as TaskId, 'running');
      sm.transition('tsk_002' as TaskId, 'success');

      const running = sm.getTasksByState('running');
      expect(running).toContain('tsk_001' as TaskId);
      expect(running).not.toContain('tsk_002' as TaskId);
    });

    it('should get statistics', () => {
      sm.transition('tsk_001' as TaskId, 'running');
      sm.transition('tsk_001' as TaskId, 'success');
      sm.transition('tsk_002' as TaskId, 'running');
      sm.transition('tsk_002' as TaskId, 'failed');
      sm.transition('tsk_002' as TaskId, 'pending');

      const stats = sm.getStatistics();
      expect(stats.total).toBe(3);
      expect(stats.success).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(2);
      expect(stats.totalRetries).toBe(1);
    });
  });

  describe('Reset', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should reset failed task to pending', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'failed');
      const result = sm.reset(taskId);
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBe('pending');
    });

    it('should not reset successful task to pending', () => {
      sm.transition(taskId, 'running');
      sm.transition(taskId, 'success');
      const result = sm.reset(taskId);
      expect(result).toBe(false);
    });
  });

  describe('Removal', () => {
    beforeEach(() => {
      sm.initialize(taskId);
    });

    it('should remove task from tracking', () => {
      const result = sm.remove(taskId);
      expect(result).toBe(true);
      expect(sm.getState(taskId)).toBeUndefined();
    });

    it('should not remove non-existent task', () => {
      const result = sm.remove('tsk_999' as TaskId);
      expect(result).toBe(false);
    });
  });
});
