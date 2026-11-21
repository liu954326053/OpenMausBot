import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chiefOfStaffPrompt } from "./chief-of-staff.ts";
import {
  canManage,
  flowPlace,
  flowRelation,
  peerAccessHelp,
  peerRosterPrompt,
  reachablePeers,
  reachesOnlyHere,
  resolveTeammate,
  roomPeerRosterSystemPrompt,
  type RosterMember,
} from "./peer-roster.ts";
import { installTeamFlows, type FlowLine } from "./team-flow/flows.ts";

const main: RosterMember = { id: "00000000-main", name: "MagicBot", defaultBot: {}, chiefOfStaff: true };
const chief: RosterMember = { id: "10000000-chief", name: "Sol", title: "Showrunner", section: "Studio", chiefOfStaff: true };
const story: RosterMember = { id: "20000000-story", name: "Story", title: "Story editor", description: "Picks the stories worth telling.", section: "Studio" };
const board: RosterMember = { id: "30000000-board", name: "Board", title: "Storyboard artist", description: "Draws every shot.", section: "Studio" };
const video: RosterMember = { id: "40000000-video", name: "Video", title: "Video editor", description: "Cuts the boards into a video.", section: "Studio" };
const scout: RosterMember = { id: "50000000-scout", name: "Scout", title: "Researcher", section: "Sales" };
const loner: RosterMember = { id: "60000000-loner", name: "Loner", title: "Helper" };
const everyone = [main, chief, story, board, video, scout, loner];

/** Sol at the top of Studio, with Story and Board under it and Video under Board; Sales and General have no flow. */
const STUDIO: Record<string, string> = { [story.id]: chief.id, [board.id]: chief.id, [video.id]: board.id };

const lead: RosterMember = { id: "70000000-lead", name: "Lead", title: "Project lead", section: "Launch", chiefOfStaff: true, teamProject: { id: "launch" } };
const writer: RosterMember = { id: "80000000-writer", name: "Writer", title: "Copywriter", section: "Launch", teamProject: { id: "launch" } };
const LAUNCH: Record<string, string> = { [writer.id]: lead.id };

function lineIn(flow: Record<string, string>, root: string, botId: string): FlowLine | null {
  if (botId !== root && !Object.hasOwn(flow, botId)) return null;
  return { superior: flow[botId] ?? null, subordinates: Object.keys(flow).filter((member) => flow[member] === botId), team: [root, ...Object.keys(flow)] };
}

const lineOf = (botId: string): FlowLine | null => lineIn(STUDIO, chief.id, botId) ?? lineIn(LAUNCH, lead.id, botId);

beforeEach(() => installTeamFlows({ parents: () => ({}), projectParents: () => ({}), lineOf }));
afterEach(() => installTeamFlows({ parents: () => ({}), projectParents: () => ({}), lineOf: () => null }));

const ids = (bots: readonly RosterMember[]) => bots.map((bot) => bot.id).sort();
const resolve = (from: RosterMember, raw: string, handing?: "work" | "question") =>
  resolveTeammate(everyone, from, raw, () => ({ where: "elsewhere" }), undefined, undefined, handing);

describe("who a bot in a flow is told of", () => {
  it("lists a member's superior and direct subordinates, and no one else", () => {
    expect(ids(reachablePeers(everyone, board))).toEqual(ids([chief, video]));
    expect(ids(reachablePeers(everyone, video))).toEqual(ids([board]));
  });

  it("lists the Chief's direct subordinates in its team and every bot it reaches outside the team, never one further down", () => {
    expect(ids(reachablePeers(everyone, chief))).toEqual(ids([story, board, main, scout, loner]));
  });

  it("leaves a bot in no flow reaching everyone, the flow's members included", () => {
    expect(ids(reachablePeers(everyone, scout))).toEqual(ids([main, chief, story, board, video, loner]));
    expect(ids(reachablePeers(everyone, main))).toEqual(ids([chief, story, board, video, scout, loner]));
  });

  it("never lets a wider reach list past the flow's lines", () => {
    expect(ids(reachablePeers(everyone, story, (bot) => bot.id !== story.id))).toEqual(ids([chief]));
    expect(ids(reachablePeers(everyone, chief, (bot) => bot.id !== chief.id))).not.toContain(video.id);
  });

  it("marks how each listed bot stands to it, and says where it stands itself", () => {
    expect(flowRelation(board, chief)).toEqual({ flow: "superior" });
    expect(flowRelation(board, video)).toEqual({ flow: "subordinate" });
    expect(flowRelation(board, story)).toEqual({});
    expect(flowRelation(scout, chief)).toEqual({});
    expect([flowPlace(chief), flowPlace(board), flowPlace(scout)]).toEqual([{ flow: "top" }, { flow: "under" }, {}]);
  });

  it("keeps a flow's members, like a project's bots, from the person's other places, and leaves a team's Chief its own", () => {
    expect(reachesOnlyHere(video)).toBe(true);
    expect(reachesOnlyHere(scout)).toBe(false);
    expect(reachesOnlyHere(chief)).toBe(false);
    expect(reachesOnlyHere({ id: "x", teamProject: { id: "p" } })).toBe(true);
  });
});

