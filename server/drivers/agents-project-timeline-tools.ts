import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const PROJECT_TIMELINE_TOOL_NAMES: ReadonlySet<string> = new Set(["timeline_get_state", "timeline_set_order"]);

const PATHS: Readonly<Record<string, string>> = {
  timeline_get_state: "/api/internal/project-timeline/read",
  timeline_set_order: "/api/internal/project-timeline/set-order",
};

export async function callProjectTimelineTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(PATHS[name]!, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "That could not be done."), isError: true };
}

export const PROJECT_TIMELINE_TOOL_DEFINITIONS = [
  {
    name: "timeline_get_state",
    description: "Read your project's film as it stands: the clips in the order they play, each with its shot, title, length and file; the shots that have no selected video yet; the shots left out; and the JianYing draft written from it. A shot's clip is the video selected for it on the canvas.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "timeline_set_order",
    description: "Set the order your project's film plays its shots in, by shot id. A shot you leave out of the list is left out of the film; name it again to bring it back. The JianYing draft is written again from the new order once every shot in it has a selected video. It answers the film as it then stands.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        shot_ids: { type: "array", maxItems: 2000, uniqueItems: true, items: { type: "string", maxLength: 200 }, description: "The ids of the shots, in the order they play, each once." },
      },
      required: ["shot_ids"],
    },
  },
];
