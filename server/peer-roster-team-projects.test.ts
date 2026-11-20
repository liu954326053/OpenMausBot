import { describe, expect, it } from "vitest";

import { chiefOfStaffPrompt } from "./chief-of-staff.ts";
import {
  PEER_ACCESS_HELP,
  canManage,
  canReach,
  departmentOpenTo,
  departmentRefusal,
  hasAuthority,
  inChargeOfEvery,
  isMainBot,
  isTeamProjectLead,
  peerAccessHelp,
  peerAllowed,
  peerRosterPrompt,
  reachRefusal,
  reachablePeers,
  renderRoster,
  resolveTeammate,
  sameTeamProject,
  teamProjectAllows,
  teamProjectRoomChange,
  teamProjectRoomConflict,
  teamProjectSetupRefusal,
  unreachableTeammate,
  type RosterMember,
} from "./peer-roster.ts";

const DRAMA_A = "Midnight Train";
const DRAMA_B = "Paper Moon";

const main: RosterMember = { id: "00000000-main", name: "MagicBot", defaultBot: {}, chiefOfStaff: true, managedSections: ["Studio", DRAMA_A, DRAMA_B] };
const studioChief: RosterMember = { id: "10000000-studio-chief", name: "Sol", section: "Studio", chiefOfStaff: true };
const outside: RosterMember = { id: "20000000-outside", name: "Otto", title: "Researcher", section: "Studio" };
const leadA: RosterMember = { id: "a1000000-lead", name: "Ava", title: "Showrunner", section: DRAMA_A, chiefOfStaff: true, teamProject: { id: "project-a" } };
const memberA: RosterMember = { id: "a2000000-member", name: "Arlo", title: "Writer", section: DRAMA_A, teamProject: { id: "project-a" } };
const leadB: RosterMember = { id: "b1000000-lead", name: "Bea", title: "Showrunner", section: DRAMA_B, chiefOfStaff: true, teamProject: { id: "project-b" } };
const memberB: RosterMember = { id: "b2000000-member", name: "Bianca", title: "Writer", section: DRAMA_B, teamProject: { id: "project-b" } };
const everyone = [main, studioChief, outside, leadA, memberA, leadB, memberB];

const ids = (bots: readonly RosterMember[]) => bots.map((bot) => bot.id).sort();
const store = { bots: everyone, bot: (id: string) => everyone.find((bot) => bot.id === id) };

describe("who a team project's wall lets through", () => {
  it("names the main bot and each project's lead", () => {
    expect(everyone.filter(isMainBot)).toEqual([main]);
    expect(everyone.filter(isTeamProjectLead)).toEqual([leadA, leadB]);
    expect(isMainBot({ defaultBot: {}, teamProject: { id: "project-a" } })).toBe(false);
    expect(isTeamProjectLead(studioChief)).toBe(false);
  });

  it("tells bots of one project, or of none, from bots of different ones", () => {
    expect(sameTeamProject(leadA, memberA)).toBe(true);
    expect(sameTeamProject(outside, main)).toBe(true);
    expect(sameTeamProject(memberA, memberB)).toBe(false);
    expect(sameTeamProject(memberA, outside)).toBe(false);
  });

  it.each([
    ["a project's member", memberA, [leadA, main]],
    ["a project's lead", leadA, [memberA, main]],
    ["the other project's member", memberB, [leadB, main]],
    ["the main bot", main, [studioChief, outside, leadA, leadB]],
    ["a bot outside every project", outside, [main, studioChief]],
    ["a Chief outside every project", studioChief, [main, outside]],
  ])("%s reaches exactly its own side and whom the rule adds", (_who, from, expected) => {
    expect(ids(reachablePeers(everyone, from))).toEqual(ids(expected));
    for (const target of everyone) {
      if (target.id === from.id) continue;
      const allowed = expected.includes(target);
      expect(teamProjectAllows(from, target)).toBe(allowed);
      expect(canReach(from, target)).toBe(allowed);
      expect(peerAllowed(from, target)).toBe(allowed);
    }
  });

  it("is one-way between a project's member and the main bot", () => {
    expect(canReach(memberA, main)).toBe(true);
    expect(canReach(main, memberA)).toBe(false);
  });

  it("holds for a project that has no lead: the main bot reaches nobody in it", () => {
    const leaderless = everyone.map((bot) => (bot.id === leadA.id ? { ...bot, chiefOfStaff: false } : bot));
    expect(ids(reachablePeers(leaderless, main))).toEqual(ids([studioChief, outside, leadB]));
  });

  it("counts a bot filed in a project's department without the project's stamp as outside it", () => {
    const stray: RosterMember = { id: "c0000000-stray", name: "Cy", section: DRAMA_A };
    expect(canReach(leadA, stray)).toBe(false);
    expect(canReach(stray, memberA)).toBe(false);
    expect(canReach(stray, outside)).toBe(true);
  });

  it("is never widened by reach someone else decides", () => {
    expect(ids(reachablePeers(everyone, memberA, (bot) => bot.id !== memberA.id))).toEqual(ids([leadA, main]));
    expect(ids(reachablePeers(everyone, outside, (bot) => bot.id !== outside.id))).toEqual(ids([main, studioChief]));
    expect(ids(reachablePeers(everyone, main, (bot) => bot.id !== main.id))).toEqual(ids([studioChief, outside, leadA, leadB]));
  });

  it("keeps the audience rule on both sides of the wall", () => {
    const restricted = { ...memberA, visibility: "admins" };
    expect(canReach(leadA, restricted)).toBe(false);
    expect(reachRefusal(leadA, restricted)).toContain("is shared with different people");
  });
});

