/**
 * Permission system for tool execution.
 * Manages access control, capabilities, and policy enforcement.
 */

import type { ToolExecutionContext } from './registry.js';

export interface Permission {
  tool: string;
  action: 'read' | 'write' | 'execute' | 'network';
  path?: string;
  scope?: 'project' | 'system' | 'network';
}

export interface PermissionPolicy {
  name: string;
  description: string;
  allowedTools: string[];
  deniedTools?: string[];
  allowedPaths?: string[];
  deniedPaths?: string[];
  capabilities: Array<'read' | 'write' | 'execute' | 'network'>;
}

/**
 * Default permission policies.
 */
export const DEFAULT_POLICIES: Record<string, PermissionPolicy> = {
  sandbox_strict: {
    name: 'Sandbox Strict',
    description: 'Read-only access to project directory',
    allowedTools: [],
    deniedTools: ['*write*', '*exec*', '*delete*'],
    allowedPaths: ['./'],
    capabilities: ['read'],
  },

  sandbox_standard: {
    name: 'Sandbox Standard',
    description: 'Read and write access to project directory',
    allowedTools: [],
    deniedTools: ['*exec*', '*shell*', '*system*'],
    allowedPaths: ['./'],
    capabilities: ['read', 'write'],
  },

  sandbox_permissive: {
    name: 'Sandbox Permissive',
    description: 'Read, write, and limited execution',
    allowedTools: [],
    capabilities: ['read', 'write', 'execute'],
  },

  mcp_client: {
    name: 'MCP Client',
    description: 'Network and tool discovery capabilities',
    allowedTools: [],
    capabilities: ['network', 'read'],
  },
};

/**
 * Permission manager for evaluating access.
 */
export class PermissionManager {
  private policy: PermissionPolicy;
  private customRules: Map<string, boolean> = new Map();

  constructor(policy: PermissionPolicy = DEFAULT_POLICIES.sandbox_standard) {
    this.policy = policy;
  }

  /**
   * Changes the active policy.
   * @param policy - New policy
   */
  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  /**
   * Checks if a tool is allowed.
   * @param toolName - Tool name
   * @returns true if allowed
   */
  isToolAllowed(toolName: string): boolean {
    // Check custom rules first
    if (this.customRules.has(toolName)) {
      return this.customRules.get(toolName) ?? false;
    }

    // Check denied list (wildcards)
    if (this.policy.deniedTools) {
      for (const pattern of this.policy.deniedTools) {
        if (this.matchPattern(toolName, pattern)) {
          return false;
        }
      }
    }

    // Check allowed list (if specified)
    if (this.policy.allowedTools && this.policy.allowedTools.length > 0) {
      return this.policy.allowedTools.some((pattern) =>
        this.matchPattern(toolName, pattern)
      );
    }

    return true;
  }

  /**
   * Checks if an action is allowed.
   * @param action - Action type
   * @returns true if allowed
   */
  isActionAllowed(action: 'read' | 'write' | 'execute' | 'network'): boolean {
    return this.policy.capabilities.includes(action);
  }

  /**
   * Checks if a path is accessible.
   * @param path - File path
   * @returns true if accessible
   */
  isPathAllowed(path: string): boolean {
    // Check denied paths
    if (this.policy.deniedPaths) {
      for (const deniedPath of this.policy.deniedPaths) {
        if (path.startsWith(deniedPath)) {
          return false;
        }
      }
    }

    // Check allowed paths (if specified)
    if (this.policy.allowedPaths && this.policy.allowedPaths.length > 0) {
      return this.policy.allowedPaths.some((allowedPath) =>
        path.startsWith(allowedPath)
      );
    }

    return true;
  }

  /**
   * Evaluates a permission request.
   * @param permission - Permission to check
   * @returns true if permitted
   */
  checkPermission(permission: Permission): boolean {
    if (!this.isToolAllowed(permission.tool)) {
      return false;
    }

    if (!this.isActionAllowed(permission.action)) {
      return false;
    }

    if (permission.path && !this.isPathAllowed(permission.path)) {
      return false;
    }

    return true;
  }

  /**
   * Adds a custom rule for a specific tool.
   * @param toolName - Tool name
   * @param allowed - Whether allowed
   */
  addCustomRule(toolName: string, allowed: boolean): void {
    this.customRules.set(toolName, allowed);
  }

  /**
   * Removes a custom rule.
   * @param toolName - Tool name
   */
  removeCustomRule(toolName: string): void {
    this.customRules.delete(toolName);
  }

  /**
   * Pattern matching with wildcard support (* matches any substring).
   * @param text - Text to match
   * @param pattern - Pattern with wildcards
   * @returns true if matches
   */
  private matchPattern(text: string, pattern: string): boolean {
    const regex = new RegExp(
      `^${pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`
    );
    return regex.test(text);
  }
}

/**
 * Global permission manager instance.
 */
let globalPermissionManager = new PermissionManager();

/**
 * Checks if a tool is allowed.
 * @param toolName - Tool name
 * @returns true if allowed
 */
export function isToolAllowed(toolName: string): boolean {
  return globalPermissionManager.isToolAllowed(toolName);
}

/**
 * Checks a permission against the execution context.
 * @param permission - Permission to check
 * @param context - Execution context
 * @throws Error if permission denied
 */
export async function checkPermission(
  permission: Permission,
  context: ToolExecutionContext
): Promise<void> {
  if (!globalPermissionManager.checkPermission(permission)) {
    throw new Error(
      `Permission denied: tool '${permission.tool}' action '${permission.action}' on '${permission.path}'`
    );
  }
}

/**
 * Sets the global permission policy.
 * @param policy - Permission policy
 */
export function setPermissionPolicy(policy: PermissionPolicy): void {
  globalPermissionManager.setPolicy(policy);
}

/**
 * Gets the global permission manager.
 * @returns Permission manager
 */
export function getPermissionManager(): PermissionManager {
  return globalPermissionManager;
}

/**
 * Resets the global permission manager (for testing).
 */
export function resetPermissions(): void {
  globalPermissionManager = new PermissionManager();
}
