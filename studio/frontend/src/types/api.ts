/**
 * Core API types shared between frontend and backend
 */

export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;

/* Projects */
export interface Project {
  id: string;
  name: string;
  folder: string;
  teamSnapshotId: string;
  episodeCount: number;
  language: string;
  lead: {
    mode: 'project-agent' | 'user';
    projectAgentId?: string;
  };
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface CreateProjectRequest {
  name: string;
  folder: string;
  episodeCount: number;
  language: string;
  teamPresetId: string;
}

export interface ProjectListResponse {
  items: Project[];
  total: number;
  hasMore: boolean;
}

/* Tasks */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface Task {
  id: string;
  nodeId: string;
  episode: number;
  status: TaskStatus;
  attempt: number;
  gate: 'none' | 'pending' | 'confirmed' | 'rejected';
  startedAt?: string;
  queuedAt: string;
  completedAt?: string;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
}

/* Artifacts */
export type ArtifactType = 'script' | 'storyboard' | 'design' | 'video' | 'audio';
export type ArtifactStatus = 'draft' | 'ready' | 'published';

export interface Artifact {
  id: string;
  type: ArtifactType;
  episode: number;
  key: string;
  title: string;
  currentVersionId?: string;
  currentVersion: number;
  status: ArtifactStatus;
  createdAt: string;
}

export interface ArtifactVersion {
  id: string;
  version: number;
  path: string;
  sha256: string;
  bytes: number;
  taskId?: string;
  graphVersionId: string;
  note?: string;
  selected: boolean;
  createdAt: string;
}

export interface ArtifactListResponse {
  items: Artifact[];
  total: number;
}

/* Graph / Workflow */
export interface GraphNode {
  id: string;
  label: string;
  type: 'script' | 'design' | 'video' | 'check';
  roleKey: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphVersion {
  id: string;
  version: number;
  hash: string;
  createdAt: string;
  origin: 'user' | 'team';
  parentId?: string;
}

export interface Graph {
  version: GraphVersion;
  nodes: GraphNode[];
  edges: GraphEdge[];
  dsl?: string;
}

export interface CompileDslResponse {
  graphVersionId: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hash: string;
  createdAt: string;
  warnings: Array<{ line: number; message: string }>;
}

/* Conversations */
export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessagePart {
  kind: 'text' | 'artifact' | 'task' | 'code';
  text?: string;
  artifactId?: string;
  versionId?: string;
  taskId?: string;
  code?: string;
  language?: string;
}

export interface Message {
  id: string;
  seq: number;
  role: MessageRole;
  parts: MessagePart[];
  taskId?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  kind: 'lead' | 'main' | 'agent';
  projectId: string;
  title: string;
  createdAt: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
  total: number;
}

/* Events */
export type EventType =
  | 'artifact.versionAdded'
  | 'artifact.selected'
  | 'artifact.deleted'
  | 'task.created'
  | 'task.statusChanged'
  | 'task.gateConfirmed'
  | 'conversation.messageAppended'
  | 'graph.layoutChanged'
  | 'graph.compiled'
  | 'system.resync';

export interface StudioEvent {
  seq: number;
  at: string;
  type: EventType;
  projectId: string;
  payload: Record<string, unknown>;
}
