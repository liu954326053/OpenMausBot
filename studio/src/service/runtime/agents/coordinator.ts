/**
 * Agent coordinator for orchestrating multi-agent collaboration.
 * Manages task distribution, state synchronization, and inter-agent coordination.
 */

import { randomUUID } from 'crypto';
import type {
  AgentIdentity,
  AgentStateSnapshot,
  CoordinationRequest,
  CoordinationResponse,
  AgentHealth,
  AgentMetrics,
  AgentFactoryConfig,
  AgentMessage,
} from './types.js';
import type { ProjectAgentId, TaskId } from '../../shared/types.js';
import { AgentFactory } from './registry.js';
import { MessageBus } from './messenger.js';

/**
 * Central coordinator for multi-agent systems.
 */
export class AgentCoordinator {
  private factory: AgentFactory;
  private messageBus: MessageBus;
  private config: AgentFactoryConfig;
  private healthChecks: Map<ProjectAgentId, AgentHealth> = new Map();
  private metrics: Map<ProjectAgentId, AgentMetrics> = new Map();
  private coordinationRequests: Map<string, CoordinationRequest> = new Map();
  private coordinationResponses: Map<string, CoordinationResponse> = new Map();
  private syncIntervalId?: NodeJS.Timeout;

  constructor(config: AgentFactoryConfig) {
    this.config = config;
    this.factory = new AgentFactory(config);
    this.messageBus = new MessageBus(config.messageBusCapacity || 1000);

    this.initializeMessageHandlers();
    this.startStateSynchronization();
  }

  /**
   * Initializes message handlers for the message bus.
   */
  private initializeMessageHandlers(): void {
    // Handle task completion messages
    this.messageBus.subscribe(
      ['task.completed', 'task.failed'],
      (msg) => this.handleTaskStatusChange(msg)
    );

    // Handle coordination requests
    this.messageBus.subscribe(
      ['coordination.request'],
      (msg) => this.handleCoordinationRequest(msg)
    );

    // Handle health checks
    this.messageBus.subscribe(
      ['health.check'],
      (msg) => this.handleHealthCheck(msg)
    );
  }

  /**
   * Starts periodic state synchronization if configured.
   */
  private startStateSynchronization(): void {
    if (!this.config.stateSync?.enabled) {
      return;
    }

    const intervalMs = this.config.stateSync.intervalMs || 5000;

    this.syncIntervalId = setInterval(async () => {
      await this.synchronizeState();
    }, intervalMs);
  }

