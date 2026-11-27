/**
 * Integration tests for OpenAI-compatible client.
 * Tests end-to-end streaming, error recovery, and AsyncGenerator consumption.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAICompatibleClient } from "../openai-compatible.ts";
import type { AgentRunRequest } from "../../../src/shared/runtime.ts";

describe("OpenAICompatibleClient Integration", () => {
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

  it("should fully consume AsyncGenerator stream", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    const chunks = [
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"The"}}]}',
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" quick"}}]}',
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" brown"}}]}',
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" fox"}}]}',
      'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];

    global.fetch = vi.fn(async () => createSSEResponse(chunks));

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Complete the phrase" }],
    };

    // Fully consume generator
    const result = {
      tokens: [] as string[],
      finishReason: undefined as string | undefined,
      eventCount: 0,
    };

    for await (const event of client.run(request)) {
      result.eventCount++;
      if (event.type === "token") {
        result.tokens.push((event.data as any).text);
      } else if (event.type === "finish") {
        result.finishReason = (event.data as any).stopReason;
      }
    }

    expect(result.tokens.join("")).toBe("The quick brown fox");
    expect(result.finishReason).toBe("stop_sequence");
    expect(result.eventCount).toBeGreaterThan(0);
  });

  it("should emit early when tool_calls complete", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    global.fetch = vi.fn(async () =>
      createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"search","arguments":"{\\"query\\":\\"python\\"}"}}]}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Search for something" }],
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description: "Search the web",
            parameters: { type: "object", properties: { query: { type: "string" } } },
          },
        },
      ],
    };

    const events: any[] = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const finishEvent = events.find((e) => e.type === "finish");
    expect(finishEvent?.data?.stopReason).toBe("tool_calls");

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBeGreaterThan(0);
  });

  it("should handle chunked streaming with varying payload sizes", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    global.fetch = vi.fn(async () =>
      createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"L"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"o"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"n"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"g response"}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Generate text" }],
    };

    const tokens: string[] = [];
    for await (const event of client.run(request)) {
      if (event.type === "token") {
        tokens.push((event.data as any).text);
      }
    }

    expect(tokens.join("")).toBe("Long response");
  });

  it("should correctly parse nested JSON in tool arguments", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
    });

    global.fetch = vi.fn(async () =>
      createSSEResponse([
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_nested","type":"function","function":{"name":"analyze","arguments":"{\\"data\\":{\\"nested\\":{\\"array\\":[1,2,3],\\"obj\\":{\\"key\\":\\"value\\"}}},\\"options\\":true}"}}]}}]}',
        'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ])
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Call analyze" }],
    };

    const events: any[] = [];
    for await (const event of client.run(request)) {
      events.push(event);
    }

    const toolCall = events.find((e) => e.type === "tool_call");
    expect(toolCall).toBeDefined();

    const input = toolCall?.data?.input;
    expect(input).toMatchObject({
      data: {
        nested: {
          array: [1, 2, 3],
          obj: { key: "value" },
        },
      },
      options: true,
    });
  });

  it("should respect maxRetries and exhaust attempts", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      maxRetries: 2,
      retryBackoffMs: () => 5,
    });

    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts++;
      return new Response(
        JSON.stringify({ error: { message: "Always fails" } }),
        { status: 500 }
      );
    });

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Will fail" }],
    };

    let error: any;
    try {
      for await (const event of client.run(request)) {
        // consume
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("temporary_failure");
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("should emit error event on permanent failure", async () => {
    client = new OpenAICompatibleClient({
      baseURL: "https://api.openai.com",
      apiKey: "test-key",
      model: "gpt-4",
      maxRetries: 0,
    });

    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
      })
    );

    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "Unauthorized" }],
    };

    const events: any[] = [];
    let error: any;

    try {
      for await (const event of client.run(request)) {
        events.push(event);
      }
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as any).classification).toBe("permanent_failure");
  });
});
