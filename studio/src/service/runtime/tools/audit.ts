/**
 * Audit logging system for tool execution.
 * Records execution events, permissions changes, and security-relevant actions.
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface AuditLogEntry {
  timestamp: string;
  eventType: 'tool_execution' | 'permission_check' | 'permission_denied' | 'error' | 'discovery';
  toolName: string;
  status: 'success' | 'error' | 'denied';
  action?: string;
  reason?: string;
  parameters?: Record<string, unknown>;
  errorMessage?: string;
  errorStack?: string;
  projectDir?: string;
  userId?: string;
}

export class AuditLogger {
  private logFile?: string;
  private entries: AuditLogEntry[] = [];
  private maxEntriesInMemory = 1000;

  constructor(logFile?: string) {
    this.logFile = logFile;
  }

  logToolExecution(
    toolName: string,
    parameters: Record<string, unknown>,
    status: 'success' | 'error',
    projectDir: string,
    errorMessage?: string
  ): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'tool_execution',
      toolName,
      status,
      parameters: this.sanitizeParameters(parameters),
      projectDir,
      errorMessage,
    };

    this.addEntry(entry);
  }

  logPermissionDenied(
    toolName: string,
    action: string,
    reason: string,
    projectDir: string
  ): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'permission_denied',
      toolName,
      status: 'denied',
      action,
      reason,
      projectDir,
    };

    this.addEntry(entry);
  }

  logToolDiscovery(toolName: string, mcpServerId: string): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'discovery',
      toolName,
      status: 'success',
      reason: `Discovered from MCP server: ${mcpServerId}`,
    };

    this.addEntry(entry);
  }

  private addEntry(entry: AuditLogEntry): void {
    this.entries.push(entry);

    if (this.entries.length > this.maxEntriesInMemory) {
      this.entries = this.entries.slice(-this.maxEntriesInMemory);
    }
  }

  private sanitizeParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(parameters)) {
      if (
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('key')
      ) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = `[STRING: ${value.length} bytes]`;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  getEntries(): AuditLogEntry[] {
    return [...this.entries];
  }

  filterEntries(predicate: (entry: AuditLogEntry) => boolean): AuditLogEntry[] {
    return this.entries.filter(predicate);
  }

  clear(): void {
    this.entries = [];
  }

  async flush(): Promise<void> {
    if (!this.logFile) {
      throw new Error('Log file not configured');
    }

    try {
      const dir = path.dirname(this.logFile);
      await fs.mkdir(dir, { recursive: true });

      const lines = this.entries.map((e) => JSON.stringify(e)).join('\n');
      await fs.appendFile(this.logFile, lines + '\n', 'utf-8');

      this.entries = [];
    } catch (err) {
      throw new Error(
        `Failed to flush audit log: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  getStats(): {
    totalEntries: number;
    byEventType: Record<string, number>;
    byStatus: Record<string, number>;
  } {
    const stats = {
      totalEntries: this.entries.length,
      byEventType: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
    };

    for (const entry of this.entries) {
      stats.byEventType[entry.eventType] = (stats.byEventType[entry.eventType] ?? 0) + 1;
      stats.byStatus[entry.status] = (stats.byStatus[entry.status] ?? 0) + 1;
    }

    return stats;
  }
}

let globalAuditLogger: AuditLogger | null = null;

export function initializeAuditLogger(logFile?: string): void {
  globalAuditLogger = new AuditLogger(logFile);
}

export function getAuditLogger(): AuditLogger {
  if (!globalAuditLogger) {
    globalAuditLogger = new AuditLogger();
  }
  return globalAuditLogger;
}

export async function logToolExecution(
  toolName: string,
  parameters: Record<string, unknown>,
  status: 'success' | 'error',
  projectDir: string,
  errorMessage?: string
): Promise<void> {
  const logger = getAuditLogger();
  logger.logToolExecution(toolName, parameters, status, projectDir, errorMessage);
}

export async function logPermissionDenied(
  toolName: string,
  action: string,
  reason: string,
  projectDir: string
): Promise<void> {
  const logger = getAuditLogger();
  logger.logPermissionDenied(toolName, action, reason, projectDir);
}

export function resetAuditLogger(): void {
  globalAuditLogger = null;
}
