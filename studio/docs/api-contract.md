# M1.5 MCP Integration - API Contract

## Overview

M1.5 provides a complete MCP (Model Context Protocol) integration layer that:
- Connects to external MCP servers (stdio/SSE transport)
- Discovers tools from MCP servers
- Registers MCP tools with the local tool registry
- Enforces permissions and sandboxing on MCP tools
- Audits all tool execution

## Core Modules

**registry.ts** - Tool Registry
- Centralized registration and lookup
- Tracks tool sources (builtin, local, MCP)
- Statistics and validation

**permissions.ts** - Permission System
- Policy-based access control
- Tool/action/path filtering
- Custom rules and wildcards

**audit.ts** - Audit Logging
- Records tool execution events
- Tracks permission denials
- Sanitizes sensitive data

**mcp-client.ts** - MCP Integration
- Connects to MCP servers (stdio/SSE)
- Discovers tools and resources
- Integrates with tool registry

## Usage

```typescript
import { McpClient, McpServerManager, ToolRegistry } from '@/service/runtime/tools';

const registry = new ToolRegistry();
const manager = new McpServerManager(registry);

const client = await manager.addServer({
  id: 'mcp_github',
  name: 'GitHub MCP Server',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
});

await manager.discoverAndRegisterAllTools();
```

## API Reference

### ToolRegistry
- `register(tool)` - Register a tool
- `get(name)` - Get tool by name
- `list(filter?)` - List tools
- `has(name)` - Check if exists
- `size()` - Get total count

### McpClient
- `connect()` - Connect to server
- `disconnect()` - Disconnect
- `discoverTools()` - Discover available tools
- `registerToolsWithRegistry(registry)` - Register tools

### PermissionManager
- `setPolicy(policy)` - Change policy
- `isToolAllowed(toolName)` - Check allowance
- `checkPermission(permission)` - Evaluate permission

### AuditLogger
- `logToolExecution(...)` - Log execution
- `getEntries()` - Get all entries
- `getStats()` - Get statistics

## Verification

Follow [`docs/verification/README.md`](../../../docs/verification/README.md) for testing.
