/**
 * 工作流图管理路由
 *
 * REST 端点：
 * - GET    /api/workflow/:projectId/graph      获取工作流图
 * - PUT    /api/workflow/:projectId/graph      更新工作流图
 * - POST   /api/workflow/:projectId/validate   校验工作流图
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { ApiError } from '../middleware/error-handler';

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.any()).optional(),
  config: z.record(z.any()).optional(),
});

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

const graphSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  metadata: z.object({
    version: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
});

export function workflowRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    '/:projectId/graph',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { projectId } = req.params;

        const project = context.db.projects.getById(projectId as any);
        if (!project) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${projectId} not found`);
        }

        const graph = context.db.events.getWorkflowGraph(projectId as any);

        res.json({
          projectId,
          graph: graph || {
            nodes: [],
            edges: [],
            metadata: { version: '1.0' },
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.put(
    '/:projectId/graph',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { projectId } = req.params;
        const payload = graphSchema.parse(req.body);

        const project = context.db.projects.getById(projectId as any);
        if (!project) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${projectId} not found`);
        }

        const graphVersionId = `gph_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        context.db.transaction(() => {
          context.db.events.create({
            type: 'workflow:graph-updated',
            projectId: projectId as any,
            timestamp: new Date().toISOString(),
            data: {
              graphVersionId,
              graph: payload,
              author: 'api-client',
            },
          });
        });

        res.json({
          projectId,
          graphVersionId,
          graph: payload,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    '/:projectId/validate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { projectId } = req.params;
        const payload = graphSchema.parse(req.body);

        const project = context.db.projects.getById(projectId as any);
        if (!project) {
          throw new ApiError(404, 'NOT_FOUND', `Project ${projectId} not found`);
        }

        const errors: string[] = [];
        const warnings: string[] = [];

        // 检查节点连接性
        const nodeIds = new Set(payload.nodes.map((n) => n.id));
        for (const edge of payload.edges) {
          if (!nodeIds.has(edge.source)) {
            errors.push(`Edge references non-existent source node: ${edge.source}`);
          }
          if (!nodeIds.has(edge.target)) {
            errors.push(`Edge references non-existent target node: ${edge.target}`);
          }
        }

        // 检查孤立节点
        const connectedNodes = new Set<string>();
        for (const edge of payload.edges) {
          connectedNodes.add(edge.source);
          connectedNodes.add(edge.target);
        }

        for (const node of payload.nodes) {
          if (!connectedNodes.has(node.id)) {
            warnings.push(`Node ${node.id} is not connected`);
          }
        }

        res.json({
          valid: errors.length === 0,
          errors,
          warnings,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
