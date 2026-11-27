/**
 * 产物与版本数据访问层
 */

import type Database from 'better-sqlite3';
import type {
  Artifact,
  ArtifactVersion,
  ArtifactId,
  ArtifactVersionId,
  ProjectId,
  ArtifactType,
  Scope,
  NodeId,
  ProjectAgentId,
  GraphVersionId,
  TaskId,
  AgentSnapshotId,
  Iso,
} from '../../shared/types';

export class ArtifactRepository {
  constructor(private db: Database.Database) {}

  /**
   * 创建产物
   */
  create(data: {
    id: ArtifactId;
    projectId: ProjectId;
    type: ArtifactType;
    episode: number;
    key: string;
    title: string;
    producerNodeId?: NodeId | null;
    producerProjectAgentId?: ProjectAgentId | null;
  }): Artifact {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO artifacts (
          id, project_id, type, episode, key, title,
          status, producer_node_id, producer_project_agent_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        data.id,
        data.projectId,
        data.type,
        data.episode,
        data.key,
        data.title,
        'draft',
        data.producerNodeId ?? null,
        data.producerProjectAgentId ?? null,
        now,
        now
      );

    return this.getById(data.id)!;
  }

  /**
   * 按 ID 查询产物
   */
  getById(id: ArtifactId): Artifact | null {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ? AND deleted_at IS NULL')
      .get(id) as any;

    return row ? this.rowToArtifact(row) : null;
  }

  /**
   * 按项目和类型查询产物列表
   */
  listByProjectAndType(projectId: ProjectId, type: ArtifactType, episode?: number): Artifact[] {
    let query = `
      SELECT * FROM artifacts
      WHERE project_id = ? AND type = ? AND deleted_at IS NULL
    `;
    const params: any[] = [projectId, type];

    if (episode !== undefined) {
      query += ' AND episode = ?';
      params.push(episode);
    }

    query += ' ORDER BY episode ASC, key ASC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((row) => this.rowToArtifact(row));
  }

  /**
   * 按项目查询所有产物
   */
  listByProject(projectId: ProjectId, includeDeleted = false): Artifact[] {
    let query = 'SELECT * FROM artifacts WHERE project_id = ?';
    if (!includeDeleted) query += ' AND deleted_at IS NULL';
    query += ' ORDER BY type ASC, episode ASC, key ASC';

    const rows = this.db.prepare(query).all(projectId) as any[];
    return rows.map((row) => this.rowToArtifact(row));
  }

  /**
   * 更新产物状态和标题
   */
  update(
    id: ArtifactId,
    data: Partial<{
      title: string;
      status: 'draft' | 'ready' | 'stale';
      currentVersionId: ArtifactVersionId;
      producerNodeId: NodeId | null;
      producerProjectAgentId: ProjectAgentId | null;
    }>
  ): Artifact {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.title !== undefined) {
      fields.push('title = ?');
      values.push(data.title);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }
    if (data.currentVersionId !== undefined) {
      const version = this.getVersionById(data.currentVersionId);
      if (version) {
        fields.push('current_version_id = ?');
        values.push(data.currentVersionId);
        fields.push('current_version = ?');
        values.push(version.version);
      }
    }
    if (data.producerNodeId !== undefined) {
      fields.push('producer_node_id = ?');
      values.push(data.producerNodeId);
    }
    if (data.producerProjectAgentId !== undefined) {
      fields.push('producer_project_agent_id = ?');
      values.push(data.producerProjectAgentId);
    }

