import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowLineWire, FlowStage } from "../../shared/team-pipeline.ts";
import type { StoredPipeline } from "./file.ts";
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

const stored = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { version: number; teams: Record<string, StoredPipeline> };
const onlyTeam = (file: string) => Object.values(stored(file).teams)[0]!;
const arrows = (lines: readonly FlowLineWire[], name: (id: string) => string) => lines.map(({ from, to }) => `${name(from)}>${name(to)}`);

/** The design's team: 云舟 leads, 砚青 writes, 墨白 designs the characters and draws the storyboard, 青禾 does post. */
async function drama() {
  const app = await installation();
  const id = app.team("漫剧组", "云舟", "砚青", "墨白", "青禾");
  const name = (botId: string) => app.store.bots.find((bot) => bot.id === botId)!.name;
  const judge = () => app.flows.setJudged("漫剧组", { [id("砚青")]: ["script"], [id("墨白")]: ["storyboard", "character"], [id("青禾")]: ["post"] });
  const studio = () => app.flows.pipelines().teams.find((team) => team.section === "漫剧组")!;
  const lines = () => arrows(studio().lines, name);
  return { app, id, name, judge, studio, lines };
}

describe("a team's pipeline", () => {
  it("has every member other under the Chief, waiting to be judged, until a judge gives it stages", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");
    const members = app.store.bots.map((bot) => bot.id).filter((bot) => bot === id("Story") || bot === id("Board"));

    expect(app.flows.pipelines()).toEqual({
      readable: true,
      teams: [{
        section: "Studio", chiefId: id("Chief"), manual: [], pending: members,
        stages: { [id("Chief")]: ["lead"], [id("Story")]: ["other"], [id("Board")]: ["other"] },
        lines: members.map((to) => ({ from: id("Chief"), to })),
      }],
    });
    const team = [id("Chief"), ...members];
    expect(app.flows.placeOf(id("Chief"))).toEqual({ stages: ["lead"], upstream: [], downstream: members, team });
    expect(app.flows.placeOf(id("Story"))).toEqual({ stages: ["other"], upstream: [id("Chief")], downstream: [], team });
  });

  it("gives a Chief with no member a pipeline of its own, which a member joins under it", async () => {
    const app = await installation();
    const id = app.team("Leadership", "Chief");
    expect(app.flows.pipelines().teams).toEqual([{ section: "Leadership", chiefId: id("Chief"), stages: { [id("Chief")]: ["lead"] }, pending: [], manual: [], lines: [] }]);
    expect(app.flows.placeOf(id("Chief"))).toEqual({ stages: ["lead"], upstream: [], downstream: [], team: [id("Chief")] });

    const joined = app.bot("Analyst", "Leadership");
    expect(app.flows.placeOf(id("Chief"))).toEqual({ stages: ["lead"], upstream: [], downstream: [joined.id], team: [id("Chief"), joined.id] });
    expect(app.flows.pipelines().teams[0]!.pending).toEqual([joined.id]);
  });

  it("is in no pipeline for the main bot, an archived bot, a bot in General and a bot of a team without a Chief", async () => {
    const app = await installation();
    app.team("Studio", "Chief", "Story");
    const main = app.store.bots.find((bot) => bot.defaultBot);
    const outside = [app.bot("Loner", ""), app.bot("Old", "Studio", { hidden: true }), app.bot("Solo", "Lab")];

    for (const bot of [...outside, ...(main ? [main] : [])]) expect(app.flows.placeOf(bot.id), bot.name).toBeNull();
    expect(app.flows.placeOf("nobody")).toBeNull();
    expect(app.flows.pipelines().teams.map((team) => team.section)).toEqual(["Studio"]);
  });

  it("runs the design's team 云舟, 砚青, 墨白, 青禾 in one line once they are judged", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();

    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾"]);
    expect(studio().stages).toEqual({ [id("云舟")]: ["lead"], [id("砚青")]: ["script"], [id("墨白")]: ["character", "storyboard"], [id("青禾")]: ["post"] });
    expect(studio().pending).toEqual([]);
    expect(app.flows.placeOf(id("墨白"))).toMatchObject({ stages: ["character", "storyboard"], upstream: [id("砚青")], downstream: [id("青禾")] });
    expect(app.flows.placeOf(id("云舟"))).toMatchObject({ stages: ["lead"], upstream: [], downstream: [id("砚青")] });
    expect(app.flows.parents("漫剧组")).toEqual({ [id("砚青")]: id("云舟"), [id("墨白")]: id("砚青"), [id("青禾")]: id("墨白") });
    expect(app.flows.lineOf(id("墨白"))).toMatchObject({ superior: id("砚青"), subordinates: [id("青禾")] });
    expect(app.flows.lineOf(id("云舟"))).toMatchObject({ superior: null, subordinates: [id("砚青")] });
  });

  it("keeps its pipeline when the department is renamed", async () => {
    const { app, judge, name } = await drama();
    judge();

    expect(app.store.renameSection("漫剧组", "短剧组")).toBeUndefined();

    expect(arrows(app.flows.pipelines().teams.find((team) => team.section === "短剧组")!.lines, name)).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾"]);
    expect(app.flows.parents("漫剧组")).toEqual({});
  });
});

