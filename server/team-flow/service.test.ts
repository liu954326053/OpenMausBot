import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { closeTeamFlowsInstallation, teamFlowsInstallation, type TeamFlowsTestApp } from "./testing.ts";

let app: TeamFlowsTestApp | undefined;

afterEach(async () => {
  await closeTeamFlowsInstallation(app);
  app = undefined;
});

async function installation() {
  app = await teamFlowsInstallation();
  return app;
}

const stored = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { version: number; teams: Record<string, Record<string, string>> };

describe("a team's flow", () => {
  it("puts every member under the Chief until someone places one", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");

    expect(app.flows.parents("Studio")).toEqual({ [id("Story")]: id("Chief"), [id("Board")]: id("Chief") });
    const listed = app.store.bots.map((bot) => bot.id).filter((bot) => bot === id("Story") || bot === id("Board"));
    expect(app.flows.lineOf(id("Chief"))).toEqual({ superior: null, subordinates: listed });
    expect(app.flows.lineOf(id("Story"))).toEqual({ superior: id("Chief"), subordinates: [] });
  });

  it("keeps a Chief with nobody under it out of any flow, so it reaches as it would without one, until a member joins", async () => {
    const app = await installation();
    const id = app.team("Leadership", "Chief");
    expect(app.flows.lineOf(id("Chief"))).toBeNull();
    expect(app.flows.wire().teams).toEqual([{ section: "Leadership", chiefId: id("Chief"), parents: {}, placed: [] }]);

    const joined = app.bot("Analyst", "Leadership");
    expect(app.flows.lineOf(id("Chief"))).toEqual({ superior: null, subordinates: [joined.id] });
  });

  it("replaces a member's superior with the one it is given next", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board", "Video");

    expect(app.flows.setLine({ botId: id("Video"), superiorId: id("Story") })).toMatchObject({ ok: true });
    expect(app.flows.setLine({ botId: id("Video"), superiorId: id("Board") })).toMatchObject({ ok: true });

    expect(app.flows.parents("Studio")[id("Video")]).toBe(id("Board"));
    expect(Object.values(stored(app.file).teams)).toEqual([{ [id("Video")]: id("Board") }]);
    expect(app.flows.wire().teams).toEqual([{
      section: "Studio", chiefId: id("Chief"), placed: [id("Video")],
      parents: { [id("Story")]: id("Chief"), [id("Board")]: id("Chief"), [id("Video")]: id("Board") },
    }]);
  });

  it("refuses a line that would make a loop, and says which bot is already below", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");
    app.flows.setLine({ botId: id("Board"), superiorId: id("Story") });

    expect(app.flows.setLine({ botId: id("Story"), superiorId: id("Board") })).toEqual({
      ok: false, status: 409,
      error: expect.objectContaining({ errorKey: "serverError.teamFlow.loop", errorParams: { bot: "Story", superior: "Board" } }),
    });
    expect(app.flows.parents("Studio")).toEqual({ [id("Story")]: id("Chief"), [id("Board")]: id("Story") });
  });

  it("never places the Chief under anyone", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story");

    expect(app.flows.setLine({ botId: id("Chief"), superiorId: id("Story") })).toMatchObject({
      ok: false, error: { errorKey: "serverError.teamFlow.chief", errorParams: { bot: "Chief", team: "Studio" } },
    });
  });

  it("refuses the main bot, an archived bot, a bot of another team or of General, itself, and a team without a Chief", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story");
    const other = app.team("Sales", "Closer", "Scout");
    const loner = app.bot("Loner", "");
    const archived = app.bot("Old", "Studio", { hidden: true });
    const chiefless = app.bot("Solo", "Lab");
    const peer = app.bot("Peer", "Lab");
    const main = app.store.bots.find((bot) => bot.defaultBot);
    const refusal = (botId: string, superiorId: string | null) => {
      const result = app.flows.setLine({ botId, superiorId });
      return result.ok ? null : result.error.errorKey;
    };

    if (main) expect(refusal(main.id, id("Chief"))).toBe("serverError.teamFlow.mainBot");
    if (main) expect(refusal(id("Story"), main.id)).toBe("serverError.teamFlow.mainBot");
    expect(refusal(archived.id, id("Chief"))).toBe("serverError.teamFlow.archived");
    expect(refusal(id("Story"), other("Scout"))).toBe("serverError.teamFlow.otherTeam");
    expect(refusal(loner.id, id("Chief"))).toBe("serverError.teamFlow.general");
    expect(refusal(id("Story"), id("Story"))).toBe("serverError.teamFlow.self");
    expect(refusal(chiefless.id, peer.id)).toBe("serverError.teamFlow.noChief");
    expect(refusal("nobody", id("Chief"))).toBe("serverError.teamFlow.noBot");
  });

  it("puts a member whose line is taken away back under the Chief", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");
    app.flows.setLine({ botId: id("Board"), superiorId: id("Story") });

    expect(app.flows.setLine({ botId: id("Board"), superiorId: null })).toMatchObject({ ok: true });

    expect(app.flows.parents("Studio")[id("Board")]).toBe(id("Chief"));
    expect(stored(app.file).teams).toEqual({});
  });

  it("moves a deleted member's subordinates under its former superior", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board", "Video", "Sound");
    app.flows.setLine({ botId: id("Board"), superiorId: id("Story") });
    app.flows.setLine({ botId: id("Video"), superiorId: id("Board") });
    app.flows.setLine({ botId: id("Sound"), superiorId: id("Board") });

    app.store.deleteBot(id("Board"));

    expect(app.flows.parents("Studio")).toEqual({ [id("Story")]: id("Chief"), [id("Video")]: id("Story"), [id("Sound")]: id("Story") });
    expect(Object.values(stored(app.file).teams)).toEqual([{ [id("Video")]: id("Story"), [id("Sound")]: id("Story") }]);
  });

  it("does the same when a member leaves the team or is archived", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board", "Video");
    app.team("Sales", "Closer");
    app.flows.setLine({ botId: id("Board"), superiorId: id("Story") });
    app.flows.setLine({ botId: id("Video"), superiorId: id("Board") });

    app.store.patchBot(id("Board"), { section: "Sales" });
    expect(app.flows.parents("Studio")[id("Video")]).toBe(id("Story"));

    app.store.patchBot(id("Story"), { hidden: true });
    expect(app.flows.parents("Studio")[id("Video")]).toBe(id("Chief"));
    expect(stored(app.file).teams).toEqual({});
  });

  it("keeps its lines when the department is renamed", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");
    app.flows.setLine({ botId: id("Board"), superiorId: id("Story") });

    expect(app.store.renameSection("Studio", "Film unit")).toBeUndefined();

    expect(app.flows.parents("Film unit")).toEqual({ [id("Story")]: id("Chief"), [id("Board")]: id("Story") });
    expect(app.flows.parents("Studio")).toEqual({});
  });

  it("gives a new Chief the top: the old Chief and whoever was under it go under the new one, the other lines stay", async () => {
    const app = await installation();
    const id = app.team("Studio", "Old chief", "Story", "Board", "Video", "Sound");
    app.flows.setLine({ botId: id("Video"), superiorId: id("Story") });
    app.flows.setLine({ botId: id("Sound"), superiorId: id("Video") });

    app.store.patchBot(id("Old chief"), { chiefOfStaff: false });
    app.store.patchBot(id("Video"), { chiefOfStaff: true });

    expect(app.flows.parents("Studio")).toEqual({
      [id("Old chief")]: id("Video"), [id("Story")]: id("Video"), [id("Board")]: id("Video"), [id("Sound")]: id("Video"),
    });
    expect(stored(app.file).teams).toEqual({});
  });
});

