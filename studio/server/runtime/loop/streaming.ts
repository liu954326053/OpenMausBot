/**
 * OpenAI-compatible stream parser.
 * Handles SSE format, tool_calls incremental assembly, and content chunking.
 */

export interface StreamChunk {
  type: "token" | "tool_call" | "finish";
  data?: unknown;
  error?: { code: string; message: string };
}

interface OpenAIDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
  finish_reason?: "stop" | "tool_calls" | "length" | null;
}

interface OpenAIChoice {
  delta?: OpenAIDelta;
  finish_reason?: "stop" | "tool_calls" | "length" | null;
}

interface OpenAIStreamEvent {
  object: string;
  choices: OpenAIChoice[];
}

/**
 * Incrementally parse OpenAI SSE stream into typed chunks.
 * Assembles tool_calls by index, coalescing argument fragments.
 *
 * @param response - Response with text() async iterable
 * @returns AsyncGenerator yielding StreamChunk objects
 *
 * @example
 * ```ts
 * const response = await fetch(url, { method: "POST" });
 * for await (const chunk of parseOpenAIStream(response)) {
 *   if (chunk.type === "token") console.log(chunk.data.text);
 *   if (chunk.type === "tool_call") console.log(chunk.data);
 * }
 * ```
 */
export async function* parseOpenAIStream(
  response: Response
): AsyncGenerator<StreamChunk> {
  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  
  // Track in-flight tool_calls to coalesce arguments
  // Use index as key since that's the most stable identifier during streaming
  const toolCallBuffer = new Map<
    number,
    {
      id: string;
      name: string;
      arguments: string;
      emitted: boolean;
    }
  >();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines and process complete lines
      const lines = buffer.split("\n");
      buffer = lines[lines.length - 1]; // Keep incomplete line

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();

        // Skip empty lines and SSE comments
        if (!line || line.startsWith(":")) continue;

        // Parse SSE line: "data: {...}"
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);

          // Handle stream termination marker
          if (dataStr === "[DONE]") {
            // Flush any remaining tool_calls
            for (const tc of toolCallBuffer.values()) {
              if (!tc.emitted) {
                yield {
                  type: "tool_call",
                  data: {
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                    complete: true,
                  },
                };
                tc.emitted = true;
              }
            }
            yield { type: "finish", data: { stopReason: "stop_sequence" } };
            return;
          }

          try {
            const event: OpenAIStreamEvent = JSON.parse(dataStr);

            for (const choice of event.choices || []) {
              const delta = choice.delta || {};

              // Emit text tokens
              if (delta.content) {
                yield { type: "token", data: { text: delta.content } };
              }

              // Accumulate tool_call arguments
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;
                  const id = tc.id || `tc_${index}`;

                  if (!toolCallBuffer.has(index)) {
                    toolCallBuffer.set(index, {
                      id,
                      name: tc.function?.name || "",
                      arguments: "",
                      emitted: false,
                    });
                  }

                  const buffered = toolCallBuffer.get(index)!;

                  // Update id if it appears later
                  if (tc.id) {
                    buffered.id = tc.id;
                  }

                  // Accumulate name if present
                  if (tc.function?.name) {
                    buffered.name = tc.function.name;
                  }

                  // Accumulate arguments (fragments)
                  if (tc.function?.arguments) {
                    buffered.arguments += tc.function.arguments;
                  }
                }
              }

              // Handle finish_reason
              if (choice.finish_reason) {
                // Flush any tool_calls that weren't emitted yet
                for (const tc of toolCallBuffer.values()) {
                  if (!tc.emitted) {
                    yield {
                      type: "tool_call",
                      data: {
                        id: tc.id,
                        name: tc.name,
                        arguments: tc.arguments,
                        complete: true,
                      },
                    };
                    tc.emitted = true;
                  }
                }

                const stopReason =
                  choice.finish_reason === "tool_calls" ? "tool_calls" : "stop_sequence";
                yield {
                  type: "finish",
                  data: { stopReason },
                };
              }
            }
          } catch (e) {
            // Emit parse error as token event (not throwing)
            yield {
              type: "token",
              error: {
                code: "parse_error",
                message: `Failed to parse SSE event: ${e instanceof Error ? e.message : String(e)}`,
              },
            };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