describe("judging", () => {
  it("lists a team with members to judge, with every member's name, title, description and soul", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story");
    app.store.patchBot(id("Story"), { title: "Screenwriter", description: "Writes every episode.", soul: "You write tight scripts." });
    app.team("Sales", "Closer");
    app.bot("Solo", "Lab");

    expect(app.flows.judgeTargets()).toEqual([{
      section: "Studio", chiefId: id("Chief"), pending: [id("Story")],
      members: expect.arrayContaining([
        { id: id("Chief"), name: "Chief", title: "", description: "", soul: "" },
        { id: id("Story"), name: "Story", title: "Screenwriter", description: "Writes every episode.", soul: "You write tight scripts." },
      ]),
    }]);
    expect(app.flows.judgeTargets()[0]!.members).toHaveLength(2);
  });

  it("records the stages a judge gives, in the pipeline's order, and tells the listeners only when something changed", async () => {
    const { app, id, judge, studio } = await drama();
    app.changed.mockClear();

    judge();
    expect(app.changed).toHaveBeenCalledTimes(1);
    expect(app.flows.judgeTargets()).toEqual([]);
    expect(onlyTeam(app.file).stages).toEqual({ [id("砚青")]: ["script"], [id("墨白")]: ["character", "storyboard"], [id("青禾")]: ["post"] });
    expect(readFileSync(app.file, "utf8")).not.toContain("砚青");

    judge();
    expect(app.changed).toHaveBeenCalledTimes(1);

    app.flows.setJudged("漫剧组", { [id("青禾")]: ["other", "post", "post"], [id("砚青")]: [] });
    expect(app.changed).toHaveBeenCalledTimes(2);
    expect(studio().stages).toMatchObject({ [id("青禾")]: ["post"], [id("砚青")]: ["other"] });
  });

  it("leaves the Chief, a bot that is not a member and a member set by hand as they are", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();
    const outsider = app.bot("Scout", "Sales");
    expect(app.flows.setLine({ from: id("云舟"), to: id("青禾"), present: true })).toMatchObject({ ok: true });
    app.changed.mockClear();

    app.flows.setJudged("漫剧组", { [id("云舟")]: ["script"], [outsider.id]: ["post"], [id("青禾")]: ["script"], nobody: ["post"] });

    expect(app.changed).not.toHaveBeenCalled();
    expect(studio().stages).toMatchObject({ [id("云舟")]: ["lead"], [id("青禾")]: ["post"] });
    expect(Object.keys(studio().stages)).toHaveLength(4);
    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾", "云舟>青禾"]);
  });

  it.each([
    ["name", { name: "砚青二号" }],
    ["title", { title: "总编剧" }],
    ["description", { description: "负责全部剧本。" }],
    ["soul", { soul: "你写短剧剧本。" }],
  ])("has a member judged again, other meanwhile, once its %s changed", async (_what, patch) => {
    const { app, id, judge, studio, lines } = await drama();
    judge();
    app.changed.mockClear();

    app.store.patchBot(id("砚青"), patch);

    expect(app.changed).toHaveBeenCalled();
    expect(studio().pending).toEqual([id("砚青")]);
    expect(studio().stages[id("砚青")]).toEqual(["other"]);
    expect(lines().map((line) => line.replace("砚青二号", "砚青")).sort()).toEqual(["云舟>墨白", "云舟>砚青", "墨白>青禾"].sort());
    expect(app.flows.judgeTargets().map((target) => target.pending)).toEqual([[id("砚青")]]);

    app.flows.setJudged("漫剧组", { [id("砚青")]: ["script"] });
    expect(studio().pending).toEqual([]);
    expect(studio().stages[id("砚青")]).toEqual(["script"]);
  });

  it("does not judge a member again for a change to anything else", async () => {
    const { app, id, judge, studio } = await drama();
    judge();

    app.store.patchBot(id("砚青"), { color: "teal" });

    expect(studio().pending).toEqual([]);
  });

  it("takes stages as judged from a member's words as they are when they are recorded, however often the teams to judge were read before", async () => {
    const { app, id, judge, studio } = await drama();
    expect(app.flows.judgeTargets()[0]!.pending).toContain(id("砚青"));
    app.store.patchBot(id("砚青"), { description: "现在负责后期。" });

    judge();
    expect(studio().pending).toEqual([]);

    app.store.patchBot(id("砚青"), { description: "又回去写剧本了。" });
    expect(studio().pending).toEqual([id("砚青")]);
  });
});

