import { describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects";
import { sidebarMainBot, unreadOutsideProjects } from "./sidebar-projects";
import { teamProjectSide } from "./team-projects";

const project = (id: string, botIds: string[]): TeamProjectWire => ({
  id, name: id, folder: `/dramas/${id}`, section: id, team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: botIds[0]!, createdAt: 1, folderState: "ready", botIds,
});
const side = teamProjectSide({ root: "/dramas", projects: [project("The bride", ["lead", "writer"])] });
const main = { id: "maus", defaultBot: {} };
const mine = { id: "mine", defaultBot: { person: "ada@example.com" } };
const theirs = { id: "theirs", defaultBot: { person: "bo@example.com" } };

describe("the bot at the top of the sidebar", () => {
  it("is the viewer's own MagicBot, else the place's", () => {
    expect(sidebarMainBot([theirs, mine, main], "ada@example.com")?.id).toBe("mine");
    expect(sidebarMainBot([theirs, main], "ada@example.com")?.id).toBe("maus");
    expect(sidebarMainBot([{ id: "plain" }], "ada@example.com")).toBeUndefined();
  });

  it("is left out while its welcome plays, or when hidden from the sidebar, unless a search found it", () => {
    expect(sidebarMainBot([main], null, { welcoming: "maus" })).toBeUndefined();
    expect(sidebarMainBot([{ ...main, sidebarHidden: true }], null)).toBeUndefined();
    expect(sidebarMainBot([{ ...main, sidebarHidden: true }], null, { searching: true })?.id).toBe("maus");
    expect(sidebarMainBot([{ ...main, hidden: true }], null)).toBeUndefined();
  });
});

describe("unread outside the projects", () => {
  const options = { viewer: "ada@example.com", mainBotId: "maus" };

  it("counts a bot in no project, but not a project's bot or the MagicBot the sidebar shows", () => {
    expect(unreadOutsideProjects([{ id: "writer", unread: true }], [], side, options)).toBe(false);
    expect(unreadOutsideProjects([{ ...main, unread: true }], [], side, options)).toBe(false);
    expect(unreadOutsideProjects([{ id: "sales", unread: true }], [], side, options)).toBe(true);
    expect(unreadOutsideProjects([{ id: "sales", unread: true, hidden: true }], [], side, options)).toBe(false);
  });

  it("leaves out someone else's MagicBot and conversations that only ran a routine", () => {
    expect(unreadOutsideProjects([{ ...theirs, unread: true }], [], side, options)).toBe(false);
    expect(unreadOutsideProjects([{ id: "sales", unread: true, tasks: [{ unread: true, routineRunId: "r" }] }], [], side, options)).toBe(false);
  });

  it("counts a group chat outside the projects, but not a project's", () => {
    expect(unreadOutsideProjects([], [{ section: "The bride", unread: true }], side, options)).toBe(false);
    expect(unreadOutsideProjects([], [{ section: "Sales", unread: true }, { unread: false }], side, options)).toBe(true);
  });
});
