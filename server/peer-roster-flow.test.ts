import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlowStage } from "../shared/team-pipeline.ts";
import { chiefOfStaffPrompt } from "./chief-of-staff.ts";
import {
  canManage,
  flowPlace,
  flowRelation,
  peerAccessHelp,
  peerRosterPrompt,
  pipelineRosterWire,
  reachablePeers,
  reachesOnlyHere,
  resolveTeammate,
  roomPeerRosterSystemPrompt,
  type RosterMember,
} from "./peer-roster.ts";
import { installTeamFlows, type PipelinePlace } from "./team-flow/flows.ts";

const main: RosterMember = { id: "00000000-main", name: "MagicBot", defaultBot: {}, chiefOfStaff: true };
const chief: RosterMember = { id: "10000000-chief", name: "Sol", title: "Showrunner", section: "Studio", chiefOfStaff: true };
const story: RosterMember = { id: "20000000-story", name: "Story", title: "Screenwriter", description: "Writes every episode.", section: "Studio" };
const board: RosterMember = { id: "30000000-board", name: "Board", title: "Storyboard artist", description: "Draws every shot.", section: "Studio" };
const video: RosterMember = { id: "40000000-video", name: "Video", title: "Video editor", description: "Cuts the shots into a film.", section: "Studio" };
const ops: RosterMember = { id: "45000000-ops", name: "Ops", title: "Publisher", description: "Posts the film.", section: "Studio" };
const drift: RosterMember = { id: "47000000-drift", name: "Drift", title: "Intern", section: "Studio" };
const scout: RosterMember = { id: "50000000-scout", name: "Scout", title: "Researcher", section: "Sales" };
const loner: RosterMember = { id: "60000000-loner", name: "Loner", title: "Helper" };
const everyone = [main, chief, story, board, video, ops, drift, scout, loner];

const lead: RosterMember = { id: "70000000-lead", name: "Lead", title: "Project lead", section: "Launch", chiefOfStaff: true, teamProject: { id: "launch" } };
const writer: RosterMember = { id: "80000000-writer", name: "Writer", title: "Copywriter", section: "Launch", teamProject: { id: "launch" } };
const editor: RosterMember = { id: "90000000-editor", name: "Editor", title: "Editor", section: "Launch", teamProject: { id: "launch" } };

interface Drawn { lead: string; stages: Record<string, FlowStage[]>; lines: Array<[from: string, to: string]> }

/** Sol leads Studio: Story writes, Board draws, Video cuts, Ops stands outside the stages under Sol, and no line reaches Drift. Sales and General have no pipeline. */
const STUDIO: Drawn = {
  lead: chief.id,
  stages: { [chief.id]: ["lead"], [story.id]: ["script"], [board.id]: ["storyboard"], [video.id]: ["post"], [ops.id]: ["other"], [drift.id]: ["other"] },
  lines: [[chief.id, story.id], [story.id, board.id], [board.id, video.id], [chief.id, ops.id]],
};
const LAUNCH: Drawn = {
  lead: lead.id,
  stages: { [lead.id]: ["lead"], [writer.id]: ["script"], [editor.id]: ["post"] },
  lines: [[lead.id, writer.id], [writer.id, editor.id]],
};

function placeIn(pipeline: Drawn, botId: string): PipelinePlace | null {
  if (!Object.hasOwn(pipeline.stages, botId)) return null;
  return {
    stages: pipeline.stages[botId]!,
    upstream: pipeline.lines.filter(([, to]) => to === botId).map(([from]) => from),
    downstream: pipeline.lines.filter(([from]) => from === botId).map(([, to]) => to),
    team: [pipeline.lead, ...Object.keys(pipeline.stages).filter((member) => member !== pipeline.lead)],
  };
}

const placeOf = (botId: string): PipelinePlace | null => placeIn(STUDIO, botId) ?? placeIn(LAUNCH, botId);
const NO_TREE = { parents: () => ({}), projectParents: () => ({}), lineOf: () => null };

