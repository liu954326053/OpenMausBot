import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";
import { callProjectCanvasTool, PROJECT_CANVAS_TOOL_NAMES } from "./agents-project-canvas-tools.ts";
import { callProjectTimelineTool, PROJECT_TIMELINE_TOOL_NAMES } from "./agents-project-timeline-tools.ts";

/** The tools only a project's bots are shown: every bot's canvas tools and the post bot's timeline tools. */
export const PROJECT_BOT_TOOL_NAMES: ReadonlySet<string> = new Set([...PROJECT_CANVAS_TOOL_NAMES, ...PROJECT_TIMELINE_TOOL_NAMES]);

export function callProjectBotTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  return PROJECT_TIMELINE_TOOL_NAMES.has(name) ? callProjectTimelineTool(name, args, context) : callProjectCanvasTool(name, args, context);
}
