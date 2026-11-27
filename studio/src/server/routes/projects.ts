/**
 * 项目管理路由
 *
 * REST 端点：
 * - POST   /api/projects          创建项目
 * - GET    /api/projects/:id      获取项目
 * - PUT    /api/projects/:id      更新项目
 * - DELETE /api/projects/:id      删除项目
 * - GET    /api/projects          列出项目
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { ApiError } from '../middleware/error-handler';

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  folder: z.string().min(1),
  episodeCount: z.number().int().min(1),
  language: z.enum(['zh', 'en']),
  teamSnapshotId: z.string(),
  sourceTeamPresetId: z.string().optional().nullable(),
  leadMode: z.enum(['project-agent', 'main-agent']),
  leadProjectAgentId: z.string().optional().nullable(),
  maxConcurrentTasks: z.number().int().min(1).optional(),
  networkPerAgent: z.boolean().optional(),
});

const updateProjectSchema = createProjectSchema.partial();

export function projectRouter(context: AppContext): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createProjectSchema.parse(req.body);

      const projectId = `prj_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const project = context.db.projects.create({
        id: projectId as any,
        name: data.name,
        folder: data.folder,
        teamSnapshotId: data.teamSnapshotId as any,
        sourceTeamPresetId: data.sourceTeamPresetId as any,
        leadMode: data.leadMode,
        leadProjectAgentId: data.leadProjectAgentId as any,
        episodeCount: data.episodeCount,
        language: data.language,
        coverArtifactId: null,
        maxConcurrentTasks: data.maxConcurrentTasks,
        networkPerAgent: data.networkPerAgent,
      });

      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const project = context.db.projects.getById(id as any);

      if (!project) {
        throw new ApiError(404, 'NOT_FOUND', `Project ${id} not found`);
      }

      res.json(project);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = updateProjectSchema.parse(req.body);

        const existing = context.db.projects.getById(id as any);
        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${id} not found`);
        }

        const updated = context.db.projects.update(id as any, {
          name: data.name ?? existing.name,
          episodeCount: data.episodeCount ?? existing.episodeCount,
          language: data.language ?? existing.language,
          maxConcurrentTasks: data.maxConcurrentTasks ?? existing.settings.maxConcurrentTasks,
          networkPerAgent: data.networkPerAgent ?? existing.settings.networkPerAgent,
        });

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
        const existing = context.db.projects.getById(id as any);

        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${id} not found`);
        }

        context.db.projects.delete(id as any);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const projects = context.db.projects.list({
        limit,
        offset,
        includeDeleted: false,
      });

      res.json(projects);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
