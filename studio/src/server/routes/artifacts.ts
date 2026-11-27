/**
 * 产物与版本管理路由
 *
 * REST 端点：
 * - POST   /api/artifacts                 创建产物
 * - GET    /api/artifacts/:id             获取产物
 * - PUT    /api/artifacts/:id             更新产物元数据
 * - DELETE /api/artifacts/:id             删除产物
 * - GET    /api/artifacts/:id/versions    获取版本历史
 * - POST   /api/artifacts/:id/versions    创建新版本
 * - GET    /api/artifacts/:id/versions/:versionId   获取特定版本
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { ApiError } from '../middleware/error-handler';

const createArtifactSchema = z.object({
  projectId: z.string(),
  type: z.enum([
    'source',
    'brief',
    'plan',
    'script',
    'episode',
    'character',
    'scene',
    'shot',
    'take',
    'final',
  ]),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  scope: z.enum(['drama', 'episode']).optional(),
  episodeNumber: z.number().int().min(1).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateArtifactSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const createVersionSchema = z.object({
  content: z.string().or(z.instanceof(Buffer)),
  format: z.string().optional(),
  message: z.string().optional(),
  inputPinVersionIds: z.array(z.string()).optional(),
});

export function artifactsRouter(context: AppContext): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createArtifactSchema.parse(req.body);

      const artifactId = `art_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const artifact = context.db.artifacts.create({
        id: artifactId as any,
        projectId: data.projectId as any,
        type: data.type as any,
        title: data.title,
        description: data.description || null,
        scope: data.scope || 'drama',
        episodeNumber: data.episodeNumber || null,
        metadata: data.metadata || {},
      });

      res.status(201).json(artifact);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const artifact = context.db.artifacts.getById(id as any);

      if (!artifact) {
        throw new ApiError(404, 'NOT_FOUND', `Artifact ${id} not found`);
      }

      res.json(artifact);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = updateArtifactSchema.parse(req.body);

        const existing = context.db.artifacts.getById(id as any);
        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Artifact ${id} not found`);
        }

        const updated = context.db.artifacts.update(id as any, {
          title: data.title ?? existing.title,
          description: data.description ?? existing.description,
          metadata: data.metadata ?? existing.metadata,
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
        const existing = context.db.artifacts.getById(id as any);

        if (!existing) {
          throw new ApiError(404, 'NOT_FOUND', `Artifact ${id} not found`);
        }

        context.db.artifacts.delete(id as any);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    '/:id/versions',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const artifact = context.db.artifacts.getById(id as any);

        if (!artifact) {
          throw new ApiError(404, 'NOT_FOUND', `Artifact ${id} not found`);
        }

        const versions = context.db.artifacts.listVersions(id as any);

        res.json({
          artifactId: id,
          versions: versions || [],
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/:id/versions',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const data = createVersionSchema.parse(req.body);

        const artifact = context.db.artifacts.getById(id as any);
        if (!artifact) {
          throw new ApiError(404, 'NOT_FOUND', `Artifact ${id} not found`);
        }

        const versionId = `av_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        context.db.transaction(() => {
          context.db.artifacts.createVersion({
            id: versionId as any,
            artifactId: id as any,
            content: data.content,
            format: data.format || 'text',
            message: data.message || 'Version created via API',
            inputPinVersionIds: (data.inputPinVersionIds || []) as any,
          });
        });

        const version = context.db.artifacts.getVersion(versionId as any);

        res.status(201).json(version);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    '/:id/versions/:versionId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id, versionId } = req.params;

        const artifact = context.db.artifacts.getById(id as any);
        if (!artifact) {
          throw new ApiError(404, 'NOT_FOUND', `Artifact ${id} not found`);
        }

        const version = context.db.artifacts.getVersion(versionId as any);
        if (!version || version.artifactId !== id) {
          throw new ApiError(404, 'NOT_FOUND', `Version ${versionId} not found`);
        }

        res.json(version);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