describe("a project's flow", () => {
  const place = [main, chief, scout, lead, writer];
  const resolveIn = (from: RosterMember, raw: string, handing?: "work" | "question") =>
    resolveTeammate(place, from, raw, () => null, undefined, undefined, handing);

  it("lets the lead reach its direct subordinates and, past the project's wall, the main bot alone", () => {
    expect(ids(reachablePeers(place, lead))).toEqual(ids([writer, main]));
    expect(resolveIn(lead, "MagicBot", "question")).toEqual({ id: main.id, byName: true });
    expect(resolveIn(lead, writer.id)).toEqual({ id: writer.id, byName: false });
    expect(resolveIn(lead, scout.id)).toEqual({ error: expect.stringContaining(`No bot with id or name "${scout.id}"`) });
  });

  it("keeps a project member to its lines: not even the main bot", () => {
    expect(ids(reachablePeers(place, writer))).toEqual(ids([lead]));
    expect(resolveIn(writer, main.id, "question")).toEqual({ error: expect.stringContaining("MagicBot is not on your lines in your team's flow") });
  });
});

describe("handing work in a flow", () => {
  it("hands work to a direct subordinate, by id or by name", () => {
    expect(resolve(chief, board.id)).toEqual({ id: board.id, byName: false });
    expect(resolve(board, "Video")).toEqual({ id: video.id, byName: true });
  });

  it("refuses work further down and names the subordinate it goes through and whom it can hand work to", () => {
    const refused = resolve(chief, video.id);
    expect(refused).toEqual({ error: expect.stringContaining("Video is not your direct subordinate: it works under Board. Hand the work to Board") });
    expect((refused as { error: string }).error).toContain(`You can hand work to your direct subordinates: Story (id ${story.id}), Board (id ${board.id}).`);
    expect((refused as { error: string }).error).toContain("Nothing was sent.");
    expect(resolve(chief, "Video", "question")).toEqual({ error: expect.stringContaining("Video is not your direct subordinate: it works under Board. Ask Board, who can ask Video in turn.") });
  });

  it("lets the Chief hand work or a question outside its team as a bot in no flow would: another department, General, the main bot", () => {
    expect(resolve(chief, scout.id)).toEqual({ id: scout.id, byName: false });
    expect(resolve(chief, "Loner")).toEqual({ id: loner.id, byName: true });
    expect(resolve(chief, "MagicBot", "question")).toEqual({ id: main.id, byName: true });
    expect(resolve(chief, "Ledger")).toEqual({ error: "elsewhere" });
  });

  it("refuses work up to the superior, and lets a question go up", () => {
    expect(resolve(board, chief.id)).toEqual({ error: expect.stringContaining("Sol is your superior in your team's flow, and work goes only down it") });
    expect(resolve(board, chief.id, "question")).toEqual({ id: chief.id, byName: false });
    expect(resolve(video, "Sol", "question")).toEqual({ error: expect.stringContaining("Sol is not on your lines in your team's flow") });
  });

  it("refuses a sideways teammate, a bot of another department and the main bot, by id and by name", () => {
    for (const target of [story.id, "Story", scout.id, "Scout", main.id, "MagicBot"]) {
      const refused = resolve(board, target, "question");
      expect(refused, target).toEqual({ error: expect.stringContaining("is not on your lines in your team's flow") });
      expect((refused as { error: string }).error).toContain(`You can hand work to your direct subordinates: Video (id ${video.id}). You can ask your superior, Sol (id ${chief.id}), a question with consult: true.`);
    }
  });

  it("tells a bot without subordinates to do the work itself", () => {
    expect(resolve(video, story.id)).toEqual({ error: expect.stringContaining("You have no subordinates to hand work to, so do it yourself.") });
  });

  it("leaves a bot in no flow handing work to anyone, and never tells a flow's bot of another place", () => {
    expect(resolve(scout, video.id)).toEqual({ id: video.id, byName: false });
    expect(resolve(main, "Video")).toEqual({ id: video.id, byName: true });
    expect(resolve(scout, "Ledger")).toEqual({ error: "elsewhere" });
    expect(resolve(story, "Ledger")).toEqual({ error: expect.stringContaining('No bot with id or name "Ledger"') });
  });

  it("narrows reach only: authority over a teammate stays with the department", () => {
    expect(canManage(chief, video)).toBe(true);
  });
});