    if (fields.length === 0) return this.getById(id)!;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);

    this.db
      .prepare(`UPDATE artifacts SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id)!;
  }

  /**
   * 删除产物（逻辑删除）
   */
  delete(id: ArtifactId): void {
    this.db
      .prepare('UPDATE artifacts SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /**
   * 恢复已删除的产物
   */
  restore(id: ArtifactId): void {
    this.db
      .prepare('UPDATE artifacts SET deleted_at = NULL WHERE id = ?')
      .run(id);
  }

  /**
   * 创建产物版本
   */
  createVersion(data: {
    id: ArtifactVersionId;
    artifactId: ArtifactId;
    version: number;
    path: string;
    bytes: number;
    sha256: string;
    taskId?: TaskId | null;
    graphVersionId: GraphVersionId;
    agentSnapshotId?: AgentSnapshotId | null;
    inputPins?: Array<{
      artifactId: ArtifactId;
      versionId: ArtifactVersionId;
      sha256: string;
    }>;
    note?: string | null;
    selected?: boolean;
  }): ArtifactVersion {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO artifact_versions (
          id, artifact_id, version, schema_version, path, bytes, sha256,
          task_id, graph_version_id, agent_snapshot_id,
          note, selected, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        data.id,
        data.artifactId,
        data.version,
        1,
        data.path,
        data.bytes,
        data.sha256,
        data.taskId ?? null,
        data.graphVersionId,
        data.agentSnapshotId ?? null,
        data.note ?? null,
        (data.selected ?? false) ? 1 : 0,
        now
      );

    if (data.inputPins && data.inputPins.length > 0) {
      const stmt = this.db.prepare(`
        INSERT INTO artifact_version_input_pins (version_id, seq, artifact_id, input_version_id, sha256)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < data.inputPins.length; i++) {
        const pin = data.inputPins[i];
        stmt.run(data.id, i, pin.artifactId, pin.versionId, pin.sha256);
      }
    }

    return this.getVersionById(data.id)!;
  }

  /**
   * 按 ID 查询产物版本
   */
  getVersionById(id: ArtifactVersionId): ArtifactVersion | null {
    const row = this.db
      .prepare('SELECT * FROM artifact_versions WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    const inputPins = this.db
      .prepare(
        `
        SELECT artifact_id, input_version_id, sha256
        FROM artifact_version_input_pins
        WHERE version_id = ?
        ORDER BY seq ASC
      `
      )
      .all(id) as any[];

    return this.rowToArtifactVersion(row, inputPins);
  }

  /**
   * 查询产物的所有版本
   */
  getVersionsByArtifact(artifactId: ArtifactId): ArtifactVersion[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM artifact_versions
        WHERE artifact_id = ?
        ORDER BY version DESC
      `
      )
      .all(artifactId) as any[];

    return rows.map((row) => {
      const inputPins = this.db
        .prepare(
          `
          SELECT artifact_id, input_version_id, sha256
          FROM artifact_version_input_pins
          WHERE version_id = ?
          ORDER BY seq ASC
        `
        )
        .all(row.id) as any[];

      return this.rowToArtifactVersion(row, inputPins);
    });
  }

  /**
   * 更新版本选中状态
   */
  updateVersionSelected(versionId: ArtifactVersionId, selected: boolean): void {
    this.db
      .prepare('UPDATE artifact_versions SET selected = ? WHERE id = ?')
      .run(selected ? 1 : 0, versionId);
  }

  /**
   * 转换行数据为产物对象
   */
  private rowToArtifact(row: any): Artifact {
    return {
      id: row.id,
      projectId: row.project_id,
      type: row.type,
      episode: row.episode,
      key: row.key,
      title: row.title,
      currentVersionId: row.current_version_id,
      currentVersion: row.current_version,
      status: row.status,
      producerNodeId: row.producer_node_id,
      producerProjectAgentId: row.producer_project_agent_id,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 转换行数据为版本对象
   */
  private rowToArtifactVersion(row: any, inputPins: any[]): ArtifactVersion {
    return {
      id: row.id,
      artifactId: row.artifact_id,
      version: row.version,
      schemaVersion: row.schema_version,
      path: row.path,
      bytes: row.bytes,
      sha256: row.sha256,
      taskId: row.task_id,
      graphVersionId: row.graph_version_id,
      agentSnapshotId: row.agent_snapshot_id,
      inputPins: inputPins.map((pin) => ({
        artifactId: pin.artifact_id,
        versionId: pin.input_version_id,
        sha256: pin.sha256,
      })),
      note: row.note,
      selected: row.selected === 1,
      createdAt: row.created_at,
    };
  }
}
