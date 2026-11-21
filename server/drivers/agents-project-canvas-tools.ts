import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";
import { CANVAS_CONTENT_MAX_CHARS, CANVAS_MAX_OPS, CANVAS_PROMPT_MAX_CHARS, CANVAS_TITLE_MAX_CHARS } from "../../shared/project-canvas.ts";

export const PROJECT_CANVAS_TOOL_NAMES: ReadonlySet<string> = new Set(["canvas_get_state", "canvas_apply_ops", "canvas_generate"]);

const PATHS: Readonly<Record<string, string>> = {
  canvas_get_state: "/api/internal/project-canvas/read",
  canvas_apply_ops: "/api/internal/project-canvas/apply",
  canvas_generate: "/api/internal/project-canvas/generate",
};

export async function callProjectCanvasTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(PATHS[name]!, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "That could not be done."), isError: true };
}

const point = { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] };

export const PROJECT_CANVAS_TOOL_DEFINITIONS = [
  {
    name: "canvas_get_state",
    description: "Read your project's canvas: with no arguments every bot's node and status and the nodes in brief; with node_id one node in full; with connected: true, in full, what is connected to your own node. Your replies show on your node by themselves.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        node_id: { type: "string", maxLength: 200, description: "One node's id, a bot's being bot:<id>." },
        connected: { type: "boolean", description: "The nodes connected to your own node, and nothing else." },
      },
    },
  },
  {
    name: "canvas_apply_ops",
    description: "Change your project's canvas, in order, all or nothing. You add text and shot nodes; they land to the right of your node, connected from it and below what you made, unless you give a position. You change, connect from and delete only nodes you made. Files you attach become nodes on their own.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ops: {
          type: "array",
          minItems: 1,
          maxItems: CANVAS_MAX_OPS,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["add_node", "update_node", "delete_node", "connect_nodes", "delete_connections"] },
              id: { type: "string", maxLength: 200, description: "update_node and delete_node: the node; delete_connections: the connection." },
              ids: { type: "array", items: { type: "string", maxLength: 200 }, description: "delete_node and delete_connections: several at once." },
              nodeType: { type: "string", enum: ["text", "shot"], description: "add_node: a text node holds content; a shot holds a prompt to generate a picture or a clip from." },
              title: { type: "string", maxLength: CANVAS_TITLE_MAX_CHARS },
              position: { ...point, description: "add_node: where its top-left corner goes; left out, the server places it." },
              metadata: {
                type: "object",
                additionalProperties: false,
                description: "add_node: the node's fields. update_node: the fields to change; null removes one.",
                properties: {
                  content: { type: "string", maxLength: CANVAS_CONTENT_MAX_CHARS, description: "A text node's text, in Markdown." },
                  prompt: { type: "string", maxLength: CANVAS_PROMPT_MAX_CHARS, description: "A shot's prompt." },
                  settings: { type: "object", additionalProperties: true, description: "A shot's generation settings, such as model, size or seconds." },
                },
              },
              patch: {
                type: "object",
                additionalProperties: false,
                description: "update_node: the node's frame or title.",
                properties: { title: { type: "string", maxLength: CANVAS_TITLE_MAX_CHARS }, position: point, width: { type: "number" }, height: { type: "number" } },
              },
              fromNodeId: { type: "string", maxLength: 200, description: "connect_nodes: the node the reference comes from." },
              toNodeId: { type: "string", maxLength: 200, description: "connect_nodes: the node it goes into." },
            },
            required: ["type"],
          },
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "canvas_generate",
    description: "Generate a shot node you made, from its prompt and settings and the images connected into it. Its node shows the progress; what it makes lands to its right. Nothing is asked of the person, so generate only what the task needs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { node_id: { type: "string", maxLength: 200, description: "The shot node's id." } },
      required: ["node_id"],
    },
  },
];
