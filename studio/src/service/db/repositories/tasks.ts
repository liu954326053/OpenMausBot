/**
 * 任务数据访问层
 */

import type Database from 'better-sqlite3';
import type {
  Task,
  TaskStatus,
  TaskErrorKind,
  TaskId,
  ProjectId,
  GraphVersionId,
  NodeId,
  ProjectAgentId,
  AgentSnapshotId,
  Scope,
  ArtifactId,
  ArtifactVersionId,
  Iso,
} from '../../../shared/types';

export class TaskRepository {
  constructor(private db: Database.Database) {}

  /**
   * 创建任务
   */
  create(data: {
    id: TaskId;
    projectId: ProjectId;
    graphVersionId: GraphVersionId;
    nodeId: NodeId;
    projectAgentId: ProjectAgentId;
    scope: Scope;
    episode: number;
    agentSnapshotId?: AgentSnapshotId | null;
    inputPins?: Array<{
      artifactId: ArtifactId;
      versionId: ArtifactVersionId;
      sha256: string;
    }>;
  }): Task {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO tasks (
          id, project_id, graph_version_id, node_id, project_agent_id,
          agent_snapshot_id, scope, episode, status, attempt, gate, queued_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        data.id,
        data.projectId,
        data.graphVersionId,
        data.nodeId,
        data.projectAgentId,
        data.agentSnapshotId ?? null,
        data.scope,
        data.episode,
        'waiting',
        1,
        'none',
        now,
        now
      );

    if (data.inputPins && data.inputPins.length > 0) {
      const stmt = this.db.prepare(`
        INSERT INTO task_input_pins (task_id, seq, artifact_id, version_id, sha256)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < data.inputPins.length; i++) {
        const pin = data.inputPins[i];
        stmt.run(data.id, i, pin.artifactId, pin.versionId, pin.sha256);
      }
    }

    return this.getById(data.id)!;
  }

  /**
   * 按 ID 查询任务
   */
  getById(id: TaskId): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    const inputPins = this.db
      .prepare(
        `
        SELECT artifact_id, version_id, sha256
        FROM task_input_pins
        WHERE task_id = ?
        ORDER BY seq ASC
      `
      )
      .all(id) as any[];

    const outputVersions = this.db
      .prepare(
        `
        SELECT version_id
        FROM task_output_versions
        WHERE task_id = ?
        ORDER BY seq ASC
      `
      )
      .all(id) as any[];

    return this.rowToTask(row, inputPins, outputVersions);
  }

  /**
   * 按图版本和节点查询任务
   */
  getByGraphNodeAndEpisode(
    graphVersionId: GraphVersionId,
    nodeId: NodeId,
    episode: number
  ): Task | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM tasks
        WHERE graph_version_id = ? AND node_id = ? AND episode = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(graphVersionId, nodeId, episode) as any;

    if (!row) return null;

    const inputPins = this.db
      .prepare(
        `
        SELECT artifact_id, version_id, sha256
        FROM task_input_pins
        WHERE task_id = ?
        ORDER BY seq ASC
      `
      )
      .all(row.id) as any[];

    const outputVersions = this.db
      .prepare(
        `
        SELECT version_id
        FROM task_output_versions
        WHERE task_id = ?
        ORDER BY seq ASC
      `
      )
      .all(row.id) as any[];

    return this.rowToTask(row, inputPins, outputVersions);
  }

  /**
   * 按项目查询任务（按状态筛选）
   */
  listByProject(projectId: ProjectId, status?: TaskStatus): Task[] {
    let query = 'SELECT * FROM tasks WHERE project_id = ?';
    const params: any[] = [projectId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((row) => {
      const inputPins = this.db
        .prepare(
          `
          SELECT artifact_id, version_id, sha256
          FROM task_input_pins
          WHERE task_id = ?
          ORDER BY seq ASC
        `
        )
        .all(row.id) as any[];

      const outputVersions = this.db
        .prepare(
          `
          SELECT version_id
          FROM task_output_versions
          WHERE task_id = ?
          ORDER BY seq ASC
        `
        )
        .all(row.id) as any[];

      return this.rowToTask(row, inputPins, outputVersions);
    });
  }

  /**
   * 按图版本查询任务
   */
  listByGraphVersion(graphVersionId: GraphVersionId): Task[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM tasks WHERE graph_version_id = ?
        ORDER BY created_at DESC
      `
      )
      .all(graphVersionId) as any[];

    return rows.map((row) => {
      const inputPins = this.db
        .prepare(
          `
          SELECT artifact_id, version_id, sha256
          FROM task_input_pins
          WHERE task_id = ?
          ORDER BY seq ASC
        `
        )
        .all(row.id) as any[];

      const outputVersions = this.db
        .prepare(
          `
          SELECT version_id
          FROM task_output_versions
          WHERE task_id = ?
          ORDER BY seq ASC
        `
        )
        .all(row.id) as any[];

      return this.rowToTask(row, inputPins, outputVersions);
    });
  }

  /**
   * 更新任务状态
   */
  updateStatus(id: TaskId, status: TaskStatus, now?: Iso): Task {
    const timestamp = now ?? new Date().toISOString();

    const updates: string[] = ['status = ?'];
    const values: any[] = [status];

    if (status === 'running' && !this.getById(id)?.startedAt) {
      updates.push('started_at = ?');
      values.push(timestamp);
    }

    if (['done', 'failed', 'cancelled'].includes(status)) {
      updates.push('ended_at = ?');
      values.push(timestamp);
    }

    values.push(id);

    this.db
      .prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id)!;
  }