beforeEach(() => installTeamFlows({ ...NO_TREE, placeOf }));
afterEach(() => installTeamFlows(NO_TREE));

const ids = (bots: readonly RosterMember[]) => bots.map((bot) => bot.id).sort();
const resolve = (from: RosterMember, raw: string, handing?: "work" | "question") =>
  resolveTeammate(everyone, from, raw, () => ({ where: "elsewhere" }), undefined, undefined, handing);
const refusal = (from: RosterMember, raw: string, handing?: "work" | "question"): string => {
  const resolved = resolve(from, raw, handing);
  return "error" in resolved ? resolved.error : `reached ${resolved.id}`;
};

describe("who a bot in a pipeline is told of", () => {
  it("lists a member's upstream and downstream, and no one else", () => {
    expect(ids(reachablePeers(everyone, board))).toEqual(ids([story, video]));
    expect(ids(reachablePeers(everyone, story))).toEqual(ids([chief, board]));
    expect(ids(reachablePeers(everyone, video))).toEqual(ids([board]));
    expect(ids(reachablePeers(everyone, ops))).toEqual(ids([chief]));
    expect(reachablePeers(everyone, drift)).toEqual([]);
  });

  it("lists the lead's downstream in its team, the first stage and the members outside the stages, and every bot it reaches outside the team", () => {
    expect(ids(reachablePeers(everyone, chief))).toEqual(ids([story, ops, main, scout, loner]));
  });

  it("leaves a bot in no pipeline reaching everyone, the pipeline's members included", () => {
    expect(ids(reachablePeers(everyone, scout))).toEqual(ids([main, chief, story, board, video, ops, drift, loner]));
    expect(ids(reachablePeers(everyone, main))).toEqual(ids([chief, story, board, video, ops, drift, scout, loner]));
  });

  it("never lets a wider reach list past the pipeline's lines", () => {
    expect(ids(reachablePeers(everyone, story, (bot) => bot.id !== story.id))).toEqual(ids([chief, board]));
    expect(ids(reachablePeers(everyone, chief, (bot) => bot.id !== chief.id))).not.toContain(video.id);
  });

  it("marks how each listed bot stands to it, and says where it stands itself", () => {
    expect(flowRelation(board, story)).toEqual({ flow: "upstream" });
    expect(flowRelation(board, video)).toEqual({ flow: "downstream" });
    expect(flowRelation(board, chief)).toEqual({});
    expect(flowRelation(scout, chief)).toEqual({});
    expect([flowPlace(chief), flowPlace(board), flowPlace(scout), flowPlace(main)]).toEqual([{ flow: "lead" }, { flow: "member" }, {}, {}]);
  });

  it("keeps a pipeline's members, like a project's bots, from the person's other places, and leaves a team's lead its own", () => {
    expect(reachesOnlyHere(video)).toBe(true);
    expect(reachesOnlyHere(scout)).toBe(false);
    expect(reachesOnlyHere(chief)).toBe(false);
    expect(reachesOnlyHere({ id: "x", teamProject: { id: "p" } })).toBe(true);
  });
});

