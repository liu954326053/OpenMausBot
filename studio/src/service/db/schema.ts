/**
 * SQLite 数据库架构与迁移
 *
 * 三层存储架构：
 * - 磁盘：产物字节（blob）
 * - SQLite：索引与元数据（schema 本文件）
 * - 内存：临时运行状态（快照）
 */

import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

export interface MigrationResult {
  version: number;
  appliedAt: string;
  success: boolean;
  error?: string;
}

export class DatabaseSchema {
  constructor(private db: Database.Database) {}

  /**
   * 初始化数据库：创建所有表、索引和触发器
   */
  init(): void {
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');

    this.createVersionTable();
    this.applyMigrations();
  }

  /**
   * 创建版本追踪表（元表）
   */
  private createVersionTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS __schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        UNIQUE(id)
      )
    `);
  }

  /**
   * 应用所需迁移脚本
   */
  private applyMigrations(): void {
    const current = this.getVersion();

    if (current < 1) {
      this.migrate_v1();
    }
  }

  /**
   * 获取当前架构版本
   */
  private getVersion(): number {
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
   * 更新版本号
   */
  private setVersion(version: number): void {
    this.db.prepare(`
      INSERT INTO __schema_version (id, version, applied_at)
      VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET version = excluded.version
    `).run(version);
  }

  /**
   * V1 迁移：初始架构（核心表）
   */
  private migrate_v1(): void {
    this.db.exec(`
      -- ============================================================
      -- 1. 项目与团队
      -- ============================================================

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder TEXT NOT NULL UNIQUE,
        team_snapshot_id TEXT NOT NULL,
        source_team_preset_id TEXT,
        lead_mode TEXT NOT NULL CHECK (lead_mode IN ('project-agent', 'main-agent')),
        lead_project_agent_id TEXT,
        episode_count INTEGER NOT NULL CHECK (episode_count > 0),
        language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
        cover_artifact_id TEXT,
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 4,
        network_per_agent BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX idx_projects_deleted ON projects(deleted_at);
      CREATE INDEX idx_projects_last_activity ON projects(last_activity_at DESC);

      -- ============================================================
      -- 2. 智能体定义与指派
      -- ============================================================

      CREATE TABLE agent_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        avatar_path TEXT,
        instructions TEXT NOT NULL,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('builtin', 'claude-cli', 'codex-cli')),
        engine_model TEXT NOT NULL,
        engine_provider_id TEXT,
        permissions_file_write TEXT NOT NULL DEFAULT 'ask',
        permissions_command_run TEXT NOT NULL DEFAULT 'ask',
        permissions_network BOOLEAN NOT NULL DEFAULT 0,
        permissions_generate BOOLEAN NOT NULL DEFAULT 0,
        permissions_converse BOOLEAN NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX idx_agent_definitions_deleted ON agent_definitions(deleted_at);

      CREATE TABLE agent_definition_skills (
        agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        PRIMARY KEY (agent_id, skill_id),
        FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
      );

      CREATE TABLE agent_definition_mcp_servers (
        agent_id TEXT NOT NULL,
        mcp_server_id TEXT NOT NULL,
        PRIMARY KEY (agent_id, mcp_server_id),
        FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
      );

      CREATE TABLE project_agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_definition_id TEXT NOT NULL,
        role_key TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('drama', 'episode')),
        episode_from INTEGER,
        episode_to INTEGER,
        override_instructions_append TEXT,
        override_engine_kind TEXT,
        override_engine_model TEXT,
        override_engine_provider_id TEXT,
        memory_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        removed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (agent_definition_id) REFERENCES agent_definitions(id)
      );

      CREATE INDEX idx_project_agents_project ON project_agents(project_id);
      CREATE INDEX idx_project_agents_removed ON project_agents(removed_at);

      CREATE TABLE project_agent_skills (
        project_agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        PRIMARY KEY (project_agent_id, skill_id),
        FOREIGN KEY (project_agent_id) REFERENCES project_agents(id)
      );

      CREATE TABLE project_agent_mcp_servers (
        project_agent_id TEXT NOT NULL,
        mcp_server_id TEXT NOT NULL,
        PRIMARY KEY (project_agent_id, mcp_server_id),
        FOREIGN KEY (project_agent_id) REFERENCES project_agents(id)
      );

      -- ============================================================
      -- 3. 工作流与产物
      -- ============================================================

      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        episode INTEGER NOT NULL CHECK (episode >= 0),
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        current_version_id TEXT,
        current_version INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'stale')),
        producer_node_id TEXT,
        producer_project_agent_id TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE (project_id, type, episode, key)
      );

      CREATE INDEX idx_artifacts_project ON artifacts(project_id);
      CREATE INDEX idx_artifacts_deleted ON artifacts(deleted_at);
      CREATE INDEX idx_artifacts_status ON artifacts(status);

      CREATE TABLE artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        path TEXT NOT NULL,
        bytes INTEGER NOT NULL CHECK (bytes >= 0),
        sha256 TEXT NOT NULL,
        task_id TEXT,
        graph_version_id TEXT NOT NULL,
        agent_snapshot_id TEXT,
        note TEXT,
        selected BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
        UNIQUE (artifact_id, version)
      );

      CREATE INDEX idx_artifact_versions_artifact ON artifact_versions(artifact_id);
      CREATE INDEX idx_artifact_versions_created ON artifact_versions(created_at DESC);

      CREATE TABLE artifact_version_input_pins (
        version_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        artifact_id TEXT NOT NULL,
        input_version_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY (version_id, seq),
        FOREIGN KEY (version_id) REFERENCES artifact_versions(id)
      );

      -- ============================================================
      -- 4. 任务与执行
      -- ============================================================

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        graph_version_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        project_agent_id TEXT NOT NULL,
        agent_snapshot_id TEXT,
        scope TEXT NOT NULL CHECK (scope IN ('drama', 'episode')),
        episode INTEGER NOT NULL CHECK (episode >= 0),
        status TEXT NOT NULL DEFAULT 'waiting' CHECK (
          status IN ('waiting', 'ready', 'running', 'done', 'failed', 'stale', 'cancelled')
        ),
        attempt INTEGER NOT NULL DEFAULT 1,
        gate TEXT NOT NULL DEFAULT 'none' CHECK (gate IN ('none', 'pending', 'confirmed')),
        error_kind TEXT,
        error_message TEXT,
        error_detail TEXT,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (project_agent_id) REFERENCES project_agents(id)
      );

      CREATE INDEX idx_tasks_project ON tasks(project_id);
      CREATE INDEX idx_tasks_status ON tasks(status);
      CREATE INDEX idx_tasks_graph_version ON tasks(graph_version_id);

      CREATE TABLE task_input_pins (
        task_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY (task_id, seq),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE task_output_versions (
        task_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        version_id TEXT NOT NULL,
        PRIMARY KEY (task_id, seq),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (version_id) REFERENCES artifact_versions(id)
      );

      CREATE TABLE task_attempts (
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        log_path TEXT NOT NULL,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        ended_at TEXT,
        PRIMARY KEY (task_id, attempt),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX idx_task_attempts_task ON task_attempts(task_id);

      -- ============================================================
      -- 5. 对话与消息
      -- ============================================================

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('main', 'lead', 'agent')),
        project_agent_id TEXT,
        focus_artifact_id TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (project_agent_id) REFERENCES project_agents(id)
      );

      CREATE INDEX idx_conversations_project ON conversations(project_id);
      CREATE INDEX idx_conversations_kind ON conversations(kind);
      CREATE INDEX idx_conversations_archived ON conversations(archived_at);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
        task_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        UNIQUE (conversation_id, seq)
      );

      CREATE INDEX idx_messages_conversation ON messages(conversation_id);

      CREATE TABLE message_parts (
        message_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'artifact', 'spill')),
        text_content TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        artifact_id TEXT,
        artifact_version_id TEXT,
        spill_path TEXT,
        spill_bytes INTEGER,
        PRIMARY KEY (message_id, seq),
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      -- ============================================================
      -- 6. 追加式事件日志（JSON Lines）
      -- ============================================================

      CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        project_id TEXT,
        payload TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE INDEX idx_events_project ON events(project_id);
      CREATE INDEX idx_events_type ON events(type);
      CREATE INDEX idx_events_at ON events(at DESC);

      -- ============================================================
      -- 7. 技能与 MCP 服务
      -- ============================================================

      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        version TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        store_path TEXT NOT NULL,
        file_count INTEGER NOT NULL CHECK (file_count >= 0),
        bytes INTEGER NOT NULL CHECK (bytes >= 0),
        enabled BOOLEAN NOT NULL DEFAULT 1,
        deleted_at TEXT
      );

      CREATE INDEX idx_skills_deleted ON skills(deleted_at);

      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
        command TEXT,
        url TEXT,
        auth_ref TEXT,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        last_probe_ok BOOLEAN,
        last_probe_at TEXT,
        last_probe_tools TEXT
      );

      -- ============================================================
      -- 8. 生成服务
      -- ============================================================

      CREATE TABLE generation_services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (capability IN ('image', 'video')),
        plugin_id TEXT NOT NULL,
        base_url TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https')),
        models TEXT NOT NULL,
        secret_refs TEXT NOT NULL DEFAULT '{}',
        enabled BOOLEAN NOT NULL DEFAULT 1,
        deleted_at TEXT
      );

      CREATE INDEX idx_generation_services_deleted ON generation_services(deleted_at);

      -- ============================================================
      -- 9. 图版本历史
      -- ============================================================

      CREATE TABLE graph_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        parent_id TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('team-snapshot', 'lead', 'user')),
        hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (parent_id) REFERENCES graph_versions(id),
        UNIQUE (project_id, version)
      );

      CREATE INDEX idx_graph_versions_project ON graph_versions(project_id);

      CREATE TABLE graph_nodes (
        graph_version_id TEXT NOT NULL,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('agent', 'artifact')),
        agent_project_agent_id TEXT,
        agent_role_key TEXT,
        agent_reads TEXT,
        agent_writes TEXT,
        agent_gate BOOLEAN,
        agent_config TEXT,
        artifact_type TEXT,
        artifact_scope TEXT,
        PRIMARY KEY (graph_version_id, id),
        FOREIGN KEY (graph_version_id) REFERENCES graph_versions(id)
      );

      CREATE TABLE graph_edges (
        graph_version_id TEXT NOT NULL,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        PRIMARY KEY (graph_version_id, id),
        FOREIGN KEY (graph_version_id) REFERENCES graph_versions(id)
      );

      -- ============================================================
      -- 10. 团队快照
      -- ============================================================

      CREATE TABLE team_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        preset_id TEXT,
        body_hash TEXT NOT NULL,
        roles TEXT NOT NULL,
        lead_role_key TEXT,
        default_workflow_dsl TEXT NOT NULL,
        generation_defaults TEXT,
        created_at TEXT NOT NULL,
        superseded_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE INDEX idx_team_snapshots_project ON team_snapshots(project_id);

      -- ============================================================
      -- 11. 智能体快照（任务开始时固化）
      -- ============================================================

      CREATE TABLE agent_snapshots (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        definition TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX idx_agent_snapshots_task ON agent_snapshots(task_id);
    `);

    this.setVersion(1);
  }
}

/**
 * 获取数据库连接字符串
 */
export function getDatabasePath(projectFolder: string): string {
  return `${projectFolder}/studio.db`;
}
