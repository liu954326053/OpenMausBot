import { afterEach, describe, expect, it } from "vitest";

import type { TeamSetupOperation, TeamSetupResult } from "../../shared/team-setup.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import "../server-line-packs.ts";
import { installTeamFlows, type PipelinePlace } from "../team-flow/flows.ts";
import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";
import { PLAN_STAGES, pipelineCardLines, planStagesSchema, plannedStages, recordPlannedStages, type PlanBot } from "./proposal.ts";

const NO_FLOWS = { parents: () => ({}), projectParents: () => ({}), lineOf: () => null };
const MODEL = { instanceId: "claude", model: "sonnet" };

const create = (botId: string, name: string, section: string, stages?: TeamSetupOperation["stages"], chief = false): TeamSetupOperation =>
  ({ action: "create", botId, threadId: `${botId}-thread`, fields: { name, title: name, soul: "Do the work.", section, modelSelection: MODEL, ...(chief ? { chiefOfStaff: true } : {}) }, ...(stages ? { stages } : {}) });
const update = (botId: string, section: string, stages?: TeamSetupOperation["stages"], fields: TeamSetupOperation["fields"] = {}): TeamSetupOperation =>
  ({ action: "update", botId, fields: { section, ...fields }, ...(stages ? { stages } : {}) });
const bot = (id: string, section: string, extra: Partial<PlanBot> = {}): PlanBot => ({ id, name: id, section, ...extra });

const SCREENSHOT = [
  create("yunzhou", "云舟", "漫剧", undefined, true), create("yanqing", "砚青", "漫剧", ["script"]),
  create("mobai", "墨白", "漫剧", ["character", "storyboard"]), create("qinghe", "青禾", "漫剧", ["post"]),
];
const applied = (operations: TeamSetupOperation[]): TeamSetupResult =>
  ({ state: "applied", newTeams: [], bots: operations.map((operation) => ({ id: operation.botId, name: operation.fields.name ?? operation.botId, action: operation.action === "create" ? "created" : "updated" })) });

function installed(places: Record<string, FlowStage[]> = {}) {
  const recorded: Array<[string, Readonly<Record<string, readonly FlowStage[]>>]> = [];
  installTeamFlows({
    ...NO_FLOWS,
    placeOf: (botId): PipelinePlace | null => (Object.hasOwn(places, botId) ? { stages: places[botId]!, upstream: [], downstream: [], team: [] } : null),
    setJudged: (section, stages) => { recorded.push([section, stages]); },
  });
  return recorded;
}

afterEach(() => {
  installTeamFlows(NO_FLOWS);
});

describe("the stages a plan gives a bot", () => {
  it("are the ones propose_team_setup offers a Chief and the main bot, with what each means", () => {
    for (const env of [{ OMB_CHIEF_OF_STAFF: "1" }, { OMB_CHIEF_OF_STAFF: "1", OMB_MAUSBOT: "1" }]) {
      const tool = availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "bot", ...env })).find((each) => each.name === "propose_team_setup") as unknown as
        { description: string; inputSchema: { properties: { operations: { items: { properties: { fields: { properties: Record<string, { items?: { enum?: string[] }; description?: string }> } } } } } } };
      const offered = tool.inputSchema.properties.operations.items.properties.fields.properties.stages!;
      expect(offered.items?.enum).toEqual([...PLAN_STAGES]);
      for (const stage of PLAN_STAGES) expect(offered.description).toContain(`${stage} = `);
      expect(tool.description).toContain("For a team that makes short dramas, give every member but the Chief its stages");
      for (const stage of PLAN_STAGES) expect(planStagesSchema.safeParse([stage]).success, stage).toBe(true);
    }
    expect(planStagesSchema.safeParse(["director"]).success).toBe(false);
  });

  it("are the pipeline's, once each and in its order, or other", () => {
    expect(plannedStages(["storyboard", "character", "storyboard"], false)).toEqual(["character", "storyboard"]);
    expect(plannedStages(["other"], false)).toEqual(["other"]);
    expect(plannedStages(["post", "other"], false)).toEqual(["post"]);
  });

  it("are none for the team's Chief, which leads, and none when the plan names none", () => {
    expect(plannedStages(["script"], true)).toBeUndefined();
    expect(plannedStages(["lead"], false)).toBeUndefined();
    expect(plannedStages([], false)).toBeUndefined();
    expect(plannedStages(undefined, false)).toBeUndefined();
  });
});

