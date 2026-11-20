// The main bot's project tools: read the team templates, then propose a project the person confirms on a card. The
// catalog shows them only to the global main bot in its own chats; the internal routes
// (server/team-project-proposal-routes.ts) refuse every other bot regardless. The guidance lives in their results, so
// the descriptions that ride every main-bot turn stay short.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";
import { TEAM_PROJECT_NAME_MAX } from "../../shared/team-projects.ts";
import { agentToolAnnotations } from "../agent-tool-policy.ts";

export const TEAM_PROJECT_TOOL_NAMES: ReadonlySet<string> = new Set(["list_team_templates", "propose_team_project"]);

export async function callTeamProjectTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = name === "list_team_templates"
    ? await context.client.apiResponse("/api/internal/team-templates")
    : await context.client.apiResponse("/api/internal/team-project-proposals", {
      method: "POST", body: JSON.stringify({ name: args.name, templateId: args.template_id, request: args.request }),
    });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "That could not be done."), isError: true };
}

export const TEAM_PROJECT_TOOL_DEFINITIONS = [
  {
    name: "list_team_templates",
    description: "The team templates a project can be made from: each one's id, name, the genres it suits and its roles. Read it before propose_team_project. You cannot make or change a template.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "propose_team_project",
    description: "When the person asks for a new project (one short drama: a folder and a team made from a team template), propose it. They get a card with Create and Cancel; nothing is made before Create. Never makes a template: when none fits, say so and name the ones there are.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: TEAM_PROJECT_NAME_MAX, description: "The project's name, which is also its folder's name." },
        template_id: { type: "string", maxLength: 200, description: "A team template's id from list_team_templates." },
        request: { type: "string", maxLength: 8000, description: "What the person wants made, in their words, with every detail they gave. The project's lead gets it." },
      },
      required: ["name", "template_id", "request"],
    },
  },
].map((tool) => {
  const annotations = agentToolAnnotations(tool.name);
  return annotations ? { ...tool, annotations } : tool;
});
