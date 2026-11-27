/**
 * 数据库架构与迁移测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseSchema, SCHEMA_VERSION } from '../../../../src/service/db/schema';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('DatabaseSchema', () => {
  let dbPath: string;
  let db: Database.Database;
  let schema: DatabaseSchema;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-schema-${Date.now()}.db`);
    db = new Database(dbPath);
    schema = new DatabaseSchema(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should initialize database schema', () => {
    schema.init();

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name != '__schema_version'"
      )
      .all() as Array<{ name: string }>;

    expect(tables.length).toBeGreaterThan(0);

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('artifacts');
    expect(tableNames).toContain('tasks');
    expect(tableNames).toContain('events');
  });

  it('should create version table and track schema version', () => {
    schema.init();

    const result = db
      .prepare('SELECT version FROM __schema_version WHERE id = 1')
      .get() as { version: number };

    expect(result.version).toBe(SCHEMA_VERSION);
  });

  it('should enforce foreign key constraints', () => {
    schema.init();

    const pragmaResult = db
      .prepare('PRAGMA foreign_keys')
      .get() as { foreign_keys: number };

    expect(pragmaResult.foreign_keys).toBe(1);
  });

  it('should use WAL mode for durability', () => {
    schema.init();

    const result = db
      .prepare('PRAGMA journal_mode')
      .get() as { journal_mode: string };

    expect(result.journal_mode).toBe('wal');
  });

  it('should create all required indexes', () => {
    schema.init();

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_projects_deleted');
    expect(indexNames).toContain('idx_artifacts_project');
    expect(indexNames).toContain('idx_tasks_project');
    expect(indexNames).toContain('idx_events_project');
  });

  it('should create all core tables with correct schema', () => {
    schema.init();

    const projectsInfo = db.prepare('PRAGMA table_info(projects)').all() as any[];
    const columnNames = projectsInfo.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('folder');
    expect(columnNames).toContain('team_snapshot_id');
    expect(columnNames).toContain('deleted_at');
  });

  it('should handle multiple init calls idempotently', () => {
    schema.init();
    const count1 = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'")
      .get() as { count: number };

    schema.init();
    const count2 = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'")
      .get() as { count: number };

    expect(count1.count).toBe(count2.count);
  });

  it('should create tables with correct constraints', () => {
    schema.init();

    const artifactsInfo = db.prepare('PRAGMA table_info(artifacts)').all() as any[];
    const episodeCol = artifactsInfo.find((c) => c.name === 'episode');

    expect(episodeCol).toBeDefined();
  });
});

describe('DatabaseSchema - Migration', () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-migration-${Date.now()}.db`);
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should track schema version progression', () => {
    const schema = new DatabaseSchema(db);
    schema.init();

    const version = db
      .prepare('SELECT version FROM __schema_version WHERE id = 1')
      .get() as { version: number };

    expect(version.version).toBe(1);
  });

  it('should preserve data across schema init calls', () => {
    let schema = new DatabaseSchema(db);
    schema.init();

    const insertStmt = db.prepare(`
      INSERT INTO projects (
        id, name, folder, team_snapshot_id, lead_mode, episode_count, language,
        created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      'prj_test1',
      'Test Project',
      '/tmp/test',
      'tsn_123',
      'main-agent',
      1,
      'zh',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString()
    );

    const beforeCount = db
      .prepare('SELECT COUNT(*) as count FROM projects')
      .get() as { count: number };
    expect(beforeCount.count).toBe(1);

    schema = new DatabaseSchema(db);
    schema.init();

    const afterCount = db
      .prepare('SELECT COUNT(*) as count FROM projects')
      .get() as { count: number };
    expect(afterCount.count).toBe(1);
  });
});
