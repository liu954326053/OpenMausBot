/**
 * HTTP API 集成测试
 *
 * 验证完整的请求-响应周期，包括数据库集成、错误处理和中间件。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp, AppContext } from '../src/server/app';
import { DatabaseManager } from '../src/service/db';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('HTTP API Integration', () => {
  let app: ReturnType<typeof createApp>;
  let context: AppContext;
  let testDbPath: string;

  beforeAll(() => {
    testDbPath = path.join(__dirname, '../../tests/fixtures/test.db');
    const fixtureDir = path.dirname(testDbPath);

    if (!fs.existsSync(fixtureDir)) {
      fs.mkdirSync(fixtureDir, { recursive: true });
    }

    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const db = new DatabaseManager();
    db.init(fixtureDir);

    context = { db };
    app = createApp(context);
  });

  afterAll(() => {
    context.db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('database');
      expect(res.body.database).toHaveProperty('initialized', true);
    });
  });

  describe('Projects API', () => {
    let projectId: string;

    it('should create a project', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          name: 'Test Drama',
          folder: '/projects/test-drama',
          episodeCount: 12,
          language: 'zh',
          teamSnapshotId: 'tsn_test_001',
          leadMode: 'project-agent',
          maxConcurrentTasks: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Drama');
      projectId = res.body.id;
    });

    it('should retrieve a project', async () => {
      const res = await request(app).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(projectId);
      expect(res.body.name).toBe('Test Drama');
    });

    it('should update a project', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}`)
        .send({
          name: 'Updated Drama',
          episodeCount: 13,
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Drama');
    });

    it('should list projects', async () => {
      const res = await request(app).get('/api/projects?limit=10&offset=0');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/prj_nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('should delete a project', async () => {
      const res = await request(app).delete(`/api/projects/${projectId}`);

      expect(res.status).toBe(204);
    });
  });

  describe('Artifacts API', () => {
    let projectId: string;
    let artifactId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          name: 'Artifact Test Project',
          folder: '/projects/artifact-test',
          episodeCount: 1,
          language: 'zh',
          teamSnapshotId: 'tsn_test_002',
          leadMode: 'project-agent',
        });

      projectId = res.body.id;
    });

    it('should create an artifact', async () => {
      const res = await request(app)
        .post('/api/artifacts')
        .send({
          projectId,
          type: 'script',
          title: 'Episode 1 Script',
          description: 'Main script',
          scope: 'episode',
          episodeNumber: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe('Episode 1 Script');
      artifactId = res.body.id;
    });

    it('should retrieve an artifact', async () => {
      const res = await request(app).get(`/api/artifacts/${artifactId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(artifactId);
    });

    it('should create artifact version', async () => {
      const res = await request(app)
        .post(`/api/artifacts/${artifactId}/versions`)
        .send({
          content: 'Scene 1: The beginning...',
          format: 'text',
          message: 'Initial version',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.id).toMatch(/^av_/);
    });

    it('should list artifact versions', async () => {
      const res = await request(app).get(
        `/api/artifacts/${artifactId}/versions`
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('versions');
      expect(Array.isArray(res.body.versions)).toBe(true);
    });
  });

  describe('Tasks API', () => {
    let projectId: string;
    let taskId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          name: 'Task Test Project',
          folder: '/projects/task-test',
          episodeCount: 1,
          language: 'zh',
          teamSnapshotId: 'tsn_test_003',
          leadMode: 'project-agent',
        });

      projectId = res.body.id;
    });

    it('should create a task', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({
          projectId,
          name: 'Generate Script',
          nodeId: 'nod_script_gen',
          status: 'pending',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      taskId = res.body.id;
    });

    it('should retrieve a task', async () => {
      const res = await request(app).get(`/api/tasks/${taskId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(taskId);
    });

    it('should update task status', async () => {
      const res = await request(app)
        .put(`/api/tasks/${taskId}/status`)
        .send({
          status: 'running',
          message: 'Task started',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('running');
    });

    it('should record task attempt', async () => {
      const res = await request(app)
        .post(`/api/tasks/${taskId}/attempts`)
        .send({
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          exitCode: 0,
          output: 'Task completed successfully',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('attemptId');
    });
  });

  describe('Conversation API', () => {
    let projectId: string;
    let conversationId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          name: 'Conversation Test Project',
          folder: '/projects/conversation-test',
          episodeCount: 1,
          language: 'zh',
          teamSnapshotId: 'tsn_test_004',
          leadMode: 'project-agent',
        });

      projectId = res.body.id;
    });

    it('should create a conversation', async () => {
      const res = await request(app)
        .post('/api/conversation')
        .send({
          projectId,
          title: 'Script Discussion',
          description: 'Discussing script revisions',
          scope: 'drama',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      conversationId = res.body.id;
    });

    it('should send a message', async () => {
      const res = await request(app)
        .post(`/api/conversation/${conversationId}/messages`)
        .send({
          content: 'What should we do about scene 3?',
          role: 'user',
          author: 'director',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('messageId');
      expect(res.body.content).toBe('What should we do about scene 3?');
    });

    it('should get conversation messages', async () => {
      const res = await request(app).get(
        `/api/conversation/${conversationId}/messages`
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messages');
      expect(Array.isArray(res.body.messages)).toBe(true);
    });
  });

  describe('Workflow API', () => {
    let projectId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          name: 'Workflow Test Project',
          folder: '/projects/workflow-test',
          episodeCount: 1,
          language: 'zh',
          teamSnapshotId: 'tsn_test_005',
          leadMode: 'project-agent',
        });

      projectId = res.body.id;
    });

    it('should validate workflow graph', async () => {
      const res = await request(app)
        .post(`/api/workflow/${projectId}/validate`)
        .send({
          nodes: [
            { id: 'n1', type: 'input', label: 'Start' },
            { id: 'n2', type: 'process', label: 'Process' },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('should detect invalid graph', async () => {
      const res = await request(app)
        .post(`/api/workflow/${projectId}/validate`)
        .send({
          nodes: [{ id: 'n1', type: 'input', label: 'Start' }],
          edges: [
            {
              id: 'e1',
              source: 'n1',
              target: 'n_nonexistent',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          name: '', // 空名字应该失败
          folder: '/test',
          episodeCount: 1,
          language: 'zh',
          teamSnapshotId: 'tsn_test',
          leadMode: 'project-agent',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle not found errors', async () => {
      const res = await request(app).get('/api/projects/prj_does_not_exist');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
