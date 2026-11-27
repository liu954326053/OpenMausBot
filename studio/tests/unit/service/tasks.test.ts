/**
 * 任务服务单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService } from '../../src/service/tasks';
import type {
  TaskId,
  ProjectId,
  GraphVersionId,
  NodeId,
  ProjectAgentId,
  Scope,
} from '../../src/shared/types';

describe('TaskService', () => {
  let mockDb: any;
  let mockEvents: any;
  let taskService: TaskService;

  beforeEach(() => {
    mockDb = {
      tasks: {
        create: vi.fn().mockReturnValue({
          id: 'tsk_test' as TaskId,
          projectId: 'prj_test' as ProjectId,
          graphVersionId: 'gph_test' as GraphVersionId,
          nodeId: 'nod_test' as NodeId,
          projectAgentId: 'pag_test' as ProjectAgentId,
          agentSnapshotId: null,
          scope: 'drama' as Scope,
          episode: 0,
          status: 'waiting',
          attempt: 1,
          gate: 'none',
          inputPins: [],
          outputVersionIds: [],
          queuedAt: new Date().toISOString(),
        }),
        getById: vi.fn().mockReturnValue({
          id: 'tsk_test' as TaskId,
          projectId: 'prj_test' as ProjectId,
          graphVersionId: 'gph_test' as GraphVersionId,
          nodeId: 'nod_test' as NodeId,
          projectAgentId: 'pag_test' as ProjectAgentId,
          agentSnapshotId: null,
          scope: 'drama' as Scope,
          episode: 0,
          status: 'waiting',
          attempt: 1,
          gate: 'none',
          inputPins: [],
          outputVersionIds: [],
          queuedAt: new Date().toISOString(),
        }),
        getByGraphNodeAndEpisode: vi.fn().mockReturnValue(null),
        listByProject: vi.fn().mockReturnValue([]),
        listByGraphVersion: vi.fn().mockReturnValue([]),
        updateStatus: vi.fn().mockReturnValue({
          id: 'tsk_test',
          status: 'ready',
        }),
        setError: vi.fn().mockReturnValue({
          id: 'tsk_test',
          status: 'failed',
        }),
        clearError: vi.fn(),
        updateGate: vi.fn().mockReturnValue({
          id: 'tsk_test',
          gate: 'pending',
        }),
        addOutputVersion: vi.fn(),
        createAttempt: vi.fn(),
        updateAttempt: vi.fn(),
      },
    };

    mockEvents = {
      publish: vi.fn(),
    };

    taskService = new TaskService(mockDb, mockEvents);
  });

  describe('create', () => {
    it('should create a task and publish event', async () => {
      const result = await taskService.create({
        id: 'tsk_test' as TaskId,
        projectId: 'prj_test' as ProjectId,
        graphVersionId: 'gph_test' as GraphVersionId,
        nodeId: 'nod_test' as NodeId,
        projectAgentId: 'pag_test' as ProjectAgentId,
        scope: 'drama',
        episode: 0,
      });

      expect(result.id).toBe('tsk_test');
      expect(result.status).toBe('waiting');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.created',
        })
      );
    });
  });

  describe('getById', () => {
    it('should return task by id', async () => {
      const result = await taskService.getById('tsk_test' as TaskId);
      expect(result.id).toBe('tsk_test');
    });

    it('should throw error if task not found', async () => {
      mockDb.tasks.getById.mockReturnValueOnce(null);
      await expect(taskService.getById('tsk_missing' as TaskId)).rejects.toThrow();
    });
  });

  describe('updateStatus', () => {
    it('should update task status and publish event', async () => {
      await taskService.updateStatus('tsk_test' as TaskId, {
        status: 'ready',
      });

      expect(mockDb.tasks.updateStatus).toHaveBeenCalled();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.statusChanged',
        })
      );
    });
  });

  describe('cancel', () => {
    it('should cancel task and publish event', async () => {
      await taskService.cancel('tsk_test' as TaskId);

      expect(mockDb.tasks.updateStatus).toHaveBeenCalledWith('tsk_test', 'cancelled');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.statusChanged',
          payload: expect.objectContaining({
            status: 'cancelled',
          }),
        })
      );
    });

    it('should throw error if task already done', async () => {
      mockDb.tasks.getById.mockReturnValueOnce({
        id: 'tsk_test',
        status: 'done',
      });

      await expect(taskService.cancel('tsk_test' as TaskId)).rejects.toThrow();
    });
  });

  describe('setError', () => {
    it('should set task error and publish event', async () => {
      await taskService.setError('tsk_test' as TaskId, {
        kind: 'timeout',
        message: 'Task execution timeout',
      });

      expect(mockDb.tasks.setError).toHaveBeenCalled();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.statusChanged',
          payload: expect.objectContaining({
            status: 'failed',
          }),
        })
      );
    });
  });

  describe('requestGateConfirmation', () => {
    it('should request gate confirmation and publish event', async () => {
      await taskService.requestGateConfirmation('tsk_test' as TaskId);

      expect(mockDb.tasks.updateGate).toHaveBeenCalledWith('tsk_test', 'pending');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.gateRequested',
        })
      );
    });
  });

  describe('confirmGate', () => {
    it('should confirm gate and publish event', async () => {
      await taskService.confirmGate('tsk_test' as TaskId);

      expect(mockDb.tasks.updateGate).toHaveBeenCalledWith('tsk_test', 'confirmed');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.gateConfirmed',
        })
      );
    });
  });

  describe('createAttempt', () => {
    it('should create task attempt', async () => {
      await taskService.createAttempt('tsk_test' as TaskId, 1, '/logs/tsk_test_1.log');

      expect(mockDb.tasks.createAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'tsk_test',
          attempt: 1,
          logPath: '/logs/tsk_test_1.log',
        })
      );
    });
  });

  describe('getReadyTasks', () => {
    it('should return ready task ids', async () => {
      mockDb.tasks.listByProject.mockReturnValueOnce([
        { id: 'tsk_1' },
        { id: 'tsk_2' },
      ]);

      const result = await taskService.getReadyTasks('prj_test' as ProjectId);

      expect(result).toEqual(['tsk_1', 'tsk_2']);
      expect(mockDb.tasks.listByProject).toHaveBeenCalledWith('prj_test', 'ready');
    });
  });
});
