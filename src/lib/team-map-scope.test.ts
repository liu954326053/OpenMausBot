import { describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects";
import { mayJoinOnMap, teamMapBots, teamMapDepartments } from "./team-map-scope";
import { teamProjectSide } from "./team-projects";

const project = (overrides: Partial<TeamProjectWire>): TeamProjectWire => ({
  id: "p1", name: "Launch", section: "Launch", folder: "/work/launch", leadBotId: "lead", botIds: ["lead", "writer"], follows: {}, createdAt: 1, ...overrides,
}) as TeamProjectWire;

const teamMapScope = <B extends { id: string; section?: string; hidden?: boolean }>(bots: B[], names: string[], side: ReturnType<typeof teamProjectSide>) =>
  ({ bots: teamMapBots(bots, side), names: teamMapDepartments(names, side) });

describe("the team map's teams", () => {
  const side = teamProjectSide({ root: "/work", projects: [project({}), project({ id: "p2", name: "Old", section: "Old", botIds: ["retired"], archivedAt: 5 })] });
  const bots = [
    { id: "main", defaultBot: {} },
    { id: "lead", section: "Launch" },
    { id: "writer", section: "Launch", pinned: true },
    { id: "retired", section: "Old" },
    { id: "pepper" },
    { id: "ops", section: "Ops" },
    { id: "ghost", hidden: true },
  ];

  it("keeps the bots and departments outside projects, archived projects included", () => {
    const scope = teamMapScope(bots, ["Ops", "Launch", "Old", "Research"], side);
    expect(scope.bots.map((bot) => bot.id)).toEqual(["main", "pepper", "ops"]);
    expect(scope.names).toEqual(["Ops", "Research"]);
  });

  it("draws every department while the projects are still being read", () => {
    const scope = teamMapScope(bots, ["Ops", "Launch"], teamProjectSide(null));
    expect(scope.bots.map((bot) => bot.id)).toEqual(["main", "lead", "writer", "retired", "pepper", "ops"]);
    expect(scope.names).toEqual(["Ops", "Launch"]);
  });
});

describe("mayJoinOnMap", () => {
  it("offers a main bot only the team of bots in no department", () => {
    expect(mayJoinOnMap({ defaultBot: {} }, "Ops")).toBe(false);
    expect(mayJoinOnMap({ defaultBot: {} }, "")).toBe(true);
    expect(mayJoinOnMap({}, "Ops")).toBe(true);
  });
});
