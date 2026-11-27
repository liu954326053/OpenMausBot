/**
 * Agent runtime loop: main execution orchestration.
 * Connects AgentEngineAdapter (M1.1) and tool system (M1.4).
 *
 * Core responsibilities:
 * - Manage conversation turn execution: receive input → call LLM → parse tool_calls → execute tools → append results → loop
 * - Stream token-level output via AsyncGenerator
 * - Handle abort signals and timeouts
 * - Manage conversation history with context window clipping
 * - Enforce permission checks for tool execution
 */

import type {
  AgentEngineAdapter,
  AgentRunRequest,
  AgentRunEvent,
  Message,
  ToolCall,
} from "../../../src/shared/runtime.ts";
import type {
  ToolRegistry,
  ToolDefinition,
  ToolExecutionContext,
} from "../../../src/service/runtime/tools/index.ts";
import { checkPermission, type Permission } from "../../../src/service/runtime/tools/index.ts";

export interface AgentLoopConfig {
  /**
   * Maximum number of tool call iterations before stopping.
   */
  maxIterations?: number;

  /**
   * Maximum tokens to retain in conversation history.
   * Context beyond this is clipped using sliding window strategy.
   */
  maxContextTokens?: number;

  /**
   * Default system prompt if none provided in request.
   */
  defaultSystemPrompt?: string;

  /**
   * Approximate tokens per message character (for quick estimation).
   */
  tokensPerCharacter?: number;
}

export interface AgentLoopRequest {
  /**
   * Conversation messages.
   */
  messages: Message[];

  /**
   * System prompt override.
   */
  systemPrompt?: string;

  /**
   * Temperature for LLM sampling.
   */
  temperature?: number;

  /**
   * Maximum completion tokens.
   */
  maxTokens?: number;

  /**
   * Abort signal for cancellation.
   */
  signal?: AbortSignal;

  /**
   * Timeout in milliseconds.
   */
  timeoutMs?: number;
}

export interface AgentLoopEvent {
  type: "token" | "tool_call" | "tool_result" | "iteration_complete" | "complete" | "error";
  data?: unknown;
  error?: { code: string; message: string };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
  complete: boolean;
}

/**
 * Agent main runtime loop.
 * Orchestrates conversation turns with streaming support, tool execution, and resilience.
 */
export class AgentLoop {
  private readonly engine: AgentEngineAdapter;
  private readonly toolRegistry: ToolRegistry;
  private readonly config: AgentLoopConfig;

  constructor(
    engine: AgentEngineAdapter,
    toolRegistry: ToolRegistry,
    config: AgentLoopConfig = {}
  ) {
    this.engine = engine;
    this.toolRegistry = toolRegistry;
    this.config = {
      maxIterations: 10,
      maxContextTokens: 128000,
      tokensPerCharacter: 0.25, // Rough heuristic
      ...config,
    };
  }

