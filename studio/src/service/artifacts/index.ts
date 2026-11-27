/**
 * 产物版本管理服务
 *
 * 职责：
 * - 产物版本创建与比较
 * - 版本选用与状态管理
 * - 事件发布
 */

import type { DatabaseManager } from '../db';
import type {
  ArtifactId,
  ArtifactVersionId,
  ArtifactType,
  ProjectId,
  TaskId,
  GraphVersionId,
  NodeId,
  ProjectAgentId,
} from '../../shared/types';
import type { EventService } from '../events';

export interface CreateArtifactInput {
  id: ArtifactId;
  projectId: ProjectId;
  type: ArtifactType;
  episode: number;
  key: string;
  title: string;
  producerNodeId?: NodeId | null;
  producerProjectAgentId?: ProjectAgentId | null;
}

export interface CreateVersionInput {
  id: ArtifactVersionId;
  artifactId: ArtifactId;
  version: number;
  path: string;
  bytes: number;
  sha256: string;
  taskId?: TaskId | null;
  graphVersionId: GraphVersionId;
  note?: string | null;
  inputPins?: Array<{
    artifactId: ArtifactId;
    versionId: ArtifactVersionId;
    sha256: string;
  }>;
}

export interface VersionComparison {
  versionA: ArtifactVersionId;
  versionB: ArtifactVersionId;
  isDifferent: boolean;
  sha256A: string;
  sha256B: string;
}

export class ArtifactService {
  constructor(
    private db: DatabaseManager,
    private events: EventService
  ) {}

  /**
   * 创建产物
   */
  async create(input: CreateArtifactInput) {
    const artifact = this.db.artifacts.create({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      episode: input.episode,
      key: input.key,
      title: input.title,
      producerNodeId: input.producerNodeId ?? null,
      producerProjectAgentId: input.producerProjectAgentId ?? null,
    });

    this.events.publish({
      type: 'artifact.created',
      projectId: input.projectId,
      payload: {
        artifactId: artifact.id,
        type: artifact.type,
        episode: artifact.episode,
        title: artifact.title,
      },
    });

    return artifact;
  }

  /**
   * 获取产物
   */
  async getById(id: ArtifactId) {
    const artifact = this.db.artifacts.getById(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }
    return artifact;
  }

  /**
   * 按项目和类型查询产物
   */
  async listByType(projectId: ProjectId, type: ArtifactType, episode?: number) {
    return this.db.artifacts.listByProjectAndType(projectId, type, episode);
  }

  /**
   * 获取项目所有产物
   */
  async listByProject(projectId: ProjectId) {
    return this.db.artifacts.listByProject(projectId);
  }

  /**
   * 创建新版本
   */
  async createVersion(input: CreateVersionInput) {
    const artifact = await this.getById(input.artifactId);

    const version = this.db.artifacts.createVersion({
      id: input.id,
      artifactId: input.artifactId,
      version: input.version,
      path: input.path,
      bytes: input.bytes,
      sha256: input.sha256,
      taskId: input.taskId ?? null,
      graphVersionId: input.graphVersionId,
      note: input.note ?? null,
      inputPins: input.inputPins,
      selected: false,
    });

    this.events.publish({
      type: 'artifact.versionAdded',
      projectId: artifact.projectId,
      payload: {
        artifactId: input.artifactId,
        versionId: version.id,
        version: version.version,
        sha256: version.sha256,
        bytes: version.bytes,
      },
    });

    return version;
  }

  /**
   * 获取版本
   */
  async getVersionById(id: ArtifactVersionId) {
    const version = this.db.artifacts.getVersionById(id);
    if (!version) {
      throw new Error(`Artifact version not found: ${id}`);
    }
    return version;
  }

  /**
   * 获取产物的所有版本
   */
  async getVersionsByArtifact(artifactId: ArtifactId) {
    return this.db.artifacts.getVersionsByArtifact(artifactId);
  }

  /**
   * 选用版本
   */
  async selectVersion(artifactId: ArtifactId, versionId: ArtifactVersionId) {
    const artifact = await this.getById(artifactId);
    const version = await this.getVersionById(versionId);

    if (version.artifactId !== artifactId) {
      throw new Error('Version does not belong to artifact');
    }

    this.db.artifacts.updateVersionSelected(versionId, true);

    const updated = this.db.artifacts.update(artifactId, {
      currentVersionId: versionId,
      status: 'ready',
    });

    this.events.publish({
      type: 'artifact.selected',
      projectId: artifact.projectId,
      payload: {
        artifactId,
        versionId,
        version: version.version,
      },
    });

    return updated;
  }

  /**
   * 比较两个版本
   */
  async compareVersions(
    versionIdA: ArtifactVersionId,
    versionIdB: ArtifactVersionId
  ): Promise<VersionComparison> {
    const versionA = await this.getVersionById(versionIdA);
    const versionB = await this.getVersionById(versionIdB);

    return {
      versionA: versionIdA,
      versionB: versionIdB,
      isDifferent: versionA.sha256 !== versionB.sha256,
      sha256A: versionA.sha256,
      sha256B: versionB.sha256,
    };
  }

  /**
   * 更新产物状态
   */
  async updateStatus(
    artifactId: ArtifactId,
    status: 'draft' | 'ready' | 'stale'
  ) {
    const artifact = await this.getById(artifactId);

    const updated = this.db.artifacts.update(artifactId, {
      status,
    });

    this.events.publish({
      type: 'artifact.statusChanged',
      projectId: artifact.projectId,
      payload: {
        artifactId,
        status,
      },
    });

    return updated;
  }

  /**
   * 删除产物
   */
  async delete(artifactId: ArtifactId) {
    const artifact = await this.getById(artifactId);

    this.db.artifacts.delete(artifactId);

    this.events.publish({
      type: 'artifact.deleted',
      projectId: artifact.projectId,
      payload: {
        artifactId,
      },
    });

    return artifact;
  }

  /**
   * 恢复删除的产物
   */
  async restore(artifactId: ArtifactId) {
    const deleted = this.db.artifacts.getById(artifactId);
    if (deleted) {
      this.db.artifacts.restore(artifactId);
    }

    return this.db.artifacts.getById(artifactId);
  }
}