describe("the pipeline on the confirmation card", () => {
  it("is one line of names in the order work passes, in the language of the conversation", () => {
    installed();
    expect(pipelineCardLines({ operations: SCREENSHOT }, [], undefined)).toEqual(["Pipeline of “漫剧”: 云舟 → 砚青 → 墨白 → 青禾"]);
    expect(pipelineCardLines({ operations: SCREENSHOT }, [], "zh")).toEqual(["“漫剧”的流水线：云舟 → 砚青 → 墨白 → 青禾"]);
    expect(pipelineCardLines({ operations: SCREENSHOT }, [], "zh-TW")).toEqual(["「漫剧」的流水線：云舟 → 砚青 → 墨白 → 青禾"]);
    expect(pipelineCardLines({ operations: SCREENSHOT }, [], "pt-BR")).toEqual(["Linha de produção de “漫剧”: 云舟 → 砚青 → 墨白 → 青禾"]);
    expect(pipelineCardLines({ operations: SCREENSHOT }, [], "de")).toEqual(["Pipeline von „漫剧“: 云舟 → 砚青 → 墨白 → 青禾"]);
  });

  it("names the members of one stage together, and apart the ones the plan keeps outside the pipeline", () => {
    installed();
    const operations = [
      create("lead", "Avery", "Studio", undefined, true), create("w1", "Blake", "Studio", ["script"]), create("w2", "Casey", "Studio", ["script"]),
      create("board", "Devon", "Studio", ["storyboard"]), create("ops", "Emery", "Studio", ["other"]), create("voice", "Finley", "Studio", ["other"]),
      create("unjudged", "Gray", "Studio"),
    ];
    expect(pipelineCardLines({ operations }, [], undefined)).toEqual([
      "Pipeline of “Studio”: Avery → Blake and Casey → Devon",
      "Outside the pipeline, working with Avery directly: Emery and Finley",
    ]);
    expect(pipelineCardLines({ operations }, [], "zh")).toEqual(["“Studio”的流水线：Avery → Blake和Casey → Devon", "流水线之外，由Avery直接安排：Emery和Finley"]);
  });

  it("joins the team's present members, by the stages they have, and follows the plan's renames and moves", () => {
    installed({ ada: ["script"], cy: ["storyboard"], gone: ["post"] });
    const bots = [bot("clive", "Work", { name: "Clive", chiefOfStaff: true }), bot("ada", "Work", { name: "Ada" }), bot("cy", "Work"), bot("gone", "Work"),
      bot("eve", "Elsewhere", { name: "Eve" }), bot("old", "Work", { hidden: true }), bot("main", "Work", { defaultBot: {} })];
    const operations = [create("bo", "Bo", "Work", ["post"]), update("cy", "Work", undefined, { name: "Cyrus" }), update("gone", "Elsewhere"), update("eve", "Work", ["character"])];
    expect(pipelineCardLines({ operations }, bots, undefined)).toEqual(["Pipeline of “Work”: Clive → Ada → Eve → Cyrus → Bo"]);
  });

  it("has a line for each team the plan gives stages", () => {
    installed();
    const operations = [...SCREENSHOT, create("lead2", "Avery", "Studio", undefined, true), create("w", "Blake", "Studio", ["script"])];
    expect(pipelineCardLines({ operations }, [], undefined)).toEqual(["Pipeline of “漫剧”: 云舟 → 砚青 → 墨白 → 青禾", "Pipeline of “Studio”: Avery → Blake"]);
  });

  it("says nothing of a team with no stage of the pipeline, without a Chief, in General or of a project", () => {
    installed();
    const office = [create("head", "林一", "增长", undefined, true), create("ops", "李四", "增长", ["other"])];
    expect(pipelineCardLines({ operations: office }, [], undefined)).toEqual([]);
    expect(pipelineCardLines({ operations: [create("a", "砚青", "漫剧", ["script"])] }, [], undefined)).toEqual([]);
    expect(pipelineCardLines({ operations: [create("c", "云舟", "", undefined, true), create("a", "砚青", "", ["script"])] }, [], undefined)).toEqual([]);
    expect(pipelineCardLines({ operations: [create("a", "砚青", "片场", ["script"])] },
      [bot("lead", "片场", { chiefOfStaff: true, teamProject: { id: "project-1" } as PlanBot["teamProject"] })], undefined)).toEqual([]);
    expect(pipelineCardLines({ operations: SCREENSHOT.map(({ stages: _stages, ...operation }) => operation) }, [], undefined)).toEqual([]);
  });
});

describe("recording a plan's stages once it is applied", () => {
  it("gives each team the stages of its bots, by the department each ends in", () => {
    const recorded = installed();
    const operations = [...SCREENSHOT, update("ada", "Work", ["script"]), create("ops", "李四", "增长", ["other"]), create("unjudged", "Gray", "漫剧")];
    recordPlannedStages({ operations }, applied(operations));
    expect(recorded).toEqual([
      ["漫剧", { yanqing: ["script"], mobai: ["character", "storyboard"], qinghe: ["post"] }],
      ["Work", { ada: ["script"] }],
      ["增长", { ops: ["other"] }],
    ]);
  });

  it("records nothing for a plan that was not applied, a bot it did not make, or a bot in General", () => {
    const recorded = installed();
    recordPlannedStages({ operations: SCREENSHOT }, { state: "denied", bots: [], newTeams: [] });
    recordPlannedStages({ operations: SCREENSHOT }, { state: "failed", bots: [], newTeams: [], error: "disk full" });
    recordPlannedStages({ operations: SCREENSHOT }, applied(SCREENSHOT.slice(0, 1)));
    recordPlannedStages({ operations: [create("a", "砚青", "", ["script"])] }, applied([create("a", "砚青", "")]));
    expect(recorded).toEqual([]);
  });

  it("never fails the setup when the flows refuse the stages", () => {
    installTeamFlows({ ...NO_FLOWS, setJudged: () => { throw new Error("team-flows.json cannot be written"); } });
    expect(() => recordPlannedStages({ operations: SCREENSHOT }, applied(SCREENSHOT))).not.toThrow();
  });
});