describe("lines drawn by hand", () => {
  it("adds a line and makes both ends manual, so a judge leaves them as they are", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();

    const drawn = app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: true });

    expect(drawn).toEqual({ ok: true, pipelines: app.flows.pipelines() });
    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾", "砚青>青禾"]);
    expect(studio().manual.sort()).toEqual([id("砚青"), id("青禾")].sort());
    expect(onlyTeam(app.file).added).toEqual([{ from: id("砚青"), to: id("青禾") }]);

    app.flows.setJudged("漫剧组", { [id("砚青")]: ["post"], [id("墨白")]: ["storyboard"] });
    expect(studio().stages).toMatchObject({ [id("砚青")]: ["script"], [id("墨白")]: ["storyboard"] });
  });

  it("takes away a line the stages give, and puts it back when it is drawn again", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();

    expect(app.flows.setLine({ from: id("墨白"), to: id("青禾"), present: false })).toMatchObject({ ok: true });
    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白"]);
    expect(studio().manual.sort()).toEqual([id("墨白"), id("青禾")].sort());
    expect(onlyTeam(app.file).removed).toEqual([{ from: id("墨白"), to: id("青禾") }]);

    expect(app.flows.setLine({ from: id("墨白"), to: id("青禾"), present: true })).toMatchObject({ ok: true });
    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾"]);
    expect(onlyTeam(app.file)).toMatchObject({ added: [], removed: [] });
  });

  it("takes away a line drawn by hand, and never marks the Chief manual", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();
    app.flows.setLine({ from: id("云舟"), to: id("青禾"), present: true });
    expect(studio().manual).toEqual([id("青禾")]);

    expect(app.flows.setLine({ from: id("云舟"), to: id("青禾"), present: false })).toMatchObject({ ok: true });

    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾"]);
    expect(onlyTeam(app.file)).toMatchObject({ added: [], removed: [], manual: [id("青禾")] });
  });

  it("changes nothing for a line that is already there, or already not there", async () => {
    const { app, id, judge, studio } = await drama();
    judge();
    app.changed.mockClear();

    expect(app.flows.setLine({ from: id("砚青"), to: id("墨白"), present: true })).toMatchObject({ ok: true });
    expect(app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: false })).toMatchObject({ ok: true });

    expect(app.changed).not.toHaveBeenCalled();
    expect(studio().manual).toEqual([]);
  });

  it("refuses a line that would close a loop, and says whose work already reaches whom", async () => {
    const { app, id, judge, lines } = await drama();
    judge();

    expect(app.flows.setLine({ from: id("青禾"), to: id("砚青"), present: true })).toEqual({
      ok: false, status: 409,
      error: expect.objectContaining({ errorKey: "serverError.teamFlow.loop", errorParams: { from: "青禾", to: "砚青" } }),
    });
    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾"]);
  });

  it("never draws a line into the Chief", async () => {
    const { app, id } = await drama();

    expect(app.flows.setLine({ from: id("砚青"), to: id("云舟"), present: true })).toMatchObject({
      ok: false, status: 409, error: { errorKey: "serverError.teamFlow.chief", errorParams: { bot: "云舟", team: "漫剧组" } },
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
    const refusal = (from: string, to: string, present = true) => {
      const result = app.flows.setLine({ from, to, present });
      return result.ok ? null : [result.error.errorKey, result.error.errorParams];
    };

    if (main) expect(refusal(id("Chief"), main.id)).toEqual(["serverError.teamFlow.mainBot", undefined]);
    if (main) expect(refusal(main.id, id("Story"))).toEqual(["serverError.teamFlow.mainBot", undefined]);
    expect(refusal(id("Chief"), archived.id)).toEqual(["serverError.teamFlow.archived", { bot: "Old" }]);
    expect(refusal(archived.id, id("Story"))).toEqual(["serverError.teamFlow.archived", { bot: "Old" }]);
    expect(refusal(other("Scout"), id("Story"))).toEqual(["serverError.teamFlow.otherTeam", { bot: "Scout", team: "Studio" }]);
    expect(refusal(other("Scout"), id("Story"), false)).toEqual(["serverError.teamFlow.otherTeam", { bot: "Scout", team: "Studio" }]);
    expect(refusal(id("Chief"), loner.id)).toEqual(["serverError.teamFlow.general", { bot: "Loner" }]);
    expect(refusal(id("Story"), id("Story"))).toEqual(["serverError.teamFlow.self", undefined]);
    expect(refusal(peer.id, chiefless.id)).toEqual(["serverError.teamFlow.noChief", { team: "Lab" }]);
    expect(refusal(id("Chief"), "nobody")).toEqual(["serverError.teamFlow.noBot", undefined]);
    expect(refusal("nobody", id("Story"))).toEqual(["serverError.teamFlow.noBot", undefined]);
  });
});

