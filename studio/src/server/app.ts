/**
 * HTTP API 应用程序设置
 *
 * 漫剧工作室 HTTP API 服务器。集成 Express 框架，支持：
 * - REST 端点（项目、工作流、产物、任务、对话、事件）
 * - 请求校验与错误处理中间件
 * - SSE 实时事件流
 * - 数据库集成
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '@service/db';
import { projectRouter } from './routes/projects';
import { workflowRouter } from './routes/workflow';
import { artifactsRouter } from './routes/artifacts';
import { tasksRouter } from './routes/tasks';
import { conversationRouter } from './routes/conversation';
import { eventsRouter } from './routes/events';
import { errorHandler, ApiError } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';

export interface AppContext {
  db: DatabaseManager;
}

export function createApp(context: AppContext): Express {
  const app = express();

  app.use(express.json({ limit: '20mb' }));
  app.use(requestLogger);

  app.use('/api/projects', projectRouter(context));
  app.use('/api/workflow', workflowRouter(context));
  app.use('/api/artifacts', artifactsRouter(context));
  app.use('/api/tasks', tasksRouter(context));
  app.use('/api/conversation', conversationRouter(context));
  app.use('/api/events', eventsRouter(context));

  app.get('/api/health', (req: Request, res: Response) => {
    const health = context.db.health();
    res.json({
      status: health.isCompatible ? 'ok' : 'degraded',
      database: health,
    });
  });

  app.use(errorHandler);

  return app;
}
