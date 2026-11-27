/**
 * Agent runtime types and interfaces.
 * Shared contract between runtime engine and adapters.
 */

export interface AgentEngine {
  id: string;
  name: string;
  version: string;
}

export interface EngineCapabilities {
  supportsStreaming: boolean;
  supportsToolCalls: boolean;
  supportsSystemPrompt: boolean;
  maxContextTokens: number;
}

export interface ContentBlock {
  type: "text";
  text: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface Message {
  role: "user" | "assistant" | "system";
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentRunRequest {
  messages: Message[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
}

export type AgentRunEvent =
  | { type: "token"; data: { text: string } }
  | { type: "tool_call"; data: { id: string; name: string; arguments: string; complete: boolean } }
  | { type: "finish"; data: { stopReason: "stop_sequence" | "tool_calls" | "max_tokens"; usage?: { inputTokens: number; outputTokens: number } } }
  | { type: "error"; error: { code: string; message: string } };

export interface AgentEngineAdapter {
  readonly engine: AgentEngine;
  capabilities(): Promise<EngineCapabilities>;
  run(request: AgentRunRequest): AsyncIterable<AgentRunEvent>;
}

/**
 * Error classification for resilience layer.
 */
export type ErrorClassification = "rate_limited" | "temporary_failure" | "permanent_failure" | "parse_error" | "timeout" | "abort";

export interface ClassifiedError extends Error {
  classification: ErrorClassification;
  statusCode?: number;
  retryAfterMs?: number;
}