describe("a member that leaves", () => {
  it.each([
    ["is deleted", (app: TeamFlowsTestApp, botId: string) => { app.store.deleteBot(botId); }],
    ["moves to another team", (app: TeamFlowsTestApp, botId: string) => { app.store.patchBot(botId, { section: "Sales" }); }],
    ["is archived", (app: TeamFlowsTestApp, botId: string) => { app.store.patchBot(botId, { hidden: true }); }],
  ])("takes its stages and the lines drawn by hand with it when it %s, and the stages on either side join", async (_how, leave) => {
    const { app, id, judge, lines } = await drama();
    app.team("Sales", "Closer");
    judge();
    app.flows.setLine({ from: id("云舟"), to: id("墨白"), present: true });
    app.flows.setLine({ from: id("砚青"), to: id("墨白"), present: false });
    app.flows.setLine({ from: id("云舟"), to: id("青禾"), present: true });
    const gone = id("墨白");

    leave(app, gone);

    expect(lines()).toEqual(["云舟>砚青", "砚青>青禾", "云舟>青禾"]);
    expect(readFileSync(app.file, "utf8")).not.toContain(gone);
    expect(onlyTeam(app.file)).toMatchObject({ added: [{ from: id("云舟"), to: id("青禾") }], removed: [], manual: [id("砚青"), id("青禾")] });
  });

  it("makes a new Chief the lead: the old one is a member to judge, and no line goes into the new one", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();
    app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: true });

    app.store.patchBot(id("云舟"), { chiefOfStaff: false });
    app.store.patchBot(id("青禾"), { chiefOfStaff: true });

    expect(studio().chiefId).toBe(id("青禾"));
    expect(studio().stages).toEqual({ [id("青禾")]: ["lead"], [id("云舟")]: ["other"], [id("砚青")]: ["script"], [id("墨白")]: ["character", "storyboard"] });
    expect(studio().pending).toEqual([id("云舟")]);
    expect(lines().sort()).toEqual(["青禾>砚青", "砚青>墨白", "青禾>云舟"].sort());
    expect(onlyTeam(app.file)).toMatchObject({ added: [], manual: [id("砚青")] });
    expect(Object.keys(onlyTeam(app.file).stages).sort()).toEqual([id("砚青"), id("墨白")].sort());
  });

  it("forgets the pipeline of a team whose department is deleted", async () => {
    const { app, id, judge } = await drama();
    judge();

    for (const member of ["云舟", "砚青", "墨白", "青禾"]) app.store.patchBot(id(member), { section: "" });
    expect(app.store.deleteSection("漫剧组")).toBeUndefined();

    expect(stored(app.file).teams).toEqual({});
  });
});

