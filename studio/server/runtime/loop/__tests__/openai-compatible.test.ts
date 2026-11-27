/**
 * Unit tests for OpenAI-compatible client.
 * Uses a fake SSE server and tests streaming, retries, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAICompatibleClient } from "../openai-compatible.ts";
import type { AgentRunRequest } from "../../../src/shared/runtime.ts";

describe("OpenAICompatibleClient", () => {
  let client: OpenAICompatibleClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /**
   * Helper: Create SSE response from chunks.
   */
  function createSSEResponse(chunks: string[]): Response {
    const data = chunks.join("\n") + "\n";
    return new Response(data, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  /**
   * Helper: Mock fetch with configurable response.
   */
  function mockFetch(handler: (url: string, init: RequestInit) => Response) {
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      return Promise.resolve(handler(String(url), init || {}));
    });
  }

  it("should emit single token stream", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    mockFetch(() =>
      createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"!"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const events = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const tokens = events
      .filter((e) => e.type === "token")
      .map((e) => (e.data as any).text)
      .join("");

    expect(tokens).toBe("Hello world!");
    expect(events.some((e) => e.type === "finish")).toBe(true);
  });

  it("should assemble incremental tool_calls arguments", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    mockFetch(() =>
      createSSEResponse([
        // First chunk: tool_call start
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"search"}}]}}]}',
        // Second chunk: arguments part 1
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":\\"hel"}}]}}]}',
        // Third chunk: arguments part 2
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"lo\\"}"}}]}}]}',
        // Fourth chunk: finish
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const events = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBeGreaterThan(0);

    const toolCall = toolCalls[0];
    expect(toolCall.type).toBe("tool_call");
    expect((toolCall.data as any).name).toBe("search");
    expect((toolCall.data as any).callId).toBe("call_123");
    expect((toolCall.data as any).input).toMatchObject({ q: "hello" });
  });

  it("should retry on 429 rate limit", { timeout: 2000 }, async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      maxRetries: 2,
      retryBackoffMs: () => 10,
      rateLimitRetryDelayMs: 50,
    });

    let attempt = 0;
    global.fetch = vi.fn(async () => {
      attempt++;
      if (attempt === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Rate limited" } }),
          { status: 429 }
        );
      }
      return createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"Success"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ]);
    });

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const events = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const tokens = events
      .filter((e) => e.type === "token")
      .map((e) => (e.data as any).text)
      .join("");

    expect(tokens).toBe("Success");
    expect(attempt).toBe(2);
  });

  it("should classify 500 as temporary failure", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      maxRetries: 1,
    });

    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Internal server error" } }),
        { status: 500 }
      );
    });

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const events = [];
    let error: any;

    try {
      for await (const event of client.run(request)) {
        events.push(event);
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("temporary_failure");
  });

  it("should classify 503 as temporary failure", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      maxRetries: 0,
    });

    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Service unavailable" } }),
        { status: 503 }
      );
    });

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    let error: any;
    try {
      for await (const event of client.run(request)) {
        // consume events
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("temporary_failure");
  });

  it("should classify 404 as permanent failure", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      maxRetries: 0,
    });

    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Not found" } }),
        { status: 404 }
      );
    });

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    let error: any;
    try {
      for await (const event of client.run(request)) {
        // consume events
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("permanent_failure");
  });

  it("should handle SSE parse errors gracefully", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    mockFetch(() =>
      createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}',
        'data: {invalid json}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const events = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const hasToken = events.some((e) => e.type === "token" && (e.data as any).text === "Hi");
    const hasFinish = events.some((e) => e.type === "finish");

    expect(hasToken).toBe(true);
    expect(hasFinish).toBe(true);
  });

  it("should handle timeout with abort signal", { timeout: 5000 }, async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      timeout: 50,
    });

    let aborted = false;
    global.fetch = vi.fn(async (url: string, init?: any) => {
      return new Promise<Response>((resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("The user aborted a request.", "AbortError"));
          });
        }
        setTimeout(() => {
          if (!aborted) {
            reject(new Error("Test timeout"));
          }
        }, 500);
      });
    });

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    let error: any;
    try {
      for await (const event of client.run(request)) {
        // consume events
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("timeout");
  });

  it("should handle external abort signal", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    global.fetch = vi.fn(async () => {
      return createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"Content"}}]}',
        "data: [DONE]",
      ]);
    });

    const controller = new AbortController();
    controller.abort();

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
      signal: controller.signal,
    };

    let error: any;
    try {
      for await (const event of client.run(request)) {
        // consume events
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("abort");
  });

  it("should expose engine capabilities", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    const caps = await client.capabilities();

    expect(caps.supportsStreaming).toBe(true);
    expect(caps.supportsToolCalls).toBe(true);
    expect(caps.supportsSystemPrompt).toBe(true);
    expect(caps.maxContextTokens).toBeGreaterThan(0);
  });

  it("should handle multiple tool calls in one stream", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    mockFetch(() =>
      createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"fn1","arguments":"{\\"x\\":1}"}}]}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"fn2","arguments":"{\\"y\\":2}"}}]}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Hello" }],
    };

    const events = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === "finish")).toBe(true);
  });
});
