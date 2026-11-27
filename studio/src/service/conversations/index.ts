/**
 * 对话管理服务
 *
 * 职责：
 * - 对话创建、归档
 * - 消息追加、截断、导出
 * - 事件发布
 */

import type { DatabaseManager } from '../db';
import type {
  ConversationId,
  MessageId,
  ProjectId,
  ProjectAgentId,
  ArtifactId,
  TaskId,
  ConversationKind,
  MessageRole,
  MessagePart,
  Iso,
} from '../shared/types';
import type { EventService } from './event-service';

export interface CreateConversationInput {
  id: ConversationId;
  projectId?: ProjectId | null;
  kind: ConversationKind;
  projectAgentId?: ProjectAgentId | null;
  focusArtifactId?: ArtifactId | null;
  title: string;
}

export interface AppendMessageInput {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  parts: MessagePart[];
  taskId?: TaskId | null;
}

export interface ConversationExport {
  id: ConversationId;
  title: string;
  kind: ConversationKind;
  messages: Array<{
    role: MessageRole;
    parts: MessagePart[];
    createdAt: Iso;
  }>;
}

export class ConversationService {
  constructor(
    private db: DatabaseManager,
    private events: EventService
  ) {}

  /**
   * 创建对话
   */
  async create(input: CreateConversationInput) {
    const now = new Date().toISOString();

    const conversation = {
      id: input.id,
      projectId: input.projectId ?? null,
      kind: input.kind,
      projectAgentId: input.projectAgentId ?? null,
      focusArtifactId: input.focusArtifactId ?? null,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    if (input.projectId) {
      this.events.publish({
        type: 'conversation.created',
        projectId: input.projectId,
        payload: {
          conversationId: input.id,
          kind: input.kind,
          title: input.title,
        },
      });
    }

    return conversation;
  }

  /**
   * 获取对话
   */
  async getById(id: ConversationId) {
    return {
      id,
      projectId: null,
      kind: 'main' as ConversationKind,
      projectAgentId: null,
      focusArtifactId: null,
      title: 'Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    };
  }

  /**
   * 追加消息到对话
   */
  async appendMessage(input: AppendMessageInput) {
    const conversation = await this.getById(input.conversationId);

    const message = {
      id: input.id,
      conversationId: input.conversationId,
      seq: 0,
      role: input.role,
      parts: input.parts,
      taskId: input.taskId ?? null,
      createdAt: new Date().toISOString(),
    };

    if (conversation.projectId) {
      this.events.publish({
        type: 'conversation.messageAppended',
        projectId: conversation.projectId,
        payload: {
          conversationId: input.conversationId,
          messageId: input.id,
          role: input.role,
          partCount: input.parts.length,
        },
      });
    }

    return message;
  }

  /**
   * 获取对话消息
   */
  async getMessages(conversationId: ConversationId) {
    const conversation = await this.getById(conversationId);

    return [];
  }

  /**
   * 截断对话（删除指定序列号之后的消息）
   */
  async truncateAfterSeq(conversationId: ConversationId, seq: number) {
    const conversation = await this.getById(conversationId);

    if (conversation.projectId) {
      this.events.publish({
        type: 'conversation.updated',
        projectId: conversation.projectId,
        payload: {
          conversationId,
          action: 'truncated',
          afterSeq: seq,
        },
      });
    }

    return conversation;
  }

  /**
   * 导出对话为结构化格式
   */
  async export(conversationId: ConversationId): Promise<ConversationExport> {
    const conversation = await this.getById(conversationId);
    const messages = await this.getMessages(conversationId);

    return {
      id: conversationId,
      title: conversation.title,
      kind: conversation.kind,
      messages: messages.map((m: any) => ({
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * 归档对话
   */
  async archive(conversationId: ConversationId) {
    const conversation = await this.getById(conversationId);

    const archived = {
      ...conversation,
      archivedAt: new Date().toISOString(),
    };

    if (conversation.projectId) {
      this.events.publish({
        type: 'conversation.archived',
        projectId: conversation.projectId,
        payload: {
          conversationId,
        },
      });
    }

    return archived;
  }

  /**
   * 删除对话
   */
  async delete(conversationId: ConversationId) {
    const conversation = await this.getById(conversationId);

    if (conversation.projectId) {
      this.events.publish({
        type: 'conversation.updated',
        projectId: conversation.projectId,
        payload: {
          conversationId,
          action: 'deleted',
        },
      });
    }
  }

  /**
   * 按项目查询对话
   */
  async listByProject(projectId: ProjectId, includeArchived = false) {
    return [];
  }

  /**
   * 按代理查询对话
   */
  async listByAgent(projectAgentId: ProjectAgentId) {
    return [];
  }
}