describe("judging a team again", () => {
  it("forgets what was set by hand, has every member judged again, and can be undone", async () => {
    const { app, id, judge, studio, lines } = await drama();
    judge();
    app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: true });
    const before = studio();
    app.changed.mockClear();

    const again = app.flows.rejudge("漫剧组");

    expect(again).toMatchObject({ ok: true, undo: { section: "漫剧组" } });
    if (!again.ok) throw new Error("refused");
    expect(again.pipelines).toEqual(app.flows.pipelines());
    expect(app.changed).toHaveBeenCalledTimes(1);
    expect(studio().manual).toEqual([]);
    expect(studio().pending.sort()).toEqual([id("砚青"), id("墨白"), id("青禾")].sort());
    expect(lines().sort()).toEqual(["云舟>砚青", "云舟>墨白", "云舟>青禾"].sort());
    expect(stored(app.file).teams).toEqual({});

    const undone = app.flows.restore(JSON.parse(JSON.stringify(again.undo)) as typeof again.undo);
    expect(undone).toEqual({ ok: true, pipelines: app.flows.pipelines() });
    expect(studio()).toEqual(before);
  });

  it("tells the listeners even when nothing was stored, so a judge that gave up tries again", async () => {
    const { app } = await drama();
    app.changed.mockClear();

    expect(app.flows.rejudge("漫剧组")).toMatchObject({ ok: true });

    expect(app.changed).toHaveBeenCalledTimes(1);
  });

  it("puts back only what today's members can hold", async () => {
    const { app, id, judge, lines } = await drama();
    judge();
    const again = app.flows.rejudge("漫剧组");
    if (!again.ok) throw new Error("refused");
    app.store.deleteBot(id("墨白"));

    expect(app.flows.restore(again.undo)).toMatchObject({ ok: true });

    expect(lines()).toEqual(["云舟>砚青", "砚青>青禾"]);
    expect(readFileSync(app.file, "utf8")).not.toContain(id("墨白"));
  });

  it("refuses a team that is not there, one without a Chief, a project's own department, and a state it did not answer", async () => {
    const { app, id } = await drama();
    app.bot("Solo", "Lab");
    const copy = app.bot("Lead 1", "Season one", { chiefOfStaff: true });
    app.store.patchBot(copy.id, { teamProject: { id: "Season one", role: "lead", source: id("云舟") } });
    const key = (result: ReturnType<typeof app.flows.rejudge>) => (result.ok ? null : [result.status, result.error.errorKey, result.error.errorParams]);

    expect(key(app.flows.rejudge("Nowhere"))).toEqual([404, "serverError.teamFlow.noTeam", undefined]);
    expect(key(app.flows.rejudge(""))).toEqual([404, "serverError.teamFlow.noTeam", undefined]);
    expect(key(app.flows.rejudge("Season one"))).toEqual([404, "serverError.teamFlow.noTeam", undefined]);
    expect(key(app.flows.rejudge("Lab"))).toEqual([409, "serverError.teamFlow.noChief", { team: "Lab" }]);
    expect(app.flows.restore({ section: "漫剧组", state: { stages: { [id("砚青")]: ["director"] } } })).toBeNull();
    expect(app.flows.restore({ section: "漫剧组", state: "everything" })).toBeNull();
  });
});

describe("what the listeners are told", () => {
  it("tells once the pipeline shows a line drawn or taken away, a member gone, a new Chief or the file read again", async () => {
    const { app, id, judge } = await drama();
    judge();
    const seen: string[][] = [];
    app.changed.mockReset();
    app.changed.mockImplementation(() => seen.push(app.flows.placeOf(id("青禾"))?.upstream ?? []));

    app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: true });
    app.flows.setLine({ from: id("墨白"), to: id("青禾"), present: false });
    expect(app.flows.setLine({ from: id("青禾"), to: id("砚青"), present: true })).toMatchObject({ ok: false });
    app.store.patchBot(id("砚青"), { hidden: true });
    app.store.patchBot(id("墨白"), { color: "coral" });
    writeFileSync(app.file, JSON.stringify({ version: 2, teams: { [app.sections.sectionMemoryKey("漫剧组")]: { stages: { [id("青禾")]: ["post"], [id("墨白")]: ["script"] } } } }));
    app.flows.reload();

    expect(seen).toEqual([[id("墨白"), id("砚青")], [id("砚青")], [], [id("墨白")]]);
  });
});

