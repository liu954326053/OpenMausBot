/**
 * 项目生命周期管理服务
 *
 * 职责：
 * - 项目创建、更新、存档、删除
 * - 项目统计与查询
 * - 事件发布
 */

import type { DatabaseManager } from '../db';
import type {
  ProjectId,
  TeamSnapshotId,
  TeamPresetId,
  ProjectAgentId,
  ArtifactId,
  Iso,
} from '../../shared/types';
import type { EventService } from '../events';

export interface CreateProjectInput {
  id: ProjectId;
  name: string;
  folder: string;
  teamSnapshotId: TeamSnapshotId;
  sourceTeamPresetId: TeamPresetId | null;
  leadMode: 'project-agent' | 'main-agent';
  leadProjectAgentId: ProjectAgentId | null;
  episodeCount: number;
  language: 'zh' | 'en';
  coverArtifactId?: ArtifactId | null;
  maxConcurrentTasks?: number;
  networkPerAgent?: boolean;
}

export interface UpdateProjectInput {
  name?: string;
  coverArtifactId?: ArtifactId | null;
  maxConcurrentTasks?: number;
  networkPerAgent?: boolean;
}

export interface ProjectStats {
  totalArtifacts: number;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  conversationCount: number;
}

export class ProjectService {
  constructor(
    private db: DatabaseManager,
    private events: EventService
  ) {}

  /**
   * 创建项目
   */
  async create(input: CreateProjectInput) {
    const project = this.db.projects.create({
      id: input.id,
      name: input.name,
      folder: input.folder,
      teamSnapshotId: input.teamSnapshotId,
      sourceTeamPresetId: input.sourceTeamPresetId,
      leadMode: input.leadMode,
      leadProjectAgentId: input.leadProjectAgentId,
      episodeCount: input.episodeCount,
      language: input.language,
      coverArtifactId: input.coverArtifactId ?? null,
      maxConcurrentTasks: input.maxConcurrentTasks ?? 4,
      networkPerAgent: input.networkPerAgent ?? false,
    });

    this.events.publish({
      type: 'project.created',
      projectId: project.id,
      payload: {
        projectId: project.id,
        name: project.name,
        episodeCount: project.episodeCount,
        language: project.language,
      },
    });

    return project;
  }

  /**
   * 获取项目
   */
  async getById(id: ProjectId) {
    const project = this.db.projects.getById(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    this.db.projects.touch(id);
    return project;
  }

  /**
   * 按文件夹获取项目
   */
  async getByFolder(folder: string) {
    return this.db.projects.getByFolder(folder);
  }

  /**
   * 列出所有活跃项目
   */
  async listActive(limit = 100, offset = 0) {
    return this.db.projects.listActive(limit, offset);
  }

  /**
   * 更新项目
   */
  async update(id: ProjectId, input: UpdateProjectInput) {
    const project = await this.getById(id);

    const updated = this.db.projects.update(id, {
      name: input.name,
      coverArtifactId: input.coverArtifactId,
      maxConcurrentTasks: input.maxConcurrentTasks,
      networkPerAgent: input.networkPerAgent,
    });

    this.events.publish({
      type: 'project.updated',
      projectId: id,
      payload: {
        projectId: id,
        changes: input,
      },
    });

    return updated;
  }

  /**
   * 存档项目（逻辑删除）
   */
  async archive(id: ProjectId) {
    const project = await this.getById(id);

    this.db.projects.delete(id);

    this.events.publish({
      type: 'project.deleted',
      projectId: id,
      payload: {
        projectId: id,
        name: project.name,
      },
    });

    return project;
  }

  /**
   * 获取项目统计
   */
  async getStats(projectId: ProjectId): Promise<ProjectStats> {
    const artifacts = this.db.artifacts.listByProject(projectId);
    const tasks = this.db.tasks.listByProject(projectId);

    const tasksByStatus: Record<string, number> = {};
    for (const task of tasks) {
      tasksByStatus[task.status] = (tasksByStatus[task.status] ?? 0) + 1;
    }

    return {
      totalArtifacts: artifacts.length,
      totalTasks: tasks.length,
      tasksByStatus,
      conversationCount: 0,
    };
  }

  /**
   * 检查项目是否存在
   */
  async exists(id: ProjectId): Promise<boolean> {
    return this.db.projects.exists(id);
  }

  /**
   * 获取项目总数
   */
  async count(): Promise<number> {
    return this.db.projects.count();
  }
}
