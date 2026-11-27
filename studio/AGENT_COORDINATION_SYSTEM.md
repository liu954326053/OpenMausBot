feat: multi-agent coordination system with lifecycle management

## Overview

This commit introduces a production-ready multi-agent coordination system for the Drama Studio, enabling collaborative AI workflows with sophisticated lifecycle management, state synchronization, and inter-agent communication.

## Architecture

### 1. Types (types.ts)
Core type definitions defining the protocol for all inter-agent interactions:
- **AgentState**: idle → running → (success/error/sleeping/shutdown)
- **MessageType**: 13 message types covering tasks, artifacts, state sync, coordination
- **Priority levels**: critical, high, normal, low for message processing
- **Delivery guarantees**: at-most-once, at-least-once, exactly-once
- **Coordination patterns**: dependency, collaboration, resource-allocation, state-sync

### 2. Registry & Factory (registry.ts)
Manages agent instance lifecycle and state:

**AgentRegistry**:
- Registration and unregistration of agent instances
- Role-based indexing for efficient agent discovery (O(1) lookup)
- Task assignment with capacity limits
- State management (idle, running, error, sleeping, shutdown)
- Error tracking and recovery
- Task tracking with success/failure counters

**AgentFactory**:
- Creates and registers agents with validation
- Enforces max agent limits
- Provides registry access for state inspection
- Reset capability for testing

### 3. Message Bus (messenger.ts)
Implements publish-subscribe messaging with routing:

**Publishing**:
- Priority-based queuing (4 priority levels)
- Automatic message ID generation
- TTL-based expiration
- History tracking for debugging

**Subscriptions**:
- Event type filtering
- Agent-specific filtering
- Custom filter predicates
- Handler registration with async support

**Processing**:
- Priority-aware queue processing
- Delivery guarantee enforcement
- Request-response pattern (sync coordination)
- Acknowledgement tracking

### 4. Coordinator (coordinator.ts)
Central orchestration hub tying all components together:

**Agent Management**:
- Create/shutdown agents with identity tracking
- Get agents by role for load distribution
- Find available agents for task assignment

**Task Flow**:
- Assign tasks to agents (respects capacity)
- Complete tasks with success/failure tracking
- Load balance across available agents
- Automatic metric recording

**Collaboration**:
- Submit coordination requests (broadcast or targeted)
- Respond to coordination with resource commitments
- Handle dependencies, collaboration needs, resource allocation

**Observability**:
- Health checks with response time tracking
- Per-agent metrics: tasks, success rate, error rate
- Message processing statistics
- State snapshots for debugging

**State Sync**:
- Periodic state synchronization (configurable interval)
- Event-driven updates
- Message-based state propagation

## Key Features

### 1. Task Management
```typescript
// Assign task to available agent
const agentId = coordinator.findAvailableAgent('writer');
coordinator.assignTask(taskId, agentId);

// Complete with success/failure
coordinator.completeTask(taskId, true); // success
coordinator.completeTask(taskId, false); // failure
```

### 2. Role-Based Agent Discovery
```typescript
const writers = coordinator.getAgentsByRole('writer');
const available = coordinator.findAvailableAgent('writer');
```

### 3. Health & Metrics
```typescript
const health = coordinator.getAgentHealth(agentId);
const metrics = coordinator.getAgentMetrics(agentId);

// Error rate calculation
const errorRate = metrics.failedTasks / metrics.totalTasksProcessed;
```

### 4. Coordination Patterns
```typescript
// Request collaboration from another agent
const requestId = coordinator.submitCoordinationRequest(
  initiatorId,
  'collaboration',
  { taskId, artifactIds: [...] },
  targetAgentId
);

// Respond with resource commitment
coordinator.respondToCoordinationRequest(
  requestId,
  responderId,
  true, // accept
  undefined, // no reason (accepted)
  { tasks: 2, memory: 256 } // commit resources
);
```

### 5. Priority-Based Messaging
Messages are processed in priority order:
1. Critical (highest priority)
2. High
3. Normal
4. Low (lowest priority)

Ensures urgent coordination requests are handled before routine updates.

## Testing Strategy

### Registry Tests (20+ tests)
- Agent registration/unregistration
- Role-based indexing
- Task assignment with capacity limits
- State transitions
- Error reporting and recovery
- Task completion tracking

### Integration Tests (24+ tests)
- Full agent lifecycle
- Task assignment and completion
- Role-based discovery
- Health monitoring
- Metrics calculation
- Coordination requests/responses
- Message processing

All tests are deterministic, use vitest, and don't require external dependencies.

## Configuration

```typescript
const config: AgentFactoryConfig = {
  projectDir: '/path/to/project',
  maxAgents: 10,
  messageBusCapacity: 1000,
  stateSync: {
    enabled: true,
    intervalMs: 5000,
    compressionEnabled: false
  }
};

const coordinator = new AgentCoordinator(config);
```

## Performance Characteristics

- Agent lookup: O(1) by ID, O(1) average by role
- Task assignment: O(1)
- Message routing: O(n) where n = matching subscribers
- State sync: O(agents) per sync cycle
- Memory: ~1KB per agent + message queue overhead

## Safety & Reliability

1. **Isolation**: Each agent has isolated task queues and limits
2. **Capacity Limits**: Max concurrent tasks per agent prevents overload
3. **Error Tracking**: Failed tasks tracked separately from successful ones
4. **Health Checks**: Periodic health verification with timeout
5. **Graceful Shutdown**: Proper cleanup on coordinator shutdown
6. **Message Delivery**: Configurable delivery guarantees (at-most-once, at-least-once, exactly-once)

## Future Enhancements

1. **Persistent State**: Save metrics and health to disk
2. **Agent Clustering**: Support for distributed agents
3. **Advanced Scheduling**: Priority scheduling, deadline tracking
4. **Performance Profiling**: Per-agent CPU/memory tracking
5. **Fault Recovery**: Automatic recovery from agent failures
6. **Message Compression**: Compress large state sync messages
7. **Dead Letter Queue**: Handle messages that can't be delivered

## Files Changed

- studio/src/service/runtime/agents/types.ts (232 lines) - Type definitions
- studio/src/service/runtime/agents/registry.ts (402 lines) - Agent registry & factory
- studio/src/service/runtime/agents/messenger.ts (361 lines) - Message bus
- studio/src/service/runtime/agents/coordinator.ts (505 lines) - Orchestration hub
- studio/src/service/runtime/agents/index.ts (10 lines) - Exports
- studio/src/service/runtime/agents/__tests__/registry.test.ts (320 lines) - Registry tests
- studio/src/service/runtime/agents/__tests__/integration.test.ts (253 lines) - Integration tests

**Total**: 2,083 lines of production code and tests

## Verification

All tests pass:
```bash
npm test -- studio/src/service/runtime/agents/
```

Branch: studio/api-design
Commit: a42c8f175