describe("a pipeline file that cannot be read", () => {
  it("leaves the file as it is, keeps every team to other under its Chief with nobody to judge, and refuses changes until it is restored", async () => {
    const { app, id, judge } = await drama();
    judge();
    app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: true });
    const good = readFileSync(app.file, "utf8");
    writeFileSync(app.file, "{ not json");

    const flows = app.restarted();
    const stop = flows.start();
    try {
      const unreadable = flows.pipelines();
      expect(unreadable.readable).toBe(false);
      expect(unreadable.teams[0]).toMatchObject({ pending: [], manual: [], stages: { [id("砚青")]: ["other"], [id("青禾")]: ["other"] } });
      expect(unreadable.teams[0]!.lines.every((line) => line.from === id("云舟"))).toBe(true);
      expect(flows.judgeTargets()).toEqual([]);
      for (const refused of [
        flows.setLine({ from: id("砚青"), to: id("墨白"), present: false }),
        flows.rejudge("漫剧组"),
        flows.restore({ section: "漫剧组", state: {} }),
        flows.setSuperior({ botId: id("青禾"), superiorId: id("砚青") }),
      ]) expect(refused).toMatchObject({ ok: false, status: 503, error: { errorKey: "serverError.teamFlow.unreadable" } });
      flows.setJudged("漫剧组", { [id("砚青")]: ["post"] });
      app.store.deleteBot(id("墨白"));
      expect(readFileSync(app.file, "utf8")).toBe("{ not json");
      expect(app.logged.some((line) => line.includes("team-flows.json") && line.includes("left as it is"))).toBe(true);

      writeFileSync(app.file, good);
      flows.reload();
      expect(flows.pipelines().readable).toBe(true);
      expect(flows.placeOf(id("青禾"))).toMatchObject({ stages: ["post"], upstream: [id("砚青")] });
      expect(readFileSync(app.file, "utf8")).not.toContain(id("墨白"));
    } finally {
      stop();
    }
  });

  it("writes only over the text it read: a file changed on disk since is taken in first", async () => {
    const { app, id, judge, lines } = await drama();
    judge();
    const key = app.sections.sectionMemoryKey("漫剧组");
    const onDisk = stored(app.file);
    onDisk.teams[key] = { ...onDisk.teams[key]!, added: [{ from: id("云舟"), to: id("青禾") }], manual: [id("青禾")] };
    writeFileSync(app.file, JSON.stringify(onDisk));

    expect(app.flows.setLine({ from: id("砚青"), to: id("青禾"), present: true })).toMatchObject({ ok: true });

    expect(lines()).toEqual(["云舟>砚青", "砚青>墨白", "墨白>青禾", "云舟>青禾", "砚青>青禾"]);
  });
});

describe("a version 1 file", () => {
  it("keeps the line of a member placed under a superior as one drawn by hand, makes it manual, and has everyone else judged", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board", "Video");
    app.stop();
    writeFileSync(app.file, JSON.stringify({ version: 1, teams: { [app.sections.sectionMemoryKey("Studio")]: { [id("Video")]: id("Board") } } }));

    const flows = app.restarted();
    const stop = flows.start();
    try {
      const studio = flows.pipelines().teams[0]!;
      expect(studio.manual).toEqual([id("Video")]);
      expect(studio.pending.sort()).toEqual([id("Story"), id("Board")].sort());
      expect(studio.lines).toContainEqual({ from: id("Board"), to: id("Video") });
      expect(flows.placeOf(id("Video"))).toMatchObject({ stages: ["other"], upstream: [id("Chief"), id("Board")] });
      expect(stored(app.file)).toEqual({
        version: 2,
        teams: { [app.sections.sectionMemoryKey("Studio")]: { stages: {}, judged: {}, manual: [id("Video")], added: [{ from: id("Board"), to: id("Video") }], removed: [] } },
      });

      flows.setJudged("Studio", { [id("Story")]: ["script"], [id("Board")]: ["storyboard"], [id("Video")]: ["post"] });
      expect(flows.pipelines().teams[0]!.stages).toMatchObject({ [id("Story")]: ["script"], [id("Board")]: ["storyboard"], [id("Video")]: ["other"] });
    } finally {
      stop();
    }
  });
});