describe("a bot behind the wall does not exist for the caller", () => {
  const refusal = (from: RosterMember, raw: string) => {
    const resolved = resolveTeammate(everyone, from, raw);
    if (!("error" in resolved)) throw new Error(`${raw} resolved to ${resolved.id}`);
    return resolved.error;
  };

  it.each([
    ["its exact id", memberB.id],
    ["the start of its id", memberB.id.slice(0, 9)],
    ["its id in capitals", memberB.id.toUpperCase()],
    ["its name", "Bianca"],
    ["its name as a model slugs it", "@bianca"],
  ])("refuses another project's bot named by %s, without its name or id", (_how, raw) => {
    const said = refusal(memberA, raw);
    expect(said).toContain(`No bot with id or name "${raw.replace(/^@/, "@")}"`);
    for (const secret of [memberB.id, "Bianca", DRAMA_B, "project-b"]) {
      if (!raw.toLowerCase().includes(secret.toLowerCase())) expect(said).not.toContain(secret);
    }
    expect(said).toContain(`You can reach: Ava (id ${leadA.id}), MagicBot (id ${main.id}).`);
    expect(said).toContain("You work inside one team project");
    expect(said).not.toContain(PEER_ACCESS_HELP);
  });

  it("answers a name behind the wall exactly as it answers a name nobody has", () => {
    const withName = (name: string) => refusal(memberA, name).replaceAll(name, "<name>");
    expect(withName("Bianca")).toBe(withName("Nobody"));
    expect(withName("Otto")).toBe(withName("Nobody"));
    const byId = (id: string) => refusal(memberA, id).replaceAll(id, "<id>");
    expect(byId(memberB.id)).toBe(byId("ffffffff-none"));
  });

  it("refuses the main bot a project's member and gives it the lead", () => {
    expect(resolveTeammate(everyone, main, leadA.id)).toEqual({ id: leadA.id, byName: false });
    expect(resolveTeammate(everyone, main, "Ava")).toEqual({ id: leadA.id, byName: true });
    const said = refusal(main, memberA.id);
    expect(said).not.toContain("Arlo");
    expect(said).toContain(PEER_ACCESS_HELP);
    expect(said).toContain("reached only through its lead");
    expect(refusal(main, "Arlo")).not.toContain(memberA.id);
  });

  it("refuses a bot outside every project all of a project, its lead included, in the words it always had", () => {
    for (const raw of [leadA.id, memberA.id, "Ava", "Arlo"]) {
      const said = refusal(outside, raw);
      expect(said).toContain(PEER_ACCESS_HELP);
      expect(said).not.toMatch(/project/i);
      expect(said).toContain(`You can reach: Sol (id ${studioChief.id}), MagicBot (id ${main.id}).`);
    }
    expect(refusal(outside, "Ava")).not.toContain(leadA.id);
  });

  it("gives a project's bot its own side by id and by name", () => {
    expect(resolveTeammate(everyone, memberA, leadA.id)).toEqual({ id: leadA.id, byName: false });
    expect(resolveTeammate(everyone, memberA, "MagicBot")).toEqual({ id: main.id, byName: true });
    expect(resolveTeammate(everyone, leadA, "arlo")).toEqual({ id: memberA.id, byName: true });
  });

  describe("two projects made from one team template, whose bots share their names", () => {
    const directorA: RosterMember = { ...leadA, name: "Director" };
    const writerA: RosterMember = { ...memberA, name: "Writer" };
    const directorB: RosterMember = { ...leadB, name: "Director" };
    const writerB: RosterMember = { ...memberB, name: "Writer" };
    const twins = [main, studioChief, outside, directorA, writerA, directorB, writerB];

    it("gives each project's bot its own namesake, never a choice that names the other project's", () => {
      expect(resolveTeammate(twins, writerA, "Director")).toEqual({ id: directorA.id, byName: true });
      expect(resolveTeammate(twins, directorA, "Writer")).toEqual({ id: writerA.id, byName: true });
      expect(resolveTeammate(twins, writerB, "Director")).toEqual({ id: directorB.id, byName: true });
      expect(resolveTeammate(twins, directorB, "writer")).toEqual({ id: writerB.id, byName: true });
    });

    it("has the main bot choose between the leads by their projects, and tells it of no member", () => {
      expect(resolveTeammate(twins, main, "Director")).toEqual({
        error: '2 teammates you can reach are named "Director", so nothing was sent: '
          + `Director, Project lead of ${DRAMA_A} (id ${directorA.id}); Director, Project lead of ${DRAMA_B} (id ${directorB.id}). `
          + "Send it again with the id of the one you mean.",
      });
      expect(resolveTeammate(twins, main, directorB.id)).toEqual({ id: directorB.id, byName: false });
      const said = (resolveTeammate(twins, main, "Writer") as { error: string }).error;
      expect(said).toContain('No bot with id or name "Writer"');
      expect(said).not.toContain(writerA.id);
      expect(said).not.toContain(writerB.id);
    });

    it("leaves a bot outside every project with no namesake at all", () => {
      const said = (resolveTeammate(twins, outside, "Director") as { error: string }).error;
      expect(said).toContain('No bot with id or name "Director"');
      expect(said).not.toContain(directorA.id);
      expect(said).not.toContain(directorB.id);
    });
  });

  it("does not let a hidden bot's id prefix shadow a bot the caller can reach", () => {
    const twin: RosterMember = { ...memberB, id: `${leadA.id.slice(0, 8)}-twin`, name: "Twin" };
    expect(resolveTeammate([...everyone, twin], memberA, leadA.id.slice(0, 8))).toEqual({ id: leadA.id, byName: false });
  });

  it("never sends a project's bot to the person's other places", () => {
    let asked = 0;
    const elsewhere = () => { asked += 1; return { where: "Bianca lives on Cloud." }; };
    expect(resolveTeammate(everyone, memberA, "Cloudbot", elsewhere)).toMatchObject({ error: expect.stringContaining('No bot with id or name "Cloudbot"') });
    expect(asked).toBe(0);
    expect(resolveTeammate(everyone, outside, "Cloudbot", elsewhere)).toEqual({ error: "Bianca lives on Cloud." });
    expect(asked).toBe(1);
  });

  it("words a refusal at the wall as an unknown id", () => {
    const said = reachRefusal(memberA, memberB)!;
    expect(said).toContain(`No bot with id "${memberB.id}"`);
    expect(said).not.toContain("Bianca");
    expect(reachRefusal(main, memberA)).not.toContain("Arlo");
    expect(reachRefusal(outside, leadA)).toBe(`No bot with id "${leadA.id}" — call list_bots and copy the exact id from the result. ${PEER_ACCESS_HELP}`);
    expect(reachRefusal(memberA, leadA)).toBeNull();
  });

  it("never names a bot behind the wall as the teammate a hand-off missed", () => {
    expect(unreachableTeammate(everyone, memberA, "Bianca")).toBeNull();
    expect(unreachableTeammate(everyone, memberA, memberB.id)).toBeNull();
    expect(unreachableTeammate(everyone, main, "Arlo")).toBeNull();
    expect(unreachableTeammate(everyone, outside, "Ava")).toBeNull();
    const apart = { ...outside, id: "30000000-apart", name: "Bianca", visibility: "admins" };
    expect(unreachableTeammate([...everyone, apart], studioChief, "Bianca")).toBe(apart);
  });

  it("says what a bot can reach in the words that fit where it stands", () => {
    expect(peerAccessHelp(outside, everyone)).toBe(PEER_ACCESS_HELP);
    expect(peerAccessHelp(main, [main, outside])).toBe(PEER_ACCESS_HELP);
    expect(peerAccessHelp(main, everyone)).toBe(`${PEER_ACCESS_HELP} A team project's own bots are reached only through its lead.`);
    expect(peerAccessHelp(memberA, everyone)).toContain("outside this project");
  });
});

