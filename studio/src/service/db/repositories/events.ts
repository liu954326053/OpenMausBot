/**
 * 事件日志数据访问层（追加式 JSON Lines）
 *
 * 事件日志是不可变的追加式记录，用于：
 * - 完整的审计追踪
 * - 事件重放和恢复
 * - 快照同步
 *
 * seq 保证全局单调递增，支持检测网络丢失或冲突。
 */

import type Database from 'better-sqlite3';
import type {
  StudioEvent,
  StudioEventType,
  ProjectId,
  Json,
} from '../../shared/types';

export class EventRepository {
  constructor(private db: Database.Database) {}

  /**
   * 追加事件到日志
   *
   * 返回分配的 seq 号
   */
  append(data: {
    type: StudioEventType;
    projectId?: ProjectId;
    payload: Json;
    at?: string;
  }): number {
    const at = data.at ?? new Date().toISOString();

    const result = this.db
      .prepare(
        `
        INSERT INTO events (at, type, project_id, payload)
        VALUES (?, ?, ?, ?)
        RETURNING seq
      `
      )
      .get(at, data.type, data.projectId ?? null, JSON.stringify(data.payload)) as {
      seq: number;
    };

    return result.seq;
  }

  /**
   * 按 seq 号查询单个事件
   */
  getBySeq(seq: number): StudioEvent | null {
    const row = this.db
      .prepare('SELECT seq, at, type, project_id, payload FROM events WHERE seq = ?')
      .get(seq) as any;

    return row ? this.rowToEvent(row) : null;
  }

  /**
   * 查询给定范围内的所有事件
   *
   * 支持检测事件丢失（通过检查 seq 的连续性）
   */
  getRange(fromSeq: number, toSeq: number): StudioEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT seq, at, type, project_id, payload FROM events
        WHERE seq >= ? AND seq <= ?
        ORDER BY seq ASC
      `
      )
      .all(fromSeq, toSeq) as any[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * 查询特定项目的事件
   */
  getByProject(projectId: ProjectId, limit = 1000, offset = 0): StudioEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT seq, at, type, project_id, payload FROM events
        WHERE project_id = ?
        ORDER BY seq DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(projectId, limit, offset) as any[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * 查询特定类型的事件
   */
  getByType(type: StudioEventType, limit = 1000, offset = 0): StudioEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT seq, at, type, project_id, payload FROM events
        WHERE type = ?
        ORDER BY seq DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(type, limit, offset) as any[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * 查询特定项目和类型的事件
   */
  getByProjectAndType(
    projectId: ProjectId,
    type: StudioEventType,
    limit = 1000,
    offset = 0
  ): StudioEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT seq, at, type, project_id, payload FROM events
        WHERE project_id = ? AND type = ?
        ORDER BY seq DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(projectId, type, limit, offset) as any[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * 查询给定时间戳之后的所有事件
   */
  getAfter(after: string, limit = 1000): StudioEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT seq, at, type, project_id, payload FROM events
        WHERE at > ?
        ORDER BY seq ASC
        LIMIT ?
      `
      )
      .all(after, limit) as any[];

    return rows.map((row) => this.rowToEvent(row));
  }

  /**
   * 获取最新的 seq 号
   */
  getLatestSeq(): number {
    const result = this.db
      .prepare('SELECT MAX(seq) as seq FROM events')
      .get() as { seq: number | null };

    return result.seq ?? 0;
  }

  /**
   * 获取事件总数
   */
  count(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM events')
      .get() as { count: number };

    return result.count;
  }

  /**
   * 获取特定项目的事件总数
   */
  countByProject(projectId: ProjectId): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM events WHERE project_id = ?')
      .get(projectId) as { count: number };

    return result.count;
  }

  /**
   * 验证事件日志的连续性
   *
   * 返回第一个间隙的位置（如果没有间隙则返回 -1）
   */
  validateContinuity(fromSeq = 1): number {
    const rows = this.db
      .prepare(
        `
        SELECT seq FROM events WHERE seq >= ? ORDER BY seq ASC
      `
      )
      .all(fromSeq) as Array<{ seq: number }>;

    if (rows.length === 0) return -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].seq !== fromSeq + i) {
        return fromSeq + i;
      }
    }

    return -1;
  }

  /**
   * 流式读取事件（适合大数据集）
   *
   * 使用迭代器模式避免将所有事件加载到内存
   */
  *streamEvents(
    fromSeq = 1,
    batchSize = 1000
  ): Generator<StudioEvent, void, undefined> {
    let currentSeq = fromSeq;

    while (true) {
      const batch = this.getRange(currentSeq, currentSeq + batchSize - 1);

      if (batch.length === 0) break;

      for (const event of batch) {
        yield event;
      }

      if (batch.length < batchSize) break;

      currentSeq = batch[batch.length - 1].seq + 1;
    }
  }

  /**
   * 获取事件统计信息
   */
  getStats(): {
    totalEvents: number;
    latestSeq: number;
    eventsByType: Record<StudioEventType, number>;
    eventsByProject: Record<string, number>;
  } {
    const total = this.count();
    const latest = this.getLatestSeq();

    const byTypeRows = this.db
      .prepare('SELECT type, COUNT(*) as count FROM events GROUP BY type')
      .all() as Array<{ type: StudioEventType; count: number }>;

    const byType: Record<StudioEventType, number> = {} as any;
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }

    const byProjectRows = this.db
      .prepare(
        `
        SELECT project_id, COUNT(*) as count FROM events
        WHERE project_id IS NOT NULL
        GROUP BY project_id
      `
      )
      .all() as Array<{ project_id: string; count: number }>;

    const byProject: Record<string, number> = {};
    for (const row of byProjectRows) {
      byProject[row.project_id] = row.count;
    }

    return {
      totalEvents: total,
      latestSeq: latest,
      eventsByType: byType,
      eventsByProject: byProject,
    };
  }

  /**
   * 转换行数据为事件对象
   */
  private rowToEvent(row: any): StudioEvent {
    return {
      seq: row.seq,
      at: row.at,
      type: row.type,
      projectId: row.project_id,
      payload: JSON.parse(row.payload),
    };
  }
}