  /**
   * Run a single agent loop turn.
   * Streams tokens, tool calls and results, loops until completion.
   *
   * @param request - Loop request with messages and config
   * @yields AgentLoopEvent objects
   *
   * @example
   * ```ts
   * const loop = new AgentLoop(engine, toolRegistry);
   * for await (const event of loop.run(request)) {
   *   if (event.type === "token") {
   *     console.log((event.data as any).text);
   *   }
   * }
   * ```
   */
  async *run(request: AgentLoopRequest): AsyncGenerator<AgentLoopEvent> {
    // Setup abort handling
    const timeoutId = this.setupTimeout(request.timeoutMs);
    const abortController = new AbortController();

    const abortListener = () => {
      abortController.abort();
    };
    if (request.signal) {
      request.signal.addEventListener("abort", abortListener);
    }

    try {
      // Prepare conversation state
      let messages = [...request.messages];
      let iterationCount = 0;

      // Main loop: iterate until completion or max iterations
      while (iterationCount < (this.config.maxIterations ?? 10)) {
        // Check abort
        if (abortController.signal.aborted || request.signal?.aborted) {
          throw new Error("Agent loop aborted");
        }

        iterationCount++;

        // Clip context if needed
        messages = this.clipContext(messages);

        // Build run request for LLM
        const runRequest: AgentRunRequest = {
          messages,
          tools: this.getAvailableTools(),
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          signal: abortController.signal,
        };

        // Accumulate response: tokens, tool calls, finish reason
        let assistantContent = "";
        const toolCalls: AccumulatedToolCall[] = [];
        let finishReason: "stop_sequence" | "tool_calls" | undefined;
        let hasToolCalls = false;

        // Stream LLM response
        try {
          for await (const event of this.engine.run(runRequest)) {
            if (event.type === "token") {
              const text = (event.data as any)?.text ?? "";
              assistantContent += text;
              yield {
                type: "token",
                data: { text },
              };
            } else if (event.type === "tool_call") {
              const data = event.data as any;
              const tcIndex = toolCalls.findIndex((tc) => tc.id === data.callId);

              if (tcIndex >= 0) {
                // Update existing tool call (shouldn't happen, but be safe)
                toolCalls[tcIndex] = {
                  ...toolCalls[tcIndex],
                  arguments: data.input ? JSON.stringify(data.input) : toolCalls[tcIndex].arguments,
                  complete: data.complete ?? true,
                };
              } else {
                // New tool call
                toolCalls.push({
                  id: data.callId,
                  name: data.name,
                  arguments: typeof data.input === "string" ? data.input : JSON.stringify(data.input ?? {}),
                  complete: data.complete ?? true,
                });
              }

              hasToolCalls = true;
              yield {
                type: "tool_call",
                data: {
                  id: data.callId,
                  name: data.name,
                  input: data.input,
                },
              };
            } else if (event.type === "finish") {
              finishReason = (event.data as any)?.stopReason ?? "stop_sequence";
            } else if (event.type === "error") {
              const error = event.error as any;
              yield {
                type: "error",
                error: {
                  code: error.code ?? "unknown",
                  message: error.message ?? "Unknown error",
                },
              };
            }
          }
        } catch (error) {
          throw new Error(`LLM execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Add assistant message to history
        const assistantMessage: Message = {
          role: "assistant",
          content: assistantContent || undefined,
          tool_calls: toolCalls.length > 0
            ? toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              }))
            : undefined,
        };
        messages.push(assistantMessage);

        // If no tool calls or finish reason is stop, we're done
        if (!hasToolCalls || finishReason === "stop_sequence") {
          yield {
            type: "complete",
            data: {
              iterationCount,
              finalMessage: assistantMessage,
            },
          };
          return;
        }

        // Execute tool calls and collect results
        const toolResults: Array<{
          toolCallId: string;
          result: unknown;
          error?: string;
        }> = [];

        for (const tc of toolCalls) {
          if (abortController.signal.aborted || request.signal?.aborted) {
            throw new Error("Tool execution aborted");
          }

          const result = await this.executeTool(tc.name, tc.arguments);
          toolResults.push({
            toolCallId: tc.id,
            result: result.success ? result.data : undefined,
            error: result.error,
          });

          // Stream tool result event
          yield {
            type: "tool_result",
            data: {
              toolCallId: tc.id,
              toolName: tc.name,
              ...result,
            },
          };
        }

        // Add tool results to conversation
        for (const result of toolResults) {
          messages.push({
            role: "user",
            tool_call_id: result.toolCallId,
            content: result.error ? `Error: ${result.error}` : JSON.stringify(result.result ?? ""),
            name: "tool",
          });
        }

        // Signal end of iteration
        yield {
          type: "iteration_complete",
          data: { iterationCount, toolCallCount: toolCalls.length },
        };
      }

      // Max iterations reached
      yield {
        type: "complete",
        data: {
          iterationCount,
          reason: "max_iterations_reached",
        },
      };
    } finally {
      // Cleanup
      if (timeoutId) clearTimeout(timeoutId);
      if (request.signal) {
        request.signal.removeEventListener("abort", abortListener);
      }
      abortController.abort();
    }
  }

  /**
   * Execute a single tool call.
   */
  private async executeTool(
    toolName: string,
    argumentsJson: string
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      // Check if tool exists
      const tool = this.toolRegistry.get(toolName);
      if (!tool) {
        return {
          success: false,
          error: `Tool '${toolName}' not found in registry`,
        };
      }

      // Check if tool is disabled
      if (tool.disabled) {
        return {
          success: false,
          error: `Tool '${toolName}' is disabled`,
        };
      }

      // Parse arguments
      let params: Record<string, unknown>;
      try {
        params = JSON.parse(argumentsJson) as Record<string, unknown>;
      } catch (e) {
        return {
          success: false,
          error: `Invalid JSON arguments: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // Check permission
      const permission: Permission = {
        tool: toolName,
        action: "execute",
        scope: "project",
      };

      try {
        await checkPermission(permission, {
          projectDir: process.cwd(),
        });
      } catch (e) {
        return {
          success: false,
          error: `Permission denied: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // Execute tool
      const result = await tool.execute(params, {
        projectDir: process.cwd(),
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get available tools as OpenAI-compatible format.
   */
  private getAvailableTools(): AgentRunRequest["tools"] {
    return this.toolRegistry
      .list((tool) => !tool.disabled)
      .map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.schema,
        },
      }));
  }

  /**
   * Clip conversation history to fit within context window.
   * Uses sliding window strategy: keep system message, most recent messages.
   */
  private clipContext(messages: Message[]): Message[] {
    const maxTokens = this.config.maxContextTokens ?? 128000;

    // Estimate tokens in conversation
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg);
    }

    // If within limit, return as-is
    if (totalTokens <= maxTokens) {
      return messages;
    }

    // Keep system message and most recent messages
    const result: Message[] = [];
    let currentTokens = 0;

    // Add all system messages first
    for (const msg of messages) {
      if (msg.role === "system") {
        result.push(msg);
        currentTokens += this.estimateTokens(msg);
      }
    }

    // Add most recent messages in reverse order until we hit the limit
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i];
      const msgTokens = this.estimateTokens(msg);

      if (currentTokens + msgTokens <= maxTokens) {
        result.unshift(msg);
        currentTokens += msgTokens;
      } else {
        // Skip messages in the middle
        break;
      }
    }

    return result;
  }

  /**
   * Estimate token count for a message (rough heuristic).
   */
  private estimateTokens(message: Message): number {
    let chars = 0;

    if (message.content) {
      chars += message.content.length;
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        chars += tc.function.name.length + tc.function.arguments.length;
      }
    }

    return Math.ceil(chars * (this.config.tokensPerCharacter ?? 0.25));
  }

  /**
   * Setup timeout that aborts the entire operation.
   */
  private setupTimeout(timeoutMs?: number): NodeJS.Timeout | null {
    // Timeouts are handled by the caller's AbortSignal integration
    // This is a placeholder for explicit timeout handling if needed
    return null;
  }
}
