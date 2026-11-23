import { describe, expect, it } from "vitest";

import type { ProjectTeamUnusable, TeamProjectRefusal, TeamProjectWire } from "../../shared/team-projects";
import { en } from "@/locales";
import { refusalKey, refusalPlace, teamProjectFolder, teamProjectSectionId, teamProjectSide, teamProjectsVersion, unusableKey } from "./team-projects";

const project = (id: string, extra: Partial<TeamProjectWire> = {}): TeamProjectWire => ({
  id, name: id, folder: `/dramas/${id}`, section: id, team: { key: "team:urban", name: "Urban drama team" }, follows: {},
  leadBotId: `${id}-lead`, createdAt: 1, folderState: "ready", botIds: [`${id}-lead`, `${id}-writer`, `${id}-shots`], episodeBots: {}, ...extra,
});
const bot = (id: string, section?: string, pinned?: boolean) => ({ id, section, pinned });
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

const bride = project("bride");
const palace = project("palace", { folderState: "missing" });
const shelved = project("shelved", { archivedAt: 5 });
const older = project("older", { archivedAt: 2 });
const list = { root: "/dramas", projects: [bride, shelved, palace, older] };
const bots = [
  bot("main"), bot("bride-shots", "bride"), bot("free"), bot("bride-lead", "bride"), bot("sales-1", "Sales"),
  bot("palace-lead", "palace"), bot("shelved-lead", "shelved"), bot("bride-writer", "bride"),
];

describe("the projects the sidebar lists", () => {
  it("are the ones not archived, in the server's order; archived ones are kept apart, the latest first", () => {
    const side = teamProjectSide(list);
    expect(ids(side.projects)).toEqual(["bride", "palace"]);
    expect(ids(side.archived)).toEqual(["shelved", "older"]);
    expect([side.shown, side.root]).toEqual([true, "/dramas"]);
  });

  it("are none before the list is read, and nothing is taken from the departments", () => {
    const side = teamProjectSide(null);
    expect([side.shown, side.root, side.projects, side.archived]).toEqual([false, null, [], []]);
    expect(side.bots(bots)).toEqual(bots);
    expect(side.department("bride")).toBe(true);
  });
});

describe("a project's team", () => {
  const side = teamProjectSide(list);

  it("has the lead first, then the members in the server's order", () => {
    expect(ids(side.team(bride, bots))).toEqual(["bride-lead", "bride-writer", "bride-shots"]);
  });

  it("also holds a bot filed in the project's department that the server did not list, after the others", () => {
    const withExtra = [bot("helper", "bride"), ...bots];
    expect(ids(side.team(bride, withExtra))).toEqual(["bride-lead", "bride-writer", "bride-shots", "helper"]);
  });

  it("keeps a bot the server lists even when its department was changed", () => {
    const moved = bots.map((one) => (one.id === "bride-writer" ? bot("bride-writer", "Sales") : one));
    expect(ids(side.team(bride, moved))).toContain("bride-writer");
    expect(ids(side.bots(moved))).not.toContain("bride-writer");
  });

  it("has the group chats filed in its department", () => {
    const rooms = [{ id: "writers", section: "bride" }, { id: "all-hands" }, { id: "deals", section: "Sales" }];
    expect(ids(side.teamRooms(bride, rooms))).toEqual(["writers"]);
    expect(ids(side.rooms(rooms))).toEqual(["all-hands", "deals"]);
  });

  it("tells which project a bot is in", () => {
    expect(side.of(bot("bride-lead", "bride"))?.id).toBe("bride");
    expect(side.of(bot("helper", "palace"))?.id).toBe("palace");
    expect(side.of(bot("sales-1", "Sales"))).toBeUndefined();
  });

  it("tells which bot a copy follows, and only while it follows one", () => {
    const following = teamProjectSide({ root: "/dramas", projects: [project("bride", { follows: { "bride-writer": "writer" } })] });
    expect(following.source("bride-writer")).toEqual({ sourceId: "writer", project: expect.objectContaining({ id: "bride" }) });
    expect(following.source("bride-lead")).toBeUndefined();
    expect(following.source("writer")).toBeUndefined();
  });
});