describe("a flow file that cannot be read", () => {
  it("leaves the file as it is, keeps every team to its default flow and refuses changes until it is restored", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");
    app.flows.setLine({ botId: id("Board"), superiorId: id("Story") });
    const good = readFileSync(app.file, "utf8");
    writeFileSync(app.file, "{ not json");

    const flows = app.restarted();
    const stop = flows.start();
    try {
      expect(flows.wire().readable).toBe(false);
      expect(flows.parents("Studio")).toEqual({ [id("Story")]: id("Chief"), [id("Board")]: id("Chief") });
      expect(flows.setLine({ botId: id("Story"), superiorId: id("Board") })).toMatchObject({
        ok: false, status: 503, error: { errorKey: "serverError.teamFlow.unreadable" },
      });
      app.store.deleteBot(id("Story"));
      expect(readFileSync(app.file, "utf8")).toBe("{ not json");
      expect(app.logged.some((line) => line.includes("team-flows.json") && line.includes("left as it is"))).toBe(true);

      writeFileSync(app.file, good);
      flows.reload();
      expect(flows.wire().readable).toBe(true);
      expect(flows.parents("Studio")).toEqual({ [id("Board")]: id("Chief") });
    } finally {
      stop();
    }
  });
});

describe("a project's flow", () => {
  const project = (app: TeamFlowsTestApp, projectId: string, copies: Array<[name: string, source?: string]>) => {
    const ids = new Map<string, string>();
    copies.forEach(([name, source], index) => {
      const made = app.bot(name, projectId, index === 0 ? { chiefOfStaff: true } : {});
      app.store.patchBot(made.id, { teamProject: { id: projectId, role: name, ...(source ? { source } : {}) } });
      ids.set(name, made.id);
    });
    return (name: string) => ids.get(name)!;
  };

  it("maps the team's flow onto each project's copies, and every project follows a change to it", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Script");
    const one = project(app, "Season one", [["Lead 1", id("Chief")], ["Story 1", id("Story")], ["Script 1", id("Script")]]);
    const two = project(app, "Season two", [["Lead 2", id("Chief")], ["Story 2", id("Story")], ["Script 2", id("Script")]]);

    expect(app.flows.projectParents("Season one")).toEqual({ [one("Story 1")]: one("Lead 1"), [one("Script 1")]: one("Lead 1") });

    app.flows.setLine({ botId: id("Script"), superiorId: id("Story") });

    expect(app.flows.projectParents("Season one")).toEqual({ [one("Story 1")]: one("Lead 1"), [one("Script 1")]: one("Story 1") });
    expect(app.flows.projectParents("Season two")).toEqual({ [two("Story 2")]: two("Lead 2"), [two("Script 2")]: two("Story 2") });
    expect(app.flows.parents("Season two")).toEqual(app.flows.projectParents("Season two"));
    expect(app.flows.lineOf(two("Story 2"))).toEqual({ superior: two("Lead 2"), subordinates: [two("Script 2")] });
    expect(app.flows.wire().teams.map((team) => team.section)).toEqual(["Studio"]);
  });

  it("puts every bot of a project not made from a team, and a copy whose source left, under its lead", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Script");
    app.flows.setLine({ botId: id("Script"), superiorId: id("Story") });
    const old = project(app, "Pilot", [["Lead"], ["Writer"], ["Editor"]]);
    const left = project(app, "Season three", [["Lead 3", id("Chief")], ["Story 3", id("Story")], ["Script 3", id("Script")]]);
    app.store.patchBot(left("Story 3"), { teamProject: { id: "Season three", role: "Story 3", source: id("Story"), sourceLeft: true } });

    expect(app.flows.projectParents("Pilot")).toEqual({ [old("Writer")]: old("Lead"), [old("Editor")]: old("Lead") });
    expect(app.flows.projectParents("Season three")).toEqual({ [left("Story 3")]: left("Lead 3"), [left("Script 3")]: left("Lead 3") });
  });

  it("refuses a line drawn inside a project and names the team it comes from", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Script");
    const copies = project(app, "Season one", [["Lead 1", id("Chief")], ["Story 1", id("Story")], ["Script 1", id("Script")]]);
    const old = project(app, "Pilot", [["Lead"], ["Writer"]]);

    expect(app.flows.setLine({ botId: copies("Script 1"), superiorId: copies("Story 1") })).toMatchObject({
      ok: false, error: { errorKey: "serverError.teamFlow.project", errorParams: { bot: "Script 1", team: "Studio" } },
    });
    expect(app.flows.setLine({ botId: old("Writer"), superiorId: old("Lead") })).toMatchObject({
      ok: false, error: { errorKey: "serverError.teamFlow.projectNoTeam", errorParams: { bot: "Writer" } },
    });
  });
});
