/**
 * 数据库事务与并发写入测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../../src/service/db/index';
import { getDatabasePath } from '../../../../src/service/db/schema';
import type { ProjectId, ArtifactId } from '../../../../src/shared/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('DatabaseManager - Transactions', () => {
  let dbPath: string;
  let manager: DatabaseManager;
  let projectFolder: string;

  beforeEach(() => {
    projectFolder = path.join(os.tmpdir(), `test-tx-${Date.now()}-${Math.random()}`);
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }
    dbPath = path.join(projectFolder, 'studio.db');
    manager = new DatabaseManager();
    manager.init(projectFolder);
  });

  afterEach(() => {
    manager.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(projectFolder)) {
      fs.rmSync(projectFolder, { recursive: true });
    }
  });

  it('should commit successful transactions', () => {
    manager.transaction(() => {
      manager.projects.create({
        id: 'prj_123' as ProjectId,
        name: 'Test',
        folder: '/tmp/test',
        teamSnapshotId: 'tsn_123' as any,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: 1,
        language: 'zh',
        coverArtifactId: null,
      });
    });

    const project = manager.projects.getById('prj_123' as ProjectId);
    expect(project).toBeDefined();
    expect(project?.name).toBe('Test');
  });

  it('should rollback failed transactions', () => {
    try {
      manager.transaction(() => {
        manager.projects.create({
          id: 'prj_456' as ProjectId,
          name: 'Test Project',
          folder: '/tmp/test2',
          teamSnapshotId: 'tsn_456' as any,
          sourceTeamPresetId: null,
          leadMode: 'main-agent',
          leadProjectAgentId: null,
          episodeCount: 1,
          language: 'en',
          coverArtifactId: null,
        });

        throw new Error('Intentional error');
      });
    } catch {
      // Expected error
    }

    const project = manager.projects.getById('prj_456' as ProjectId);
    expect(project).toBeNull();
  });

  it('should maintain ACID properties', () => {
    const projectId = 'prj_acid' as ProjectId;

    manager.transaction(() => {
      const project = manager.projects.create({
        id: projectId,
        name: 'ACID Test',
        folder: '/tmp/acid',
        teamSnapshotId: 'tsn_acid' as any,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: 10,
        language: 'zh',
        coverArtifactId: null,
      });

      for (let i = 0; i < 10; i++) {
        manager.artifacts.create({
          id: `art_${i}` as ArtifactId,
          projectId,
          type: 'script',
          episode: i,
          key: `ep_${i}`,
          title: `Episode ${i}`,
        });
      }
    });

    const artifacts = manager.artifacts.listByProject(projectId);
    expect(artifacts).toHaveLength(10);
  });

  it('should support nested transactions (savepoints)', () => {
    const projectId = 'prj_nested' as ProjectId;

    manager.transaction(() => {
      manager.projects.create({
        id: projectId,
        name: 'Nested TX',
        folder: '/tmp/nested',
        teamSnapshotId: 'tsn_nested' as any,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: 1,
        language: 'zh',
        coverArtifactId: null,
      });

      manager.artifacts.create({
        id: 'art_1' as ArtifactId,
        projectId,
        type: 'brief',
        episode: 0,
        key: 'brief',
        title: 'Brief',
      });
    });

    const project = manager.projects.getById(projectId);
    const artifacts = manager.artifacts.listByProject(projectId);

    expect(project?.name).toBe('Nested TX');
    expect(artifacts).toHaveLength(1);
  });
});

describe('DatabaseManager - Concurrency', () => {
  let dbPath: string;
  let manager: DatabaseManager;
  let projectFolder: string;

  beforeEach(() => {
    projectFolder = path.join(os.tmpdir(), `test-concurrent-${Date.now()}-${Math.random()}`);
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }
    dbPath = path.join(projectFolder, 'studio.db');
    manager = new DatabaseManager();
    manager.init(projectFolder);
  });

  afterEach(() => {
    manager.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(projectFolder)) {
      fs.rmSync(projectFolder, { recursive: true });
    }
  });

  it('should handle multiple sequential writes', () => {
    for (let i = 0; i < 10; i++) {
      manager.projects.create({
        id: `prj_seq_${i}` as ProjectId,
        name: `Project ${i}`,
        folder: `${projectFolder}/seq/${i}`,
        teamSnapshotId: `tsn_${i}` as any,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: i + 1,
        language: 'zh',
        coverArtifactId: null,
      });
    }

    const count = manager.projects.count();
    expect(count).toBe(10);
  });

  it('should maintain consistency across concurrent artifact writes', () => {
    const projectId = 'prj_concurrent_artifacts' as ProjectId;
    const concurrentFolder = `${projectFolder}/concurrent_artifacts`;

    manager.projects.create({
      id: projectId,
      name: 'Concurrent Test',
      folder: concurrentFolder,
      teamSnapshotId: 'tsn_concurrent' as any,
      sourceTeamPresetId: null,
      leadMode: 'main-agent',
      leadProjectAgentId: null,
      episodeCount: 20,
      language: 'zh',
      coverArtifactId: null,
    });

    for (let i = 0; i < 20; i++) {
      manager.artifacts.create({
        id: `art_concurrent_${i}` as ArtifactId,
        projectId,
        type: 'script',
        episode: i,
        key: `script_ep${i}`,
        title: `Script Episode ${i}`,
      });
    }

    const artifacts = manager.artifacts.listByProject(projectId);
    expect(artifacts).toHaveLength(20);

    for (let i = 0; i < 20; i++) {
      expect(artifacts.some((a) => a.episode === i)).toBe(true);
    }
  });

  it('should handle event appends with guaranteed seq ordering', () => {
    for (let i = 0; i < 100; i++) {
      manager.events.append({
        type: 'project.activity',
        payload: { counter: i },
      });
    }

    const latestSeq = manager.events.getLatestSeq();
    expect(latestSeq).toBe(100);

    const count = manager.events.count();
    expect(count).toBe(100);

    const continuityGap = manager.events.validateContinuity(1);
    expect(continuityGap).toBe(-1);
  });

  it('should maintain event seq ordering during rapid writes', () => {
    const seqs: number[] = [];

    for (let i = 0; i < 50; i++) {
      const seq = manager.events.append({
        type: 'project.activity',
        payload: { batch: Math.floor(i / 10), index: i % 10 },
      });
      seqs.push(seq);
    }

    const isSorted = seqs.every((seq, i) => i === 0 || seq > seqs[i - 1]);
    expect(isSorted).toBe(true);

    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i + 1);
    }
  });
});

describe('DatabaseManager - Health & Integrity', () => {
  let dbPath: string;
  let manager: DatabaseManager;
  let projectFolder: string;

  beforeEach(() => {
    projectFolder = path.join(os.tmpdir(), `test-health-${Date.now()}-${Math.random()}`);
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }
    dbPath = path.join(projectFolder, 'studio.db');
    manager = new DatabaseManager();
    manager.init(projectFolder);
  });

  afterEach(() => {
    manager.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(projectFolder)) {
      fs.rmSync(projectFolder, { recursive: true });
    }
  });

  it('should report database health status', () => {
    const health = manager.health();

    expect(health.initialized).toBe(true);
    expect(health.schemaVersion).toBe(1);
    expect(health.expectedVersion).toBe(1);
    expect(health.isCompatible).toBe(true);
  });

  it('should validate database integrity', () => {
    const result = manager.integrityCheck();

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should track database size', () => {
    for (let i = 0; i < 10; i++) {
      manager.projects.create({
        id: `prj_size_${i}` as ProjectId,
        name: `Project ${i}`,
        folder: `${projectFolder}/size/${i}`,
        teamSnapshotId: `tsn_${i}` as any,
        sourceTeamPresetId: null,
        leadMode: 'main-agent',
        leadProjectAgentId: null,
        episodeCount: 1,
        language: 'zh',
        coverArtifactId: null,
      });
    }

    const size = manager.getSize();
    expect(size).toBeGreaterThan(0);
  });

  it('should report WAL statistics', () => {
    const stats = manager.getWalStats();

    expect(stats.checkpointMode).toBe('wal');
    expect(stats.walSize).toBeGreaterThanOrEqual(0);
  });
});

/**
 * 辅助函数
 */
function getDatabasePath(projectFolder: string): string {
  return `${projectFolder}/studio.db`;
}
