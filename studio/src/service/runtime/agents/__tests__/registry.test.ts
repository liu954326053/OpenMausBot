/**
 * Unit tests for AgentRegistry and AgentFactory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry, AgentFactory } from '../registry.js';
import type { ProjectAgentId, AgentFactoryConfig } from '../../shared/types.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    const config: AgentFactoryConfig = {
      projectDir: '/test/project',
    };
    registry = new AgentRegistry(config);
  });

  describe('register', () => {
    it('should register a new agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      const result = registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Script Writer',
        version: '1.0.0',
        capabilities: ['write', 'edit'],
        maxConcurrentTasks: 2,
      });

      expect(result).toBe(true);
      expect(registry.get(agentId)).toBeDefined();
    });

    it('should not register duplicate agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      const identity = {
        id: agentId,
        roleKey: 'writer',
        name: 'Script Writer',
        version: '1.0.0',
        capabilities: ['write'],
        maxConcurrentTasks: 1,
      };

      registry.register(identity);
      const result = registry.register(identity);

      expect(result).toBe(false);
    });

    it('should index agents by role', () => {
      const id1 = 'pag_writer1' as ProjectAgentId;
      const id2 = 'pag_writer2' as ProjectAgentId;

      registry.register({
        id: id1,
        roleKey: 'writer',
        name: 'Writer 1',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      registry.register({
        id: id2,
        roleKey: 'writer',
        name: 'Writer 2',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      const writers = registry.getByRole('writer');
      expect(writers).toHaveLength(2);
      expect(writers.map(w => w.id)).toContain(id1);
      expect(writers.map(w => w.id)).toContain(id2);
    });
  });

  describe('task management', () => {
    it('should assign task to agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 2,
      });

      const result = registry.assignTask('tsk_001', agentId);
      expect(result).toBe(true);

      const snapshot = registry.getStateSnapshot(agentId);
      expect(snapshot?.activeTasks).toContain('tsk_001');
    });

    it('should not exceed max concurrent tasks', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      registry.assignTask('tsk_001', agentId);
      const result = registry.assignTask('tsk_002', agentId);

      expect(result).toBe(false);
    });

    it('should remove task from agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 2,
      });

      registry.assignTask('tsk_001', agentId);
      registry.removeTask('tsk_001', true);

      const snapshot = registry.getStateSnapshot(agentId);
      expect(snapshot?.activeTasks).not.toContain('tsk_001');
      expect(snapshot?.completedTasks).toBe(1);
    });

    it('should track failed tasks', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 2,
      });

      registry.assignTask('tsk_001', agentId);
      registry.removeTask('tsk_001', false);

      const snapshot = registry.getStateSnapshot(agentId);
      expect(snapshot?.failedTasks).toBe(1);
    });
  });

  describe('state management', () => {
    it('should update agent state', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      registry.setState(agentId, 'running');
      const snapshot = registry.getStateSnapshot(agentId);

      expect(snapshot?.state).toBe('running');
    });

    it('should report and clear errors', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      registry.reportError(agentId, { code: 'TEST_ERROR', message: 'Test error' });
      let snapshot = registry.getStateSnapshot(agentId);

      expect(snapshot?.state).toBe('error');
      expect(snapshot?.error).toBeDefined();

      registry.clearError(agentId);
      snapshot = registry.getStateSnapshot(agentId);

      expect(snapshot?.state).toBe('idle');
      expect(snapshot?.error).toBeUndefined();
    });

    it('should check availability', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      expect(registry.isAvailable(agentId)).toBe(true);

      registry.assignTask('tsk_001', agentId);
      expect(registry.isAvailable(agentId)).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should unregister an agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 1,
      });

      const result = registry.unregister(agentId);
      expect(result).toBe(true);
      expect(registry.get(agentId)).toBeUndefined();
    });

    it('should clean up task mappings on unregister', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      registry.register({
        id: agentId,
        roleKey: 'writer',
        name: 'Writer',
        version: '1.0.0',
        capabilities: [],
        maxConcurrentTasks: 2,
      });

      registry.assignTask('tsk_001', agentId);
      registry.unregister(agentId);

      expect(registry.getTaskAgent('tsk_001')).toBeUndefined();
    });
  });
});

describe('AgentFactory', () => {
  let factory: AgentFactory;

  beforeEach(() => {
    const config: AgentFactoryConfig = {
      projectDir: '/test/project',
      maxAgents: 10,
    };
    factory = new AgentFactory(config);
  });

  describe('createAgent', () => {
    it('should create an agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      const result = factory.createAgent(agentId, 'writer', 'Script Writer', ['write'], 2);

      expect(result.error).toBeUndefined();
      expect(result.identity).toBeDefined();
      expect(result.identity.name).toBe('Script Writer');
    });

    it('should respect max agents limit', () => {
      const config: AgentFactoryConfig = {
        projectDir: '/test/project',
        maxAgents: 1,
      };
      const limitedFactory = new AgentFactory(config);

      limitedFactory.createAgent('pag_test1' as ProjectAgentId, 'writer', 'Writer 1', [], 1);
      const result = limitedFactory.createAgent('pag_test2' as ProjectAgentId, 'editor', 'Editor 1', [], 1);

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('MAX_AGENTS_EXCEEDED');
    });
  });

  describe('shutdownAgent', () => {
    it('should shutdown an agent', () => {
      const agentId = 'pag_test1' as ProjectAgentId;
      factory.createAgent(agentId, 'writer', 'Writer', [], 1);

      const result = factory.shutdownAgent(agentId);
      expect(result).toBe(true);

      const registry = factory.getRegistry();
      expect(registry.get(agentId)).toBeUndefined();
    });
  });

  describe('getRegistry', () => {
    it('should return the registry', () => {
      const registry = factory.getRegistry();
      expect(registry).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset all agents', () => {
      factory.createAgent('pag_test1' as ProjectAgentId, 'writer', 'Writer', [], 1);
      
      let registry = factory.getRegistry();
      expect(registry.listAll()).toHaveLength(1);

      factory.reset();
      registry = factory.getRegistry();
      expect(registry.listAll()).toHaveLength(0);
    });
  });
});
