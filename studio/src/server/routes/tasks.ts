/**
 * 任务管理路由
 *
 * REST 端点：
 * - POST   /api/tasks              创建任务
 * - GET    /api/tasks/:id          获取任务
 * - PUT    /api/tasks/:id/status   更新任务状态
 * - GET    /api/tasks              查询任务（按项目、状态）
 * - POST   /api/tasks/:id/attempts 记录执行尝试
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { ApiError } from '../middleware/error-handler';

const createTaskSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  nodeId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).default('pending'),
  inputPinIds: z.array(z.string()).optional(),
  outputVersionIds: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  message: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const recordAttemptSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string().optional(),
  exitCode: z.number().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
});

export function tasksRouter(context: AppContext): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createTaskSchema.parse(req.body);

      const taskId = `tsk_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const task = context.db.tasks.create({
        id: taskId as any,
        projectId: data.projectId as any,
        name: data.name,
        description: data.description || null,
        nodeId: data.nodeId as any,
        status: (data.status || 'pending') as any,
        metadata: data.metadata || {},
      });

      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const task = context.db.tasks.getById(id as any);

      if (!task) {
        throw new ApiError(404, 'NOT_FOUND', `Task ${id} not found`);
      }

      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/:id/status',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = updateStatusSchema.parse(req.body);

        const existing = context.db.tasks.getById(id as any);
        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Task ${id} not found`);
        }

        const updated = context.db.tasks.updateStatus(id as any, {
          status: data.status as any,
          message: data.message || null,
          metadata: data.metadata || existing.metadata,
        });

        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId, status, limit = '50', offset = '0' } = req.query;

      const filters = {
        projectId: projectId as string | undefined,
        status: status as string | undefined,
      };

      const tasks = context.db.tasks.list({
        ...filters,
        limit: Math.min(parseInt(limit as string) || 50, 100),
        offset: parseInt(offset as string) || 0,
      });

      res.json(tasks);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/:id/attempts',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = recordAttemptSchema.parse(req.body);

        const task = context.db.tasks.getById(id as any);
        if (!task) {
          throw new ApiError(404, 'NOT_FOUND', `Task ${id} not found`);
        }

        const attemptId = `att_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        context.db.transaction(() => {
          context.db.events.create({
            type: 'task:attempt-recorded',
            projectId: task.projectId,
            timestamp: new Date().toISOString(),
            data: {
              attemptId,
              taskId: id,
              startedAt: data.startedAt,
              completedAt: data.completedAt,
              exitCode: data.exitCode || null,
              output: data.output || null,
              error: data.error || null,
            },
          });
        });

        res.status(201).json({
          attemptId,
          taskId: id,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          exitCode: data.exitCode,
          error: data.error,
          recordedAt: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
