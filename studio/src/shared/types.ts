/**
 * 漫剧工作室：完整 TypeScript 类型定义
 * 路径：studio/src/shared/types.ts
 * 状态：设计中
 */

// ============================================================================
// 1. 基础类型与 ID
// ============================================================================

/** ID 前缀与类型映射 */
export type ProjectId = `prj_${string}`;
export type TeamPresetId = `tpl_${string}`;
export type TeamSnapshotId = `tsn_${string}`;
export type AgentDefinitionId = `agt_${string}`;
export type ProjectAgentId = `pag_${string}`;
export type AgentSnapshotId = `asn_${string}`;
export type SkillId = `skl_${string}`;
export type McpServerId = `mcp_${string}`;
export type ArtifactId = `art_${string}`;
export type ArtifactVersionId = `av_${string}`;
export type TaskId = `tsk_${string}`;
export type GraphVersionId = `gph_${string}`;
export type NodeId = `nod_${string}`;
export type EdgeId = `edg_${string}`;
export type ConversationId = `cnv_${string}`;
export type MessageId = `msg_${string}`;
export type GenerationServiceId = `gen_${string}`;

/** ISO-8601 时间戳（UTC，毫秒精度）*/
export type Iso = string;

/** POSIX 相对路径（相对项目根，禁止 `..`）*/
export type RelPath = string;

/** 可序列化 JSON */
export type Json = null | boolean | number | string | Json[] | Record<string, Json>;

/** 作用域：全剧或每集 */
export type Scope = 'drama' | 'episode';

/** 产物类型目录（M1 冻结，10 种） */
export type ArtifactType = 
  | 'source'      // 原作素材
  | 'brief'       // 创意文案
  | 'plan'        // 策划案（集数、里程碑）
  | 'script'      // 剧本（全剧）
  | 'episode'     // 分集脚本（每集）
  | 'character'   // 角色设定
  | 'scene'       // 场景设定
  | 'shot'        // 分镜（镜头）
  | 'take'        // 视频版本（待选）
  | 'final';      // 成片（最终）

// ============================================================================
// 2. 项目与团队
// ============================================================================

export interface Project {
  id: ProjectId;
  name: string;
  folder: string;
  
  teamSnapshotId: TeamSnapshotId;
  sourceTeamPresetId: TeamPresetId | null;
  
  lead: {
    mode: 'project-agent' | 'main-agent';
    projectAgentId: ProjectAgentId | null;
  };
  
  episodeCount: number;
  language: 'zh' | 'en';
  coverArtifactId: ArtifactId | null;
  
  settings: {
    maxConcurrentTasks: number;
    networkPerAgent: boolean;
  };
  
  createdAt: Iso;
  updatedAt: Iso;
  lastActivityAt: Iso;
  deletedAt: Iso | null;
}

export interface TeamPreset {
  id: TeamPresetId;
  name: string;
  description: string;
  
  roles: Array<{
    key: string;
    label: string;
    agentDefinitionId: AgentDefinitionId;
    scope: Scope;
  }>;
  
  leadRoleKey: string | null;
  defaultWorkflowDsl: string;
  generationDefaults: GenerationSelection | null;
  
  isDefault: boolean;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

export interface TeamSnapshot {
  id: TeamSnapshotId;
  projectId: ProjectId;
  presetId: TeamPresetId | null;
  
  roles: TeamPreset['roles'];
  leadRoleKey: string | null;
  defaultWorkflowDsl: string;
  generationDefaults: GenerationSelection | null;
  
  bodyHash: string;
  createdAt: Iso;
  supersededAt: Iso | null;
}

// ============================================================================
// 3. 智能体定义与指派
// ============================================================================

export interface AgentDefinition {
  id: AgentDefinitionId;
  name: string;
  title: string;
  avatarPath: RelPath | null;
  
  instructions: string;
  
  engine: {
    kind: 'builtin' | 'claude-cli' | 'codex-cli';
    model: string;
    providerId: string | null;
  };
  
  skillIds: SkillId[];
  mcpServerIds: McpServerId[];
  
  permissions: {
    fileWrite: 'project' | 'ask';
    commandRun: 'project' | 'ask';
    network: boolean;
    generate: boolean;
    converse: boolean;
  };
  
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

export interface ProjectAgent {
  id: ProjectAgentId;
  projectId: ProjectId;
  agentDefinitionId: AgentDefinitionId;
  
  roleKey: string;
  scope: Scope;
  episodeFrom: number | null;
  episodeTo: number | null;
  
  overrides: {
    instructionsAppend: string | null;
    engine: Partial<AgentDefinition['engine']> | null;
    addSkillIds: SkillId[];
    addMcpServerIds: McpServerId[];
  };
  
  memoryDir: RelPath;
  createdAt: Iso;
  removedAt: Iso | null;
}

export interface AgentSnapshot {
  id: AgentSnapshotId;
  taskId: TaskId;
  
