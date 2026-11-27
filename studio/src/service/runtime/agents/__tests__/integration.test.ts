/**
 * Core integration tests for agent coordination system.
 * Tests registry, messaging, and coordinator together.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentCoordinator } from '../coordinator';
import type { AgentFactoryConfig, ProjectAgentId, TaskId } from '../../shared/types';

describe('Agent Coordination System', () => {
  let coordinator: AgentCoordinator;

  beforeEach(() => {
    const config: AgentFactoryConfig = {
      projectDir: '/test/project',
      maxAgents: 10,
      messageBusCapacity: 1000,
      stateSync: { enabled: false },
    };
    coordinator = new AgentCoordinator(config);
  });

  afterEach(() => {
    coordinator.shutdown();
  });

  describe('agent lifecycle', () => {
    it('should create agents with identities', () => {
      const id = 'pag_writer1' as ProjectAgentId;
      const identity = coordinator.createAgent(id, 'writer', 'Writer', ['write'], 2);

      expect(identity).toBeDefined();
      expect(identity?.name).toBe('Writer');
      expect(identity?.maxConcurrentTasks).toBe(2);
    });

    it('should track agents by role', () => {
      coordinator.createAgent('pag_writer1' as ProjectAgentId, 'writer', 'Writer 1', [], 1);
      coordinator.createAgent('pag_writer2' as ProjectAgentId, 'writer', 'Writer 2', [], 1);
      coordinator.createAgent('pag_editor1' as ProjectAgentId, 'editor', 'Editor', [], 1);

      const writers = coordinator.getAgentsByRole('writer');
      expect(writers).toHaveLength(2);
    });

    it('should shutdown agents', () => {
      const id = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(id, 'writer', 'Writer', [], 1);
      
      const result = coordinator.shutdownAgent(id);
      expect(result).toBe(true);
      
      const agents = coordinator.getActiveAgents();
      expect(agents.find(a => a.id === id)).toBeUndefined();
    });
  });

  describe('task management', () => {
    it('should assign tasks to agents', () => {
      const agentId = 'pag_writer1' as ProjectAgentId;
      const taskId = 'tsk_001' as TaskId;

      coordinator.createAgent(agentId, 'writer', 'Writer', [], 2);
      const result = coordinator.assignTask(taskId, agentId);

      expect(result).toBe(true);
    });

    it('should respect max concurrent tasks', () => {
      const agentId = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(agentId, 'writer', 'Writer', [], 1);

      coordinator.assignTask('tsk_001' as TaskId, agentId);
      const result = coordinator.assignTask('tsk_002' as TaskId, agentId);

      expect(result).toBe(false);
    });

    it('should track task completion', () => {
      const agentId = 'pag_writer1' as ProjectAgentId;
      const taskId = 'tsk_001' as TaskId;

      coordinator.createAgent(agentId, 'writer', 'Writer', [], 1);
      coordinator.assignTask(taskId, agentId);
      coordinator.completeTask(taskId, true);

      const metrics = coordinator.getAgentMetrics(agentId);
      expect(metrics?.successfulTasks).toBe(1);
    });

    it('should track task failures', () => {
      const agentId = 'pag_writer1' as ProjectAgentId;
      const taskId = 'tsk_001' as TaskId;

      coordinator.createAgent(agentId, 'writer', 'Writer', [], 1);
      coordinator.assignTask(taskId, agentId);
      coordinator.completeTask(taskId, false);

      const metrics = coordinator.getAgentMetrics(agentId);
      expect(metrics?.failedTasks).toBe(1);
      expect(metrics?.errorRate).toBe(1.0);
    });
  });

  describe('agent discovery', () => {
    it('should find available agents', () => {
      const id1 = 'pag_writer1' as ProjectAgentId;
      const id2 = 'pag_writer2' as ProjectAgentId;

      coordinator.createAgent(id1, 'writer', 'Writer 1', [], 1);
      coordinator.createAgent(id2, 'writer', 'Writer 2', [], 1);

      coordinator.assignTask('tsk_001' as TaskId, id1);

      const available = coordinator.findAvailableAgent('writer');
      expect(available).toBe(id2);
    });

    it('should return undefined when no agents available', () => {
      const id = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(id, 'writer', 'Writer', [], 1);
      coordinator.assignTask('tsk_001' as TaskId, id);

      const available = coordinator.findAvailableAgent('writer');
      expect(available).toBeUndefined();
    });
  });

  describe('health monitoring', () => {
    it('should initialize health tracking', () => {
      const id = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(id, 'writer', 'Writer', [], 1);

      const health = coordinator.getAgentHealth(id);
      expect(health).toBeDefined();
      expect(health?.healthy).toBe(true);
      expect(health?.state).toBe('idle');
    });

    it('should track all agent health', () => {
      coordinator.createAgent('pag_writer1' as ProjectAgentId, 'writer', 'Writer', [], 1);
      coordinator.createAgent('pag_editor1' as ProjectAgentId, 'editor', 'Editor', [], 1);

      const allHealth = coordinator.getAllAgentHealth();
      expect(allHealth.size).toBe(2);
    });
  });

  describe('metrics tracking', () => {
    it('should initialize metrics', () => {
      const id = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(id, 'writer', 'Writer', [], 1);

      const metrics = coordinator.getAgentMetrics(id);
      expect(metrics).toBeDefined();
      expect(metrics?.totalTasksProcessed).toBe(0);
      expect(metrics?.successfulTasks).toBe(0);
    });

    it('should track all agent metrics', () => {
      coordinator.createAgent('pag_writer1' as ProjectAgentId, 'writer', 'Writer', [], 1);
      coordinator.createAgent('pag_editor1' as ProjectAgentId, 'editor', 'Editor', [], 1);

      const allMetrics = coordinator.getAllAgentMetrics();
      expect(allMetrics.size).toBe(2);
    });

    it('should calculate error rates', () => {
      const id = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(id, 'writer', 'Writer', [], 2);

      coordinator.assignTask('tsk_001' as TaskId, id);
      coordinator.completeTask('tsk_001' as TaskId, false);

      coordinator.assignTask('tsk_002' as TaskId, id);
      coordinator.completeTask('tsk_002' as TaskId, true);

      const metrics = coordinator.getAgentMetrics(id);
      expect(metrics?.totalTasksProcessed).toBe(2);
      expect(metrics?.failedTasks).toBe(1);
      expect(metrics?.successfulTasks).toBe(1);
      expect(metrics?.errorRate).toBe(0.5);
    });
  });

  describe('message processing', () => {
    it('should process queued messages', async () => {
      const id = 'pag_writer1' as ProjectAgentId;
      coordinator.createAgent(id, 'writer', 'Writer', [], 1);

      const processed = await coordinator.processMessages();
      expect(typeof processed).toBe('number');
      expect(processed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shutdown', () => {
    it('should shutdown coordinator and cleanup', () => {
      coordinator.createAgent('pag_writer1' as ProjectAgentId, 'writer', 'Writer', [], 1);
      coordinator.createAgent('pag_editor1' as ProjectAgentId, 'editor', 'Editor', [], 1);

      coordinator.shutdown();

      const agents = coordinator.getActiveAgents();
      expect(agents).toHaveLength(0);
    });
  });

  describe('coordination', () => {
    it('should submit coordination requests', () => {
      const initiator = 'pag_writer1' as ProjectAgentId;
      const target = 'pag_editor1' as ProjectAgentId;

      coordinator.createAgent(initiator, 'writer', 'Writer', [], 1);
      coordinator.createAgent(target, 'editor', 'Editor', [], 1);

      const requestId = coordinator.submitCoordinationRequest(
        initiator,
        'collaboration',
        { taskId: 'tsk_001' as any },
        target
      );

      expect(requestId).toMatch(/^coord_/);
    });

    it('should respond to coordination requests', () => {
      const initiator = 'pag_writer1' as ProjectAgentId;
      const responder = 'pag_editor1' as ProjectAgentId;

      coordinator.createAgent(initiator, 'writer', 'Writer', [], 1);
      coordinator.createAgent(responder, 'editor', 'Editor', [], 1);

      const requestId = coordinator.submitCoordinationRequest(
        initiator,
        'collaboration',
        { taskId: 'tsk_001' as any },
        responder
      );

      const response = coordinator.respondToCoordinationRequest(
        requestId,
        responder,
        true,
        undefined,
        { tasks: 1 }
      );

      expect(response).toBe(true);
    });
  });
});