describe("authority stops at the wall", () => {
  it("gives the main bot contact with a project's lead and no say over it or its team", () => {
    expect(canReach(main, leadA)).toBe(true);
    expect(hasAuthority(main, leadA)).toBe(false);
    expect(canManage(main, leadA)).toBe(false);
    expect(canManage(main, memberA)).toBe(false);
    expect(canManage(main, outside)).toBe(true);
  });

  it("keeps a project's lead in charge of its own team and of nothing outside", () => {
    expect(canManage(leadA, memberA)).toBe(true);
    expect(canManage(leadA, main)).toBe(false);
    const ambitious = { ...leadA, managedSections: ["Studio", DRAMA_B, ""] };
    expect(canManage(ambitious, outside)).toBe(false);
    expect(canManage(ambitious, memberB)).toBe(false);
    expect(hasAuthority(ambitious, main)).toBe(false);
  });

  it("leaves authority among bots outside projects as it was", () => {
    expect(canManage(studioChief, outside)).toBe(true);
    expect(canManage(outside, studioChief)).toBe(true);
    expect(canManage(studioChief, main)).toBe(false);
  });

  it("says why the main bot cannot change a lead, without sending the person to a setting that would not help", () => {
    const said = departmentRefusal(main, leadA)!;
    expect(said).toContain("@Ava leads a team project");
    expect(said).not.toContain("Also in charge of");
    expect(departmentRefusal({ ...main, managedSections: [] }, leadA)).toBe(said);
    expect(departmentRefusal(leadA, main)).toContain("outside Ava's team project");
    expect(departmentRefusal(main, memberA)).toBeNull();
    expect(departmentRefusal(leadA, memberA)).toBeNull();
  });

  it("never counts a project's lead as in charge of every department", () => {
    const departments = ["Studio", DRAMA_A, DRAMA_B];
    expect(inChargeOfEvery(main, departments)).toBe(true);
    expect(inChargeOfEvery({ ...leadA, managedSections: ["", ...departments] }, departments)).toBe(false);
  });
});

