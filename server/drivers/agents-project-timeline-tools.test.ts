import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import { isReadOnlyAgentTool } from "../agent-tool-policy.ts";
import { agentsServerEnv, type AgentsConversation } from "../agents-turn.ts";
import { BOX_ENV_OMB_NAMES } from "../bot-box/env.ts";
import { installTeamFlows } from "../team-flow/flows.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import type { Json } from "./agents-client.ts";
import { AGENTS_MCP_ENV } from "./agents-mcp-env.ts";
import { PROJECT_TIMELINE_TOOL_DEFINITIONS, PROJECT_TIMELINE_TOOL_NAMES } from "./agents-project-timeline-tools.ts";

const TOOLS = ["timeline_get_state", "timeline_set_order"];

type Bot = AgentsConversation["bot"];
const POST: Bot = { id: "post", teamProject: { id: "project-1", role: "editor" } };
const BOARD_AND_POST: Bot = { id: "both", teamProject: { id: "project-1", role: "board" } };
const WRITER: Bot = { id: "writer", teamProject: { id: "project-1", role: "writer" } };
const LEAD: Bot = { id: "lead", chiefOfStaff: true, teamProject: { id: "project-1", role: "producer" } };
const TEAM_POST: Bot = { id: "team-post" };
const STAGES: Record<string, FlowStage[]> = { post: ["post"], both: ["storyboard", "post"], writer: ["script"], lead: ["lead"], "team-post": ["post"] };
const NO_FLOWS = { parents: () => ({}), projectParents: () => ({}), lineOf: () => null };
const HOST: AgentsConversation["host"] = {
  skillAuthoring: false, sharedComputers: false, cloudHome: false, team: false, voiceNotes: false, x: false, research: false, imageGeneration: false, localVm: false,
};
const envFor = (bot: Bot, room = false) =>
  agentsServerEnv({ threadId: "t", bot, room, teamComputer: false, host: HOST }, { generation: "g", depth: 0, skillAuthoring: false }, () => "bearer", "http://127.0.0.1:1");
const shown = (bot: Bot, room = false) => availableTools(catalogProfileFromEnv(envFor(bot, room))).map((tool) => tool.name).filter((tool) => TOOLS.includes(tool));

beforeEach(() => installTeamFlows({ ...NO_FLOWS, placeOf: (botId) => (STAGES[botId] ? { stages: STAGES[botId], upstream: [], downstream: [], team: Object.keys(STAGES) } : null) }));
afterEach(() => installTeamFlows(NO_FLOWS));

function harness(answer: { ok: boolean; status: number; body: Json }) {
  const sent: Array<{ path: string; method?: string; body?: unknown }> = [];
  const record = async (path: string, init?: { method?: string; body?: string }) => {
    sent.push({ path, ...(init?.method ? { method: init.method } : {}), ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    return answer;
  };
  const context: ToolCallContext = {
    botId: "post", threadId: "thread-post", externalRuntime: false, sharedComputers: false,
    client: { api: async (path, init) => (await record(path, init)).body, apiResponse: record },
  };
  return { sent, context };
}

describe("who is shown the timeline tools", () => {
  it("a project's bot whose stages include post, in its own chats", () => {
    expect(shown(POST)).toEqual(TOOLS);
    expect(shown(BOARD_AND_POST)).toEqual(TOOLS);
    expect([...PROJECT_TIMELINE_TOOL_NAMES]).toEqual(TOOLS);
  });

  it("no other bot of the project, and no post bot of a team that is in no project", () => {
    expect(shown(WRITER)).toEqual([]);
    expect(shown(LEAD)).toEqual([]);
    expect(shown(TEAM_POST)).toEqual([]);
    expect(envFor(WRITER).OMB_PROJECT_TIMELINE).toBe("0");
  });

  it("no bot in a room, which people outside the project may read", () => {
    expect(shown(POST, true)).toEqual([]);
    expect(envFor(POST, true).OMB_PROJECT_TIMELINE).toBe("0");
  });

  it("the switch reaches the tools' server over both of its transports", () => {
    expect(AGENTS_MCP_ENV).toContain("OMB_PROJECT_TIMELINE");
    expect(BOX_ENV_OMB_NAMES.has("OMB_PROJECT_TIMELINE")).toBe(true);
  });

  it("only with the switch, listed last, changing nothing else", () => {
    const base = { OMB_BOT_ID: "post", OMB_PROJECT_CANVAS: "1" };
    const without = availableTools(catalogProfileFromEnv(base));
    const withTools = availableTools(catalogProfileFromEnv({ ...base, OMB_PROJECT_TIMELINE: "1" }));
    expect(withTools.slice(-2).map((tool) => tool.name)).toEqual(TOOLS);
    expect(JSON.stringify(withTools.slice(0, -2))).toBe(JSON.stringify(without));
    expect(availableTools(catalogProfileFromEnv({ ...base, OMB_PROJECT_TIMELINE: "true" })).map((tool) => tool.name)).not.toContain("timeline_get_state");
  });
});

describe("the timeline tools' schemas", () => {
  it("are closed objects with no construct a provider may refuse", () => {
    for (const tool of PROJECT_TIMELINE_TOOL_DEFINITIONS) expect([tool.inputSchema.type, tool.inputSchema.additionalProperties]).toEqual(["object", false]);
    expect(JSON.stringify(PROJECT_TIMELINE_TOOL_DEFINITIONS)).not.toMatch(/"(oneOf|anyOf|allOf|const|format|\$ref)"/);
  });

  it("are not marked as reads, so no read-only turn is handed them", () => {
    for (const tool of TOOLS) expect(isReadOnlyAgentTool(tool)).toBe(false);
  });
});

describe("calling the timeline tools", () => {
  it("send the arguments to the harness and hand back its words", async () => {
    const { sent, context } = harness({ ok: true, status: 200, body: { text: "{\"clips\":[]}" } });
    expect(await callTool("timeline_get_state", {}, context)).toEqual({ text: "{\"clips\":[]}" });
    await callTool("timeline_set_order", { shot_ids: ["s2", "s1"] }, context);
    expect(sent).toEqual([
      { path: "/api/internal/project-timeline/read", method: "POST", body: {} },
      { path: "/api/internal/project-timeline/set-order", method: "POST", body: { shot_ids: ["s2", "s1"] } },
    ]);
  });

  it("tell the bot a refusal in the harness's words, as an error", async () => {
    const { context } = harness({ ok: false, status: 422, body: { error: "ghost isn't a shot of this project." } });
    expect(await callTool("timeline_set_order", { shot_ids: ["ghost"] }, context)).toEqual({ text: "ghost isn't a shot of this project.", isError: true });
  });

  it("refuse an order that names a shot twice, or an id past its limit, before anything runs", async () => {
    const { sent, context } = harness({ ok: true, status: 200, body: {} });
    for (const shotIds of [["s1", "s2", "s1"], ["x".repeat(201)]]) {
      const result = await callTool("timeline_set_order", { shot_ids: shotIds }, context);
      expect(result).toMatchObject({ isError: true });
      expect(result.text).toContain("timeline_set_order was not run:");
    }
    expect(sent).toEqual([]);
  });
});
