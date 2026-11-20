import { afterEach, describe, expect, it } from "vitest";

import { agentsServerEnv, type AgentsConversation } from "./agents-turn.ts";
import { BOX_ENV_OMB_NAMES } from "./bot-box/env.ts";
import { readTeamRolesWith } from "./chief-level.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { AGENTS_MCP_ENV } from "./drivers/agents-mcp-env.ts";
import { proposesTeamProjects } from "./team-project-proposal-access.ts";

type Bot = AgentsConversation["bot"];
const MAIN: Bot = { id: "magicbot", defaultBot: {}, chiefOfStaff: true };
const PROJECT_LEAD: Bot = { id: "lead", chiefOfStaff: true, teamProject: { id: "project-1", role: "producer" } };
const PROJECT_MEMBER: Bot = { id: "member", teamProject: { id: "project-1", role: "writer" } };
const ORDINARY: Bot = { id: "plain" };
const DEPARTMENT_CHIEF: Bot = { id: "chief", chiefOfStaff: true };

const HOST: AgentsConversation["host"] = {
  skillAuthoring: false, sharedComputers: false, cloudHome: false, team: false, voiceNotes: false, x: false, research: false, imageGeneration: false, localVm: false,
};
const envFor = (bot: Bot, room = false) =>
  agentsServerEnv({ threadId: "t", bot, room, teamComputer: false, host: HOST }, { generation: "g", depth: 0, skillAuthoring: false }, () => "bearer", "http://127.0.0.1:1");
const switchFor = (bot: Bot, room = false) => envFor(bot, room).OMB_TEAM_PROJECTS;

afterEach(() => readTeamRolesWith(() => null));

describe("who proposes projects", () => {
  it("only the global main bot: the person's MagicBot, which belongs to no project", () => {
    expect(proposesTeamProjects(MAIN)).toBe(true);
    expect(proposesTeamProjects({ defaultBot: {} })).toBe(true);
    expect(proposesTeamProjects(PROJECT_LEAD)).toBe(false);
    expect(proposesTeamProjects(PROJECT_MEMBER)).toBe(false);
    expect(proposesTeamProjects(ORDINARY)).toBe(false);
    expect(proposesTeamProjects(DEPARTMENT_CHIEF)).toBe(false);
    expect(proposesTeamProjects(undefined)).toBe(false);
    expect(proposesTeamProjects(null)).toBe(false);
  });

  it("a MagicBot filed in a project is that project's bot, not the main bot", () => {
    expect(proposesTeamProjects({ ...MAIN, teamProject: { id: "project-1", role: "producer" } })).toBe(false);
  });

  it("on a Team Cloud a member's MagicBot holds no more than its member", () => {
    const members: Bot = { id: "theirs", defaultBot: { person: "sam@example.com" } };
    expect(proposesTeamProjects(members)).toBe(false);
    readTeamRolesWith((email) => (email === "sam@example.com" ? "admin" : null));
    expect(proposesTeamProjects(members)).toBe(true);
  });
});

describe("the switch that lists the project tools", () => {
  it("is on for the main bot in its own chats and for nobody else", () => {
    expect(switchFor(MAIN)).toBe("1");
    expect(switchFor(PROJECT_LEAD)).toBe("0");
    expect(switchFor(PROJECT_MEMBER)).toBe("0");
    expect(switchFor(ORDINARY)).toBe("0");
    expect(switchFor(DEPARTMENT_CHIEF)).toBe("0");
  });

  it("is off in a room, where no project is proposed", () => {
    expect(switchFor(MAIN, true)).toBe("0");
  });
});

describe("the tools each bot is shown", () => {
  const PAIR = ["list_team_templates", "propose_team_project"];
  const shown = (bot: Bot, room = false) =>
    availableTools(catalogProfileFromEnv(envFor(bot, room))).map((tool) => tool.name).filter((tool) => PAIR.includes(tool));

  it("only the global main bot has the two project tools", () => {
    expect(shown(MAIN)).toEqual(PAIR);
    expect(shown(PROJECT_LEAD)).toEqual([]);
    expect(shown(PROJECT_MEMBER)).toEqual([]);
    expect(shown(ORDINARY)).toEqual([]);
    expect(shown(DEPARTMENT_CHIEF)).toEqual([]);
    expect(shown(MAIN, true)).toEqual([]);
  });

  it("the switch reaches the tools' server over both of its transports", () => {
    expect(AGENTS_MCP_ENV).toContain("OMB_TEAM_PROJECTS");
    expect(BOX_ENV_OMB_NAMES.has("OMB_TEAM_PROJECTS")).toBe(true);
  });
});
