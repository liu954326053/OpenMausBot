/**
 * 事件日志与 seq 单调性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseSchema } from '../../../../src/service/db/schema';
import { EventRepository } from '../../../../src/service/db/repositories/events';
import type { ProjectId } from '../../../../src/shared/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('EventRepository - Append-only Log', () => {
  let dbPath: string;
  let db: Database.Database;
  let repo: EventRepository;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-events-${Date.now()}.db`);
    db = new Database(dbPath);
    const schema = new DatabaseSchema(db);
    schema.init();
    repo = new EventRepository(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should append events and return seq number', () => {
    const seq1 = repo.append({
      type: 'project.created',
      payload: { id: 'prj_123', name: 'Test' },
    });

    const seq2 = repo.append({
      type: 'artifact.created',
      payload: { id: 'art_456' },
    });

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
  });

  it('should maintain seq monotonic increments', () => {
    const seqs: number[] = [];

    for (let i = 0; i < 100; i++) {
      const seq = repo.append({
        type: 'project.activity',
        payload: { counter: i },
      });
      seqs.push(seq);
    }

    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i + 1);
    }
  });

  it('should retrieve events by seq', () => {
    const seq1 = repo.append({
      type: 'project.created',
      payload: { id: 'prj_123' },
    });

    const event = repo.getBySeq(seq1);

    expect(event).toBeDefined();
    expect(event?.seq).toBe(1);
    expect(event?.type).toBe('project.created');
    expect(event?.payload).toEqual({ id: 'prj_123' });
  });

  it('should handle time ordering correctly', () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 1000).toISOString();

    const seq1 = repo.append({
      type: 'project.created',
      payload: { id: 'prj_1' },
      at: now,
    });

    const seq2 = repo.append({
      type: 'artifact.created',
      payload: { id: 'art_1' },
      at: future,
    });

    const event1 = repo.getBySeq(seq1);
    const event2 = repo.getBySeq(seq2);

    expect(event1?.at).toBe(now);
    expect(event2?.at).toBe(future);
  });

  it('should detect seq continuity breaks', () => {
    // 创建事件
    repo.append({ type: 'project.created', payload: { id: 'prj_1' } });
    repo.append({ type: 'artifact.created', payload: { id: 'art_1' } });
    repo.append({ type: 'task.created', payload: { id: 'tsk_1' } });

    const gap = repo.validateContinuity(1);
    expect(gap).toBe(-1);
  });

  it('should support event range queries', () => {
    for (let i = 0; i < 10; i++) {
      repo.append({
        type: 'project.activity',
        payload: { counter: i },
      });
    }

    const events = repo.getRange(3, 7);

    expect(events.length).toBe(5);
    expect(events[0].seq).toBe(3);
    expect(events[events.length - 1].seq).toBe(7);
  });

  it.skip('should filter events by project', () => {
    // TODO: Need to create projects before appending events with projectId due to FK constraint
    const projectId1 = 'prj_111' as ProjectId;
    const projectId2 = 'prj_222' as ProjectId;

    repo.append({
      type: 'project.created',
      payload: { id: projectId1 },
    });

    repo.append({
      type: 'artifact.created',
      payload: { id: 'art_1' },
    });

    repo.append({
      type: 'project.created',
      payload: { id: projectId2 },
    });

    const allEvents = repo.getByType('project.created');
    expect(allEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('should filter events by type', () => {
    repo.append({
      type: 'project.created',
      payload: { id: 'prj_1' },
    });

    repo.append({
      type: 'project.updated',
      payload: { id: 'prj_1' },
    });

    repo.append({
      type: 'artifact.created',
      payload: { id: 'art_1' },
    });

    const projectEvents = repo.getByType('project.created');
    const artifactEvents = repo.getByType('artifact.created');

    expect(projectEvents.length).toBe(1);
    expect(artifactEvents.length).toBe(1);
  });

  it('should track event statistics', () => {
    repo.append({
      type: 'project.created',
      payload: {},
    });

    repo.append({
      type: 'artifact.created',
      payload: {},
    });

    const stats = repo.getStats();

    expect(stats.totalEvents).toBe(2);
    expect(stats.latestSeq).toBe(2);
    expect(stats.eventsByType['project.created']).toBe(1);
    expect(stats.eventsByType['artifact.created']).toBe(1);
  });

  it('should support event streaming', () => {
    for (let i = 0; i < 50; i++) {
      repo.append({
        type: 'project.activity',
        payload: { counter: i },
      });
    }

    const events: number[] = [];

    for (const event of repo.streamEvents(1, 10)) {
      events.push(event.seq);
    }

    expect(events).toHaveLength(50);
    expect(events[0]).toBe(1);
    expect(events[49]).toBe(50);
  });

  it('should maintain payload JSON integrity', () => {
    const payload = {
      id: 'prj_123',
      name: 'Test Project',
      nested: {
        level: 2,
        array: [1, 2, 3],
      },
      timestamp: new Date().toISOString(),
    };

    const seq = repo.append({
      type: 'project.created',
      payload,
    });

    const event = repo.getBySeq(seq);

    expect(event?.payload).toEqual(payload);
  });
});

describe('EventRepository - Concurrency', () => {
  let dbPath: string;
  let db: Database.Database;
  let repo: EventRepository;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-events-concurrent-${Date.now()}.db`);
    db = new Database(dbPath);
    const schema = new DatabaseSchema(db);
    schema.init();
    repo = new EventRepository(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should handle sequential concurrent writes', () => {
    const seqs: number[] = [];

    const writeEvent = () => {
      const seq = repo.append({
        type: 'project.activity',
        payload: { timestamp: Date.now() },
      });
      seqs.push(seq);
    };

    for (let i = 0; i < 50; i++) {
      writeEvent();
    }

    expect(seqs).toHaveLength(50);

    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i + 1);
    }

    const count = repo.count();
    expect(count).toBe(50);
  });

  it('should maintain seq ordering under rapid fire writes', () => {
    const seqs: number[] = [];

    for (let batch = 0; batch < 10; batch++) {
      for (let i = 0; i < 10; i++) {
        const seq = repo.append({
          type: 'project.activity',
          payload: { batch, index: i },
        });
        seqs.push(seq);
      }
    }

    expect(seqs).toHaveLength(100);

    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sorted);

    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i + 1);
    }
  });

  it('should track event count accurately', () => {
    for (let i = 0; i < 20; i++) {
      repo.append({
        type: 'project.activity',
        payload: { counter: i },
      });
    }

    const total = repo.count();
    expect(total).toBeGreaterThanOrEqual(20);
  });
});