describe("a project's pipeline", () => {
  const project = (app: TeamFlowsTestApp, projectId: string, copies: Array<[name: string, source?: string]>) => {
    const ids = new Map<string, string>();
    copies.forEach(([name, source], index) => {
      const made = app.bot(name, projectId, index === 0 ? { chiefOfStaff: true } : {});
      app.store.patchBot(made.id, { teamProject: { id: projectId, role: name, ...(source ? { source } : {}) } });
      ids.set(name, made.id);
    });
    return (name: string) => ids.get(name)!;
  };
  const dramaProject = (app: TeamFlowsTestApp, id: (name: string) => string, projectId: string, mark: string) =>
    project(app, projectId, [[`云舟${mark}`, id("云舟")], [`砚青${mark}`, id("砚青")], [`墨白${mark}`, id("墨白")], [`青禾${mark}`, id("青禾")]]);

  it("gives each copy its source's stages and the team's lines, and every project follows a change to the team", async () => {
    const { app, id, judge, name } = await drama();
    const one = dramaProject(app, id, "Season one", "1");
    const two = dramaProject(app, id, "Season two", "2");
    const stagesOf = (copy: (name: string) => string, mark: string, stages: FlowStage[][]) =>
      Object.fromEntries(["云舟", "砚青", "墨白", "青禾"].map((member, index) => [copy(`${member}${mark}`), stages[index]]));

    expect(app.flows.projectPipeline("Season one").stages).toEqual(stagesOf(one, "1", [["lead"], ["other"], ["other"], ["other"]]));
    judge();

    const first = app.flows.projectPipeline("Season one");
    expect(first).toMatchObject({ projectId: "Season one", leadId: one("云舟1") });
    expect(first.stages).toEqual(stagesOf(one, "1", [["lead"], ["script"], ["character", "storyboard"], ["post"]]));
    expect(arrows(first.lines, name)).toEqual(["云舟1>砚青1", "砚青1>墨白1", "墨白1>青禾1"]);

    app.flows.setLine({ from: id("云舟"), to: id("青禾"), present: true });
    app.flows.setLine({ from: id("墨白"), to: id("青禾"), present: false });

    expect(arrows(app.flows.projectPipeline("Season one").lines, name)).toEqual(["云舟1>砚青1", "砚青1>墨白1", "云舟1>青禾1"]);
    expect(arrows(app.flows.projectPipeline("Season two").lines, name)).toEqual(["云舟2>砚青2", "砚青2>墨白2", "云舟2>青禾2"]);
    expect(app.flows.projectParents("Season two")).toEqual({ [two("砚青2")]: two("云舟2"), [two("墨白2")]: two("砚青2"), [two("青禾2")]: two("云舟2") });
    expect(app.flows.parents("Season two")).toEqual(app.flows.projectParents("Season two"));
    const place = app.flows.placeOf(two("墨白2"))!;
    expect({ ...place, team: [...place.team].sort() }).toEqual({
      stages: ["character", "storyboard"], upstream: [two("砚青2")], downstream: [],
      team: [two("云舟2"), two("砚青2"), two("墨白2"), two("青禾2")].sort(),
    });
    expect(place.team[0]).toBe(two("云舟2"));
    expect(app.flows.pipelines().teams.map((team) => team.section)).toEqual(["漫剧组"]);
    expect(app.flows.judgeTargets()).toEqual([]);
  });

  it("puts every bot of a project not made from a team, and a copy whose source left, under its lead as other", async () => {
    const { app, id, judge, name } = await drama();
    judge();
    const old = project(app, "Pilot", [["Lead"], ["Writer"], ["Editor"]]);
    const left = dramaProject(app, id, "Season three", "3");
    app.store.patchBot(left("墨白3"), { teamProject: { id: "Season three", role: "墨白3", source: id("墨白"), sourceLeft: true } });

    expect(app.flows.projectPipeline("Pilot")).toEqual({
      projectId: "Pilot", leadId: old("Lead"),
      stages: { [old("Lead")]: ["lead"], [old("Writer")]: ["other"], [old("Editor")]: ["other"] },
      lines: expect.arrayContaining([{ from: old("Lead"), to: old("Writer") }, { from: old("Lead"), to: old("Editor") }]),
    });
    expect(app.flows.projectPipeline("Season three").stages[left("墨白3")]).toEqual(["other"]);
    expect(arrows(app.flows.projectPipeline("Season three").lines, name)).toEqual(["云舟3>砚青3", "砚青3>青禾3", "云舟3>墨白3"]);
  });

  it("has no pipeline for a project without a lead, or one that is not there", async () => {
    const app = await installation();
    const orphan = app.bot("Writer", "Pilot");
    app.store.patchBot(orphan.id, { teamProject: { id: "Pilot", role: "writer" } });

    expect(app.flows.projectPipeline("Pilot")).toEqual({ projectId: "Pilot", leadId: null, stages: {}, lines: [] });
    expect(app.flows.projectPipeline("no-such-project")).toEqual({ projectId: "no-such-project", leadId: null, stages: {}, lines: [] });
    expect(app.flows.placeOf(orphan.id)).toBeNull();
  });

  it("refuses a line drawn inside a project and names the team it comes from", async () => {
    const { app, id } = await drama();
    const copies = dramaProject(app, id, "Season one", "1");
    const old = project(app, "Pilot", [["Lead"], ["Writer"]]);

    expect(app.flows.setLine({ from: copies("砚青1"), to: copies("青禾1"), present: true })).toMatchObject({
      ok: false, error: { errorKey: "serverError.teamFlow.project", errorParams: { bot: "青禾1", team: "漫剧组" } },
    });
    expect(app.flows.setLine({ from: old("Lead"), to: old("Writer"), present: false })).toMatchObject({
      ok: false, error: { errorKey: "serverError.teamFlow.projectNoTeam", errorParams: { bot: "Writer" } },
    });
  });
});

