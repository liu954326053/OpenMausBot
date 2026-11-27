/**
 * Integration tests for AgentLoop.
 * Tests full streaming pipeline with OpenAICompatibleClient, parseOpenAIStream, and tool execution.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentLoop } from "../agent-loop.ts";
import { OpenAICompatibleClient } from "../openai-compatible.ts";
import type { ToolDefinition } from "../../../src/service/runtime/tools/index.ts";
import type { Message } from "../../../src/shared/runtime.ts";

class MockToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(tools?: ToolDefinition[]) {
    if (tools) {
      for (const tool of tools) {
        this.tools.set(tool.name, tool);
      }
    }
  }

  register(tool: ToolDefinition): boolean {
    if (this.tools.has(tool.name)) return false;
    this.tools.set(tool.name, tool);
    return true;
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(filter?: (tool: ToolDefinition) => boolean): ToolDefinition[] {
    const tools = Array.from(this.tools.values());
    return filter ? tools.filter(filter) : tools;
  }

  listBySource(source: string): ToolDefinition[] {
    return this.list((t) => t.source === source);
  }

  listFromMcpServer(mcpServerId: string): ToolDefinition[] {
    return this.list((t) => t.mcpServerId === mcpServerId);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }

  getStats() {
    return { total: this.tools.size, bySource: {}, disabled: 0 };
  }

  validate(): string[] {
    return [];
  }
}

describe("AgentLoop Integration", () => {
  /**
   * Helper: Mock fetch with OpenAI SSE responses.
   */
  function mockOpenAIFetch(response: Response) {
    global.fetch = vi.fn(async () => response);
  }

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

  beforeEach(() => {
    // Clear fetch mock before each test
    global.fetch = vi.fn();
  });

  describe("full streaming pipeline", () => {
    it("should stream complete conversation from engine to output", async () => {
      mockOpenAIFetch(
        createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"The"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" answer"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" is"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" 42"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ])
      );

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
      });

      const registry = new MockToolRegistry();
      const loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "What is the answer?" }];
      const tokens: string[] = [];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
        if (event.type === "token") {
          tokens.push((event.data as any).text);
        }
      }

      expect(tokens.join("")).toBe("The answer is 42");
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("should handle tool call streaming and execution", async () => {
      // First response: tool call
      mockOpenAIFetch(
        createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"calculate","arguments":"{\\"a\\":10"}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":","}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"b\\":5,"}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"op\\":\\"add\\"}"}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          "data: [DONE]",
        ])
      );

      const calculateTool: ToolDefinition = {
        name: "calculate",
        description: "Perform arithmetic",
        schema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
            op: { type: "string" },
          },
        },
        execute: vi.fn(async (params) => {
          const { a, b, op } = params as any;
          if (op === "add") return a + b;
          throw new Error("Unknown operation");
        }),
      };

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
      });

      const registry = new MockToolRegistry([calculateTool]);
      const loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Calculate 10 + 5" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "tool_call")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(calculateTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ a: 10, b: 5, op: "add" }),
        expect.any(Object)
      );
    });

    it("should handle multiple tool calls in sequence", async () => {
      mockOpenAIFetch(
        createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"tool1","arguments":"{\\"x\\":1}"}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"tool2","arguments":"{\\"y\\":2}"}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          "data: [DONE]",
        ])
      );

      const tool1: ToolDefinition = {
        name: "tool1",
        description: "Tool 1",
        schema: {},
        execute: vi.fn(async (params) => ({ result: "tool1_result" })),
      };

      const tool2: ToolDefinition = {
        name: "tool2",
        description: "Tool 2",
        schema: {},
        execute: vi.fn(async (params) => ({ result: "tool2_result" })),
      };

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
      });

      const registry = new MockToolRegistry([tool1, tool2]);
      const loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Call both tools" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === "tool_call");
      expect(toolCalls).toHaveLength(2);

      expect(tool1.execute).toHaveBeenCalled();
      expect(tool2.execute).toHaveBeenCalled();
    });
  });

  describe("error resilience", () => {
    it("should recover from rate limit with retry", async () => {
      let callCount = 0;
      global.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: rate limit
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { "Retry-After": "1" },
          });
        }
        // Second call: success
        return createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"Success"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ]);
      });

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
        retryBackoffMs: () => 1, // Fast backoff for testing
        rateLimitRetryDelayMs: 1,
      });

      const registry = new MockToolRegistry();
      const loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Test" }];
      const tokens: string[] = [];

      for await (const event of loop.run({ messages })) {
        if (event.type === "token") {
          tokens.push((event.data as any).text);
        }
      }

      expect(tokens.join("")).toBe("Success");
    });

    it("should handle engine parse errors gracefully", async () => {
      mockOpenAIFetch(
        createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"Valid"}}]}',
          "data: invalid json here", // Parse error
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":" response"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ])
      );

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
      });

      const registry = new MockToolRegistry();
      const loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Test" }];
      const tokens: string[] = [];
      const errors: any[] = [];

      for await (const event of loop.run({ messages })) {
        if (event.type === "token") {
          tokens.push((event.data as any).text);
        } else if (event.type === "error") {
          errors.push(event.error);
        }
      }

      // Should continue despite parse error
      expect(tokens.length).toBeGreaterThan(0);
    });
  });

  describe("message history construction", () => {
    it("should construct correct message history with tool results", async () => {
      mockOpenAIFetch(
        createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"greet","arguments":"{\\"name\\":\\"Alice\\"}"}}]}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          "data: [DONE]",
        ])
      );

      const greetTool: ToolDefinition = {
        name: "greet",
        description: "Greet someone",
        schema: {},
        execute: vi.fn(async (params) => ({ greeting: `Hello, ${(params as any).name}!` })),
      };

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
      });

      const registry = new MockToolRegistry([greetTool]);
      const loop = new AgentLoop(engine, registry);

      const initialMessages: Message[] = [{ role: "user", content: "Greet Alice" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages: initialMessages })) {
        events.push(event);
      }

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent?.data?.finalMessage).toBeDefined();

      const assistantMsg = completeEvent.data.finalMessage;
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.tool_calls).toBeDefined();
      expect(assistantMsg.tool_calls?.length).toBeGreaterThan(0);
    });
  });

  describe("context window management", () => {
    it("should handle conversation history with context clipping", async () => {
      mockOpenAIFetch(
        createSSEResponse([
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"OK"}}]}',
          'data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ])
      );

      const engine = new OpenAICompatibleClient({
        baseURL: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4",
      });

      const registry = new MockToolRegistry();
      const loop = new AgentLoop(engine, registry, {
        maxContextTokens: 100,
        tokensPerCharacter: 1,
      });

      const longText = "A".repeat(200);
      const messages: Message[] = [
        { role: "system", content: "Be helpful" },
        { role: "user", content: longText },
        { role: "assistant", content: "Acknowledged" },
        { role: "user", content: "New request" },
      ];

      const events: any[] = [];
      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });
});