describe("which departments a Chief may add bots to", () => {
  it("opens a project's department to that project's lead alone", () => {
    expect(departmentOpenTo(everyone, leadA, DRAMA_A)).toBe(true);
    expect(departmentOpenTo(everyone, main, DRAMA_A)).toBe(false);
    expect(departmentOpenTo(everyone, studioChief, DRAMA_A)).toBe(false);
    expect(departmentOpenTo(everyone, leadB, DRAMA_A)).toBe(false);
  });

  it("keeps a project's lead out of every other department, existing or new", () => {
    expect(departmentOpenTo(everyone, leadA, "Studio")).toBe(false);
    expect(departmentOpenTo(everyone, leadA, undefined)).toBe(false);
    expect(departmentOpenTo(everyone, leadA, "Brand new")).toBe(false);
  });

  it("leaves departments without a project's bots to the Chiefs outside projects", () => {
    expect(departmentOpenTo(everyone, main, "Studio")).toBe(true);
    expect(departmentOpenTo(everyone, main, undefined)).toBe(true);
    expect(departmentOpenTo(everyone, studioChief, "Brand new")).toBe(true);
  });

  it("still counts a department whose project bots are all archived as the project's", () => {
    const archived = everyone.map((bot) => (bot.teamProject?.id === "project-a" ? { ...bot, hidden: true } : bot));
    expect(departmentOpenTo(archived, main, DRAMA_A)).toBe(false);
  });

  it("closes a department that holds two projects' bots to both leads", () => {
    const mixed = [...everyone, { ...memberB, id: "b3000000-moved", section: DRAMA_A }];
    expect(departmentOpenTo(mixed, leadA, DRAMA_A)).toBe(false);
    expect(departmentOpenTo(mixed, main, DRAMA_A)).toBe(false);
  });

  it("tells each kind of Chief what the wall means for it", () => {
    expect(teamProjectSetupRefusal(leadA, "Studio")).toContain(`only in its own department, ${DRAMA_A}`);
    expect(teamProjectSetupRefusal(main, DRAMA_A)).toContain("Hand the request to the project's lead with coordinate_bots.");
    expect(teamProjectSetupRefusal(studioChief, DRAMA_A)).toContain("Tell the person to ask the project's lead.");
    expect(teamProjectSetupRefusal(studioChief, DRAMA_A)).toContain(`The ${DRAMA_A} department belongs to a team project`);
  });
});

