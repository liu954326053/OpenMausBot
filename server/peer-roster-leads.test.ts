import { describe, expect, it } from "vitest";

import type { TeamProjectMembership } from "../shared/team-projects.ts";
import { chiefOfStaffPrompt } from "./chief-of-staff.ts";
import {
  canManage,
  canReach,
  peerAccessHelp,
  peerRosterPrompt,
  reachablePeers,
  reachesOnlyHere,
  resolveTeammate,
  roomPeerRosterSystemPrompt,
  type RosterMember,
} from "./peer-roster.ts";

const main: RosterMember = { id: "00000000-main", name: "MagicBot", defaultBot: {}, chiefOfStaff: true };
const chief: RosterMember = { id: "10000000-chief", name: "Sol", title: "Showrunner", section: "Studio", chiefOfStaff: true };
const story: RosterMember = { id: "20000000-story", name: "Story", title: "Screenwriter", description: "Writes every episode.", section: "Studio" };
const board: RosterMember = { id: "30000000-board", name: "Board", title: "Storyboard artist", description: "Draws every shot.", section: "Studio" };
const video: RosterMember = { id: "40000000-video", name: "Video", title: "Video editor", description: "Cuts the shots into a film.", section: "Studio" };
const scout: RosterMember = { id: "50000000-scout", name: "Scout", title: "Researcher", section: "Sales" };
const loner: RosterMember = { id: "60000000-loner", name: "Loner", title: "Helper" };
const members = [story, board, video];
const everyone = [main, chief, ...members, scout, loner];

const inLaunch = (role: string, episode?: TeamProjectMembership["episode"]): TeamProjectMembership => ({ id: "launch", role, ...(episode ? { episode } : {}) });
const lead: RosterMember = { id: "70000000-lead", name: "Lead", title: "Showrunner", section: "Launch", chiefOfStaff: true, teamProject: inLaunch("showrunner") };
const writer: RosterMember = { id: "80000000-writer", name: "Writer", title: "Screenwriter", section: "Launch", teamProject: inLaunch("screenwriter") };
const boardOne: RosterMember = { id: "90000000-board-ep01", name: "Board EP01", title: "Storyboard artist", section: "Launch", teamProject: inLaunch("storyboard-artist", { number: 1, job: "storyboard" }) };
const cutTwo: RosterMember = { id: "91000000-cut-ep02", name: "Cut EP02", title: "Video editor", section: "Launch", teamProject: inLaunch("video-editor", { number: 2, job: "post" }) };
const project = [writer, boardOne, cutTwo];
const place = [...everyone, lead, ...project];

const ids = (bots: readonly RosterMember[]) => bots.map((bot) => bot.id).sort();
const resolve = (bots: readonly RosterMember[], from: RosterMember, raw: string) => resolveTeammate(bots, from, raw, () => ({ where: "elsewhere" }));
const lineWords = /upstream|downstream|pipeline|stage:/;

describe("a team's lead and its members", () => {
  it("lets the lead reach every member, by id and by name, and every member reach the lead", () => {
    for (const member of members) {
      expect(canReach(chief, member)).toBe(true);
      expect(canReach(member, chief)).toBe(true);
      expect(resolve(everyone, chief, member.id)).toEqual({ id: member.id, byName: false });
      expect(resolve(everyone, chief, member.name!)).toEqual({ id: member.id, byName: true });
      expect(resolve(everyone, member, "Sol")).toEqual({ id: chief.id, byName: true });
    }
  });

  it("leaves every bot outside a project reaching every other one, in any department", () => {
    for (const from of everyone) expect(ids(reachablePeers(everyone, from))).toEqual(ids(everyone.filter((bot) => bot.id !== from.id)));
    expect(resolve(everyone, chief, "MagicBot")).toEqual({ id: main.id, byName: true });
    expect(resolve(everyone, scout, "Video")).toEqual({ id: video.id, byName: true });
  });

  it("offers the person's other places to a bot outside a project, a member as well as the lead", () => {
    expect(resolve(everyone, chief, "Ledger")).toEqual({ error: "elsewhere" });
    expect(resolve(everyone, story, "Ledger")).toEqual({ error: "elsewhere" });
    expect([main, chief, ...members, scout].map(reachesOnlyHere)).toEqual([false, false, false, false, false, false]);
  });

  it("gives authority over a member to its department's Chief", () => {
    expect(canManage(chief, video)).toBe(true);
  });
});

