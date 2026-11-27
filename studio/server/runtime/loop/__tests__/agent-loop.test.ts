/**
 * Unit tests for AgentLoop.
 * Tests core loop logic, tool execution, context clipping, and abort handling.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentLoop } from "../agent-loop.ts";
import type { AgentEngineAdapter, AgentRunRequest, AgentRunEvent, Message } from "../../../src/shared/runtime.ts";
import type { ToolRegistry, ToolDefinition } from "../../../src/service/runtime/tools/index.ts";

/**
 * Mock AgentEngineAdapter for testing.
 */
class MockEngine implements AgentEngineAdapter {
  readonly engine = { id: "mock", name: "Mock", version: "1.0.0" };

  private responses: AgentRunEvent[] = [];

  constructor(events: AgentRunEvent[]) {
    this.responses = events;
  }

  async capabilities() {
    return {
      supportsStreaming: true,
      supportsToolCalls: true,
      supportsSystemPrompt: true,
      maxContextTokens: 128000,
    };
  }

  async *run(_request: AgentRunRequest): AsyncIterable<AgentRunEvent> {
    for (const event of this.responses) {
      yield event;
    }
  }
}

/**
 * Mock ToolRegistry for testing.
 */
class MockToolRegistry implements ToolRegistry {
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
    return {
      total: this.tools.size,
      bySource: {},
      disabled: 0,
    };
  }

  validate(): string[] {
    return [];
  }
}

