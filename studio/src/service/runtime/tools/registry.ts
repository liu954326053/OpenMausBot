/**
 * Tool registry system for managing tool definitions and execution contracts.
 * Provides centralized registration, lookup, and metadata for tools from both
 * local sources and MCP servers.
 */

export interface ToolSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
}

export interface ToolExecutionContext {
  projectDir: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition<Params = Record<string, unknown>, Result = unknown> {
  name: string;
  description: string;
  schema: ToolSchema;
  execute: (params: Params, context: ToolExecutionContext) => Promise<Result>;
  source?: 'builtin' | 'mcp' | 'local';
  mcpServerId?: string;
  disabled?: boolean;
}

/**
 * Tool registry for centralized tool management.
 * Maintains a directory of all available tools and handles lookups.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private categories: Map<string, Set<string>> = new Map();
  private sourceIndex: Map<string, Set<string>> = new Map();

  /**
   * Registers a tool in the registry.
   * @param tool - Tool definition
   * @returns true if registered, false if already exists
   */
  register(tool: ToolDefinition): boolean {
    if (this.tools.has(tool.name)) {
      return false;
    }

    this.tools.set(tool.name, tool);

    // Index by source
    const source = tool.source || 'builtin';
    if (!this.sourceIndex.has(source)) {
      this.sourceIndex.set(source, new Set());
    }
    this.sourceIndex.get(source)!.add(tool.name);

    return true;
  }

  /**
   * Unregisters a tool from the registry.
   * @param name - Tool name
   * @returns true if unregistered, false if not found
   */
  unregister(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) {
      return false;
    }

    const source = tool.source || 'builtin';
    this.sourceIndex.get(source)?.delete(name);

    return this.tools.delete(name);
  }

  /**
   * Gets a tool by name.
   * @param name - Tool name
   * @returns Tool definition or undefined if not found
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Lists all registered tools.
   * @param filter - Optional filter predicate
   * @returns Array of tool definitions
   */
  list(filter?: (tool: ToolDefinition) => boolean): ToolDefinition[] {
    const tools = Array.from(this.tools.values());
    if (filter) {
      return tools.filter(filter);
    }
    return tools;
  }

  /**
   * Lists tools by source.
   * @param source - Tool source ('builtin', 'mcp', 'local')
   * @returns Array of tool definitions
   */
  listBySource(source: string): ToolDefinition[] {
    const names = this.sourceIndex.get(source) || new Set();
    return Array.from(names)
      .map((name) => this.tools.get(name))
      .filter((tool) => !!tool) as ToolDefinition[];
  }

  /**
   * Lists tools from a specific MCP server.
   * @param mcpServerId - MCP server ID
   * @returns Array of tool definitions
   */
  listFromMcpServer(mcpServerId: string): ToolDefinition[] {
    return this.list((tool) => tool.mcpServerId === mcpServerId);
  }

  /**
   * Checks if a tool exists.
   * @param name - Tool name
   * @returns true if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Gets total number of registered tools.
   * @returns Tool count
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Clears all tools from the registry.
   */
  clear(): void {
    this.tools.clear();
    this.categories.clear();
    this.sourceIndex.clear();
  }

  /**
   * Gets registry statistics.
   * @returns Statistics object
   */
  getStats(): {
    total: number;
    bySource: Record<string, number>;
    disabled: number;
  } {
    const stats = {
      total: this.tools.size,
      bySource: {} as Record<string, number>,
      disabled: 0,
    };

    for (const [source, names] of this.sourceIndex) {
      stats.bySource[source] = names.size;
    }

    for (const tool of this.tools.values()) {
      if (tool.disabled) {
        stats.disabled++;
      }
    }

    return stats;
  }

  /**
   * Validates registry integrity.
   * @returns Array of validation errors
   */
  validate(): string[] {
    const errors: string[] = [];

    for (const [name, tool] of this.tools) {
      if (!tool.name) {
        errors.push(`Tool missing name property at key ${name}`);
      }

      if (!tool.description) {
        errors.push(`Tool ${name} missing description`);
      }

      if (!tool.schema) {
        errors.push(`Tool ${name} missing schema`);
      }

      if (!tool.execute) {
        errors.push(`Tool ${name} missing execute function`);
      }

      if (tool.mcpServerId && tool.source !== 'mcp') {
        errors.push(`Tool ${name} has mcpServerId but source is not 'mcp'`);
      }
    }

    return errors;
  }
}