describe("the old tree's answers", () => {
  it("answers each member's first upstream as its superior, and marks the ones not under the Chief as placed", async () => {
    const { app, id, judge } = await drama();
    judge();

    expect(app.flows.flowsWire()).toEqual({
      readable: true,
      teams: [{
        section: "漫剧组", chiefId: id("云舟"), placed: expect.arrayContaining([id("墨白"), id("青禾")]),
        parents: { [id("砚青")]: id("云舟"), [id("墨白")]: id("砚青"), [id("青禾")]: id("墨白") },
      }],
    });
    expect(app.flows.flowsWire().teams[0]!.placed).toHaveLength(2);
  });

  it("gives a member one superior in place of the others, and takes its hand-made lines away for null", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board", "Video");

    expect(app.flows.setSuperior({ botId: id("Video"), superiorId: id("Story") })).toMatchObject({ ok: true });
    expect(app.flows.setSuperior({ botId: id("Video"), superiorId: id("Board") })).toEqual({ ok: true, flows: app.flows.flowsWire() });

    expect(app.flows.parents("Studio")).toEqual({ [id("Story")]: id("Chief"), [id("Board")]: id("Chief"), [id("Video")]: id("Board") });
    expect(app.flows.placeOf(id("Video"))).toMatchObject({ upstream: [id("Board")], downstream: [] });
    expect(app.flows.pipelines().teams[0]!.manual.sort()).toEqual([id("Story"), id("Board"), id("Video")].sort());

    expect(app.flows.setSuperior({ botId: id("Video"), superiorId: id("Chief") })).toMatchObject({ ok: true });
    expect(app.flows.placeOf(id("Video"))).toMatchObject({ upstream: [id("Chief")] });
    expect(onlyTeam(app.file)).toMatchObject({ added: [], removed: [] });

    app.flows.setSuperior({ botId: id("Video"), superiorId: id("Board") });
    expect(app.flows.setSuperior({ botId: id("Video"), superiorId: null })).toMatchObject({ ok: true });
    expect(app.flows.parents("Studio")[id("Video")]).toBe(id("Chief"));
    expect(onlyTeam(app.file)).toMatchObject({ added: [], removed: [] });
  });

  it("refuses a superior that would close a loop, the Chief under anyone, and a bot under itself", async () => {
    const app = await installation();
    const id = app.team("Studio", "Chief", "Story", "Board");
    app.flows.setSuperior({ botId: id("Board"), superiorId: id("Story") });
    const refusal = (botId: string, superiorId: string) => {
      const result = app.flows.setSuperior({ botId, superiorId });
      return result.ok ? null : [result.error.errorKey, result.error.errorParams];
    };

    expect(refusal(id("Story"), id("Board"))).toEqual(["serverError.teamFlow.loop", { from: "Board", to: "Story" }]);
    expect(refusal(id("Chief"), id("Story"))).toEqual(["serverError.teamFlow.chief", { bot: "Chief", team: "Studio" }]);
    expect(refusal(id("Story"), id("Story"))).toEqual(["serverError.teamFlow.self", undefined]);
    expect(app.flows.parents("Studio")).toEqual({ [id("Story")]: id("Chief"), [id("Board")]: id("Story") });
  });
});
