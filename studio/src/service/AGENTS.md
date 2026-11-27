# Business Services Layer (M1.9)

## Overview

This directory contains the business services layer, which mediates between the HTTP API layer (M1.7) and the SQLite database layer (M1.8).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ HTTP API Routes (M1.7)                                  │
└─────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────┐
│ Business Services Layer (M1.9) - this directory         │
│ ├─ ProjectService      (projects/)                      │
│ ├─ ArtifactService     (artifacts/)                     │
│ ├─ TaskService         (tasks/)                         │
│ ├─ ConversationService (conversations/)                 │
│ └─ EventService        (events/)                        │
└─────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────┐
│ SQLite Data Persistence (M1.8)                          │
│ ├─ ProjectRepository                                    │
│ ├─ ArtifactRepository                                   │
│ ├─ TaskRepository                                       │
│ └─ EventRepository                                      │
└─────────────────────────────────────────────────────────┘
```

## Services

### ProjectService (`projects/index.ts`)

**Responsibilities:**
- Project creation, archival, deletion
- Project queries and statistics
- Activity timestamp management
- Event publishing

**Key Methods:**
- `create(input)` - Create new project
- `getById(id)` - Fetch project by ID
- `update(id, input)` - Update project settings
- `archive(id)` - Soft-delete project
- `getStats(projectId)` - Gather project statistics

### ArtifactService (`artifacts/index.ts`)

**Responsibilities:**
- Artifact creation and management
- Version management (create, compare, select)
- Status transitions
- Event publishing

**Key Methods:**
- `create(input)` - Create artifact
- `createVersion(input)` - Add new version
- `selectVersion(artifactId, versionId)` - Mark version as selected
- `compareVersions(versionA, versionB)` - Compare two versions
- `updateStatus(id, status)` - Change artifact status
- `delete(id)` / `restore(id)` - Soft-delete and restore

### TaskService (`tasks/index.ts`)

**Responsibilities:**
- Task lifecycle management (create, track, cancel)
- Status transitions with validation
- Error handling
- Gate confirmation workflow
- Event publishing

**Key Methods:**
- `create(input)` - Create task
- `updateStatus(id, status)` - Update task status
- `cancel(id)` - Cancel task with validation
- `setError(id, error)` - Record task failure
- `requestGateConfirmation(id)` - Request manual approval
- `confirmGate(id)` - Approve task continuation
- `addOutputVersion(taskId, versionId)` - Link output artifact
- `createAttempt(taskId, attempt, logPath)` - Start execution attempt

### ConversationService (`conversations/index.ts`)

**Responsibilities:**
- Conversation CRUD
- Message append and truncation
- Conversation archival
- Export to structured format
- Event publishing

**Key Methods:**
- `create(input)` - Create conversation
- `appendMessage(input)` - Add message to conversation
- `truncateAfterSeq(id, seq)` - Delete messages after sequence
- `export(id)` - Export as ConversationExport
- `archive(id)` - Mark as archived
- `delete(id)` - Soft-delete

### EventService (`events/index.ts`)

**Responsibilities:**
- Event log persistence
- Subscription management
- SSE stream generation
- Event querying and filtering

**Key Methods:**
- `publish(input)` - Write event to log
- `subscribe(input)` - Register listener
- `unsubscribe(id)` - Remove listener
- `getRange(fromSeq, toSeq)` - Fetch event range
- `getByProject(projectId)` - Filter by project
- `getByType(type)` - Filter by event type
- `streamEvents(fromSeq)` - Async generator
- `createSseStream(projectId?, type?, fromSeq?)` - HTTP SSE generator

## Comment Conventions

Follow these rules per AGENTS.md:

### Write comments only for:

1. **License/attribution** - License headers, external attribution
2. **External constraints** - Version-specific behavior, vendor requirements
3. **Public contracts** - Doc comments for exported types/functions
4. **Upstream issues** - Links to GitHub issues or external references
5. **Security invariants** - Security assumptions or risks

### Never write comments for:

- Describing what the code does (names should be self-explanatory)
- Recording history ("used to do X", PR/issue numbers)
- Pointing at other files
- Narrating logic flow
- Restarting names or values
- Drawing banners or leaving commented-out code

### Example:

```typescript
// ✓ Good: Self-explanatory code with meaningful names
async update(id: ProjectId, input: UpdateProjectInput) {
  const project = await this.getById(id); // already validates existence
  const updated = this.db.projects.update(id, input);
  this.events.publish({ type: 'project.updated', payload: {...} });
  return updated;
}

// ✗ Avoid: Narrating what the code does
async update(id: ProjectId, input: UpdateProjectInput) {
  // Get the project by id
  const project = await this.getById(id);
  // Update it in the database
  const updated = this.db.projects.update(id, input);
  // Publish an event
  this.events.publish({...});
  // Return the updated project
  return updated;
}
```

## Testing

All services have unit tests with mocked databases:

- `projects.test.ts` - ProjectService tests
- `artifacts.test.ts` - ArtifactService tests
- `tasks.test.ts` - TaskService tests
- `conversations.test.ts` - ConversationService tests
- `events.test.ts` - EventService tests
- `index.test.ts` - Integration tests across services

**Test Structure:**
- Mock DatabaseManager and EventService
- Test public methods independently
- Verify event publishing
- Mock return values to avoid database dependencies

**Run tests:**
```bash
npm run test -- studio/tests/unit/service
```

## Dependency Injection

Services are initialized through `ServiceContainer`:

```typescript
const db = new DatabaseManager();
db.init(projectFolder);

const services = new ServiceContainer(db);

// Use services
const project = await services.projects.getById(projectId);
const artifact = await services.artifacts.getById(artifactId);
const task = await services.tasks.getById(taskId);
```

## Event Types

Events are strongly typed through `StudioEventType`:

```typescript
type StudioEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'artifact.created'
  | 'artifact.versionAdded'
  | 'artifact.statusChanged'
  | 'task.created'
  | 'task.statusChanged'
  | 'task.gateRequested'
  | 'task.gateConfirmed'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.archived'
  | 'conversation.messageAppended'
  | ...;
```

Each service publishes relevant events when state changes occur.

## Error Handling

Services throw meaningful errors:

```typescript
// When entity not found
throw new Error(`Project not found: ${id}`);

// When operation invalid
throw new Error(`Cannot cancel task with status: ${task.status}`);

// When foreign key constraint violated
throw new Error('Version does not belong to artifact');
```

API layer should catch and format these for HTTP responses.
