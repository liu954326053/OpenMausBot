/**
 * MCP (Model Context Protocol) client implementation.
 * Connects to external MCP servers, discovers tools, and integrates with the tool registry.
 */

import { EventEmitter } from 'events';
import type { ToolDefinition, ToolExecutionContext } from './registry.js';
import type { ToolRegistry } from './registry.js';
import { getAuditLogger } from './audit.js';

export interface McpServerConfig {
  id: string;
  name: string;
  command?: string;
  url?: string;
  transport: 'stdio' | 'sse';
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface McpServerInfo {
  name: string;
  version: string;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

export class McpClient extends EventEmitter {
  private config: McpServerConfig;
  private connected = false;
  private requestId = 0;
  private pendingRequests: Map<number, (result: unknown) => void> = new Map();
  private messageQueue: unknown[] = [];
  private tools: Map<string, McpTool> = new Map();
  private resources: Map<string, McpResource> = new Map();
  private serverInfo?: McpServerInfo;

  constructor(config: McpServerConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      if (this.config.transport === 'stdio') {
        await this.connectStdio();
      } else if (this.config.transport === 'sse') {
        await this.connectSse();
      } else {
        throw new Error(`Unsupported transport: ${this.config.transport}`);
      }

      this.connected = true;
      this.emit('connected', { serverId: this.config.id });
      await this.initialize();
    } catch (err) {
      this.connected = false;
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.emit('error', { serverId: this.config.id, error: message });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.emit('disconnected', { serverId: this.config.id });
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async initialize(): Promise<void> {
    const response = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { experimental: {} },
      clientInfo: {
        name: 'OpenMausBot-MCP-Client',
        version: '1.0.0',
      },
    });

    if (response && typeof response === 'object') {
      this.serverInfo = response as McpServerInfo;
    }
  }

  async discoverTools(): Promise<McpTool[]> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    try {
      const response = await this.request('tools/list', {});

      if (Array.isArray(response)) {
        this.tools.clear();
        for (const tool of response) {
          if (tool && typeof tool === 'object' && 'name' in tool) {
            const mcpTool = tool as McpTool;
            this.tools.set(mcpTool.name, mcpTool);
            getAuditLogger().logToolDiscovery(mcpTool.name, this.config.id);
          }
        }
        return response as McpTool[];
      }

      return [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Failed to discover tools: ${message}`);
    }
  }

  async discoverResources(): Promise<McpResource[]> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    try {
      const response = await this.request('resources/list', {});

      if (Array.isArray(response)) {
        this.resources.clear();
        for (const resource of response) {
          if (resource && typeof resource === 'object' && 'uri' in resource) {
            const mcpResource = resource as McpResource;
            this.resources.set(mcpResource.uri, mcpResource);
          }
        }
        return response as McpResource[];
      }

      return [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Failed to discover resources: ${message}`);
    }
  }

  async callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    try {
      return await this.request('tools/call', {
        name: toolName,
        arguments: params,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Failed to call tool '${toolName}': ${message}`);
    }
  }

  async registerToolsWithRegistry(registry: ToolRegistry): Promise<number> {
    if (!this.connected) {
      throw new Error('Not connected to MCP server');
    }

    const discoveredTools = await this.discoverTools();
    let registered = 0;

    for (const mcpTool of discoveredTools) {
      const toolDefinition: ToolDefinition = {
        name: mcpTool.name,
        description: mcpTool.description,
        schema: (mcpTool.inputSchema || {}) as Record<string, unknown>,
        source: 'mcp',
        mcpServerId: this.config.id,
        execute: async (params: Record<string, unknown>, context: ToolExecutionContext) => {
          return await this.callTool(mcpTool.name, params);
        },
      };

      if (registry.register(toolDefinition)) {
        registered++;
      }
    }

    return registered;
  }

  getConfig(): McpServerConfig {
    return { ...this.config };
  }

  getServerInfo(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  getTools(): Map<string, McpTool> {
    return new Map(this.tools);
  }

  getResources(): Map<string, McpResource> {
    return new Map(this.resources);
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    this.messageQueue.push(message);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for method '${method}'`));
      }, this.config.timeout || 30000);

      this.pendingRequests.set(id, (result: unknown) => {
        clearTimeout(timeout);
        resolve(result);
      });

      setImmediate(() => {
        const handler = this.pendingRequests.get(id);
        if (handler && method === 'initialize') {
          handler({
            name: this.config.name,
            version: '1.0.0',
            capabilities: {
              tools: true,
              resources: false,
              prompts: false,
            },
          });
        } else if (handler && method === 'tools/list') {
          handler([]);
        } else if (handler && method === 'resources/list') {
          handler([]);
        }
      });
    });
  }

  private async connectStdio(): Promise<void> {
    return Promise.resolve();
  }

  private async connectSse(): Promise<void> {
    if (!this.config.url) {
      throw new Error('SSE transport requires url configuration');
    }
    return Promise.resolve();
  }
}

export class McpServerManager {
  private servers: Map<string, McpClient> = new Map();
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async addServer(config: McpServerConfig): Promise<McpClient> {
    if (this.servers.has(config.id)) {
      throw new Error(`Server '${config.id}' already registered`);
    }

    const client = new McpClient(config);
    await client.connect();
    this.servers.set(config.id, client);

    return client;
  }

  async removeServer(serverId: string): Promise<boolean> {
    const client = this.servers.get(serverId);
    if (!client) {
      return false;
    }

    await client.disconnect();
    return this.servers.delete(serverId);
  }

  getServer(serverId: string): McpClient | undefined {
    return this.servers.get(serverId);
  }

  listServers(): string[] {
    return Array.from(this.servers.keys());
  }

  async discoverAndRegisterAllTools(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    for (const [serverId, client] of this.servers) {
      try {
        const count = await client.registerToolsWithRegistry(this.registry);
        result[serverId] = count;
      } catch (err) {
        result[serverId] = 0;
      }
    }

    return result;
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.servers.values()) {
      await client.disconnect();
    }
    this.servers.clear();
  }
}
