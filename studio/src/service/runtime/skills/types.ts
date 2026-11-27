/**
 * Skill system types and interfaces.
 * Defines skill metadata, manifests, execution contracts, and lifecycle states.
 */

export type SkillId = `skl_${string}`;

export type SkillSource = 'library' | 'project' | 'remote';

export enum SkillStatus {
  Discovering = 'discovering',
  Discovered = 'discovered',
  Loading = 'loading',
  Loaded = 'loaded',
  Failed = 'failed',
  Disabled = 'disabled',
}

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface SkillCapability {
  name: string;
  description?: string;
  supportsAsync: boolean;
  supportsStreaming: boolean;
  requiresNetwork?: boolean;
  requiresFileSystem?: boolean;
}

export interface SkillManifest {
  id: SkillId;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  
  homepage?: string;
  repository?: string;
  documentation?: string;
  
  parameters?: SkillParameter[];
  capabilities?: SkillCapability[];
  
  environment?: {
    variables?: Record<string, string>;
    minNodeVersion?: string;
    minDiskSpaceMb?: number;
    minMemoryMb?: number;
  };
  
  dependencies?: {
    tools?: string[];
    mcp?: string[];
    npm?: Record<string, string>;
  };
  
  tags?: string[];
  experimental?: boolean;
  disabled?: boolean;
  
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillDefinition {
  manifest: SkillManifest;
  source: SkillSource;
  basePath: string;
  status: SkillStatus;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  metadata: {
    fileCount: number;
    totalBytes: number;
    entryPoint?: string;
    scriptFiles?: string[];
    readmeFound: boolean;
  };
}

export interface SkillExecutionInput {
  skillId: SkillId;
  skillName: string;
  skillVersion: string;
  parameters?: Record<string, unknown>;
  projectDir?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillExecutionResult {
  skillId: SkillId;
  success: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  duration: number;
  timestamp: string;
  resourceUsage?: {
    cpuTimeMs: number;
    memoryUsedMb: number;
    filesAccessed: number;
  };
  logs?: {
    stdout: string;
    stderr: string;
  };
}

export interface SkillPreCheckResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    code: string;
  }>;
  warnings?: Array<{
    field?: string;
    message: string;
  }>;
}

export interface SkillValidationError {
  field: string;
  message: string;
  code: 'REQUIRED' | 'TYPE_MISMATCH' | 'INVALID_VALUE' | 'DEPENDENCY_MISSING' | 'CAPABILITY_MISSING' | 'UNKNOWN';
}

export interface SkillIndex {
  seq: number;
  timestamp: string;
  skills: SkillDefinition[];
  discoveryPaths: string[];
  stats: {
    total: number;
    loaded: number;
    failed: number;
    disabled: number;
  };
}

export interface SkillExecutionContext {
  projectDir: string;
  workspaceDir?: string;
  conversationId?: string;
  userId?: string;
  environment: Record<string, string>;
  timeout?: number;
  sandbox?: boolean;
}