describe("a project's pipeline", () => {
  const place = [main, chief, scout, lead, writer, editor];
  const resolveIn = (from: RosterMember, raw: string, handing?: "work" | "question") =>
    resolveTeammate(place, from, raw, () => null, undefined, undefined, handing);

  it("lets the lead reach its downstream and, past the project's wall, the main bot alone", () => {
    expect(ids(reachablePeers(place, lead))).toEqual(ids([writer, main]));
    expect(resolveIn(lead, "MagicBot", "question")).toEqual({ id: main.id, byName: true });
    expect(resolveIn(lead, writer.id)).toEqual({ id: writer.id, byName: false });
    expect(resolveIn(lead, editor.id)).toEqual({ error: expect.stringContaining("Editor is not directly downstream of you: work comes to it along the pipeline from Writer.") });
    expect(resolveIn(lead, scout.id)).toEqual({ error: expect.stringContaining(`No bot with id or name "${scout.id}"`) });
  });

  it("keeps a project's member to its lines: not even the main bot", () => {
    expect(ids(reachablePeers(place, writer))).toEqual(ids([lead, editor]));
    expect(resolveIn(writer, main.id, "question")).toEqual({ error: expect.stringContaining("MagicBot is not upstream or downstream of you in your team's pipeline") });
    expect(resolveIn(writer, editor.id, "question")).toEqual({ id: editor.id, byName: false });
    expect(resolveIn(writer, editor.id)).toEqual({ error: expect.stringContaining("you cannot hand your work to another bot") });
  });
});

describe("handing work in a pipeline", () => {
  it("lets the lead hand work to its downstream, by id or by name", () => {
    expect(resolve(chief, story.id)).toEqual({ id: story.id, byName: false });
    expect(resolve(chief, "Ops")).toEqual({ id: ops.id, byName: true });
    expect(resolve(chief, "Story", "question")).toEqual({ id: story.id, byName: true });
  });

  it("refuses the lead a bot further down, says where its work comes from and whom the lead can hand work to", () => {
    const downstream = `You can hand work to your downstream: Story (id ${story.id}), Ops (id ${ops.id}). Nothing was sent.`;
    expect(refusal(chief, video.id)).toBe(`Video is not directly downstream of you: work comes to it along the pipeline from Board. Hand work only to the bots downstream of you. ${downstream}`);
    expect(refusal(chief, "Board", "question")).toBe(`Board is not directly downstream of you: work comes to it along the pipeline from Story. Ask only the bots downstream of you. ${downstream}`);
    expect(refusal(chief, drift.id)).toBe(`Drift is on none of your lines in your team's pipeline, so it cannot be reached from here. ${downstream}`);
  });

  it("lets the lead hand work or a question outside its team as a bot in no pipeline would: another department, General, the main bot", () => {
    expect(resolve(chief, scout.id)).toEqual({ id: scout.id, byName: false });
    expect(resolve(chief, "Loner")).toEqual({ id: loner.id, byName: true });
    expect(resolve(chief, "MagicBot", "question")).toEqual({ id: main.id, byName: true });
    expect(resolve(chief, "Ledger")).toEqual({ error: "elsewhere" });
  });

  it("never lets a member hand its work on, up or down, and lets a question go both ways", () => {
    const reach = `You can ask a question with consult: true: upstream of you, Story (id ${story.id}); downstream of you, Video (id ${video.id}). Nothing was sent.`;
    expect(refusal(board, video.id)).toBe(`Video is downstream of you in your team's pipeline, and you cannot hand your work to another bot: do it yourself. Ask Video a question with consult: true instead. ${reach}`);
    expect(refusal(board, "Story")).toBe(`Story is upstream of you in your team's pipeline, and you cannot hand your work to another bot: do it yourself. Ask Story a question with consult: true instead. ${reach}`);
    expect(resolve(board, video.id, "question")).toEqual({ id: video.id, byName: false });
    expect(resolve(board, "Story", "question")).toEqual({ id: story.id, byName: true });
    expect(refusal(story, chief.id)).toContain("Sol is upstream of you in your team's pipeline, and you cannot hand your work to another bot");
    expect(resolve(story, chief.id, "question")).toEqual({ id: chief.id, byName: false });
  });

  it("refuses a member the lead it is not next to, a bot of another department and the main bot, by id and by name", () => {
    for (const target of [chief.id, "Sol", ops.id, "Ops", scout.id, "Scout", main.id, "MagicBot"]) {
      const refused = refusal(board, target, "question");
      expect(refused, target).toContain("is not upstream or downstream of you in your team's pipeline, so it cannot be reached from here.");
      expect(refused).toContain(`You can ask a question with consult: true: upstream of you, Story (id ${story.id}); downstream of you, Video (id ${video.id}). Nothing was sent.`);
    }
  });

  it("tells a member at the end of the pipeline whom it can still ask, and one no line reaches that nobody is next to it", () => {
    expect(refusal(video, story.id)).toContain(`You can ask a question with consult: true: upstream of you, Board (id ${board.id}). Nothing was sent.`);
    expect(refusal(drift, chief.id, "question")).toBe("Sol is not upstream or downstream of you in your team's pipeline, so it cannot be reached from here. No bot is upstream or downstream of you in the pipeline. Nothing was sent.");
  });

  it("leaves a bot in no pipeline handing work to anyone, and never tells a pipeline's member of another place", () => {
    expect(resolve(scout, video.id)).toEqual({ id: video.id, byName: false });
    expect(resolve(main, "Video")).toEqual({ id: video.id, byName: true });
    expect(resolve(scout, "Ledger")).toEqual({ error: "elsewhere" });
    expect(resolve(story, "Ledger")).toEqual({ error: expect.stringContaining('No bot with id or name "Ledger"') });
  });

  it("narrows reach only: authority over a teammate stays with the department", () => {
    expect(canManage(chief, video)).toBe(true);
  });
});