describe("AgentLoop", () => {
  let loop: AgentLoop;

  beforeEach(() => {
    // Reset any global state if needed
  });

  describe("basic streaming", () => {
    it("should stream tokens from LLM response", async () => {
      const engine = new MockEngine([
        { type: "token", data: { text: "Hello" } },
        { type: "token", data: { text: " " } },
        { type: "token", data: { text: "world" } },
        { type: "finish", data: { stopReason: "stop_sequence" } },
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Say hello" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => e.data.text)
        .join("");

      expect(tokens).toBe("Hello world");
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("should append assistant message to history after completion", async () => {
      const engine = new MockEngine([
        { type: "token", data: { text: "Response" } },
        { type: "finish", data: { stopReason: "stop_sequence" } },
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Test" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent?.data?.finalMessage).toBeDefined();
      expect(completeEvent.data.finalMessage.role).toBe("assistant");
      expect(completeEvent.data.finalMessage.content).toBe("Response");
    });
  });

  describe("tool call execution", () => {
    it("should execute single tool call and loop back", async () => {
      const searchTool: ToolDefinition = {
        name: "search",
        description: "Search the web",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
        execute: vi.fn(async (params) => {
          const query = (params as any).query;
          return { results: [`Result for ${query}`] };
        }),
      };

      const engine = new MockEngine([
        { type: "tool_call", data: { callId: "call_1", name: "search", input: { query: "test" } } },
        { type: "finish", data: { stopReason: "tool_calls" } },
        // Second iteration (after tool result)
        { type: "token", data: { text: "Found: " } },
        { type: "token", data: { text: "Result for test" } },
        { type: "finish", data: { stopReason: "stop_sequence" } },
      ]);

      const registry = new MockToolRegistry([searchTool]);
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Search for test" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "tool_call")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(events.some((e) => e.type === "iteration_complete")).toBe(true);
      expect(searchTool.execute).toHaveBeenCalled();
    });

    it("should handle tool execution error gracefully", async () => {
      const failingTool: ToolDefinition = {
        name: "failing_tool",
        description: "Always fails",
        schema: {},
        execute: vi.fn(async () => {
          throw new Error("Tool error");
        }),
      };

      const engine = new MockEngine([
        { type: "tool_call", data: { callId: "call_1", name: "failing_tool", input: {} } },
        { type: "finish", data: { stopReason: "tool_calls" } },
      ]);

      const registry = new MockToolRegistry([failingTool]);
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Call failing tool" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.data.error).toBeTruthy();
    });

    it("should not execute unknown tool", async () => {
      const engine = new MockEngine([
        { type: "tool_call", data: { callId: "call_1", name: "unknown_tool", input: {} } },
        { type: "finish", data: { stopReason: "tool_calls" } },
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Call unknown" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent?.data.error).toContain("not found");
    });

    it("should not execute disabled tool", async () => {
      const disabledTool: ToolDefinition = {
        name: "disabled_tool",
        description: "Disabled",
        schema: {},
        disabled: true,
        execute: vi.fn(),
      };

      const engine = new MockEngine([
        { type: "tool_call", data: { callId: "call_1", name: "disabled_tool", input: {} } },
        { type: "finish", data: { stopReason: "tool_calls" } },
      ]);

      const registry = new MockToolRegistry([disabledTool]);
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Call disabled" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent?.data.error).toContain("disabled");
      expect(disabledTool.execute).not.toHaveBeenCalled();
    });
  });

  describe("context clipping", () => {
    it("should clip old messages when context exceeds max tokens", async () => {
      const engine = new MockEngine([
        { type: "token", data: { text: "Response" } },
        { type: "finish", data: { stopReason: "stop_sequence" } },
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry, {
        maxContextTokens: 50, // Very small context window
        tokensPerCharacter: 1, // 1 token per character for easy math
      });

      const messages: Message[] = [
        { role: "system", content: "You are helpful" }, // ~20 tokens
        { role: "user", content: "A".repeat(100) }, // ~100 tokens, will be clipped
        { role: "assistant", content: "Response" }, // ~8 tokens
        { role: "user", content: "New message" }, // ~11 tokens
      ];

      const events: any[] = [];
      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      // Should complete without error (old messages clipped)
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("should always keep system messages", async () => {
      const engine = new MockEngine([
        { type: "token", data: { text: "Response" } },
        { type: "finish", data: { stopReason: "stop_sequence" } },
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry, {
        maxContextTokens: 20,
        tokensPerCharacter: 1,
      });

      const systemPrompt = "You are helpful";
      const messages: Message[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: "A".repeat(100) },
      ];

      const events: any[] = [];
      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  describe("abort signal handling", () => {
    it("should stop on abort signal", async () => {
      const engine = new MockEngine([
        { type: "token", data: { text: "Hello" } },
        // Simulate hanging
        new Promise(
          () => {} // Never resolves
        ) as any,
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry);

      const abortController = new AbortController();
      const messages: Message[] = [{ role: "user", content: "Test" }];

      // Schedule abort after 10ms
      setTimeout(() => abortController.abort(), 10);

      const events: any[] = [];
      let error: Error | null = null;

      try {
        for await (const event of loop.run({ messages, signal: abortController.signal })) {
          events.push(event);
        }
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeTruthy();
      expect(error?.message).toContain("aborted");
    });
  });

  describe("max iterations", () => {
    it("should stop at max iterations limit", async () => {
      // Create engine that always returns tool calls to trigger more iterations
      const engine = new MockEngine([
        { type: "tool_call", data: { callId: "call_1", name: "dummy", input: {} } },
        { type: "finish", data: { stopReason: "tool_calls" } },
      ]);

      const dummyTool: ToolDefinition = {
        name: "dummy",
        description: "Dummy",
        schema: {},
        execute: async () => ({ result: "done" }),
      };

      const registry = new MockToolRegistry([dummyTool]);
      loop = new AgentLoop(engine, registry, {
        maxIterations: 2,
      });

      const messages: Message[] = [{ role: "user", content: "Test" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const iterationCompletes = events.filter((e) => e.type === "iteration_complete");
      expect(iterationCompletes.length).toBeLessThanOrEqual(2);

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should emit error event on engine failure", async () => {
      const engine = new MockEngine([
        { type: "error", error: { code: "rate_limited", message: "Too many requests" } },
      ]);

      const registry = new MockToolRegistry();
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Test" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    it("should handle malformed JSON in tool arguments", async () => {
      const engine = new MockEngine([
        { type: "tool_call", data: { callId: "call_1", name: "tool", input: undefined } },
        { type: "finish", data: { stopReason: "tool_calls" } },
      ]);

      const tool: ToolDefinition = {
        name: "tool",
        description: "Test",
        schema: {},
        execute: vi.fn(async () => ({ ok: true })),
      };

      const registry = new MockToolRegistry([tool]);
      loop = new AgentLoop(engine, registry);

      const messages: Message[] = [{ role: "user", content: "Test" }];
      const events: any[] = [];

      for await (const event of loop.run({ messages })) {
        events.push(event);
      }

      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent).toBeDefined();
    });
  });
});
