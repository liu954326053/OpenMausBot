/**
 * Tool execution framework exports.
 * Aggregates all tool definitions, permissions, audit, discovery, and sandbox systems.
 */

// Tool registry and core types
export { ToolRegistry, type ToolDefinition, type ToolSchema, type ToolExecutionContext } from './registry.js';

// Tool execution middleware
export {
  wrapToolWithMiddleware,
  createIsolatedContext,
  buildExecutionPlan,
  type ExecutorOptions,
  type ExecutionResult,
} from './executor.js';

// Tool discovery and introspection
export {
  ToolDiscovery,
  ToolIntrospection,
  type ToolMetadata,
  type ToolCapability,
  type ToolInfo,
} from './discovery.js';

// Sandbox isolation system
export {
  SandboxContext,
  SandboxManager,
  SandboxLevel,
  ISOLATION_POLICIES,
  formatResourceUsage,
  type ResourceLimits,
  type IsolationPolicy,
  type SandboxConfig,
  type ResourceUsage,
} from './sandbox.js';

// Permission system
export {
  PermissionManager,
  isToolAllowed,
  checkPermission,
  setPermissionPolicy,
  getPermissionManager,
  resetPermissions,
  DEFAULT_POLICIES,
  type Permission,
  type PermissionPolicy,
} from './permissions.js';

// Audit logging system
export {
  AuditLogger,
  initializeAuditLogger,
  getAuditLogger,
  logToolExecution,
  logPermissionDenied,
  resetAuditLogger,
  type AuditLogEntry,
} from './audit.js';

// MCP client and server management
export {
  McpClient,
  McpServerManager,
  type McpServerConfig,
  type McpTool,
  type McpResource,
  type McpServerInfo,
} from './mcp-client.js';