describe("what a bot in a pipeline is told", () => {
  it("tells a member the bots upstream and downstream of it with their stages and what each does, that it only asks them questions, and to attach its files when it finishes", () => {
    const { rules, roster } = peerRosterPrompt(reachablePeers(everyone, board), board);
    expect(rules).toContain("work comes to you from the bots upstream of you, and yours goes on to the bots downstream of you");
    expect(rules).toContain("Do your stage's work yourself: you cannot hand it, or any part of it, to another bot.");
    expect(rules).toContain("you can only ask a bot upstream or downstream of you a question, with consult: true");
    expect(rules).toContain("attach every file you made for it with attach_file");
    expect(rules).not.toContain("every department");
    expect(rules).not.toMatch(/superior|subordinate/);
    expect(roster.split("\n")).toEqual([
      "[TEAM ROSTER]",
      `- Story — Screenwriter [stage: script] [upstream of you]: Writes every episode. [id: ${story.id}]`,
      `- Video — Video editor [stage: post-production] [downstream of you]: Cuts the shots into a film. [id: ${video.id}]`,
      "[/TEAM ROSTER]",
    ]);
  });

  it("tells a member its whole pipeline in order, the bots it cannot reach without their ids", () => {
    const { rules, roster } = peerRosterPrompt(reachablePeers(everyone, board), board, everyone);
    expect(rules).toContain("The roster below lists your team's whole pipeline in order, each bot with its stage and what it does, so you know who is on the team: only the bots marked upstream or downstream of you can be reached");
    expect(roster.split("\n")).toEqual([
      "[TEAM ROSTER]",
      "- Sol — Showrunner [Chief of Staff] [leads the pipeline] [not reachable from you]",
      `- Story — Screenwriter [stage: script] [upstream of you]: Writes every episode. [id: ${story.id}]`,
      `- Video — Video editor [stage: post-production] [downstream of you]: Cuts the shots into a film. [id: ${video.id}]`,
      "- Ops — Publisher [outside the pipeline's stages] [not reachable from you: its work comes along the pipeline from Sol]: Posts the film.",
      "- Drift — Intern [outside the pipeline's stages] [not reachable from you]",
      "[/TEAM ROSTER]",
    ]);
    expect(roster).not.toContain(chief.id);
    expect(roster).not.toContain(scout.id);
  });

  it("tells a member no line reaches that nobody is next to it, and still who is on its team", () => {
    expect(peerRosterPrompt(reachablePeers(everyone, drift), drift).roster).toBe("[TEAM ROSTER]\n- Nobody: no bot is upstream or downstream of you in the pipeline yet.\n[/TEAM ROSTER]");
    const { roster } = peerRosterPrompt(reachablePeers(everyone, drift), drift, everyone);
    expect(roster.split("\n").slice(1, -1).map((line) => line.split(" — ")[0])).toEqual(["- Sol", "- Story", "- Board", "- Video", "- Ops"]);
    expect(roster).not.toMatch(/\[id: /);
  });

  it("keeps one set of rules for every member of a pipeline, so moving a line does not change them", () => {
    expect(peerRosterPrompt([], video).rules).toBe(peerRosterPrompt([], board).rules);
    expect(peerRosterPrompt([], video).rules).not.toBe(peerRosterPrompt([], scout).rules);
  });

  it("tells the lead its whole pipeline in order, that it hands work only downstream, and that it reaches outside its team as before", () => {
    const { rules, roster } = chiefOfStaffPrompt(chief.id, everyone, true);
    expect(rules).toContain("In the Studio team's pipeline you are the lead: inside the team you reach only the bots downstream of you, marked so in your roster, and hand work only to them; never reach past them to a bot further down the pipeline.");
    expect(rules).toContain("Hand each part of a job to the downstream bot whose role fits it");
    expect(rules).toContain("Outside the Studio team, every other bot, in any department, is reachable too");
    expect(rules).not.toContain("Leads can coordinate their own specialists");
    expect(rules).not.toMatch(/superior|subordinate/);
    const lines = roster.split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "The Studio team's whole pipeline, in order, so you know every member: you hand work only to the bots marked downstream of you, and the others get their work along the pipeline. When the person asks who is on the team, name them all.",
      `- Story — Screenwriter [stage: script] [downstream of you]: Writes every episode. [id: ${story.id}]`,
      "- Board — Storyboard artist [stage: storyboard] [not reachable from you: its work comes along the pipeline from Story]: Draws every shot.",
      "- Video — Video editor [stage: post-production] [not reachable from you: its work comes along the pipeline from Board]: Cuts the shots into a film.",
      `- Ops — Publisher [outside the pipeline's stages] [downstream of you]: Posts the film. [id: ${ops.id}]`,
      "- Drift — Intern [outside the pipeline's stages] [not reachable from you]",
      "Other bots you can reach, in other departments:",
    ]);
    expect(lines.slice(7).map((line) => line.match(/\[id: (.+)\]$/)?.[1]).sort()).toEqual(ids([main, scout, loner]));
  });

  it("keeps telling a Chief in no pipeline that leads coordinate their own specialists", () => {
    expect(chiefOfStaffPrompt(main.id, everyone, true).rules).toContain("Leads can coordinate their own specialists.");
  });

  it("tells a bot with a Chief's tools that is a member, not the lead, to ask its neighbours and do its own stage", () => {
    const deputy = { ...board, chiefOfStaff: true };
    const { rules, roster } = chiefOfStaffPrompt(board.id, everyone.map((bot) => (bot.id === board.id ? deputy : bot)), true);
    expect(rules).toContain("In the Studio team's pipeline you are a member, not the lead: you can reach only the bots upstream and downstream of you, marked so in your roster, and only to ask a question with consult: true.");
    expect(rules).not.toContain("Outside the Studio team");
    expect(roster.split("\n").slice(0, 4)).toEqual([
      "The Studio team's whole pipeline, in order, so you know every member: you reach only the bots marked upstream or downstream of you. When the person asks who is on the team, name them all.",
      "- Sol — Showrunner [Chief of Staff] [leads the pipeline] [not reachable from you]",
      `- Story — Screenwriter [stage: script] [upstream of you]: Writes every episode. [id: ${story.id}]`,
      `- Video — Video editor [stage: post-production] [downstream of you]: Cuts the shots into a film. [id: ${video.id}]`,
    ]);
  });

  it("lists the bots of a department the lead is also responsible for apart from its pipeline", () => {
    const { roster } = chiefOfStaffPrompt(chief.id, [main, { ...chief, managedSections: ["Sales"] }, story, board, video, scout], true);
    expect(roster).toContain(`Your team in the other departments you are responsible for, outside your pipeline:\n- Scout — Researcher (Sales) [id: ${scout.id}]`);
    expect(roster).not.toContain(video.id);
  });

  it("tells a project's lead that past its lines only the main bot can be reached, and names the member it does not reach without its id", () => {
    const { rules, roster } = chiefOfStaffPrompt(lead.id, [main, chief, scout, lead, writer, editor], true);
    expect(rules).toContain("In the Launch project's pipeline you are the lead: inside the project you reach only the bots downstream of you");
    expect(rules).toContain("Outside the project only the main bot, which belongs to no project, can be reached: consult it, or hand it what crosses projects, with coordinate_bots.");
    expect(roster).toContain(`- Writer — Copywriter [stage: script] [downstream of you] [id: ${writer.id}]`);
    expect(roster).toContain("- Editor — Editor [stage: post-production] [not reachable from you: its work comes along the pipeline from Writer]");
    expect(roster).toContain(main.id);
    expect(roster).not.toContain(scout.id);
    expect(roster).not.toContain(editor.id);
  });

  it("marks the room's outsiders it can reach and how it may use each", () => {
    const told = roomPeerRosterSystemPrompt([story, video], board);
    expect(told).toContain("in your team's pipeline you can ask them a question yourself with coordinate_bots and consult: true; you cannot hand them work");
    expect(told).toContain("[upstream of you]");
    expect(told).toContain("[downstream of you]");
    expect(roomPeerRosterSystemPrompt([chief], scout)).toContain("you can reach any of them yourself");
    expect(roomPeerRosterSystemPrompt([story, scout], chief)).toContain("in your own team hand work only to one marked downstream of you, never to a bot further down the pipeline; any other bot listed is outside your team");
  });

  it("explains the pipeline when a bot asks why it cannot reach someone, the lead's reach outside its team included", () => {
    expect(peerAccessHelp(board, everyone)).toContain("you can reach the bots upstream and downstream of you and no other bot");
    expect(peerAccessHelp(board, everyone)).toContain("you cannot hand your work to another bot");
    expect(peerAccessHelp(chief, everyone)).toContain("In your own team you lead its pipeline: there you can reach only the bots downstream of you");
    expect(peerAccessHelp(chief, everyone)).toContain("Outside your team you can reach every other bot, in any department");
    expect(peerAccessHelp(lead, [lead, writer])).toContain("Outside the project you can reach the main bot, which belongs to no project");
    expect(peerAccessHelp(scout, everyone)).toContain("Every bot can reach every other bot");
  });
});

describe("what list_bots says of a pipeline", () => {
  it("gives a pipeline's member its whole team in order, the id only of the bots it reaches, and nothing to a bot in none", () => {
    expect(pipelineRosterWire(board, everyone)).toEqual({ pipeline: [
      { name: "Sol", title: "Showrunner", stages: ["lead"], reach: "none" },
      { name: "Story", title: "Screenwriter", stages: ["script"], reach: "upstream", id: story.id },
      { name: "Video", title: "Video editor", stages: ["post"], reach: "downstream", id: video.id },
      { name: "Ops", title: "Publisher", stages: ["other"], reach: "none", from: ["Sol"] },
      { name: "Drift", title: "Intern", stages: ["other"], reach: "none" },
    ] });
    expect(pipelineRosterWire(chief, everyone).pipeline?.map(({ name, reach }) => [name, reach])).toEqual([
      ["Story", "downstream"], ["Board", "none"], ["Video", "none"], ["Ops", "downstream"], ["Drift", "none"],
    ]);
    expect(pipelineRosterWire(scout, everyone)).toEqual({});
  });
});