describe("a room holds one project's bots, or none's", () => {
  const conflict = (memberIds: string[], section?: string) => teamProjectRoomConflict(store, memberIds, section);

  it("lets bots of one project, and bots of none, share a room", () => {
    expect(conflict([leadA.id, memberA.id])).toBeNull();
    expect(conflict([leadA.id, memberA.id], DRAMA_A)).toBeNull();
    expect(conflict([main.id, outside.id, studioChief.id], "Studio")).toBeNull();
    expect(conflict([memberA.id])).toBeNull();
  });

  it.each([
    ["two projects", [leadA.id, leadB.id], `Ava (${DRAMA_A})`, `Bea (${DRAMA_B})`],
    ["a project's bot and a bot outside it", [memberA.id, outside.id], `Arlo (${DRAMA_A})`, "Otto"],
    ["a project's lead and the main bot", [main.id, leadA.id], "MagicBot", `Ava (${DRAMA_A})`],
  ])("refuses a room that mixes %s, in a line the app can translate", (_what, memberIds, bot, other) => {
    const refused = conflict(memberIds)!;
    expect(refused).toMatchObject({ status: 400, errorKey: "serverError.room.projectsMixed", errorParams: { bot, other } });
    expect(refused.message).toBe(`${bot} and ${other} are not in the same project, so they can't be in one group chat. Use a group chat for each project.`);
  });

  it("tells two projects' bots of one name apart by their projects' departments", () => {
    const twins = [{ ...leadA, name: "Director" }, { ...leadB, name: "Director" }];
    const refused = teamProjectRoomConflict({ bots: twins, bot: (id) => twins.find((bot) => bot.id === id) }, [leadA.id, leadB.id])!;
    expect(refused.message).toContain(`Director (${DRAMA_A}) and Director (${DRAMA_B}) are not in the same project`);
  });

  it("counts a member that is no bot of this place as outside every project", () => {
    expect(conflict([memberA.id, "link-0000abcd-far"])).toMatchObject({ errorKey: "serverError.room.projectsMixed" });
    expect(conflict([outside.id, "link-0000abcd-far"])).toBeNull();
  });

  it("keeps a project's department for rooms of that project's bots", () => {
    expect(conflict([outside.id, studioChief.id], DRAMA_A)).toMatchObject({
      status: 400, errorKey: "serverError.room.projectDepartment", errorParams: { department: DRAMA_A, bot: "Otto" },
    });
    expect(conflict([leadB.id, memberB.id], DRAMA_A)).toMatchObject({ errorKey: "serverError.room.projectDepartment", errorParams: { bot: `Bea (${DRAMA_B})` } });
    expect(conflict([leadA.id, memberA.id], "Studio")).toBeNull();
  });

  it("checks a change by what the room would become, and leaves other changes alone", () => {
    const room = { memberIds: [leadA.id, memberA.id], section: DRAMA_A };
    expect(teamProjectRoomChange(store, room, { name: "Writers" })).toBeNull();
    expect(teamProjectRoomChange(store, room, { memberIds: [leadA.id] })).toBeNull();
    expect(teamProjectRoomChange(store, room, { memberIds: [leadA.id, outside.id] })).toMatchObject({ errorKey: "serverError.room.projectsMixed" });
    expect(teamProjectRoomChange(store, room, { section: undefined })).toBeNull();
    expect(teamProjectRoomChange(store, { memberIds: [outside.id] }, { section: DRAMA_B })).toMatchObject({ errorKey: "serverError.room.projectDepartment" });
    const alreadyMixed = { memberIds: [leadA.id, outside.id] };
    expect(teamProjectRoomChange(store, alreadyMixed, { name: "Old room" })).toBeNull();
    expect(teamProjectRoomChange(store, alreadyMixed, { memberIds: [leadA.id, outside.id, main.id] })).not.toBeNull();
  });
});

