/**
 * Skill execution engine for running skills with lifecycle management.
 * Handles execution, error handling, resource tracking, and result processing.
 */

import type {
  SkillDefinition,
  SkillExecutionInput,
  SkillExecutionResult,
  SkillExecutionContext,
} from './types';
import { SkillValidator } from './validator';

export interface ExecutionOptions {
  timeout?: number;
  sandbox?: boolean;
  captureOutput?: boolean;
  trackResources?: boolean;
}

/**
 * Executes skills with full lifecycle management.
 */
export class SkillExecutor {
  private validator = new SkillValidator();
  private executionLog: Map<string, SkillExecutionResult> = new Map();

  /**
   * Executes a skill with the given input.
   */
  async execute(
    skill: SkillDefinition,
    input: SkillExecutionInput,
    context: SkillExecutionContext,
    options: ExecutionOptions = {}
  ): Promise<SkillExecutionResult> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    try {
      // 1. Pre-check
      const preCheck = this.validator.preCheckExecution(skill, input);
      if (!preCheck.valid) {
        return {
          skillId: skill.manifest.id,
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Validation failed: ${preCheck.errors[0]?.message || 'Unknown error'}`,
          },
          duration: performance.now() - startTime,
          timestamp,
        };
      }

      // 2. Execute skill (placeholder for actual execution)
      const result = await this.executeSkillScript(skill, input, context, options);

      // 3. Track execution
      const executionResult: SkillExecutionResult = {
        skillId: skill.manifest.id,
        success: result.success,
        output: result.output,
        error: result.error,
        duration: performance.now() - startTime,
        timestamp,
        resourceUsage: result.resourceUsage,
        logs: result.logs,
      };

      // Store in log
      this.executionLog.set(this.generateExecutionId(), executionResult);

      return executionResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        skillId: skill.manifest.id,
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error.message,
          stack: error.stack,
        },
        duration: performance.now() - startTime,
        timestamp,
      };
    }
  }

  /**
   * Executes the skill's script/entry point.
   * @internal
   */
  private async executeSkillScript(
    skill: SkillDefinition,
    input: SkillExecutionInput,
    context: SkillExecutionContext,
    options: ExecutionOptions
  ): Promise<{
    success: boolean;
    output?: unknown;
    error?: { code: string; message: string; stack?: string };
    resourceUsage?: { cpuTimeMs: number; memoryUsedMb: number; filesAccessed: number };
    logs?: { stdout: string; stderr: string };
  }> {
    const entryPoint = skill.metadata.entryPoint || skill.metadata.scriptFiles?.[0];
    if (!entryPoint) {
      return {
        success: false,
        error: {
          code: 'NO_ENTRY_POINT',
          message: 'No entry point found for skill',
        },
      };
    }

    // Simulate execution (replace with actual implementation)
    return {
      success: true,
      output: { status: 'completed', input },
      resourceUsage: {
        cpuTimeMs: Math.random() * 100,
        memoryUsedMb: Math.random() * 50,
        filesAccessed: 1,
      },
      logs: {
        stdout: `Executed ${skill.manifest.name} v${skill.manifest.version}`,
        stderr: '',
      },
    };
  }

  /**
   * Runs multiple skills sequentially.
   */
  async executeSequence(
    skills: SkillDefinition[],
    input: SkillExecutionInput,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult[]> {
    const results: SkillExecutionResult[] = [];

    for (const skill of skills) {
      const result = await this.execute(skill, input, context);
      results.push(result);

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Runs multiple skills in parallel.
   */
  async executeParallel(
    skills: SkillDefinition[],
    input: SkillExecutionInput,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult[]> {
    const promises = skills.map((skill) => this.execute(skill, input, context));
    return Promise.all(promises);
  }

  /**
   * Runs a skill with retry logic.
   */
  async executeWithRetry(
    skill: SkillDefinition,
    input: SkillExecutionInput,
    context: SkillExecutionContext,
    maxAttempts = 3,
    delayMs = 1000
  ): Promise<SkillExecutionResult> {
    let lastError: SkillExecutionResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.execute(skill, input, context);

      if (result.success) {
        return result;
      }

      lastError = result;

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }

    return lastError || {
      skillId: skill.manifest.id,
      success: false,
      error: {
        code: 'MAX_RETRIES_EXCEEDED',
        message: `Failed after ${maxAttempts} attempts`,
      },
      duration: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Gets execution log entry.
   */
  getExecutionLog(executionId: string): SkillExecutionResult | undefined {
    return this.executionLog.get(executionId);
  }

  /**
   * Lists recent executions.
   */
  listRecentExecutions(limit = 10): SkillExecutionResult[] {
    return Array.from(this.executionLog.values()).slice(-limit);
  }

  /**
   * Gets execution statistics.
   */
  getExecutionStats(): {
    total: number;
    succeeded: number;
    failed: number;
    averageDuration: number;
  } {
    const executions = Array.from(this.executionLog.values());

    if (executions.length === 0) {
      return { total: 0, succeeded: 0, failed: 0, averageDuration: 0 };
    }

    const succeeded = executions.filter((e) => e.success).length;
    const failed = executions.filter((e) => !e.success).length;
    const averageDuration = executions.reduce((sum, e) => sum + e.duration, 0) / executions.length;

    return {
      total: executions.length,
      succeeded,
      failed,
      averageDuration,
    };
  }

  /**
   * Clears execution log.
   */
  clearExecutionLog(): void {
    this.executionLog.clear();
  }

  /**
   * Generates a unique execution ID.
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

/**
 * Creates a bound skill executor for a specific context.
 */
export function createSkillExecutor(
  context: SkillExecutionContext
): (skill: SkillDefinition, input: SkillExecutionInput, options?: ExecutionOptions) => Promise<SkillExecutionResult> {
  const executor = new SkillExecutor();

  return async (skill, input, options) => {
    return executor.execute(skill, input, context, options);
  };
}
