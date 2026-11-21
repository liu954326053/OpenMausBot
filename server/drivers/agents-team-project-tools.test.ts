import { describe, expect, it } from "vitest";

import { isReadOnlyAgentTool } from "../agent-tool-policy.ts";
import { TEAM_PROJECT_BRIEF_MAX } from "../team-project-proposal.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv, fullInputSchema } from "./agents-catalog.ts";
import type { Json } from "./agents-client.ts";
import { TEAM_PROJECT_TOOL_DEFINITIONS, TEAM_PROJECT_TOOL_NAMES } from "./agents-team-project-tools.ts";

const listed = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "main", OMB_CHIEF_OF_STAFF: "1", ...env }));
const names = (env: Record<string, string>) => listed(env).map((tool) => tool.name);
const PAIR = ["list_project_teams", "propose_team_project"];

function harness(answer: { ok: boolean; status: number; body: Json }) {
  const sent: Array<{ path: string; method?: string; body?: unknown }> = [];
  const record = async (path: string, init?: { method?: string; body?: string }) => {
    sent.push({ path, ...(init?.method ? { method: init.method } : {}), ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    return answer;
  };
  const context: ToolCallContext = {
    botId: "main", threadId: "thread-main", externalRuntime: false, sharedComputers: false,
    client: { api: async (path, init) => (await record(path, init)).body, apiResponse: record },
  };
  return { sent, context };
}

describe("the main bot's two project tools on the wire", () => {
  const pair = listed({ OMB_MAUSBOT: "1", OMB_TEAM_PROJECTS: "1" }).slice(-2) as Array<{ name: string; description: string; inputSchema: Record<string, any>; annotations?: unknown }>;

  it("are listed last, in this order, only with OMB_TEAM_PROJECTS", () => {
    expect(pair.map((tool) => tool.name)).toEqual(PAIR);
    expect([...TEAM_PROJECT_TOOL_NAMES]).toEqual(PAIR);
    for (const env of [{}, { OMB_TEAM_PROJECTS: "0" }, { OMB_TEAM_PROJECTS: "true" }, { OMB_MAUSBOT: "1" }] as Array<Record<string, string>>) {
      for (const tool of PAIR) expect(names(env), JSON.stringify(env)).not.toContain(tool);
    }
  });

  it("add nothing else and change nothing else in the list", () => {
    const without = listed({ OMB_MAUSBOT: "1" });
    const withPair = listed({ OMB_MAUSBOT: "1", OMB_TEAM_PROJECTS: "1" });
    expect(JSON.stringify(withPair.slice(0, -2))).toBe(JSON.stringify(without));
    expect(names({ OMB_MAUSBOT: "1" }).slice(-2)).toEqual(["list_unread_notifications", "mark_notifications_read"]);
  });

  it("ride every turn of the main bot's own chats, so they stay small", () => {
    const wire = (env: Record<string, string>) => Buffer.byteLength(JSON.stringify({ tools: listed(env) }), "utf8");
    expect(wire({ OMB_MAUSBOT: "1", OMB_TEAM_PROJECTS: "1" }) - wire({ OMB_MAUSBOT: "1" })).toBeLessThanOrEqual(1250);
  });

  it("keep flat, closed schemas with the required fields", () => {
    expect(pair.map((tool) => [tool.inputSchema.type, tool.inputSchema.additionalProperties, Object.keys(tool.inputSchema.properties), tool.inputSchema.required ?? []])).toEqual([
      ["object", false, [], []],
      ["object", false, ["name", "team", "request"], ["name", "team", "request"]],
    ]);
    expect(JSON.stringify(TEAM_PROJECT_TOOL_DEFINITIONS)).not.toMatch(/"(oneOf|anyOf|allOf|const|format|\$ref)"/);
  });

  it("hold the request to what the proposal takes, and the name to a short one", () => {
    expect(fullInputSchema("propose_team_project")).toMatchObject({ properties: { name: { maxLength: 60 }, request: { maxLength: TEAM_PROJECT_BRIEF_MAX } } });
  });

  it("say that a project is made from a team, and to propose a team first when none fits", () => {
    const [list, propose] = pair;
    expect(list!.description).toMatch(/teams a project can be made from/i);
    expect(list!.description).toMatch(/Chief of Staff/);
    expect(propose!.description).toMatch(/from a team/i);
    expect(propose!.description).toMatch(/no team fits, propose a team with propose_team_setup first/i);
    expect(propose!.description).toMatch(/nothing is made before Create/i);
  });

  it("mark only the list as a read", () => {
    expect(isReadOnlyAgentTool("list_project_teams")).toBe(true);
    expect(isReadOnlyAgentTool("propose_team_project")).toBe(false);
    expect(pair[0]!.annotations).toMatchObject({ readOnlyHint: true });
    expect(pair[1]!.annotations).toBeUndefined();
  });
});

describe("calling the project tools", () => {
  it("reads the teams from the harness and hands back its words", async () => {
    const { sent, context } = harness({ ok: true, status: 200, body: { text: "Teams (1)." } });
    expect(await callTool("list_project_teams", {}, context)).toEqual({ text: "Teams (1)." });
    expect(sent).toEqual([{ path: "/api/internal/project-teams" }]);
  });

  it("stages a proposal with the name, the team and the person's request", async () => {
    const { sent, context } = harness({ ok: true, status: 201, body: { text: "A card with Create and Cancel is now in the chat.", requestId: "r1" } });
    const result = await callTool("propose_team_project", { name: "The Swapped Bride", team: "Short drama crew", request: "Twelve episodes." }, context);
    expect(result).toEqual({ text: "A card with Create and Cancel is now in the chat." });
    expect(sent).toEqual([{ path: "/api/internal/team-project-proposals", method: "POST", body: { name: "The Swapped Bride", team: "Short drama crew", request: "Twelve episodes." } }]);
  });

  it("tells the bot a refusal in the harness's words, as an error", async () => {
    const { context } = harness({ ok: false, status: 404, body: { error: 'No team is called "nope".' } });
    expect(await callTool("propose_team_project", { name: "A", team: "nope", request: "x" }, context)).toEqual({ text: 'No team is called "nope".', isError: true });
    const down = harness({ ok: false, status: 500, body: {} });
    expect(await callTool("list_project_teams", {}, down.context)).toEqual({ text: "That could not be done.", isError: true });
  });

  it("refuses a name or a request past its limit before anything runs", async () => {
    const { sent, context } = harness({ ok: true, status: 201, body: {} });
    const longName = await callTool("propose_team_project", { name: "n".repeat(61), team: "t", request: "x" }, context);
    expect(longName).toMatchObject({ isError: true });
    expect(longName.text).toContain("propose_team_project was not run:");
    const longRequest = await callTool("propose_team_project", { name: "n", team: "t", request: "x".repeat(TEAM_PROJECT_BRIEF_MAX + 1) }, context);
    expect(longRequest.text).toContain("request takes at most");
    expect(sent).toEqual([]);
  });
});
