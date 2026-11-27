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
  ConversationId,
  MessageId,
  Json,
} from '../../shared/types';

export class EventRepository {
  constructor(private db: Database.Database) {}

  /**
   * 创建事件
   */
  create(data: {
    type: string;
    projectId: ProjectId;
    timestamp: string;
    data: Record<string, any>;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO events (type, project_id, payload, created_at)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(data.type, data.projectId, JSON.stringify(data.data), data.timestamp);
  }

  /**
   * 列出项目事件（带过滤）
   */
  listByProject(
    projectId: ProjectId,
    options?: { limit?: number; offset?: number; type?: string }
  ): any[] {
    let query = 'SELECT * FROM events WHERE project_id = ?';
    const params: any[] = [projectId];

    if (options?.type) {
      query += ' AND type = ?';
      params.push(options.type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(options?.limit || 100);
    params.push(options?.offset || 0);

    return this.db.prepare(query).all(...params) as any[];
  }

  /**
   * 创建对话
   */
  createConversation(data: {
    id: ConversationId;
    projectId: ProjectId;
    title: string;
    description: string | null;
    scope: string;
    episodeNumber: number | null;
    metadata: Record<string, any>;
  }): any {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO conversations (
          id, project_id, title, description, scope,
          episode_number, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        data.id,
        data.projectId,
        data.title,
        data.description,
        data.scope,
        data.episodeNumber,
        JSON.stringify(data.metadata),
        now,
        now
      );

    return {
      id: data.id,
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      scope: data.scope,
      episodeNumber: data.episodeNumber,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 获取对话
   */
  getConversation(id: ConversationId): any {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      scope: row.scope,
      episodeNumber: row.episode_number,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 获取对话消息
   */
  getConversationMessages(conversationId: ConversationId): any[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `
      )
      .all(conversationId) as any[];

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      content: row.content,
      role: row.role,
      author: row.author,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
    }));
  }

  /**
   * 删除对话
   */
  deleteConversation(id: ConversationId): void {
    this.db
      .prepare('DELETE FROM conversations WHERE id = ?')
      .run(id);
  }

  /**
   * 获取工作流图
   */
  getWorkflowGraph(projectId: ProjectId): any {
    const row = this.db
      .prepare(
        `
        SELECT payload FROM events
        WHERE project_id = ? AND type = 'workflow:graph-updated'
        ORDER BY created_at DESC LIMIT 1
      `
      )
      .get(projectId) as any;

    if (!row) return null;

    const data = JSON.parse(row.payload);
    return data.graph || null;
  }
}
