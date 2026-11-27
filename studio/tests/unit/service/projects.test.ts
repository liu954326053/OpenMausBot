/**
 * 项目服务单元测试
 *
 * 使用 mock database，不依赖实际 SQLite 实例
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectService } from '@/service/projects';
import type { DatabaseManager } from '@/service/db';
import type { EventService } from '@/service/events';
import type {
  ProjectId,
  TeamSnapshotId,
  ProjectAgentId,
  ArtifactId,
} from '@/shared/types';

describe('ProjectService', () => {
  let mockDb: any;
  let mockEvents: any;
  let projectService: ProjectService;

  beforeEach(() => {
    mockDb = {
      projects: {
        create: vi.fn().mockReturnValue({
          id: 'prj_test' as ProjectId,
          name: 'Test Project',
          folder: '/test',
          teamSnapshotId: 'tsn_test' as TeamSnapshotId,
          sourceTeamPresetId: null,
          lead: {
            mode: 'main-agent' as const,
            projectAgentId: null,
          },
          episodeCount: 10,
          language: 'zh' as const,
          coverArtifactId: null,
          settings: {
            maxConcurrentTasks: 4,
            networkPerAgent: false,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          deletedAt: null,
        }),
        getById: vi.fn().mockReturnValue({
          id: 'prj_test' as ProjectId,
          name: 'Test Project',
          folder: '/test',
          teamSnapshotId: 'tsn_test' as TeamSnapshotId,
          sourceTeamPresetId: null,
          lead: {
            mode: 'main-agent' as const,
            projectAgentId: null,
          },
          episodeCount: 10,
          language: 'zh' as const,
          coverArtifactId: null,
          settings: {
            maxConcurrentTasks: 4,
            networkPerAgent: false,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          deletedAt: null,
        }),
        getByFolder: vi.fn().mockReturnValue(null),
        listActive: vi.fn().mockReturnValue([]),
        update: vi.fn().mockReturnValue({
          id: 'prj_test' as ProjectId,
          name: 'Updated Project',
        }),
        touch: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn().mockReturnValue(true),
        count: vi.fn().mockReturnValue(1),
      },
      artifacts: {
        listByProject: vi.fn().mockReturnValue([]),
      },
      tasks: {
        listByProject: vi.fn().mockReturnValue([]),
      },
    };

    mockEvents = {
      publish: vi.fn(),
    };

    projectService = new ProjectService(mockDb, mockEvents);
  });

  describe('create', () => {
    it('should create a project and publish event', async () => {
      const result = await projectService.create({
        id: 'prj_test' as ProjectId,
        name: 'Test Project',
        folder: '/test',
        teamSnapshotId: 'tsn_test' as TeamSnapshotId,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: 10,
        language: 'zh',
      });

      expect(result.id).toBe('prj_test');
      expect(result.name).toBe('Test Project');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project.created',
        })
      );
    });
  });

  describe('getById', () => {
    it('should return project by id', async () => {
      const result = await projectService.getById('prj_test' as ProjectId);
      expect(result.id).toBe('prj_test');
      expect(mockDb.projects.touch).toHaveBeenCalledWith('prj_test');
    });

    it('should throw error if project not found', async () => {
      mockDb.projects.getById.mockReturnValueOnce(null);
      await expect(projectService.getById('prj_missing' as ProjectId)).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update project and publish event', async () => {
      await projectService.update('prj_test' as ProjectId, {
        name: 'Updated Project',
      });

      expect(mockDb.projects.update).toHaveBeenCalled();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project.updated',
        })
      );
    });
  });

  describe('archive', () => {
    it('should archive project and publish event', async () => {
      await projectService.archive('prj_test' as ProjectId);

      expect(mockDb.projects.delete).toHaveBeenCalledWith('prj_test');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project.deleted',
        })
      );
    });
  });

  describe('getStats', () => {
    it('should return project statistics', async () => {
      mockDb.artifacts.listByProject.mockReturnValueOnce([
        { id: 'art_1' },
        { id: 'art_2' },
      ]);

      mockDb.tasks.listByProject.mockReturnValueOnce([
        { id: 'tsk_1', status: 'done' },
        { id: 'tsk_2', status: 'running' },
        { id: 'tsk_3', status: 'failed' },
      ]);

      const stats = await projectService.getStats('prj_test' as ProjectId);

      expect(stats.totalArtifacts).toBe(2);
      expect(stats.totalTasks).toBe(3);
      expect(stats.tasksByStatus).toEqual({
        done: 1,
        running: 1,
        failed: 1,
      });
    });
  });

  describe('count', () => {
    it('should return project count', async () => {
      const count = await projectService.count();
      expect(count).toBe(1);
    });
  });
});
