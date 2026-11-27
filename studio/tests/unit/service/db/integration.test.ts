/**
 * 数据库集成测试：跨仓库交互
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../../src/service/db';
import type { ProjectId, ArtifactId } from '../../../../src/shared/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Database - Integration Tests', () => {
  let dbPath: string;
  let manager: DatabaseManager;
  const projectId = 'prj_integration' as ProjectId;
  let projectFolder: string;

  beforeEach(() => {
    projectFolder = path.join(os.tmpdir(), `integration-${Date.now()}-${Math.random()}`);
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }

    manager = new DatabaseManager();
    manager.init(projectFolder);
  });

  afterEach(() => {
    manager.close();

    dbPath = path.join(projectFolder, 'studio.db');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    if (fs.existsSync(projectFolder)) {
      fs.rmSync(projectFolder, { recursive: true });
    }
  });

  it('should support complete project workflow', () => {
    manager.transaction(() => {
      const project = manager.projects.create({
        id: projectId,
        name: 'Integration Test Project',
        folder: projectFolder,
        teamSnapshotId: 'tsn_integration' as any,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: 3,
        language: 'zh',
        coverArtifactId: null,
      });

      expect(project.id).toBe(projectId);

      manager.events.append({
        type: 'project.created',
        payload: { id: projectId, name: 'Integration Test Project' },
      });
    });

    const project = manager.projects.getById(projectId);
    expect(project).toBeDefined();

    const events = manager.events.getByType('project.created');
    expect(events.length).toBeGreaterThan(0);
  });

  it('should track artifact lifecycle', () => {
    manager.projects.create({
      id: projectId,
      name: 'Artifact Test',
      folder: projectFolder,
      teamSnapshotId: 'tsn_art' as any,
      sourceTeamPresetId: null,
      leadMode: 'main-agent',
      leadProjectAgentId: null,
      episodeCount: 2,
      language: 'zh',
      coverArtifactId: null,
    });

    const artifactId = 'art_integration' as ArtifactId;

    manager.transaction(() => {
      const artifact = manager.artifacts.create({
        id: artifactId,
        projectId,
        type: 'script',
        episode: 1,
        key: 'main_script',
        title: 'Main Script',
      });

      expect(artifact.status).toBe('draft');

      manager.events.append({
        type: 'artifact.created',
        payload: { id: artifactId, type: 'script' },
      });
    });

    const artifact = manager.artifacts.getById(artifactId);
    expect(artifact?.status).toBe('draft');

    manager.transaction(() => {
      const version = manager.artifacts.createVersion({
        id: 'av_1' as any,
        artifactId,
        version: 1,
        path: '/script/v1.txt',
        bytes: 1024,
        sha256: 'abc123',
        graphVersionId: 'gph_1' as any,
      });

      manager.artifacts.update(artifactId, {
        currentVersionId: 'av_1' as any,
        status: 'ready',
      });

      manager.events.append({
        type: 'artifact.versionAdded',
        payload: { artifactId, version: 1 },
      });
    });

    const updatedArtifact = manager.artifacts.getById(artifactId);
    expect(updatedArtifact?.status).toBe('ready');
    expect(updatedArtifact?.currentVersion).toBe(1);
  });

  it('should ensure event seq consistency', () => {
    manager.projects.create({
      id: projectId,
      name: 'Event Seq Test',
      folder: projectFolder,
      teamSnapshotId: 'tsn_seq' as any,
      sourceTeamPresetId: null,
      leadMode: 'main-agent',
      leadProjectAgentId: null,
      episodeCount: 1,
      language: 'zh',
      coverArtifactId: null,
    });

    const seqs: number[] = [];

    for (let i = 0; i < 20; i++) {
      const seq = manager.events.append({
        type: 'project.activity',
        payload: { counter: i },
      });
      seqs.push(seq);
    }

    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }

    const latestSeq = manager.events.getLatestSeq();
    expect(latestSeq).toBeGreaterThanOrEqual(seqs[seqs.length - 1]);
  });

  it('should support multiple projects', () => {
    const proj1Id = 'prj_1' as ProjectId;
    const proj2Id = 'prj_2' as ProjectId;
    const proj1Folder = `${projectFolder}/1`;
    const proj2Folder = `${projectFolder}/2`;

    manager.projects.create({
      id: proj1Id,
      name: 'Project 1',
      folder: proj1Folder,
      teamSnapshotId: 'tsn_1' as any,
      sourceTeamPresetId: null,
      leadMode: 'main-agent',
      leadProjectAgentId: null,
      episodeCount: 1,
      language: 'zh',
      coverArtifactId: null,
    });

    manager.projects.create({
      id: proj2Id,
      name: 'Project 2',
      folder: proj2Folder,
      teamSnapshotId: 'tsn_2' as any,
      sourceTeamPresetId: null,
      leadMode: 'main-agent',
      leadProjectAgentId: null,
      episodeCount: 1,
      language: 'en',
      coverArtifactId: null,
    });

    const count = manager.projects.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('should rollback on transaction failure', () => {
    manager.projects.create({
      id: projectId,
      name: 'Rollback Test',
      folder: projectFolder,
      teamSnapshotId: 'tsn_rollback' as any,
      sourceTeamPresetId: null,
      leadMode: 'main-agent',
      leadProjectAgentId: null,
      episodeCount: 1,
      language: 'zh',
      coverArtifactId: null,
    });

    try {
      manager.transaction(() => {
        manager.projects.update(projectId, {
          name: 'Updated Name',
        });

        const artifacts = manager.artifacts.listByProject(projectId);

        if (artifacts.length === 0) {
          throw new Error('No artifacts');
        }
      });
    } catch {
      // Expected error
    }

    const project = manager.projects.getById(projectId);
    expect(project?.name).toBe('Rollback Test');
  });
});
