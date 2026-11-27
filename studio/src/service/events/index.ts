/**
 * 事件总线与发布-订阅服务
 *
 * 职责：
 * - 事件发布到日志
 * - 事件订阅与 SSE 推送
 * - 事件重放与同步
 */

import type { DatabaseManager } from '../db';
import type { StudioEvent, StudioEventType, ProjectId, Json } from '../shared/types';

export interface EventSubscription {
  id: string;
  type?: StudioEventType;
  projectId?: ProjectId;
  callback: (event: StudioEvent) => void;
}

export interface PublishEventInput {
  type: StudioEventType;
  projectId?: ProjectId;
  payload: Json;
  at?: string;
}

export class EventService {
  private subscriptions: Map<string, EventSubscription> = new Map();
  private subscriptionCounter = 0;

  constructor(private db: DatabaseManager) {}

  /**
   * 发布事件到日志
   */
  publish(input: PublishEventInput): number {
    const seq = this.db.events.append({
      type: input.type,
      projectId: input.projectId,
      payload: input.payload,
      at: input.at ?? new Date().toISOString(),
    });

    this.notifySubscribers(seq);

    return seq;
  }

  /**
   * 订阅事件（支持过滤）
   */
  subscribe(input: {
    type?: StudioEventType;
    projectId?: ProjectId;
    callback: (event: StudioEvent) => void;
  }): string {
    const id = `sub_${++this.subscriptionCounter}`;

    const subscription: EventSubscription = {
      id,
      type: input.type,
      projectId: input.projectId,
      callback: input.callback,
    };

    this.subscriptions.set(id, subscription);

    return id;
  }

  /**
   * 取消订阅
   */
  unsubscribe(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * 获取事件（指定范围）
   */
  async getRange(fromSeq: number, toSeq: number): Promise<StudioEvent[]> {
    return this.db.events.getRange(fromSeq, toSeq);
  }

  /**
   * 获取特定项目的事件
   */
  async getByProject(projectId: ProjectId, limit = 1000, offset = 0): Promise<StudioEvent[]> {
    return this.db.events.getByProject(projectId, limit, offset);
  }

  /**
   * 获取特定类型的事件
   */
  async getByType(type: StudioEventType, limit = 1000, offset = 0): Promise<StudioEvent[]> {
    return this.db.events.getByType(type, limit, offset);
  }

  /**
   * 获取特定项目和类型的事件
   */
  async getByProjectAndType(
    projectId: ProjectId,
    type: StudioEventType,
    limit = 1000,
    offset = 0
  ): Promise<StudioEvent[]> {
    return this.db.events.getByProjectAndType(projectId, type, limit, offset);
  }

  /**
   * 流式读取事件（适合大数据集）
   */
  async *streamEvents(fromSeq = 1): AsyncGenerator<StudioEvent> {
    for (const event of this.db.events.streamEvents(fromSeq)) {
      yield event;
    }
  }

  /**
   * 获取最新的 seq 号
   */
  async getLatestSeq(): Promise<number> {
    return this.db.events.getLatestSeq();
  }

  /**
   * 获取事件总数
   */
  async count(): Promise<number> {
    return this.db.events.count();
  }

  /**
   * 验证事件日志连续性
   */
  async validateContinuity(fromSeq = 1): Promise<number> {
    return this.db.events.validateContinuity(fromSeq);
  }

  /**
   * 获取事件统计
   */
  async getStats() {
    return this.db.events.getStats();
  }

  /**
   * 创建 SSE 生成器（用于 HTTP 端点）
   */
  async *createSseStream(
    projectId?: ProjectId,
    type?: StudioEventType,
    fromSeq?: number
  ): AsyncGenerator<string> {
    const startSeq = fromSeq ?? (await this.getLatestSeq());

    let currentSeq = startSeq;

    while (true) {
      const events = await this.getRange(currentSeq, currentSeq + 99);

      for (const event of events) {
        const matches = this.matchesFilter(event, projectId, type);
        if (matches) {
          yield `data: ${JSON.stringify(event)}\n\n`;
        }
        currentSeq = event.seq + 1;
      }

      if (events.length === 0) {
        yield `:heartbeat\n\n`;
        await this.delay(5000);
      }
    }
  }

  /**
   * 通知订阅者
   */
  private notifySubscribers(seq: number): void {
    const event = this.db.events.getBySeq(seq);
    if (!event) return;

    for (const subscription of this.subscriptions.values()) {
      if (this.matchesFilter(event, subscription.projectId, subscription.type)) {
        try {
          subscription.callback(event);
        } catch (err) {
          console.error('Subscription callback error:', err);
        }
      }
    }
  }

  /**
   * 检查事件是否匹配过滤条件
   */
  private matchesFilter(
    event: StudioEvent,
    projectId?: ProjectId,
    type?: StudioEventType
  ): boolean {
    if (projectId && event.projectId !== projectId) {
      return false;
    }
    if (type && event.type !== type) {
      return false;
    }
    return true;
  }

  /**
   * 延迟工具
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