describe("what a bot in a flow is told", () => {
  it("tells a member its superior, its subordinates with what each does, and to attach its files when it finishes", () => {
    const { rules, roster } = peerRosterPrompt(reachablePeers(everyone, board), board);
    expect(rules).toContain("Hand work only to your direct subordinates");
    expect(rules).toContain("hand work down in the order they are listed");
    expect(rules).toContain("attach every file you made for it with attach_file");
    expect(rules).not.toContain("every department");
    expect(roster.split("\n")).toEqual([
      "[TEAM ROSTER]",
      `- Sol — Showrunner [Chief of Staff] [your superior] [id: ${chief.id}]`,
      `- Video — Video editor [your subordinate]: Cuts the boards into a video. [id: ${video.id}]`,
      "[/TEAM ROSTER]",
    ]);
  });

  it("tells a member without subordinates to do the work itself", () => {
    expect(peerRosterPrompt(reachablePeers(everyone, video), video).roster).toMatch(/^You have no subordinates in the flow: do the work yourself\.\n\[TEAM ROSTER\]/);
  });

  it("keeps one set of rules for every bot in a flow, so moving a line does not change them", () => {
    expect(peerRosterPrompt([], video).rules).toBe(peerRosterPrompt([], board).rules);
  });

  it("tells the Chief its direct subordinates in order with what each does, and that it reaches outside its team as before", () => {
    const { rules, roster } = chiefOfStaffPrompt(chief.id, everyone, true);
    expect(rules).toContain("In the Studio team's flow you are at the top: inside the team you reach only your direct subordinates and hand work only to them");
    expect(rules).toContain("Outside the Studio team, every other bot, in any department, is reachable too");
    const lines = roster.split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "Your direct subordinates in the Studio team's flow, in the order to hand work down to them:",
      `- Story — Story editor [your subordinate]: Picks the stories worth telling. [id: ${story.id}]`,
      `- Board — Storyboard artist [your subordinate]: Draws every shot. [id: ${board.id}]`,
    ]);
    expect(lines[3]).toBe("Other bots you can reach, in other departments:");
    expect(lines.slice(4).map((line) => line.match(/\[id: (.+)\]$/)?.[1]).sort()).toEqual(ids([main, scout, loner]));
  });

  it("lists the bots of a department the Chief is also responsible for apart from its flow", () => {
    const { roster } = chiefOfStaffPrompt(chief.id, [main, { ...chief, managedSections: ["Sales"] }, story, board, video, scout], true);
    expect(roster).toContain(`Your team in the other departments you are responsible for, outside your flow:\n- Scout — Researcher (Sales) [id: ${scout.id}]`);
    expect(roster).not.toContain(video.id);
  });

  it("tells a project's lead that past its lines only the main bot can be reached", () => {
    const { rules, roster } = chiefOfStaffPrompt(lead.id, [main, chief, scout, lead, writer], true);
    expect(rules).toContain("In the Launch project's flow you are at the top");
    expect(rules).toContain("Outside the project only the main bot, which belongs to no project, can be reached: consult it, or hand it what crosses projects, with coordinate_bots.");
    expect(roster).toContain(`- Writer — Copywriter [your subordinate] [id: ${writer.id}]`);
    expect(roster).toContain(main.id);
    expect(roster).not.toContain(scout.id);
  });

  it("marks the room's outsiders it can reach and how it may use each", () => {
    const told = roomPeerRosterSystemPrompt([chief, video], board);
    expect(told).toContain("hand work only to one marked your subordinate");
    expect(told).toContain("[your superior]");
    expect(told).toContain("[your subordinate]");
    expect(roomPeerRosterSystemPrompt([chief], scout)).toContain("you can reach any of them yourself");
    expect(roomPeerRosterSystemPrompt([board, scout], chief)).toContain("in your own team hand work only to one marked your subordinate, never to a bot below it; any other bot listed is outside your team");
  });

  it("explains the flow when a bot asks why it cannot reach someone, the Chief's reach outside its team included", () => {
    expect(peerAccessHelp(board, everyone)).toContain("you can reach your superior and your direct subordinates and no other bot");
    expect(peerAccessHelp(chief, everyone)).toContain("In your own team you are at the top of its flow: there you can reach only your direct subordinates");
    expect(peerAccessHelp(chief, everyone)).toContain("Outside your team you can reach every other bot, in any department");
    expect(peerAccessHelp(lead, [lead, writer])).toContain("Outside the project you can reach the main bot, which belongs to no project");
    expect(peerAccessHelp(scout, everyone)).toContain("Every bot can reach every other bot");
  });
});