describe("what is left for the departments", () => {
  const side = teamProjectSide(list);

  it("is every bot outside a project: an archived project's bots are in neither list", () => {
    expect(ids(side.bots(bots))).toEqual(["main", "free", "sales-1"]);
  });

  it("is every department that is not a project's, archived or not", () => {
    expect(["bride", "palace", "shelved", "Sales"].map((name) => side.department(name))).toEqual([false, false, false, true]);
  });

  it("still has a pinned bot of a listed project, which stays in its team as well", () => {
    const pinned = bots.map((one) => (one.id === "bride-lead" ? bot("bride-lead", "bride", true) : one));
    expect(ids(side.bots(pinned))).toEqual(["main", "free", "bride-lead", "sales-1"]);
    expect(ids(side.team(bride, pinned))[0]).toBe("bride-lead");
  });

  it("never has a pinned bot of an archived project", () => {
    const pinned = bots.map((one) => (one.id === "shelved-lead" ? bot("shelved-lead", "shelved", true) : one));
    expect(ids(side.bots(pinned))).not.toContain("shelved-lead");
  });

  it("leaves out the department of a project that is being made, before the server lists it", () => {
    const making = teamProjectSide(list, "new drama");
    const arriving = [...bots, bot("new-lead", "new drama")];
    expect(ids(making.bots(arriving))).not.toContain("new-lead");
    expect(making.department("new drama")).toBe(false);
    expect(ids(making.rooms([{ id: "room", section: "new drama" }]))).toEqual([]);
  });
});

describe("the folder a new project gets", () => {
  it("is the projects folder with the name in it", () => {
    expect(teamProjectFolder("/Users/me/dramas", " The bride ")).toBe("/Users/me/dramas/The bride");
    expect(teamProjectFolder("/Users/me/dramas/", "x")).toBe("/Users/me/dramas/x");
    expect(teamProjectFolder("/", "x")).toBe("/x");
  });

  it("uses the separator of a Windows path", () => {
    expect(teamProjectFolder("D:\\dramas\\", "x")).toBe("D:\\dramas\\x");
    expect(teamProjectFolder("D:\\", "x")).toBe("D:\\x");
  });
});

describe("why a project was not made", () => {
  const codes: TeamProjectRefusal[] = ["no_root", "root_missing", "bad_name", "name_taken", "folder_exists", "no_team", "team_unusable", "failed"];

  it("has a sentence in English for every code", () => {
    for (const code of codes) expect(en[refusalKey(code)], code).toBeTruthy();
    expect(new Set(codes.map(refusalKey)).size).toBe(codes.length);
  });

  it("is shown beside what caused it", () => {
    expect(codes.map(refusalPlace)).toEqual(["folder", "folder", "name", "name", "name", "team", "team", "form"]);
    expect(refusalPlace(null)).toBe("form");
  });
});

describe("why no project can be made from a team", () => {
  it("has its own sentence in English for every reason", () => {
    const reasons: ProjectTeamUnusable[] = ["empty", "no_chief", "main_bot_chief"];
    for (const reason of reasons) expect(en[unusableKey(reason)], reason).toBeTruthy();
    expect(new Set(reasons.map(unusableKey)).size).toBe(reasons.length);
  });
});

describe("what the list is read again for", () => {
  it("changes with the set of bots and with the departments, not with their order", () => {
    const version = teamProjectsVersion([{ id: "a" }, { id: "b" }], ["Sales"]);
    expect(teamProjectsVersion([{ id: "b" }, { id: "a" }], ["Sales"])).toBe(version);
    expect(teamProjectsVersion([{ id: "a", section: "Sales" }, { id: "b" }], ["Sales"])).not.toBe(version);
    expect(teamProjectsVersion([{ id: "a", hidden: true }, { id: "b" }], ["Sales"])).not.toBe(version);
    expect(teamProjectsVersion([{ id: "a" }], ["Sales"])).not.toBe(version);
    expect(teamProjectsVersion([{ id: "a" }, { id: "b" }], ["Sales", "bride"])).not.toBe(version);
    expect(teamProjectsVersion([{ id: "a" }, { id: "b" }], undefined)).not.toBe(version);
  });
});

it("gives each project its own id among the sidebar's sections", () => {
  expect(teamProjectSectionId("p1")).toBe("team-project:p1");
});
