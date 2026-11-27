/**
 * 任务执行管理服务
 *
 * 职责：
 * - 任务提交、取消、状态追踪
 * - 任务错误处理
 * - 事件发布
 */

import type { DatabaseManager } from '../db';
import type {
  TaskId,
  ProjectId,
  GraphVersionId,
  NodeId,
  ProjectAgentId,
  Scope,
  ArtifactId,
  ArtifactVersionId,
  TaskStatus,
  TaskErrorKind,
  Iso,
} from '../../shared/types';
import type { EventService } from '../events';

export interface CreateTaskInput {
  id: TaskId;
  projectId: ProjectId;
  graphVersionId: GraphVersionId;
  nodeId: NodeId;
  projectAgentId: ProjectAgentId;
  scope: Scope;
  episode: number;
  inputPins?: Array<{
    artifactId: ArtifactId;
    versionId: ArtifactVersionId;
    sha256: string;
  }>;
}

export interface TaskStatusUpdate {
  status: TaskStatus;
  now?: Iso;
}

export interface TaskErrorInput {
  kind: TaskErrorKind;
  message: string;
  detail?: Record<string, any>;
}

export class TaskService {
  constructor(
    private db: DatabaseManager,
    private events: EventService
  ) {}

  /**
   * 创建任务
   */
  async create(input: CreateTaskInput) {
    const task = this.db.tasks.create({
      id: input.id,
      projectId: input.projectId,
      graphVersionId: input.graphVersionId,
      nodeId: input.nodeId,
      projectAgentId: input.projectAgentId,
      scope: input.scope,
      episode: input.episode,
      inputPins: input.inputPins,
    });

    this.events.publish({
      type: 'task.created',
      projectId: input.projectId,
      payload: {
        taskId: task.id,
        nodeId: task.nodeId,
        status: task.status,
        episode: task.episode,
      },
    });

    return task;
  }

  /**
   * 获取任务
   */
  async getById(id: TaskId) {
    const task = this.db.tasks.getById(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  }

  /**
   * 按图版本和节点查询任务
   */
  async getByGraphNodeAndEpisode(
    graphVersionId: GraphVersionId,
    nodeId: NodeId,
    episode: number
  ) {
    return this.db.tasks.getByGraphNodeAndEpisode(graphVersionId, nodeId, episode);
  }

  /**
   * 按项目查询任务
   */
  async listByProject(projectId: ProjectId, status?: TaskStatus) {
    return this.db.tasks.listByProject(projectId, status);
  }

  /**
   * 按图版本查询任务
   */
  async listByGraphVersion(graphVersionId: GraphVersionId) {
    return this.db.tasks.listByGraphVersion(graphVersionId);
  }

  /**
   * 更新任务状态
   */
  async updateStatus(id: TaskId, update: TaskStatusUpdate) {
    const task = await this.getById(id);

    const updated = this.db.tasks.updateStatus(id, update.status, update.now);

    this.events.publish({
      type: 'task.statusChanged',
      projectId: task.projectId,
      payload: {
        taskId: id,
        status: update.status,
        previousStatus: task.status,
      },
    });

    return updated;
  }

  /**
   * 取消任务
   */
  async cancel(id: TaskId) {
    const task = await this.getById(id);

    if (task.status === 'done' || task.status === 'cancelled') {
      throw new Error(`Cannot cancel task with status: ${task.status}`);
    }

    const updated = this.db.tasks.updateStatus(id, 'cancelled');

    this.events.publish({
      type: 'task.statusChanged',
      projectId: task.projectId,
      payload: {
        taskId: id,
        status: 'cancelled',
        previousStatus: task.status,
      },
    });

    return updated;
  }

  /**
   * 设置任务错误
   */
  async setError(id: TaskId, error: TaskErrorInput) {
    const task = await this.getById(id);

    const updated = this.db.tasks.setError(id, error.kind, error.message, error.detail);

    this.events.publish({
      type: 'task.statusChanged',
      projectId: task.projectId,
      payload: {
        taskId: id,
        status: 'failed',
        error: {
          kind: error.kind,
          message: error.message,
        },
      },
    });

    return updated;
  }

  /**
   * 清除任务错误
   */
  async clearError(id: TaskId) {
    await this.getById(id);
    this.db.tasks.clearError(id);
  }

  /**
   * 请求闸门确认
   */
  async requestGateConfirmation(id: TaskId) {
    const task = await this.getById(id);

    const updated = this.db.tasks.updateGate(id, 'pending');

    this.events.publish({
      type: 'task.gateRequested',
      projectId: task.projectId,
      payload: {
        taskId: id,
      },
    });

    return updated;
  }

  /**
   * 确认闸门
   */
  async confirmGate(id: TaskId) {
    const task = await this.getById(id);

    const updated = this.db.tasks.updateGate(id, 'confirmed');

    this.events.publish({
      type: 'task.gateConfirmed',
      projectId: task.projectId,
      payload: {
        taskId: id,
      },
    });

    return updated;
  }

  /**
   * 添加输出版本
   */
  async addOutputVersion(taskId: TaskId, versionId: ArtifactVersionId) {
    const task = await this.getById(taskId);
    this.db.tasks.addOutputVersion(taskId, versionId);
  }

  /**
   * 创建任务执行记录
   */
  async createAttempt(taskId: TaskId, attempt: number, logPath: string) {
    await this.getById(taskId);

    this.db.tasks.createAttempt({
      taskId,
      attempt,
      logPath,
    });
  }

  /**
   * 更新任务执行记录
   */
  async updateAttempt(
    taskId: TaskId,
    attempt: number,
    data: {
      status?: TaskStatus;
      stdout?: string;
      stderr?: string;
      endedAt?: Iso;
    }
  ) {
    await this.getById(taskId);

    this.db.tasks.updateAttempt({
      taskId,
      attempt,
      status: data.status ?? 'running',
      stdout: data.stdout,
      stderr: data.stderr,
      endedAt: data.endedAt,
    });
  }

  /**
   * 检查任务是否可以启动
   */
  async canStart(id: TaskId): Promise<boolean> {
    const task = await this.getById(id);
    return task.status === 'ready' && task.gate === 'confirmed';
  }

  /**
   * 获取就绪的任务列表
   */
  async getReadyTasks(projectId: ProjectId): Promise<TaskId[]> {
    const tasks = this.db.tasks.listByProject(projectId, 'ready');
    return tasks.map((t) => t.id);
  }
}