  definition: Omit<AgentDefinition, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
  bodyHash: string;
  createdAt: Iso;
}

// ============================================================================
// 4. 工作流与产物
// ============================================================================

export interface GraphVersion {
  id: GraphVersionId;
  projectId: ProjectId;
  version: number;
  
  parentId: GraphVersionId | null;
  origin: 'team-snapshot' | 'lead' | 'user';
  
  nodes: GraphNode[];
  edges: GraphEdge[];
  dsl: string;
  
  hash: string;
  filePath: RelPath;
  
  createdAt: Iso;
}

export interface GraphNode {
  id: NodeId;
  kind: 'agent' | 'artifact';
  
  agent?: {
    projectAgentId: ProjectAgentId;
    roleKey: string;
    reads: ArtifactType[];
    writes: ArtifactType[];
    gate: boolean;
    config: Json;
  };
  
  artifact?: {
    type: ArtifactType;
    scope: Scope;
  };
}

export interface GraphEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
}

export interface Artifact {
  id: ArtifactId;
  projectId: ProjectId;
  type: ArtifactType;
  episode: number;
  key: string;
  
  title: string;
  currentVersionId: ArtifactVersionId | null;
  currentVersion: number;
  
  status: 'draft' | 'ready' | 'stale';
  producerNodeId: NodeId | null;
  producerProjectAgentId: ProjectAgentId | null;
  
  deletedAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface ArtifactVersion {
  id: ArtifactVersionId;
  artifactId: ArtifactId;
  version: number;
  
  schemaVersion: 1;
  path: RelPath;
  bytes: number;
  sha256: string;
  
  taskId: TaskId | null;
  graphVersionId: GraphVersionId;
  agentSnapshotId: AgentSnapshotId | null;
  
  inputPins: Array<{
    artifactId: ArtifactId;
    versionId: ArtifactVersionId;
    sha256: string;
  }>;
  
  note: string | null;
  selected: boolean;
  
  createdAt: Iso;
}

// ============================================================================
// 5. 任务与执行
// ============================================================================

export type TaskStatus = 
  | 'waiting'      // 等待输入
  | 'ready'        // 就绪，等待调度
  | 'running'      // 运行中
  | 'done'         // 成功
  | 'failed'       // 失败
  | 'stale'        // 过期（上游变化）
  | 'cancelled';   // 已取消

export type TaskErrorKind = 
  | 'network'           // 网络错误
  | 'auth'              // 鉴权错误
  | 'tool'              // 工具执行错误
  | 'invalid_output'    // 输出不合法
  | 'timeout'           // 超时
  | 'cancelled'         // 被取消
  | 'capability'        // 能力不足
  | 'gate_rejected';    // 闸门拒绝

export interface Task {
  id: TaskId;
  projectId: ProjectId;
  graphVersionId: GraphVersionId;
  
  nodeId: NodeId;
  projectAgentId: ProjectAgentId;
  agentSnapshotId: AgentSnapshotId | null;
  
  scope: Scope;
  episode: number;
  
  status: TaskStatus;
  attempt: number;
  
  gate: 'none' | 'pending' | 'confirmed';
  
  inputPins: Array<{
    artifactId: ArtifactId;
    versionId: ArtifactVersionId;
    sha256: string;
  }>;
  
  outputVersionIds: ArtifactVersionId[];
  
  error?: {
    kind: TaskErrorKind;
    message: string;
    detail?: Json;
  };
  
  queuedAt: Iso;
  startedAt?: Iso;
  endedAt?: Iso;
}

export interface TaskAttempt {
  taskId: TaskId;
  attempt: number;
  status: TaskStatus;
  logPath: RelPath;
  stdout: string;
  stderr: string;
  startedAt?: Iso;
  endedAt?: Iso;
}

// ============================================================================
// 6. 对话与消息
// ============================================================================

export type ConversationKind = 'main' | 'lead' | 'agent';

export interface Conversation {
  id: ConversationId;
  projectId: ProjectId | null;
  
  kind: ConversationKind;
  projectAgentId: ProjectAgentId | null;
  
  focusArtifactId: ArtifactId | null;
  
  title: string;
  createdAt: Iso;
  updatedAt: Iso;
  archivedAt: Iso | null;
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export type MessagePart = 
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: Json; output: Json | null }
  | { kind: 'artifact'; artifactId: ArtifactId; versionId: ArtifactVersionId | null }
  | { kind: 'spill'; path: RelPath; bytes: number };

export interface Message {
  id: MessageId;
  conversationId: ConversationId;
  seq: number;
  
  role: MessageRole;
  parts: MessagePart[];
  
  taskId: TaskId | null;
  createdAt: Iso;
}

// ============================================================================
// 7. 技能、MCP 与生成
// ============================================================================

export interface Skill {
  id: SkillId;
  name: string;
  version: string;
  manifestHash: string;
  
  storePath: string;
  fileCount: number;
  bytes: number;
  
  enabled: boolean;
  deletedAt: Iso | null;
}

export interface McpServer {
  id: McpServerId;
  name: string;
  