  /**
   * 设置任务错误
   */
  setError(id: TaskId, kind: TaskErrorKind, message: string, detail?: Record<string, any>): Task {
    this.db
      .prepare(
        `
        UPDATE tasks
        SET error_kind = ?, error_message = ?, error_detail = ?, status = ?
        WHERE id = ?
      `
      )
      .run(kind, message, detail ? JSON.stringify(detail) : null, 'failed', id);

    return this.getById(id)!;
  }

  /**
   * 清除任务错误
   */
  clearError(id: TaskId): void {
    this.db
      .prepare(
        `
        UPDATE tasks
        SET error_kind = NULL, error_message = NULL, error_detail = NULL
        WHERE id = ?
      `
      )
      .run(id);
  }

  /**
   * 更新任务闸门状态
   */
  updateGate(id: TaskId, gate: 'none' | 'pending' | 'confirmed'): Task {
    this.db
      .prepare('UPDATE tasks SET gate = ? WHERE id = ?')
      .run(gate, id);

    return this.getById(id)!;
  }

  /**
   * 添加输出版本
   */
  addOutputVersion(taskId: TaskId, versionId: ArtifactVersionId): void {
    const outputs = this.db
      .prepare('SELECT COUNT(*) as count FROM task_output_versions WHERE task_id = ?')
      .get(taskId) as { count: number };

    this.db
      .prepare(
        `
        INSERT INTO task_output_versions (task_id, seq, version_id)
        VALUES (?, ?, ?)
      `
      )
      .run(taskId, outputs.count, versionId);
  }

  /**
   * 创建任务执行记录
   */
  createAttempt(data: {
    taskId: TaskId;
    attempt: number;
    logPath: string;
    stdout?: string;
    stderr?: string;
    startedAt?: Iso;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO task_attempts (task_id, attempt, status, log_path, stdout, stderr, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        data.taskId,
        data.attempt,
        'running',
        data.logPath,
        data.stdout ?? '',
        data.stderr ?? '',
        data.startedAt ?? new Date().toISOString()
      );
  }

  /**
   * 更新任务执行记录
   */
  updateAttempt(data: {
    taskId: TaskId;
    attempt: number;
    status: TaskStatus;
    stdout?: string;
    stderr?: string;
    endedAt?: Iso;
  }): void {
    const updates: string[] = ['status = ?'];
    const values: any[] = [data.status];

    if (data.stdout !== undefined) {
      updates.push('stdout = ?');
      values.push(data.stdout);
    }

    if (data.stderr !== undefined) {
      updates.push('stderr = ?');
      values.push(data.stderr);
    }

    if (data.endedAt !== undefined) {
      updates.push('ended_at = ?');
      values.push(data.endedAt);
    }

    values.push(data.taskId);
    values.push(data.attempt);

    this.db
      .prepare(
        `
        UPDATE task_attempts
        SET ${updates.join(', ')}
        WHERE task_id = ? AND attempt = ?
      `
      )
      .run(...values);
  }

  /**
   * 列出任务（带过滤）
   */
  list(options: {
    projectId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): any[] {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];

    if (options.projectId) {
      query += ' AND project_id = ?';
      params.push(options.projectId);
    }

    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(options.limit || 50);
    params.push(options.offset || 0);

    return this.db.prepare(query).all(...params) as any[];
  }

  /**
   * 更新任务状态（API 版本）
   */
  updateStatus(
    id: TaskId,
    data: { status: string; message?: string | null; metadata?: Record<string, any> }
  ): any {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(data.status, now, id);

    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    return row
      ? {
          id: row.id,
          projectId: row.project_id,
          name: row.name,
          status: row.status,
          updatedAt: now,
        }
      : null;
  }

  /**
   * 转换行数据为任务对象
   */
  private rowToTask(
    row: any,
    inputPins: any[],
    outputVersions: any[]
  ): Task {
    const error =
      row.error_kind && row.error_message
        ? {
            kind: row.error_kind,
            message: row.error_message,
            detail: row.error_detail ? JSON.parse(row.error_detail) : undefined,
          }
        : undefined;

    return {
      id: row.id,
      projectId: row.project_id,
      graphVersionId: row.graph_version_id,
      nodeId: row.node_id,
      projectAgentId: row.project_agent_id,
      agentSnapshotId: row.agent_snapshot_id,
      scope: row.scope,
      episode: row.episode,
      status: row.status,
      attempt: row.attempt,
      gate: row.gate,
      inputPins: inputPins.map((pin) => ({
        artifactId: pin.artifact_id,
        versionId: pin.version_id,
        sha256: pin.sha256,
      })),
      outputVersionIds: outputVersions.map((v) => v.version_id),
      error,
    };
  }
}