describe("what each bot is told about its team", () => {
  const plain = peerRosterPrompt([outside], { section: "Studio" });

  it("tells a project's bot it works inside one project, and whom to ask for team changes", () => {
    const told = peerRosterPrompt(reachablePeers(everyone, memberA), memberA);
    expect(told.rules).toContain("You work inside one team project.");
    expect(told.rules).toContain("this project's lead, marked Project lead in the roster,");
    expect(told.rules).toContain("is outside this project, archived or shared with different people");
    expect(told.rules).not.toContain("You can reach every other bot on this team, in every department");
    expect(told.roster).toContain(`- Ava — Showrunner (${DRAMA_A}) [Project lead] [id: ${leadA.id}]`);
    expect(told.roster).toContain(`- MagicBot — General assistant (General) [Chief of Staff] [id: ${main.id}]`);
    for (const hidden of ["Bea", "Bianca", "Otto", "Sol", DRAMA_B, "Studio"]) expect(told.roster).not.toContain(hidden);
  });

  it("leaves a bot outside every project the rules it always had, and no project's bot in its roster", () => {
    const told = peerRosterPrompt(reachablePeers(everyone, outside), outside);
    expect(told.rules).toBe(plain.rules);
    expect(told.rules).not.toMatch(/project/i);
    for (const hidden of ["Ava", "Arlo", "Bea", "Bianca", DRAMA_A, DRAMA_B]) expect(told.roster).not.toContain(hidden);
  });

  it("marks a project's lead apart from a Chief of Staff in any roster", () => {
    expect(renderRoster([leadA, studioChief], { max: 5, empty: "", about: false })).toBe([
      `- Ava — Showrunner (${DRAMA_A}) [Project lead] [id: ${leadA.id}]`,
      `- Sol — General assistant (Studio) [Chief of Staff] [id: ${studioChief.id}]`,
    ].join("\n"));
  });

  it("tells the main bot to work through each project's lead, and lists the leads and no members", () => {
    const told = chiefOfStaffPrompt(main.id, everyone, true, undefined, ["Studio", DRAMA_A, DRAMA_B]);
    expect(told.rules).toContain("A bot marked Project lead in your roster leads a team project");
    expect(told.roster).toContain(`- Ava — Showrunner (${DRAMA_A}) [Project lead] [id: ${leadA.id}]`);
    expect(told.roster).toContain(`- Bea — Showrunner (${DRAMA_B}) [Project lead] [id: ${leadB.id}]`);
    expect(told.roster.indexOf("Other bots you can reach")).toBeLessThan(told.roster.indexOf("- Ava"));
    expect(told.roster.indexOf("- Otto")).toBeLessThan(told.roster.indexOf("Other bots you can reach"));
    for (const hidden of ["Arlo", "Bianca"]) expect(told.roster).not.toContain(hidden);
  });

  it("says nothing of projects to the main bot while there are none", () => {
    const before = chiefOfStaffPrompt(main.id, [main, studioChief, outside], true, undefined, ["Studio"]);
    expect(before.rules).not.toMatch(/project lead/i);
  });

  it("tells a project's lead that it leads one project and reaches the main bot beyond it", () => {
    const told = chiefOfStaffPrompt(leadA.id, everyone.map((bot) => (bot.id === leadA.id ? { ...bot, managedSections: ["Studio"] } : bot)), true, undefined, ["Studio", DRAMA_A, DRAMA_B]);
    expect(told.rules).toContain(`You lead one team project, filed as the ${DRAMA_A} department`);
    expect(told.rules).not.toContain("Every other bot on this team, in any department, is reachable too");
    expect(told.rules).not.toContain("The owner also made you responsible for");
    expect(told.rules).toContain("a plan that names another department or a new team is refused");
    expect(told.rules).not.toContain("new teams included");
    expect(told.roster).toContain(`Current ${DRAMA_A} department (your team):\n- Arlo — Writer`);
    expect(told.roster).toContain(`- MagicBot — General assistant (General) [Chief of Staff] [id: ${main.id}]`);
    for (const hidden of ["Bea", "Bianca", "Otto", "Sol"]) expect(told.roster).not.toContain(hidden);
  });

  it("leaves a Chief outside every project the rules it always had", () => {
    const withProjects = chiefOfStaffPrompt(studioChief.id, everyone, true, undefined, ["Studio", DRAMA_A, DRAMA_B]);
    const without = chiefOfStaffPrompt(studioChief.id, [main, studioChief, outside], true, undefined, ["Studio", DRAMA_A, DRAMA_B]);
    expect(withProjects.rules).toBe(without.rules);
    expect(withProjects.roster).toBe(without.roster);
  });
});
