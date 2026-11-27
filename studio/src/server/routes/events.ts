/**
 * 实时事件流路由（SSE）
 *
 * REST 端点：
 * - GET    /api/events/stream/:projectId   订阅项目实时事件
 * - GET    /api/events/history/:projectId  获取事件历史
 * - POST   /api/events/publish              发布事件（内部）
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { ApiError } from '../middleware/error-handler';

const publishEventSchema = z.object({
  type: z.string(),
  projectId: z.string(),
  data: z.record(z.any()),
  metadata: z.record(z.any()).optional(),
});

interface StreamSubscriber {
  res: Response;
  projectId: string;
  createdAt: Date;
}

const subscribers = new Map<string, StreamSubscriber[]>();

export function eventsRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    '/stream/:projectId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { projectId } = req.params;

        const project = context.db.projects.getById(projectId as any);
        if (!project) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${projectId} not found`);
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        const subscriberId = `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        if (!subscribers.has(projectId)) {
          subscribers.set(projectId, []);
        }

        subscribers.get(projectId)!.push({
          res,
          projectId,
          createdAt: new Date(),
        });

        res.write(
          `data: ${JSON.stringify({
            type: 'connection:established',
            subscriberId,
            projectId,
            timestamp: new Date().toISOString(),
          })}\n\n`
        );

        const heartbeatInterval = setInterval(() => {
          res.write(': heartbeat\n\n');
        }, 30000);

        req.on('close', () => {
          clearInterval(heartbeatInterval);
          const list = subscribers.get(projectId);
          if (list) {
            const index = list.findIndex((s) => s.res === res);
            if (index !== -1) {
              list.splice(index, 1);
            }
            if (list.length === 0) {
              subscribers.delete(projectId);
            }
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    '/history/:projectId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { projectId } = req.params;
        const { limit = '100', offset = '0', type } = req.query;

        const project = context.db.projects.getById(projectId as any);
        if (!project) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${projectId} not found`);
        }

        const events = context.db.events.listByProject(projectId as any, {
          limit: Math.min(parseInt(limit as string) || 100, 1000),
          offset: parseInt(offset as string) || 0,
          type: type as string | undefined,
        });

        res.json({
          projectId,
          events: events || [],
          limit,
          offset,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/publish',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = publishEventSchema.parse(req.body);

        context.db.transaction(() => {
          context.db.events.create({
            type: data.type as any,
            projectId: data.projectId as any,
            timestamp: new Date().toISOString(),
            data: data.data,
          });
        });

        const list = subscribers.get(data.projectId);
        if (list && list.length > 0) {
          const eventData = {
            type: data.type,
            projectId: data.projectId,
            data: data.data,
            timestamp: new Date().toISOString(),
          };

          for (const subscriber of list) {
            subscriber.res.write(
              `data: ${JSON.stringify(eventData)}\n\n`
            );
          }
        }

        res.json({
          published: true,
          projectId: data.projectId,
          type: data.type,
          subscriberCount: list?.length || 0,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
