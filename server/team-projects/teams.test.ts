import { describe, expect, it } from "vitest";

import type { BotRecord } from "../store.ts";
import { findProjectTeam, projectTeams, teamBots, teamRevision, type TeamSources } from "./teams.ts";

const bot = (id: string, patch: Partial<BotRecord> = {}): BotRecord =>
  ({ id, name: id[0]!.toUpperCase() + id.slice(1), title: `${id} title`, ...patch }) as BotRecord;

const MAIN = bot("magicbot", { defaultBot: {}, chiefOfStaff: true });

function sources(bots: BotRecord[], patch: Partial<TeamSources> = {}): TeamSources {
  return { bots, sections: [], projectSections: new Set(), context: (section) => `About ${section}`, ...patch };
}

describe("the teams a project can be made from", () => {
  it("lists each department with its context, its Chief first among its members, and the ones it cannot use with why", () => {
    const teams = projectTeams(sources([
      MAIN,
      bot("writer", { section: "Writers" }), bot("lead", { section: "Writers", chiefOfStaff: true }),
      bot("solo", { section: "Loose" }),
      bot("ruled", { section: "Ruled" }), bot("helper", { section: "Ruled", defaultBot: {}, chiefOfStaff: true }),
    ], { sections: ["Empty", "Writers"] }));

    expect(teams.map((team) => [team.name, team.unusable ?? "usable"])).toEqual([
      ["Empty", "empty"], ["Writers", "usable"], ["Loose", "no_chief"], ["Ruled", "main_bot_chief"],
    ]);
    expect(teams[1]).toEqual({
      name: "Writers", context: "About Writers",
      chief: { id: "lead", name: "Lead", title: "lead title" },
      members: [{ id: "lead", name: "Lead", title: "lead title" }, { id: "writer", name: "Writer", title: "writer title" }],
    });
    expect(teams[3]!.chief).toEqual({ id: "helper", name: "Helper", title: "helper title" });
    expect(teams[3]!.members.map((member) => member.id)).toEqual(["ruled"]);
  });

  it("leaves out the general area, projects' departments and archived bots, and never counts the main bot as a member", () => {
    const teams = projectTeams(sources([
      MAIN, bot("general"),
      bot("copy", { section: "Season one", chiefOfStaff: true }),
      bot("gone", { section: "Archive", hidden: true, chiefOfStaff: true }), bot("left", { section: "Archive" }),
      bot("stray", { section: "Mixed", defaultBot: {} }), bot("boss", { section: "Mixed", chiefOfStaff: true }),
    ], { projectSections: new Set(["Season one"]) }));

    expect(teams.map((team) => [team.name, team.unusable ?? "usable", team.members.map((member) => member.id)])).toEqual([
      ["Archive", "no_chief", ["left"]], ["Mixed", "usable", ["boss"]],
    ]);
    expect(teamBots([MAIN, bot("stray", { section: "Mixed", defaultBot: {} }), bot("boss", { section: "Mixed" })], "Mixed").map((each) => each.id)).toEqual(["boss"]);
  });

  it("finds a team by its exact name, else by the one name that differs only in case", () => {
    const held = projectTeams(sources([bot("a", { section: "Writers" }), bot("b", { section: "writers" }), bot("c", { section: "Sales" })]));
    expect(findProjectTeam(held, " Writers ")?.name).toBe("Writers");
    expect(findProjectTeam(held, "WRITERS")).toBeUndefined();
    expect(findProjectTeam(held, "sales")?.name).toBe("Sales");
    expect(findProjectTeam(held, "Nobody")).toBeUndefined();
    expect(findProjectTeam(held, 7)).toBeUndefined();
  });
});

describe("a team's revision", () => {
  const team = { name: "Writers", chief: { id: "lead", name: "Lead", title: "Leads" }, members: [{ id: "lead", name: "Lead", title: "Leads" }] };

  it("changes with the name, the Chief, a member, or a member's name or title, and with nothing else", () => {
    const base = teamRevision(team);
    expect(teamRevision({ ...team })).toBe(base);
    expect(teamRevision({ ...team, name: "Authors" })).not.toBe(base);
    expect(teamRevision({ ...team, chief: null })).not.toBe(base);
    expect(teamRevision({ ...team, members: [...team.members, { id: "new", name: "New", title: "" }] })).not.toBe(base);
    expect(teamRevision({ ...team, members: [{ id: "lead", name: "Lead", title: "Runs it" }] })).not.toBe(base);
    expect(teamRevision({ ...team, context: "Other words" } as typeof team)).toBe(base);
  });
});
