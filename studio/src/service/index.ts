/**
 * 业务服务层导出与工厂
 *
 * 统一管理所有业务服务的初始化与依赖注入
 */

import type { DatabaseManager } from '../db';
import { ProjectService } from './projects';
import { ArtifactService } from './artifacts';
import { TaskService } from './tasks';
import { ConversationService } from './conversations';
import { EventService } from './events';

export class ServiceContainer {
  private events: EventService;

  public projects: ProjectService;
  public artifacts: ArtifactService;
  public tasks: TaskService;
  public conversations: ConversationService;

  constructor(private db: DatabaseManager) {
    this.events = new EventService(this.db);

    this.projects = new ProjectService(this.db, this.events);
    this.artifacts = new ArtifactService(this.db, this.events);
    this.tasks = new TaskService(this.db, this.events);
    this.conversations = new ConversationService(this.db, this.events);
  }

  /**
   * 获取事件服务（通常只供内部使用）
   */
  getEventService(): EventService {
    return this.events;
  }
}

export { ProjectService } from './projects';
export type { CreateProjectInput, UpdateProjectInput, ProjectStats } from './projects';

export { ArtifactService } from './artifacts';
export type {
  CreateArtifactInput,
  CreateVersionInput,
  VersionComparison,
} from './artifacts';

export { TaskService } from './tasks';
export type { CreateTaskInput, TaskStatusUpdate, TaskErrorInput } from './tasks';

export { ConversationService } from './conversations';
export type { CreateConversationInput, AppendMessageInput, ConversationExport } from './conversations';

export { EventService } from './events';
export type { EventSubscription, PublishEventInput } from './events';