describe("a project's lead and its bots", () => {
  it("lets the lead reach every bot of the project, each episode's own included, and each of them reach the lead", () => {
    expect(ids(reachablePeers(place, lead))).toEqual(ids([...project, main]));
    for (const bot of project) {
      expect(resolve(place, lead, bot.id)).toEqual({ id: bot.id, byName: false });
      expect(resolve(place, lead, bot.name!)).toEqual({ id: bot.id, byName: true });
      expect(resolve(place, bot, lead.id)).toEqual({ id: lead.id, byName: false });
      expect(resolve(place, bot, "Lead")).toEqual({ id: lead.id, byName: true });
      expect(canManage(lead, bot)).toBe(true);
    }
  });

  it("lets the lead reach the main bot past the project's wall, and no other bot outside it", () => {
    expect(resolve(place, lead, "MagicBot")).toEqual({ id: main.id, byName: true });
    expect(resolve(place, lead, scout.id)).toEqual({ error: expect.stringContaining(`No bot with id or name "${scout.id}"`) });
    expect(resolve(place, lead, story.id)).toEqual({ error: expect.stringContaining(`No bot with id or name "${story.id}"`) });
  });

  it("keeps every bot of the project, the lead included, from the person's other places", () => {
    expect([lead, ...project].map(reachesOnlyHere)).toEqual([true, true, true, true]);
    expect(resolve(place, lead, "Ledger")).toEqual({ error: expect.stringContaining('No bot with id or name "Ledger"') });
  });
});

describe("what a lead and its members are told", () => {
  it("lists every member, with its id, to the team's lead, and that leads coordinate their own specialists", () => {
    const { rules, roster } = chiefOfStaffPrompt(chief.id, everyone, true);
    expect(rules).toContain("Leads can coordinate their own specialists.");
    expect(rules).toContain("Every other bot on this team, in any department, is reachable too");
    expect(roster).toContain("Current Studio department (your team):");
    for (const member of members) expect(roster).toContain(`[id: ${member.id}]`);
    expect(`${rules}\n${roster}`).not.toMatch(lineWords);
  });

  it("lists the lead, with its id, to each member", () => {
    for (const member of members) {
      const { rules, roster } = peerRosterPrompt(reachablePeers(everyone, member), member);
      expect(roster).toContain(`- Sol — Showrunner (Studio) [Chief of Staff] [id: ${chief.id}]`);
      expect(`${rules}\n${roster}`).not.toMatch(lineWords);
    }
  });

  it("lists every bot of the project to its lead, each episode's own with its id, and the main bot beyond", () => {
    const { rules, roster } = chiefOfStaffPrompt(lead.id, place, true);
    for (const bot of project) expect(roster).toContain(`[id: ${bot.id}]`);
    expect(roster).toContain(`[id: ${main.id}]`);
    expect(roster).not.toContain(scout.id);
    expect(`${rules}\n${roster}`).not.toMatch(/upstream|downstream|stage:/);
  });

  it("has the project's lead agree the brief in the group chat, plan the production once, and follow up when told", () => {
    const { rules } = chiefOfStaffPrompt(lead.id, place, true);
    expect(rules).toContain("first agree the brief with the person in the project's group chat");
    expect(rules).toContain("then call production_plan once");
    expect(rules).toContain("tells you when a task fails");
    expect(chiefOfStaffPrompt(chief.id, place, true).rules).not.toContain("production_plan");
    expect(chiefOfStaffPrompt(main.id, place, true).rules).not.toContain("production_plan");
    expect(chiefOfStaffPrompt(lead.id, place, false).rules).not.toContain("production_plan");
  });

  it("tells a bot it can reach the room's outsiders itself, and why it may not reach a bot in the words every bot is told", () => {
    expect(roomPeerRosterSystemPrompt([chief])).toContain("you can reach any of them yourself");
    expect(peerAccessHelp(scout, everyone)).toContain("Every bot can reach every other bot");
    expect(peerAccessHelp(story, everyone)).toBe(peerAccessHelp(scout, everyone));
    expect(peerAccessHelp(chief, everyone)).toBe(peerAccessHelp(scout, everyone));
  });
});
