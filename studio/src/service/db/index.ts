/**
 * 数据库管理器与仓库工厂
 *
 * 统一管理数据库连接、架构迁移、事务处理
 */

import Database from 'better-sqlite3';
import { DatabaseSchema, getDatabasePath, SCHEMA_VERSION } from './schema';
import { ProjectRepository } from './repositories/projects';
import { ArtifactRepository } from './repositories/artifacts';
import { TaskRepository } from './repositories/tasks';
import { EventRepository } from './repositories/events';

export class DatabaseManager {
  private db: Database.Database | null = null;
  private schema: DatabaseSchema | null = null;

  /**
   * 仓库引用
   */
  public projects!: ProjectRepository;
  public artifacts!: ArtifactRepository;
  public tasks!: TaskRepository;
  public events!: EventRepository;

  /**
   * 初始化数据库连接
   */
  init(projectFolder: string): void {
    const path = getDatabasePath(projectFolder);

    this.db = new Database(path, {
      readonly: false,
      fileMustExist: false,
      timeout: 5000,
    });

    this.schema = new DatabaseSchema(this.db);
    this.schema.init();

    this.projects = new ProjectRepository(this.db);
    this.artifacts = new ArtifactRepository(this.db);
    this.tasks = new TaskRepository(this.db);
    this.events = new EventRepository(this.db);
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * 执行事务
   *
   * 若回调函数抛出异常，整个事务回滚
   */
  transaction<T>(callback: () => T): T {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(callback);
    return transaction();
  }

  /**
   * 执行 SQL 查询（原始方式）
   */
  query(sql: string, params?: any[]): any {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.prepare(sql).all(params);
  }

  /**
   * 执行 SQL 查询返回单条记录
   */
  queryOne(sql: string, params?: any[]): any {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.prepare(sql).get(params);
  }

  /**
   * 获取架构版本
   */
  getSchemaVersion(): number {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const row = this.db
        .prepare('SELECT version FROM __schema_version WHERE id = 1')
        .get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * 检查数据库状态
   */
  health(): {
    initialized: boolean;
    schemaVersion: number;
    expectedVersion: number;
    isCompatible: boolean;
  } {
    const initialized = this.db !== null;
    const schemaVersion = initialized ? this.getSchemaVersion() : 0;
    const isCompatible = schemaVersion === SCHEMA_VERSION;

    return {
      initialized,
      schemaVersion,
      expectedVersion: SCHEMA_VERSION,
      isCompatible,
    };
  }

  /**
   * 获取数据库文件大小（字节）
   */
  getSize(): number {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const pageCount = (this.db.prepare('PRAGMA page_count').get() as any).page_count;
      const pageSize = (this.db.prepare('PRAGMA page_size').get() as any).page_size;
      return pageCount * pageSize;
    } catch {
      return 0;
    }
  }

  /**
   * 获取 WAL 模式统计信息
   */
  getWalStats(): { checkpointMode: string; walSize: number } {
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.prepare('PRAGMA journal_mode').get() as any;
    return {
      checkpointMode: result.journal_mode,
      walSize: 0,
    };
  }

  /**
   * 执行数据库优化
   */
  optimize(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec('PRAGMA optimize');
    this.db.exec('PRAGMA incremental_vacuum');
  }

  /**
   * 导出数据（备份）
   */
  backup(targetPath: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`VACUUM INTO '${targetPath}'`);
  }

  /**
   * 执行完整性检查
   */
  integrityCheck(): { valid: boolean; errors: string[] } {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results = this.db.prepare('PRAGMA integrity_check').all() as Array<{
        integrity_check: string;
      }>;

      const errors = results
        .map((r) => r.integrity_check)
        .filter((msg) => msg !== 'ok');

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (err) {
      return {
        valid: false,
        errors: [(err as Error).message],
      };
    }
  }
}

/**
 * 全局数据库管理器单例
 */
let dbManager: DatabaseManager | null = null;

/**
 * 获取全局数据库管理器
 */
export function getDbManager(): DatabaseManager {
  if (!dbManager) {
    dbManager = new DatabaseManager();
  }
  return dbManager;
}

/**
 * 重置数据库管理器（用于测试）
 */
export function resetDbManager(): void {
  if (dbManager) {
    dbManager.close();
  }
  dbManager = null;
}

export { DatabaseSchema, SCHEMA_VERSION } from './schema';
export type { MigrationResult } from './schema';
export { ProjectRepository } from './repositories/projects';
export { ArtifactRepository } from './repositories/artifacts';
export { TaskRepository } from './repositories/tasks';
export { EventRepository } from './repositories/events';
