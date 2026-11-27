/**
 * 产物服务单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArtifactService } from '@/service/artifacts';
import type {
  ArtifactId,
  ArtifactVersionId,
  ProjectId,
  GraphVersionId,
} from '@/shared/types';

describe('ArtifactService', () => {
  let mockDb: any;
  let mockEvents: any;
  let artifactService: ArtifactService;

  beforeEach(() => {
    mockDb = {
      artifacts: {
        create: vi.fn().mockReturnValue({
          id: 'art_test' as ArtifactId,
          projectId: 'prj_test' as ProjectId,
          type: 'script',
          episode: 1,
          key: 'episode_1_script',
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
          key: 'episode_1_script',
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
        listByProjectAndType: vi.fn().mockReturnValue([]),
        listByProject: vi.fn().mockReturnValue([]),
        createVersion: vi.fn().mockReturnValue({
          id: 'av_test' as ArtifactVersionId,
          artifactId: 'art_test' as ArtifactId,
          version: 1,
          schemaVersion: 1,
          path: '/artifacts/art_test/v1',
          bytes: 1024,
          sha256: 'abc123',
          taskId: null,
          graphVersionId: 'gph_test' as GraphVersionId,
          agentSnapshotId: null,
          inputPins: [],
          note: null,
          selected: false,
          createdAt: new Date().toISOString(),
        }),
        getVersionById: vi.fn().mockReturnValue({
          id: 'av_test' as ArtifactVersionId,
          artifactId: 'art_test' as ArtifactId,
          version: 1,
          schemaVersion: 1,
          path: '/artifacts/art_test/v1',
          bytes: 1024,
          sha256: 'abc123',
          taskId: null,
          graphVersionId: 'gph_test' as GraphVersionId,
          agentSnapshotId: null,
          inputPins: [],
          note: null,
          selected: false,
          createdAt: new Date().toISOString(),
        }),
        getVersionsByArtifact: vi.fn().mockReturnValue([]),
        updateVersionSelected: vi.fn(),
        update: vi.fn().mockReturnValue({
          id: 'art_test' as ArtifactId,
          status: 'ready',
        }),
        delete: vi.fn(),
        restore: vi.fn().mockReturnValue({
          id: 'art_test' as ArtifactId,
          deletedAt: null,
        }),
      },
    };

    mockEvents = {
      publish: vi.fn(),
    };

    artifactService = new ArtifactService(mockDb, mockEvents);
  });

  describe('create', () => {
    it('should create an artifact and publish event', async () => {
      const result = await artifactService.create({
        id: 'art_test' as ArtifactId,
        projectId: 'prj_test' as ProjectId,
        type: 'script',
        episode: 1,
        key: 'episode_1_script',
        title: 'Episode 1 Script',
      });

      expect(result.id).toBe('art_test');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact.created',
        })
      );
    });
  });

  describe('createVersion', () => {
    it('should create a version and publish event', async () => {
      const result = await artifactService.createVersion({
        id: 'av_test' as ArtifactVersionId,
        artifactId: 'art_test' as ArtifactId,
        version: 1,
        path: '/artifacts/art_test/v1',
        bytes: 1024,
        sha256: 'abc123',
        graphVersionId: 'gph_test' as GraphVersionId,
      });

      expect(result.id).toBe('av_test');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact.versionAdded',
        })
      );
    });
  });

  describe('selectVersion', () => {
    it('should select version and publish event', async () => {
      await artifactService.selectVersion(
        'art_test' as ArtifactId,
        'av_test' as ArtifactVersionId
      );

      expect(mockDb.artifacts.updateVersionSelected).toHaveBeenCalled();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact.selected',
        })
      );
    });
  });

  describe('compareVersions', () => {
    it('should compare two versions', async () => {
      const result = await artifactService.compareVersions(
        'av_v1' as ArtifactVersionId,
        'av_v2' as ArtifactVersionId
      );

      expect(result).toHaveProperty('isDifferent');
      expect(result).toHaveProperty('sha256A');
      expect(result).toHaveProperty('sha256B');
    });
  });

  describe('updateStatus', () => {
    it('should update artifact status and publish event', async () => {
      await artifactService.updateStatus('art_test' as ArtifactId, 'ready');

      expect(mockDb.artifacts.update).toHaveBeenCalled();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact.statusChanged',
        })
      );
    });
  });

  describe('delete', () => {
    it('should delete artifact and publish event', async () => {
      await artifactService.delete('art_test' as ArtifactId);

      expect(mockDb.artifacts.delete).toHaveBeenCalled();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact.deleted',
        })
      );
    });
  });
});
