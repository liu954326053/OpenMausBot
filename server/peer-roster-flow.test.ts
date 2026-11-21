import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chiefOfStaffPrompt } from "./chief-of-staff.ts";
import {
  canManage,
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

function lineOf(botId: string): FlowLine | null {
  if (botId !== chief.id && !Object.hasOwn(STUDIO, botId)) return null;
  return { superior: STUDIO[botId] ?? null, subordinates: Object.keys(STUDIO).filter((member) => STUDIO[member] === botId) };
}

beforeEach(() => installTeamFlows({ parents: () => ({}), projectParents: () => ({}), lineOf }));
afterEach(() => installTeamFlows({ parents: () => ({}), projectParents: () => ({}), lineOf: () => null }));

const ids = (bots: readonly RosterMember[]) => bots.map((bot) => bot.id).sort();
const resolve = (from: RosterMember, raw: string, handing?: "work" | "question") =>
  resolveTeammate(everyone, from, raw, () => ({ where: "elsewhere" }), undefined, undefined, handing);

describe("who a bot in a flow is told of", () => {
  it("lists its superior and its direct subordinates, and no one else", () => {
    expect(ids(reachablePeers(everyone, chief))).toEqual(ids([story, board]));
    expect(ids(reachablePeers(everyone, board))).toEqual(ids([chief, video]));
    expect(ids(reachablePeers(everyone, video))).toEqual(ids([board]));
  });

  it("leaves a bot in no flow reaching everyone, the flow's members included", () => {
    expect(ids(reachablePeers(everyone, scout))).toEqual(ids([main, chief, story, board, video, loner]));
    expect(ids(reachablePeers(everyone, main))).toEqual(ids([chief, story, board, video, scout, loner]));
  });

  it("never lets a wider reach list past the flow's lines", () => {
    expect(ids(reachablePeers(everyone, story, (bot) => bot.id !== story.id))).toEqual(ids([chief]));
  });

  it("marks how each listed bot stands to it", () => {
    expect(flowRelation(board, chief)).toEqual({ flow: "superior" });
    expect(flowRelation(board, video)).toEqual({ flow: "subordinate" });
    expect(flowRelation(board, story)).toEqual({});
    expect(flowRelation(scout, chief)).toEqual({});
  });

  it("keeps a flow's bots, like a project's, from the person's other places", () => {
    expect(reachesOnlyHere(video)).toBe(true);
    expect(reachesOnlyHere(scout)).toBe(false);
    expect(reachesOnlyHere({ id: "x", teamProject: { id: "p" } })).toBe(true);
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

  it("tells the Chief its direct subordinates in order, with what each does, and nothing about reaching everyone", () => {
    const { rules, roster } = chiefOfStaffPrompt(chief.id, everyone, true);
    expect(rules).toContain("In the Studio team's flow you are at the top: you hand work only to your direct subordinates");
    expect(rules).not.toContain("Every other bot on this team");
    expect(roster.split("\n")).toEqual([
      "Your direct subordinates in the Studio team's flow, in the order to hand work down to them:",
      `- Story — Story editor [your subordinate]: Picks the stories worth telling. [id: ${story.id}]`,
      `- Board — Storyboard artist [your subordinate]: Draws every shot. [id: ${board.id}]`,
    ]);
  });

  it("marks the room's outsiders it can reach and how it may use each", () => {
    const told = roomPeerRosterSystemPrompt([chief, video], board);
    expect(told).toContain("hand work only to one marked your subordinate");
    expect(told).toContain("[your superior]");
    expect(told).toContain("[your subordinate]");
    expect(roomPeerRosterSystemPrompt([chief], scout)).toContain("you can reach any of them yourself");
  });

  it("explains the flow when a bot asks why it cannot reach someone", () => {
    expect(peerAccessHelp(board, everyone)).toContain("you can reach your superior and your direct subordinates and no other bot");
    expect(peerAccessHelp(scout, everyone)).toContain("Every bot can reach every other bot");
  });
});
