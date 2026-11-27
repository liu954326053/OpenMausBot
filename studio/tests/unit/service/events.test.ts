/**
 * 事件服务单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventService } from '@/service/events';
import type { ProjectId, StudioEventType } from '@/shared/types';

describe('EventService', () => {
  let mockDb: any;
  let eventService: EventService;

  beforeEach(() => {
    mockDb = {
      events: {
        append: vi.fn().mockReturnValue(1),
        getRange: vi.fn().mockReturnValue([]),
        getByProject: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getByProjectAndType: vi.fn().mockReturnValue([]),
        getBySeq: vi.fn().mockReturnValue({
          seq: 1,
          at: new Date().toISOString(),
          type: 'project.created',
          projectId: 'prj_test',
          payload: { projectId: 'prj_test' },
        }),
        getLatestSeq: vi.fn().mockReturnValue(0),
        count: vi.fn().mockReturnValue(1),
        validateContinuity: vi.fn().mockReturnValue(-1),
        getStats: vi.fn().mockReturnValue({
          totalEvents: 1,
          latestSeq: 1,
          eventsByType: {},
          eventsByProject: {},
        }),
        streamEvents: vi.fn(function* () {
          yield {
            seq: 1,
            at: new Date().toISOString(),
            type: 'project.created',
            projectId: 'prj_test',
            payload: { projectId: 'prj_test' },
          };
        }),
      },
    };

    eventService = new EventService(mockDb);
  });

  describe('publish', () => {
    it('should publish event to log', () => {
      const seq = eventService.publish({
        type: 'project.created',
        projectId: 'prj_test' as ProjectId,
        payload: { projectId: 'prj_test' },
      });

      expect(seq).toBe(1);
      expect(mockDb.events.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project.created',
          projectId: 'prj_test',
        })
      );
    });

    it('should use current timestamp if not provided', () => {
      eventService.publish({
        type: 'project.created',
        payload: {},
      });

      const call = mockDb.events.append.mock.calls[0][0];
      expect(call.at).toBeDefined();
      expect(typeof call.at).toBe('string');
      expect(call.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('subscribe', () => {
    it('should register subscription', () => {
      const callback = vi.fn();
      const id = eventService.subscribe({
        type: 'project.created',
        projectId: 'prj_test' as ProjectId,
        callback,
      });

      expect(id).toMatch(/^sub_/);
    });

    it('should return unique subscription ids', () => {
      const callback = vi.fn();
      const id1 = eventService.subscribe({ callback });
      const id2 = eventService.subscribe({ callback });

      expect(id1).not.toBe(id2);
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription', () => {
      const callback = vi.fn();
      const id = eventService.subscribe({ callback });

      eventService.unsubscribe(id);

      eventService.publish({
        type: 'project.created',
        payload: {},
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getRange', () => {
    it('should get events in range', async () => {
      mockDb.events.getRange.mockReturnValueOnce([
        {
          seq: 1,
          at: new Date().toISOString(),
          type: 'project.created',
          projectId: 'prj_test',
          payload: { projectId: 'prj_test' },
        },
      ]);

      const result = await eventService.getRange(1, 10);

      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.events.getRange).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('getByProject', () => {
    it('should get events for project', async () => {
      mockDb.events.getByProject.mockReturnValueOnce([]);

      const result = await eventService.getByProject('prj_test' as ProjectId);

      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.events.getByProject).toHaveBeenCalledWith(
        'prj_test',
        1000,
        0
      );
    });

    it('should support pagination', async () => {
      await eventService.getByProject('prj_test' as ProjectId, 100, 50);

      expect(mockDb.events.getByProject).toHaveBeenCalledWith(
        'prj_test',
        100,
        50
      );
    });
  });

  describe('getByType', () => {
    it('should get events by type', async () => {
      mockDb.events.getByType.mockReturnValueOnce([]);

      const result = await eventService.getByType(
        'project.created' as StudioEventType
      );

      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.events.getByType).toHaveBeenCalledWith(
        'project.created',
        1000,
        0
      );
    });
  });

  describe('getByProjectAndType', () => {
    it('should get events by project and type', async () => {
      mockDb.events.getByProjectAndType.mockReturnValueOnce([]);

      const result = await eventService.getByProjectAndType(
        'prj_test' as ProjectId,
        'project.created' as StudioEventType
      );

      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.events.getByProjectAndType).toHaveBeenCalledWith(
        'prj_test',
        'project.created',
        1000,
        0
      );
    });
  });

  describe('getLatestSeq', () => {
    it('should return latest sequence number', async () => {
      mockDb.events.getLatestSeq.mockReturnValueOnce(42);

      const result = await eventService.getLatestSeq();

      expect(result).toBe(42);
    });
  });

  describe('count', () => {
    it('should return total event count', async () => {
      mockDb.events.count.mockReturnValueOnce(100);

      const result = await eventService.count();

      expect(result).toBe(100);
    });
  });

  describe('validateContinuity', () => {
    it('should validate event log continuity', async () => {
      mockDb.events.validateContinuity.mockReturnValueOnce(-1);

      const result = await eventService.validateContinuity(1);

      expect(result).toBe(-1);
    });
  });

  describe('getStats', () => {
    it('should return event statistics', async () => {
      mockDb.events.getStats.mockReturnValueOnce({
        totalEvents: 100,
        latestSeq: 100,
        eventsByType: {
          'project.created': 10,
          'artifact.created': 20,
        },
        eventsByProject: {
          'prj_1': 50,
          'prj_2': 50,
        },
      });

      const result = await eventService.getStats();

      expect(result).toHaveProperty('totalEvents');
      expect(result).toHaveProperty('latestSeq');
      expect(result).toHaveProperty('eventsByType');
      expect(result).toHaveProperty('eventsByProject');
    });
  });

  describe('streamEvents', () => {
    it('should stream events as async generator', async () => {
      const events = [];

      for await (const event of eventService.streamEvents(1)) {
        events.push(event);
        break;
      }

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('createSseStream', () => {
    it('should create SSE generator', async () => {
      mockDb.events.getLatestSeq.mockReturnValueOnce(0);
      mockDb.events.getRange.mockReturnValueOnce([]);

      const generator = eventService.createSseStream();
      const { value } = await generator.next();

      expect(typeof value).toBe('string');
    });

    it('should filter events by project', async () => {
      mockDb.events.getLatestSeq.mockReturnValueOnce(0);
      mockDb.events.getRange.mockReturnValueOnce([]);

      const generator = eventService.createSseStream('prj_test' as ProjectId);
      await generator.next();

      expect(mockDb.events.getLatestSeq).toHaveBeenCalled();
    });
  });
});
