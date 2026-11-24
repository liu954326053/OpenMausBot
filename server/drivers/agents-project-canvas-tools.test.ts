import { describe, expect, it } from "vitest";

import { CANVAS_CONTENT_MAX_CHARS } from "../../shared/project-canvas.ts";
import { isReadOnlyAgentTool } from "../agent-tool-policy.ts";
import { agentsServerEnv, type AgentsConversation } from "../agents-turn.ts";
import { BOX_ENV_OMB_NAMES } from "../bot-box/env.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import type { Json } from "./agents-client.ts";
import { AGENTS_MCP_ENV } from "./agents-mcp-env.ts";
import { PROJECT_CANVAS_TOOL_DEFINITIONS, PROJECT_CANVAS_TOOL_NAMES } from "./agents-project-canvas-tools.ts";

const TOOLS = ["canvas_get_state", "canvas_apply_ops", "canvas_generate"];
const LEAD_TOOLS = [...TOOLS, "production_plan"];

type Bot = AgentsConversation["bot"];
const MAIN: Bot = { id: "magicbot", defaultBot: {}, chiefOfStaff: true };
const PROJECT_LEAD: Bot = { id: "lead", chiefOfStaff: true, teamProject: { id: "project-1", role: "producer" } };
const PROJECT_MEMBER: Bot = { id: "member", teamProject: { id: "project-1", role: "writer" } };
const ORDINARY: Bot = { id: "plain" };
const HOST: AgentsConversation["host"] = {
  skillAuthoring: false, sharedComputers: false, cloudHome: false, team: false, voiceNotes: false, x: false, research: false, imageGeneration: false, localVm: false,
};
const envFor = (bot: Bot, room = false) =>
  agentsServerEnv({ threadId: "t", bot, room, teamComputer: false, host: HOST }, { generation: "g", depth: 0, skillAuthoring: false }, () => "bearer", "http://127.0.0.1:1");
const shown = (bot: Bot, room = false) => availableTools(catalogProfileFromEnv(envFor(bot, room))).map((tool) => tool.name).filter((tool) => LEAD_TOOLS.includes(tool));

function harness(answer: { ok: boolean; status: number; body: Json }) {
  const sent: Array<{ path: string; method?: string; body?: unknown }> = [];
  const record = async (path: string, init?: { method?: string; body?: string }) => {
    sent.push({ path, ...(init?.method ? { method: init.method } : {}), ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    return answer;
  };
  const context: ToolCallContext = {
    botId: "member", threadId: "thread-member", externalRuntime: false, sharedComputers: false,
    client: { api: async (path, init) => (await record(path, init)).body, apiResponse: record },
  };
  return { sent, context };
}

describe("who is shown the canvas tools", () => {
  it("every bot of a project in its own chats, the tool that plans the production its lead alone, and neither the main bot nor a bot in no project", () => {
    expect(shown(PROJECT_LEAD)).toEqual(LEAD_TOOLS);
    expect(shown(PROJECT_MEMBER)).toEqual(TOOLS);
    expect(shown(MAIN)).toEqual([]);
    expect(shown(ORDINARY)).toEqual([]);
    expect([...PROJECT_CANVAS_TOOL_NAMES]).toEqual(LEAD_TOOLS);
  });

  it("no bot in a room, which people outside the project may read", () => {
    expect(shown(PROJECT_MEMBER, true)).toEqual([]);
    expect(envFor(PROJECT_MEMBER, true).OMB_PROJECT_CANVAS).toBe("0");
  });

  it("the switch reaches the tools' server over both of its transports", () => {
    expect(AGENTS_MCP_ENV).toContain("OMB_PROJECT_CANVAS");
    expect(BOX_ENV_OMB_NAMES.has("OMB_PROJECT_CANVAS")).toBe(true);
  });

  it("only with the switch, listed last, changing nothing else", () => {
    const base = { OMB_BOT_ID: "member" };
    const without = availableTools(catalogProfileFromEnv(base));
    const withTools = availableTools(catalogProfileFromEnv({ ...base, OMB_PROJECT_CANVAS: "1" }));
    expect(withTools.slice(-3).map((tool) => tool.name)).toEqual(TOOLS);
    expect(JSON.stringify(withTools.slice(0, -3))).toBe(JSON.stringify(without));
    expect(availableTools(catalogProfileFromEnv({ ...base, OMB_PROJECT_CANVAS: "1", OMB_CHIEF_OF_STAFF: "1" })).slice(-4).map((tool) => tool.name)).toEqual(LEAD_TOOLS);
    expect(availableTools(catalogProfileFromEnv({ ...base, OMB_PROJECT_CANVAS: "true" })).map((tool) => tool.name)).not.toContain("canvas_get_state");
  });
});

describe("the canvas tools' schemas", () => {
  it("are closed objects with no construct a provider may refuse", () => {
    for (const tool of PROJECT_CANVAS_TOOL_DEFINITIONS) expect([tool.inputSchema.type, tool.inputSchema.additionalProperties]).toEqual(["object", false]);
    expect(JSON.stringify(PROJECT_CANVAS_TOOL_DEFINITIONS)).not.toMatch(/"(oneOf|anyOf|allOf|const|format|\$ref)"/);
  });

  it("are not marked as reads, so no read-only turn is handed them", () => {
    for (const tool of TOOLS) expect(isReadOnlyAgentTool(tool)).toBe(false);
  });
});

describe("calling the canvas tools", () => {
  it("send the arguments to the harness and hand back its words", async () => {
    const { sent, context } = harness({ ok: true, status: 200, body: { text: "{\"revision\":3}" } });
    expect(await callTool("canvas_get_state", { connected: true }, context)).toEqual({ text: "{\"revision\":3}" });
    const ops = [{ type: "add_node", nodeType: "text", title: "Outline", metadata: { content: "Act one" } }];
    await callTool("canvas_apply_ops", { ops }, context);
    await callTool("canvas_generate", { node_id: "n1" }, context);
    const plan = { brief: [["Episodes", "20 × 2 min"]], episodes: 20, assignments: { script: "bot:writer" } };
    await callTool("production_plan", plan, context);
    expect(sent).toEqual([
      { path: "/api/internal/project-canvas/read", method: "POST", body: { connected: true } },
      { path: "/api/internal/project-canvas/apply", method: "POST", body: { ops } },
      { path: "/api/internal/project-canvas/generate", method: "POST", body: { node_id: "n1" } },
      { path: "/api/internal/project-canvas/plan", method: "POST", body: plan },
    ]);
  });

  it("tell the bot a refusal in the harness's words, as an error", async () => {
    const { context } = harness({ ok: false, status: 403, body: { error: "operation 1: n2 was not put there by you" } });
    expect(await callTool("canvas_apply_ops", { ops: [{ type: "delete_node", id: "n2" }] }, context)).toEqual({ text: "operation 1: n2 was not put there by you", isError: true });
  });

  it("refuse a text past its limit before anything runs", async () => {
    const { sent, context } = harness({ ok: true, status: 200, body: {} });
    const result = await callTool("canvas_apply_ops", { ops: [{ type: "add_node", nodeType: "text", metadata: { content: "x".repeat(CANVAS_CONTENT_MAX_CHARS + 1) } }] }, context);
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("canvas_apply_ops was not run:");
    expect(sent).toEqual([]);
  });
});
