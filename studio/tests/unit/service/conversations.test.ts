/**
 * 对话服务单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationService } from '@/service/conversations';
import type {
  ConversationId,
  MessageId,
  ProjectId,
} from '@/shared/types';

describe('ConversationService', () => {
  let mockDb: any;
  let mockEvents: any;
  let conversationService: ConversationService;

  beforeEach(() => {
    mockDb = {};

    mockEvents = {
      publish: vi.fn(),
    };

    conversationService = new ConversationService(mockDb, mockEvents);
  });

  describe('create', () => {
    it('should create a conversation and publish event', async () => {
      const result = await conversationService.create({
        id: 'cnv_test' as ConversationId,
        projectId: 'prj_test' as ProjectId,
        kind: 'main',
        title: 'Main Conversation',
      });

      expect(result.id).toBe('cnv_test');
      expect(result.kind).toBe('main');
      expect(result.title).toBe('Main Conversation');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.created',
        })
      );
    });

    it('should create a conversation without project', async () => {
      const result = await conversationService.create({
        id: 'cnv_test' as ConversationId,
        kind: 'lead',
        title: 'Lead Conversation',
      });

      expect(result.id).toBe('cnv_test');
      expect(result.projectId).toBeNull();
      expect(mockEvents.publish).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return conversation by id', async () => {
      const result = await conversationService.getById('cnv_test' as ConversationId);

      expect(result.id).toBe('cnv_test');
      expect(result.kind).toBe('main');
      expect(result.projectId).toBe('prj_test');
    });
  });

  describe('appendMessage', () => {
    it('should append message and publish event', async () => {
      mockDb = {
        ...mockDb,
      };

      await conversationService.appendMessage({
        id: 'msg_test' as MessageId,
        conversationId: 'cnv_test' as ConversationId,
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
      });

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.messageAppended',
        })
      );
    });
  });

  describe('getMessages', () => {
    it('should return messages for conversation', async () => {
      const result = await conversationService.getMessages(
        'cnv_test' as ConversationId
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('truncateAfterSeq', () => {
    it('should truncate conversation and publish event', async () => {
      await conversationService.truncateAfterSeq('cnv_test' as ConversationId, 5);

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.updated',
          payload: expect.objectContaining({
            action: 'truncated',
            afterSeq: 5,
          }),
        })
      );
    });
  });

  describe('export', () => {
    it('should export conversation in structured format', async () => {
      const result = await conversationService.export('cnv_test' as ConversationId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('kind');
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe('archive', () => {
    it('should archive conversation and publish event', async () => {
      const result = await conversationService.archive('cnv_test' as ConversationId);

      expect(result.archivedAt).not.toBeNull();
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.archived',
        })
      );
    });
  });

  describe('delete', () => {
    it('should delete conversation and publish event', async () => {
      await conversationService.delete('cnv_test' as ConversationId);

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.updated',
          payload: expect.objectContaining({
            action: 'deleted',
          }),
        })
      );
    });
  });

  describe('listByProject', () => {
    it('should return empty list for project', async () => {
      const result = await conversationService.listByProject(
        'prj_test' as ProjectId
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });
});
