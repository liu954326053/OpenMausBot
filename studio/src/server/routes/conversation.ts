/**
 * 对话管理路由
 *
 * REST 端点：
 * - POST   /api/conversation                创建对话
 * - GET    /api/conversation/:id            获取对话
 * - PUT    /api/conversation/:id            更新对话
 * - DELETE /api/conversation/:id            删除对话
 * - POST   /api/conversation/:id/messages   发送消息
 * - GET    /api/conversation/:id/messages   获取消息
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { ApiError } from '../middleware/error-handler';

const createConversationSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  scope: z.enum(['drama', 'episode']).optional(),
  episodeNumber: z.number().int().min(1).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']).default('user'),
  author: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export function conversationRouter(context: AppContext): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createConversationSchema.parse(req.body);

      const conversationId = `cnv_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const conversation = context.db.events.createConversation({
        id: conversationId as any,
        projectId: data.projectId as any,
        title: data.title || `Conversation ${new Date().toLocaleDateString()}`,
        description: data.description || null,
        scope: data.scope || 'drama',
        episodeNumber: data.episodeNumber || null,
        metadata: data.metadata || {},
      });

      res.status(201).json(conversation);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const messages = context.db.events.getConversationMessages(id as any);

      if (!messages || messages.length === 0) {
        throw new ApiError(404, 'NOT_FOUND', `Conversation ${id} not found`);
      }

      const conversation = context.db.events.getConversation(id as any);

      res.json({
        ...conversation,
        messageCount: messages.length,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = updateConversationSchema.parse(req.body);

        const existing = context.db.events.getConversation(id as any);
        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Conversation ${id} not found`);
        }

        const updated = {
          ...existing,
          title: data.title ?? existing.title,
          description: data.description ?? existing.description,
          metadata: { ...existing.metadata, ...data.metadata },
          updatedAt: new Date().toISOString(),
        };

        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete(
    '/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const existing = context.db.events.getConversation(id as any);

        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Conversation ${id} not found`);
        }

        context.db.events.deleteConversation(id as any);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/:id/messages',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = sendMessageSchema.parse(req.body);

        const conversation = context.db.events.getConversation(id as any);
        if (!conversation) {
          throw new ApiError(404, 'NOT_FOUND', `Conversation ${id} not found`);
        }

        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        context.db.transaction(() => {
          context.db.events.create({
            type: 'conversation:message-added',
            projectId: conversation.projectId,
            timestamp: new Date().toISOString(),
            data: {
              conversationId: id,
              messageId,
              content: data.content,
              role: data.role,
              author: data.author || 'api-client',
              metadata: data.metadata || {},
            },
          });
        });

        res.status(201).json({
          messageId,
          conversationId: id,
          content: data.content,
          role: data.role,
          author: data.author || 'api-client',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    '/:id/messages',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { limit = '50', offset = '0' } = req.query;

        const conversation = context.db.events.getConversation(id as any);
        if (!conversation) {
          throw new ApiError(404, 'NOT_FOUND', `Conversation ${id} not found`);
        }

        const messages = context.db.events.getConversationMessages(id as any);

        const pageSize = Math.min(parseInt(limit as string) || 50, 100);
        const pageOffset = parseInt(offset as string) || 0;
        const paged = messages.slice(pageOffset, pageOffset + pageSize);

        res.json({
          conversationId: id,
          messages: paged,
          total: messages.length,
          limit: pageSize,
          offset: pageOffset,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
