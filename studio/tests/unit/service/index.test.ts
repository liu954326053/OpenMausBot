/**
 * 业务服务层集成测试
 *
 * 验证多个服务之间的交互和协调
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceContainer } from '@/service';
import type { DatabaseManager } from '@/service/db';
import type {
  ProjectId,
  TeamSnapshotId,
  ArtifactId,
  GraphVersionId,
  TaskId,
  NodeId,
  ProjectAgentId,
} from '@/shared/types';

describe('ServiceContainer Integration', () => {
  let mockDb: any;
  let services: ServiceContainer;

  beforeEach(() => {
    mockDb = {
      projects: {
        create: vi.fn().mockReturnValue({
          id: 'prj_test' as ProjectId,
          name: 'Test Project',
          folder: '/test',
          teamSnapshotId: 'tsn_test' as TeamSnapshotId,
          sourceTeamPresetId: null,
          lead: { mode: 'main-agent', projectAgentId: null },
          episodeCount: 10,
          language: 'zh',
          coverArtifactId: null,
          settings: { maxConcurrentTasks: 4, networkPerAgent: false },
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
          lead: { mode: 'main-agent', projectAgentId: null },
          episodeCount: 10,
          language: 'zh',
          coverArtifactId: null,
          settings: { maxConcurrentTasks: 4, networkPerAgent: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          deletedAt: null,
        }),
        touch: vi.fn(),
        exists: vi.fn().mockReturnValue(true),
        count: vi.fn().mockReturnValue(1),
        listActive: vi.fn().mockReturnValue([]),
        update: vi.fn(),
        delete: vi.fn(),
        getByFolder: vi.fn(),
      },
      artifacts: {
        create: vi.fn().mockReturnValue({
          id: 'art_test' as ArtifactId,
          projectId: 'prj_test' as ProjectId,
          type: 'script',
          episode: 1,
          key: 'episode_1',
          title: 'Episode 1 Script',
          currentVersionId: null,
          currentVersion: 0,
          status: 'draft',
          producerNodeId: null,
          producerProjectAgentId: null,
          deletedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getById: vi.fn().mockReturnValue({
          id: 'art_test' as ArtifactId,
          projectId: 'prj_test' as ProjectId,
          type: 'script',
          episode: 1,
          key: 'episode_1',
          title: 'Episode 1 Script',
          currentVersionId: null,
          currentVersion: 0,
          status: 'draft',
          producerNodeId: null,
          producerProjectAgentId: null,
          deletedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        listByProject: vi.fn().mockReturnValue([]),
        listByProjectAndType: vi.fn().mockReturnValue([]),
        createVersion: vi.fn().mockReturnValue({
          id: 'av_test',
          artifactId: 'art_test',
          version: 1,
          schemaVersion: 1,
          path: '/artifacts/art_test/v1',
          bytes: 1024,
          sha256: 'abc123',
          taskId: null,
          graphVersionId: 'gph_test',
          agentSnapshotId: null,
          inputPins: [],
          note: null,
          selected: false,
          createdAt: new Date().toISOString(),
        }),
        getVersionById: vi.fn().mockReturnValue({
          id: 'av_test',
          artifactId: 'art_test',
          version: 1,
          schemaVersion: 1,
          path: '/artifacts/art_test/v1',
          bytes: 1024,
          sha256: 'abc123',
          taskId: null,
          graphVersionId: 'gph_test',
          agentSnapshotId: null,
          inputPins: [],
          note: null,
          selected: false,
          createdAt: new Date().toISOString(),
        }),
        getVersionsByArtifact: vi.fn().mockReturnValue([]),
        updateVersionSelected: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        restore: vi.fn(),
      },
      tasks: {
        create: vi.fn().mockReturnValue({
          id: 'tsk_test' as TaskId,
          projectId: 'prj_test' as ProjectId,
          graphVersionId: 'gph_test' as GraphVersionId,
          nodeId: 'nod_test' as NodeId,
          projectAgentId: 'pag_test' as ProjectAgentId,
          agentSnapshotId: null,
          scope: 'drama',
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
          scope: 'drama',
          episode: 0,
          status: 'waiting',
          attempt: 1,
          gate: 'none',
          inputPins: [],
          outputVersionIds: [],
          queuedAt: new Date().toISOString(),
        }),
        listByProject: vi.fn().mockReturnValue([]),
        listByGraphVersion: vi.fn().mockReturnValue([]),
        getByGraphNodeAndEpisode: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn().mockReturnValue({
          id: 'tsk_test',
          status: 'ready',
        }),
        setError: vi.fn(),
        clearError: vi.fn(),
        updateGate: vi.fn(),
        addOutputVersion: vi.fn(),
        createAttempt: vi.fn(),
        updateAttempt: vi.fn(),
      },
      events: {
        append: vi.fn().mockReturnValue(1),
        getRange: vi.fn().mockReturnValue([]),
        getByProject: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getByProjectAndType: vi.fn().mockReturnValue([]),
        getBySeq: vi.fn(),
        getLatestSeq: vi.fn().mockReturnValue(0),
        count: vi.fn().mockReturnValue(1),
        validateContinuity: vi.fn().mockReturnValue(-1),
        getStats: vi.fn().mockReturnValue({
          totalEvents: 1,
          latestSeq: 1,
          eventsByType: {},
          eventsByProject: {},
        }),
        streamEvents: vi.fn(function* () {}),
      },
    };

    services = new ServiceContainer(mockDb as any);
  });

  describe('Service initialization', () => {
    it('should initialize all services', () => {
      expect(services.projects).toBeDefined();
      expect(services.artifacts).toBeDefined();
      expect(services.tasks).toBeDefined();
      expect(services.conversations).toBeDefined();
      expect(services.getEventService()).toBeDefined();
    });
  });

  describe('Cross-service interaction', () => {
    it('should create project, artifact, and task in sequence', async () => {
      const project = await services.projects.create({
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

      expect(project.id).toBe('prj_test');

      const artifact = await services.artifacts.create({
        id: 'art_test' as ArtifactId,
        projectId: project.id,
        type: 'script',
        episode: 1,
        key: 'episode_1',
        title: 'Episode 1 Script',
      });

      expect(artifact.id).toBe('art_test');

      const task = await services.tasks.create({
        id: 'tsk_test' as TaskId,
        projectId: project.id,
        graphVersionId: 'gph_test' as GraphVersionId,
        nodeId: 'nod_test' as NodeId,
        projectAgentId: 'pag_test' as ProjectAgentId,
        scope: 'drama',
        episode: 0,
      });

      expect(task.id).toBe('tsk_test');
    });

    it('should track event publications', async () => {
      await services.projects.create({
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

      await services.artifacts.create({
        id: 'art_test' as ArtifactId,
        projectId: 'prj_test' as ProjectId,
        type: 'script',
        episode: 1,
        key: 'episode_1',
        title: 'Episode 1 Script',
      });

      expect(mockDb.events.append).toHaveBeenCalledTimes(2);
    });
  });

  describe('Event publishing', () => {
    it('should publish project.created event', async () => {
      await services.projects.create({
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

      expect(mockDb.events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project.created',
        })
      );
    });

    it('should publish artifact.versionAdded event', async () => {
      await services.artifacts.createVersion({
        id: 'av_test' as any,
        artifactId: 'art_test' as ArtifactId,
        version: 1,
        path: '/artifacts/art_test/v1',
        bytes: 1024,
        sha256: 'abc123',
        graphVersionId: 'gph_test' as GraphVersionId,
      });

      expect(mockDb.events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact.versionAdded',
        })
      );
    });

    it('should publish task.statusChanged event', async () => {
      await services.tasks.updateStatus('tsk_test' as TaskId, {
        status: 'ready',
      });

      expect(mockDb.events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.statusChanged',
        })
      );
    });
  });
});
