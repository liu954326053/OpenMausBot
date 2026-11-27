/**
 * OpenAI-compatible streaming client.
 * Implements AgentEngineAdapter with resilience, retry logic, and error classification.
 *
 * Features:
 * - Incremental tool_calls streaming (not materialized at once)
 * - Exponential backoff retry on 429/500/503
 * - 5-minute wait on rate limit (429)
 * - Abort signal support
 * - Error classification: RateLimiter, TemporaryFailure, PermanentFailure, ParseError
 */

import {
  type AgentEngine,
  type AgentEngineAdapter,
  type AgentRunEvent,
  type AgentRunRequest,
  type EngineCapabilities,
  type ClassifiedError,
  type ErrorClassification,
} from "../../src/shared/runtime.ts";
import { parseOpenAIStream, type StreamChunk } from "./streaming.ts";

export interface OpenAICompatibleConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeout?: number; // ms, default 60000
  maxRetries?: number; // default 3
  retryBackoffMs?: (attempt: number) => number; // custom backoff function for testing
  rateLimitRetryDelayMs?: number; // override for rate-limit retry delay, default 5 minutes
}

/**
 * Classify HTTP status codes and errors into retry/permanent categories.
 */
function classifyError(statusCode: number, error?: Error): {
  classification: ErrorClassification;
  retryAfterMs?: number;
} {
  if (statusCode === 429) {
    return {
      classification: "rate_limited",
      retryAfterMs: 5 * 60 * 1000, // 5 minutes
    };
  }
  if (statusCode === 500 || statusCode === 503) {
    return { classification: "temporary_failure" };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return { classification: "permanent_failure" };
  }
  if (statusCode >= 500) {
    return { classification: "temporary_failure" };
  }
  return { classification: "permanent_failure" };
}

/**
 * Create a typed error with classification.
 */
function createClassifiedError(
  message: string,
  classification: ErrorClassification,
  statusCode?: number,
  retryAfterMs?: number
): ClassifiedError {
  const err = new Error(message) as ClassifiedError;
  err.classification = classification;
  err.statusCode = statusCode;
  err.retryAfterMs = retryAfterMs;
  return err;
}

/**
 * Exponential backoff with jitter.
 */
function backoffMs(attempt: number): number {
  const baseMs = 100;
  const maxMs = 30000;
  const exponential = baseMs * Math.pow(2, attempt);
  const jittered = exponential * (0.5 + Math.random());
  return Math.min(jittered, maxMs);
}

export class OpenAICompatibleClient implements AgentEngineAdapter {
  readonly engine: AgentEngine;
  private readonly config: OpenAICompatibleConfig;
  private readonly retryBackoff: (attempt: number) => number;

  constructor(config: OpenAICompatibleConfig) {
    this.config = {
      timeout: 60000,
      maxRetries: 3,
      ...config,
    };

    this.retryBackoff = config.retryBackoffMs || backoffMs;

    this.engine = {
      id: `openai-${this.config.baseURL}`,
      name: "OpenAI Compatible",
      version: "1.0.0",
    };
  }

  async capabilities(): Promise<EngineCapabilities> {
    return {
      supportsStreaming: true,
      supportsToolCalls: true,
      supportsSystemPrompt: true,
      maxContextTokens: 128000,
    };
  }

  /**
   * Execute a run request and stream events.
   * Implements retry logic with exponential backoff and error classification.
   */
  async *run(request: AgentRunRequest): AsyncIterable<AgentRunEvent> {
    let lastError: ClassifiedError | undefined;
    const maxRetries = this.config.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check abort signal
      if (request.signal?.aborted) {
        throw createClassifiedError("Request aborted", "abort");
      }

      try {
        yield* this.executeStream(request);
        return; // Success
      } catch (error) {
        const isClassified = error instanceof Error && "classification" in error;
        const classification = isClassified
          ? (error as ClassifiedError).classification
          : "permanent_failure";
        const statusCode = isClassified
          ? (error as ClassifiedError).statusCode
          : undefined;
        const retryAfterMs = isClassified
          ? (error as ClassifiedError).retryAfterMs
          : undefined;

        lastError = createClassifiedError(
          error instanceof Error ? error.message : String(error),
          classification,
          statusCode,
          retryAfterMs
        );

        // Classify if we should retry
        const shouldRetry =
          classification === "rate_limited" ||
          classification === "temporary_failure";

        if (!shouldRetry || attempt === maxRetries) {
          yield {
            type: "error",
            error: {
              code: classification,
              message: lastError.message,
            },
          };
          throw lastError;
        }

        // Exponential backoff
        const rateLimitWait = classification === "rate_limited" && retryAfterMs
          ? Math.min(retryAfterMs, this.config.rateLimitRetryDelayMs ?? (5 * 60 * 1000))
          : undefined;
        
        const waitMs = rateLimitWait ?? this.retryBackoff(attempt);

        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // Should not reach here
    throw lastError || new Error("Unexpected retry exhaustion");
  }

  /**
   * Internal: execute a single streaming request.
   */
  private async *executeStream(
    request: AgentRunRequest
  ): AsyncGenerator<AgentRunEvent> {
    const url = new URL("/v1/chat/completions", this.config.baseURL).toString();

    const payload = {
      model: this.config.model,
      messages: request.messages,
      tools: request.tools,
      stream: true,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      top_p: request.topP ?? 1.0,
    };

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;

    // Set timeout
    if (this.config.timeout && this.config.timeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort();
      }, this.config.timeout);
    }

    // Forward abort signal to our controller
    if (request.signal) {
      const abortListener = () => controller.abort();
      request.signal.addEventListener("abort", abortListener);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const { classification, retryAfterMs } = classifyError(
          response.status
        );
        throw createClassifiedError(
          `OpenAI API error: ${response.status} ${errorText}`,
          classification,
          response.status,
          retryAfterMs
        );
      }

      // Parse streaming response
      for await (const chunk of parseOpenAIStream(response)) {
        if (chunk.type === "token") {
          if (chunk.error) {
            // Parse error - emit warning but continue
            yield {
              type: "error",
              error: {
                code: "parse_error",
                message: chunk.error.message,
              },
            };
          } else {
            yield {
              type: "token",
              data: { text: chunk.data?.text ?? "" },
            };
          }
        } else if (chunk.type === "tool_call") {
          const data = chunk.data as {
            id: string;
            name: string;
            arguments: string;
            complete: boolean;
          };
          yield {
            type: "tool_call",
            data: {
              callId: data.id,
              name: data.name,
              input: tryParseJSON(data.arguments),
            },
          };
        } else if (chunk.type === "finish") {
          const data = chunk.data as { stopReason: string };
          yield {
            type: "finish",
            data: {
              stopReason:
                data.stopReason === "tool_calls" ? "tool_calls" : "stop_sequence",
            },
          };
        }
      }
    } catch (error) {
      // Handle abort
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw createClassifiedError("Request timed out or aborted", "timeout");
        }
        // Check if it's already classified
        if ("classification" in error) {
          throw error;
        }
        // Network or other fetch errors
        throw createClassifiedError(error.message, "temporary_failure");
      }
      throw createClassifiedError(String(error), "permanent_failure");
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (request.signal) {
        controller.abort(); // Clean up
      }
    }
  }
}

/**
 * Safely parse JSON, returning the string if parsing fails.
 */
function tryParseJSON(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