  /**
   * Stops state synchronization.
   */
  stopStateSynchronization(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = undefined;
    }
  }

  /**
   * Creates a new agent instance and registers it.
   * @param agentId - Agent ID
   * @param roleKey - Role key
   * @param name - Agent name
   * @param capabilities - Agent capabilities
   * @param maxConcurrentTasks - Max concurrent tasks
   * @returns Agent identity
   */
  createAgent(
    agentId: ProjectAgentId,
    roleKey: string,
    name: string,
    capabilities: string[] = [],
    maxConcurrentTasks: number = 1
  ): AgentIdentity | null {
    const result = this.factory.createAgent(
      agentId,
      roleKey,
      name,
      capabilities,
      maxConcurrentTasks
    );

    if (!result.error) {
      this.initializeAgentMetrics(agentId);
      this.initializeAgentHealth(agentId);
      return result.identity;
    }

    return null;
  }

  /**
   * Shuts down an agent and unregisters it.
   * @param agentId - Agent ID
   * @returns true if shut down
   */
  shutdownAgent(agentId: ProjectAgentId): boolean {
    return this.factory.shutdownAgent(agentId);
  }

  /**
   * Gets all active agents.
   * @returns Array of agent identities
   */
  getActiveAgents(): AgentIdentity[] {
    return this.factory.getRegistry().listAll();
  }

  /**
   * Gets agents with a specific role.
   * @param roleKey - Role key
   * @returns Array of agent identities
   */
  getAgentsByRole(roleKey: string): AgentIdentity[] {
    return this.factory.getRegistry().getByRole(roleKey);
  }

  /**
   * Assigns a task to an agent.
   * @param taskId - Task ID
   * @param agentId - Agent ID
   * @returns true if assigned
   */
  assignTask(taskId: TaskId, agentId: ProjectAgentId): boolean {
    const result = this.factory.getRegistry().assignTask(taskId, agentId);

    if (result) {
      this.recordMetric(agentId, { type: 'task_assigned' });
    }

    return result;
  }

  /**
   * Records task completion.
   * @param taskId - Task ID
   * @param success - Whether successful
   * @returns true if removed
   */
  completeTask(taskId: TaskId, success: boolean = true): boolean {
    const removed = this.factory.getRegistry().removeTask(taskId, success);

    if (removed) {
      const agentId = this.factory.getRegistry().getTaskAgent(taskId);
      if (agentId) {
        this.recordMetric(agentId, {
          type: success ? 'task_completed' : 'task_failed',
        });
      }
    }

    return removed;
  }

  /**
   * Finds an available agent for a task.
   * @param roleKey - Role key
   * @returns Agent ID or undefined
   */
  findAvailableAgent(roleKey: string): ProjectAgentId | undefined {
    const agents = this.getAgentsByRole(roleKey);
    const registry = this.factory.getRegistry();

    for (const agent of agents) {
      if (registry.isAvailable(agent.id)) {
        return agent.id;
      }
    }

    return undefined;
  }

  /**
   * Submits a coordination request.
   * @param initiator - Initiating agent
   * @param kind - Coordination kind
   * @param targetAgent - Target agent (optional for broadcast)
   * @param data - Request data
   * @returns Coordination request ID
   */
  submitCoordinationRequest(
    initiator: ProjectAgentId,
    kind: 'dependency' | 'collaboration' | 'resource-allocation' | 'state-sync',
    data: CoordinationRequest['data'],
    targetAgent?: ProjectAgentId
  ): string {
    const requestId = `coord_${randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30000).toISOString(); // 30s TTL

    const request: CoordinationRequest = {
      id: requestId,
      initiator,
      target: targetAgent,
      broadcast: !targetAgent,
      kind,
      data,
      createdAt: now as any,
      expiresAt: expiresAt as any,
    };

    this.coordinationRequests.set(requestId, request);

    const message: AgentMessage = {
      id: `msg_${randomUUID()}`,
      type: 'coordination.request',
      fromAgent: initiator,
      toAgent: targetAgent,
      broadcast: !targetAgent,
      priority: 'high',
      timestamp: now as any,
      deliveryGuarantee: 'at-least-once',
      payload: request,
    };

    this.messageBus.publish(message);

    return requestId;
  }

  /**
   * Responds to a coordination request.
   * @param requestId - Request ID
   * @param respondent - Responding agent
   * @param accepted - Whether request is accepted
   * @param reason - Optional reason for rejection
   * @param committedResources - Resources being committed
   * @returns true if response sent
   */
  respondToCoordinationRequest(
    requestId: string,
    respondent: ProjectAgentId,
    accepted: boolean,
    reason?: string,
    committedResources?: { tasks?: number; memory?: number; duration?: number }
  ): boolean {
    const request = this.coordinationRequests.get(requestId);
    if (!request) {
      return false;
    }

    const responseId = `coordresp_${randomUUID()}`;
    const response: CoordinationResponse = {
      requestId,
      respondent,
      accepted,
      reason,
      committedResources,
      respondedAt: new Date().toISOString() as any,
    };

    this.coordinationResponses.set(responseId, response);

    const message: AgentMessage = {
      id: `msg_${randomUUID()}`,
      type: 'coordination.response',
      fromAgent: respondent,
      toAgent: request.initiator,
      priority: 'high',
      timestamp: new Date().toISOString() as any,
      deliveryGuarantee: 'at-least-once',
      payload: response,
      correlationId: requestId,
    };

    this.messageBus.publish(message);

    return true;
  }

  /**
   * Synchronizes state across all agents.
   */
  private async synchronizeState(): Promise<void> {
    const agents = this.getActiveAgents();

    for (const agent of agents) {
      const snapshot = this.factory.getRegistry().getStateSnapshot(agent.id);
      if (snapshot) {
        const message: AgentMessage = {
          id: `msg_${randomUUID()}`,
          type: 'state.sync',
          fromAgent: agent.id,
          broadcast: true,
          priority: 'normal',
          timestamp: new Date().toISOString() as any,
          deliveryGuarantee: 'at-most-once',
          payload: snapshot,
        };

        this.messageBus.publish(message);
      }
    }

    await this.messageBus.processQueue();
  }

  /**
   * Handles task status change messages.
   */
  private handleTaskStatusChange(msg: AgentMessage): void {
    // Log and update metrics based on task completion
    if (msg.type === 'task.completed') {
      this.recordMetric(msg.fromAgent, { type: 'message_received' });
    }
  }

  /**
   * Handles coordination requests.
   */
  private handleCoordinationRequest(msg: AgentMessage): void {
    this.recordMetric(msg.fromAgent, { type: 'coordination_request' });
  }

  /**
   * Handles health check messages.
   */
  private handleHealthCheck(msg: AgentMessage): void {
    if (msg.fromAgent) {
      const health = this.healthChecks.get(msg.fromAgent);
      if (health) {
        health.lastHeartbeat = new Date().toISOString() as any;
        health.healthy = true;
        health.responseTimeMs = Date.now() - new Date(msg.timestamp).getTime();
      }
    }
  }

  /**
   * Performs health check on all agents.
   * @returns Map of agent health
   */
  async performHealthCheck(): Promise<Map<ProjectAgentId, AgentHealth>> {
    const agents = this.getActiveAgents();
    const start = Date.now();

    for (const agent of agents) {
      const message: AgentMessage = {
        id: `msg_${randomUUID()}`,
        type: 'health.check',
        fromAgent: agent.id as any,
        toAgent: agent.id,
        priority: 'high',
        timestamp: new Date().toISOString() as any,
        deliveryGuarantee: 'at-most-once',
        payload: {},
      };

      await this.messageBus.request(message, 2000);
    }

    return this.healthChecks;
  }

  /**
   * Gets health status of an agent.
   * @param agentId - Agent ID
   * @returns Agent health or undefined
   */
  getAgentHealth(agentId: ProjectAgentId): AgentHealth | undefined {
    return this.healthChecks.get(agentId);
  }

  /**
   * Gets all agent health statuses.
   * @returns Map of agent health
   */
  getAllAgentHealth(): Map<ProjectAgentId, AgentHealth> {
    return new Map(this.healthChecks);
  }

  /**
   * Gets metrics for an agent.
   * @param agentId - Agent ID
   * @returns Agent metrics or undefined
   */
  getAgentMetrics(agentId: ProjectAgentId): AgentMetrics | undefined {
    return this.metrics.get(agentId);
  }

  /**
   * Gets all agent metrics.
   * @returns Map of agent metrics
   */
  getAllAgentMetrics(): Map<ProjectAgentId, AgentMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Processes queued messages (should be called regularly).
   * @returns Number of messages processed
   */
  async processMessages(): Promise<number> {
    return this.messageBus.processQueue();
  }

  /**
   * Initializes health tracking for an agent.
   */
  private initializeAgentHealth(agentId: ProjectAgentId): void {
    this.healthChecks.set(agentId, {
      agentId,
      healthy: true,
      state: 'idle',
      lastHeartbeat: new Date().toISOString() as any,
      errorCount: 0,
      consecutiveErrors: 0,
    });
  }

  /**
   * Initializes metrics for an agent.
   */
  private initializeAgentMetrics(agentId: ProjectAgentId): void {
    this.metrics.set(agentId, {
      agentId,
      totalTasksProcessed: 0,
      successfulTasks: 0,
      failedTasks: 0,
      averageTaskDurationMs: 0,
      errorRate: 0,
      uptime: 0,
      messagesReceived: 0,
      messagesSent: 0,
      averageMessageLatencyMs: 0,
      resourceUsagePercent: 0,
    });
  }

  /**
   * Records a metric event.
   */
  private recordMetric(agentId: ProjectAgentId, event: { type: string }): void {
    const metrics = this.metrics.get(agentId);
    if (!metrics) {
      return;
    }

    switch (event.type) {
      case 'task_assigned':
        metrics.totalTasksProcessed++;
        break;
      case 'task_completed':
        metrics.successfulTasks++;
        break;
      case 'task_failed':
        metrics.failedTasks++;
        break;
      case 'message_received':
        metrics.messagesReceived++;
        break;
    }

    if (metrics.totalTasksProcessed > 0) {
      metrics.errorRate = metrics.failedTasks / metrics.totalTasksProcessed;
    }
  }

  /**
   * Shuts down the coordinator.
   */
  shutdown(): void {
    this.stopStateSynchronization();
    
    for (const agent of this.getActiveAgents()) {
      this.shutdownAgent(agent.id);
    }
    
    this.factory.reset();
    this.messageBus.clear();
  }
}