  transport: 'stdio' | 'http';
  command: string | null;
  url: string | null;
  
  authRef: string | null;
  enabled: boolean;
  
  lastProbe?: {
    ok: boolean;
    tools: string[];
    at: Iso;
  };
}

export interface GenerationService {
  id: GenerationServiceId;
  name: string;
  capability: 'image' | 'video';
  
  pluginId: string;
  baseUrl: string;
  protocol: 'http' | 'https';
  
  models: Array<{ id: string; label: string }>;
  secretRefs: Record<string, string>;
  
  enabled: boolean;
  deletedAt: Iso | null;
}

export interface GenerationSelection {
  serviceId: GenerationServiceId;
  modelId: string;
  params: Json | null;
}

// ============================================================================
// 8. 事件
// ============================================================================

export type StudioEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'project.activity'
  | 'teamPreset.created'
  | 'teamPreset.updated'
  | 'teamPreset.deleted'
  | 'teamPreset.defaultChanged'
  | 'agentDefinition.created'
  | 'agentDefinition.updated'
  | 'agentDefinition.deleted'
  | 'projectAgent.added'
  | 'projectAgent.updated'
  | 'projectAgent.removed'
  | 'artifact.created'
  | 'artifact.versionAdded'
  | 'artifact.statusChanged'
  | 'artifact.selected'
  | 'artifact.deleted'
  | 'artifact.restored'
  | 'task.created'
  | 'task.statusChanged'
  | 'task.gateRequested'
  | 'task.gateConfirmed'
  | 'graph.versionCreated'
  | 'graph.layoutChanged'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.archived'
  | 'conversation.messageAppended'
  | 'generation.jobChanged'
  | 'system.resync';

export interface StudioEvent {
  seq: number;
  at: Iso;
  type: StudioEventType;
  projectId?: ProjectId;
  payload: Json;
}

// ============================================================================
// 9. 快照格式
// ============================================================================

export interface ProjectSnapshot {
  seq: number;
  data: {
    project: Project;
    projectAgents: ProjectAgent[];
    artifacts: Artifact[];
    tasks: Task[];
    gates: Array<{
      taskId: TaskId;
      nodeId: NodeId;
      episode: number;
      confirmedAt?: Iso;
    }>;
    graphVersion: GraphVersion;
  };
}

export interface HomeSnapshot {
  seq: number;
  data: {
    projects: Array<
      Project & {
        counters: {
          artifacts: number;
          tasks: number;
          pending: number;
        };
      }
    >;
    teamPresets: TeamPreset[];
    defaultTeamPresetId: TeamPresetId | null;
  };
}

// ============================================================================
// 10. API 响应格式
// ============================================================================

export interface ApiResponse<T> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: Record<string, Json>;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

// ============================================================================
// 11. 请求体（常用）
// ============================================================================

export interface CreateProjectRequest {
  name: string;
  folder: string;
  episodeCount: number;
  language: 'zh' | 'en';
  teamPresetId?: TeamPresetId;
}

export interface CompileDslRequest {
  dsl: string;
}

export interface CreateArtifactRequest {
  type: ArtifactType;
  episode: number;
  key: string;
  title: string;
}

export interface StartTasksRequest {
  nodeIds?: NodeId[];
  episode?: number;
  maxConcurrent?: number;
}

export interface RetryTaskRequest {
  useOriginalInputs?: boolean;
  maxAttempts?: number;
}

export interface ConfirmGateRequest {
  decision: boolean;
  feedback?: string;
}

export interface CreateConversationRequest {
  kind: ConversationKind;
  projectId?: ProjectId;
  projectAgentId?: ProjectAgentId;
  focusArtifactId?: ArtifactId;
  title: string;
}

export interface AppendMessageRequest {
  role: MessageRole;
  parts: MessagePart[];
}

export interface CreateAgentRequest {
  name: string;
  title: string;
  instructions: string;
  engine: AgentDefinition['engine'];
  skillIds?: SkillId[];
  mcpServerIds?: McpServerId[];
  permissions?: Partial<AgentDefinition['permissions']>;
  avatarPath?: RelPath;
}

export interface CreateTeamRequest {
  name: string;
  description: string;
  roles: Array<{
    key: string;
    label: string;
    agentDefinitionId: AgentDefinitionId;
    scope: Scope;
  }>;
  leadRoleKey?: string | null;
  defaultWorkflowDsl: string;
  generationDefaults?: GenerationSelection | null;
}

// ============================================================================
// 12. 实用类型
// ============================================================================

/** 验证函数返回值 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** 类型守卫 */
export function isProjectId(id: string): id is ProjectId {
  return id.startsWith('prj_');
}

export function isArtifactId(id: string): id is ArtifactId {
  return id.startsWith('art_');
}

export function isTaskId(id: string): id is TaskId {
  return id.startsWith('tsk_');
}

export function isNodeId(id: string): id is NodeId {
  return id.startsWith('nod_');
}
