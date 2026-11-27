/**
 * 项目数据访问层
 */

import type Database from 'better-sqlite3';
import type {
  Project,
  ProjectId,
  TeamSnapshotId,
  TeamPresetId,
  ProjectAgentId,
  Iso,
  ArtifactId,
} from '../../shared/types';

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  /**
   * 创建项目
   */
  create(data: {
    id: ProjectId;
    name: string;
    folder: string;
    teamSnapshotId: TeamSnapshotId;
    sourceTeamPresetId: TeamPresetId | null;
    leadMode: 'project-agent' | 'main-agent';
    leadProjectAgentId: ProjectAgentId | null;
    episodeCount: number;
    language: 'zh' | 'en';
    coverArtifactId: ArtifactId | null;
    maxConcurrentTasks?: number;
    networkPerAgent?: boolean;
  }): Project {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO projects (
          id, name, folder, team_snapshot_id, source_team_preset_id,
          lead_mode, lead_project_agent_id, episode_count, language,
          cover_artifact_id, max_concurrent_tasks, network_per_agent,
          created_at, updated_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        data.id,
        data.name,
        data.folder,
        data.teamSnapshotId,
        data.sourceTeamPresetId,
        data.leadMode,
        data.leadProjectAgentId,
        data.episodeCount,
        data.language,
        data.coverArtifactId,
        data.maxConcurrentTasks ?? 4,
        data.networkPerAgent ? 1 : 0,
        now,
        now,
        now
      );

    return this.getById(data.id)!;
  }

  /**
   * 按 ID 查询项目
   */
  getById(id: ProjectId): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(id) as any;

    return row ? this.rowToProject(row) : null;
  }

  /**
   * 按文件夹查询项目
   */
  getByFolder(folder: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE folder = ? AND deleted_at IS NULL')
      .get(folder) as any;

    return row ? this.rowToProject(row) : null;
  }

  /**
   * 列出所有活跃项目
   */
  listActive(limit = 100, offset = 0): Project[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM projects
        WHERE deleted_at IS NULL
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(limit, offset) as any[];

    return rows.map((row) => this.rowToProject(row));
  }

  /**
   * 更新项目
   */
  update(
    id: ProjectId,
    data: Partial<{
      name: string;
      coverArtifactId: ArtifactId | null;
      maxConcurrentTasks: number;
      networkPerAgent: boolean;
    }>
  ): Project {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.coverArtifactId !== undefined) {
      fields.push('cover_artifact_id = ?');
      values.push(data.coverArtifactId);
    }
    if (data.maxConcurrentTasks !== undefined) {
      fields.push('max_concurrent_tasks = ?');
      values.push(data.maxConcurrentTasks);
    }
    if (data.networkPerAgent !== undefined) {
      fields.push('network_per_agent = ?');
      values.push(data.networkPerAgent ? 1 : 0);
    }

    if (fields.length === 0) return this.getById(id)!;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);

    this.db
      .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id)!;
  }

  /**
   * 更新项目活动时间戳
   */
  touch(id: ProjectId): void {
    this.db
      .prepare(
        'UPDATE projects SET last_activity_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(new Date().toISOString(), id);
  }

  /**
   * 删除项目（逻辑删除）
   */
  delete(id: ProjectId): void {
    this.db
      .prepare('UPDATE projects SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /**
   * 检查项目是否存在
   */
  exists(id: ProjectId): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(id);
    return row !== undefined;
  }

  /**
   * 获取项目总数
   */
  count(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM projects WHERE deleted_at IS NULL')
      .get() as { count: number };
    return result.count;
  }

  /**
   * 列出项目（带分页）
   */
  list(options: {
    limit?: number;
    offset?: number;
    includeDeleted?: boolean;
  } = {}): Project[] {
    const { limit = 50, offset = 0, includeDeleted = false } = options;

    const whereClause = includeDeleted ? '' : 'WHERE deleted_at IS NULL';

    const rows = this.db
      .prepare(
        `
        SELECT * FROM projects
        ${whereClause}
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(limit, offset) as any[];

    return rows.map((row) => this.rowToProject(row));
  }

  /**
   * 转换行数据为项目对象
   */
  private rowToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      folder: row.folder,
      teamSnapshotId: row.team_snapshot_id,
      sourceTeamPresetId: row.source_team_preset_id,
      lead: {
        mode: row.lead_mode,
        projectAgentId: row.lead_project_agent_id,
      },
      episodeCount: row.episode_count,
      language: row.language,
      coverArtifactId: row.cover_artifact_id,
      settings: {
        maxConcurrentTasks: row.max_concurrent_tasks,
        networkPerAgent: row.network_per_agent === 1,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
      deletedAt: row.deleted_at,
    };
  }
}
