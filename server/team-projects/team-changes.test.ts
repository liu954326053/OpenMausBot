import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TEAM_PROJECT_FOLDER, type TeamProjectWire } from "../../shared/team-projects.ts";
import { teamChangesInput } from "./team-changes.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

const DAILY = { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] };

async function installation() {
  app = await teamProjectsInstallation();
  const stop = app.projects.start();
  app.projects.setRoot(app.root);
  const sales = app.salesTeam();
  const source = (key: string) => app!.store.bot(sales.byKey.get(key)!.id)!;
  const project = async (name: string): Promise<TeamProjectWire> => {
    const result = await app!.projects.create({ name, team: "Sales desk" });
    if (!("project" in result)) throw new Error(`not made: ${result.code}: ${result.error}`);
    return result.project;
  };
  const copyOf = (project: TeamProjectWire, key: string) => app!.byRole(project.id).get(key)!;
  const listed = (project: TeamProjectWire) => app!.projects.list().find((candidate) => candidate.id === project.id)!;
  const hire = (name: string, title: string) =>
    app!.store.createBot({ name, title, section: "Sales desk", modelSelection: { instanceId: "codex", model: "gpt-hire" } }, { seedMessages: false });
  return Object.assign(app, { stop, source, project, copyOf, listed, hire });
}

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

describe("what changed in a project's team", () => {
  it("is nothing while the copies follow the whole team", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    expect(app.listed(project).teamChanges).toBeUndefined();
  });

  it("is each member the project has no copy of, and each copy whose source left, in every project of the team", async () => {
    const app = await installation();
    const projects = [await app.project("Season one"), await app.project("Season two")];
    const ada = app.hire("Ada", "Analyst");
    app.store.patchBot(app.source("scout").id, { hidden: true });

    for (const project of projects) {
      expect(app.listed(project).teamChanges).toEqual({
        joined: [{ id: ada.id, name: "Ada", title: "Analyst" }],
        left: [{ id: app.copyOf(project, "scout").id, name: "Scout", title: app.copyOf(project, "scout").title }],
      });
    }
    expect(app.byRole(projects[0]!.id).size).toBe(3);
  });

  it("is not shown for an archived project, and is again once it is restored", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    app.hire("Ada", "Analyst");
    app.projects.archive(project.id);
    expect(app.listed(project).teamChanges).toBeUndefined();
    app.projects.restore(project.id);
    expect(app.listed(project).teamChanges?.joined.map((member) => member.name)).toEqual(["Ada"]);
  });
});

describe("the person's decisions about a team's changes", () => {
  it("make a copy of a new member only when asked, the way the project's copies were made", async () => {
    const app = await installation();
    const [one, two] = [await app.project("Season one"), await app.project("Season two")];
    const ada = app.hire("Ada", "Analyst");
    app.store.patchBotProfile(ada.id, { soul: "You read the numbers." });
    app.skills.installSkill(ada.id, "own", [{ path: "SKILL.md", content: "---\nname: ledger\ndescription: Keeps the ledger.\n---\nKeep it.\n" }]);
    app.routines.create({ name: "Weekly numbers", prompt: "Sum the week.", botId: ada.id, runOn: "maus", enabled: true, schedule: DAILY, durationMinutes: 30 });

    const outcome = await app.projects.decideTeamChanges(one.id, { add: [ada.id], remove: [], keep: [] });

    expect(outcome?.skipped).toEqual([]);
    expect(outcome?.project.teamChanges).toBeUndefined();
    const copy = app.botsOf(one.id).find((bot) => bot.teamProject?.source === ada.id)!;
    expect(copy).toMatchObject({
      name: "Ada", title: "Analyst", soul: "You read the numbers.", section: "Season one", cwd: one.folder,
      modelSelection: { instanceId: "codex", model: "gpt-hire" }, teamProject: { id: one.id, source: ada.id },
    });
    expect(copy.chiefOfStaff).toBeFalsy();
    expect(outcome?.project.follows[copy.id]).toBe(ada.id);
    expect(app.placed).toContain(copy.id);
    expect(app.skills.listSkills(copy.id).map((skill) => skill.name)).toEqual(["ledger"]);
    expect(app.routines.listRoutines().filter((routine) => routine.botId === copy.id).map((routine) => routine.enabled)).toEqual([false]);
    expect(app.store.sections).not.toContain("Sales desk 2");

    app.store.patchBot(ada.id, { title: "Lead analyst" });
    expect(app.store.bot(copy.id)!.title).toBe("Lead analyst");
    expect(app.listed(two).teamChanges?.joined.map((member) => member.id)).toEqual([ada.id]);
  });

  it("delete a departed copy as a person's deletion does, and keep another as the project's own", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const [scout, writer] = [app.copyOf(project, "scout"), app.copyOf(project, "writer")];
    app.store.patchBot(app.source("scout").id, { hidden: true });
    app.store.patchBot(app.source("writer").id, { section: "Elsewhere" });

    const outcome = await app.projects.decideTeamChanges(project.id, { add: [], remove: [scout.id], keep: [writer.id] });

    expect(outcome?.skipped).toEqual([]);
    expect(app.store.bot(scout.id)).toBeNull();
    expect(readdirSync(join(project.folder, TEAM_PROJECT_FOLDER, "bots", ".deleted"))).toEqual([expect.stringMatching(/^scout-/)]);
    expect(app.store.bot(writer.id)!.teamProject).toEqual({ id: project.id, role: "writer" });
    expect(app.projects.copyRefusal(writer.id, ["name"])).toBeNull();
    expect(outcome?.project.teamChanges).toBeUndefined();
  });

  it("skip what no longer stands, and what could not be done, and say why in the log", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const ada = app.hire("Ada", "Analyst");
    const lead = app.copyOf(project, "lead");
    const scout = app.copyOf(project, "scout");
    app.store.patchBot(app.source("scout").id, { hidden: true });
    app.store.patchBot(ada.id, { hidden: true });
    app.onDelete = (botId) => (botId === scout.id ? "stop this bot's active routine before deleting the bot" : null);
    const before = app.snapshot();

    const outcome = await app.projects.decideTeamChanges(project.id, { add: [ada.id, "nobody"], remove: [scout.id, lead.id], keep: [lead.id] });

    expect(outcome?.skipped.sort()).toEqual([ada.id, lead.id, lead.id, "nobody", scout.id].sort());
    expect(app.snapshot()).toBe(before);
    expect(app.store.bot(lead.id)!.teamProject?.source).toBe(app.source("lead").id);
    expect(app.logged).toContain("team projects: Scout was not removed from Season one: stop this bot's active routine before deleting the bot");
    expect(await app.projects.decideTeamChanges("project-404", { add: [], remove: [], keep: [] })).toBeNull();
  });

  it("take back a copy that could not be finished, and leave the rest of the project as it was", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const ada = app.hire("Ada", "Analyst");
    const before = app.snapshot();
    app.onPlace = (botId) => {
      if (app.store.bot(botId)?.teamProject?.source === ada.id) throw new Error("the project folder is read-only");
    };

    const outcome = await app.projects.decideTeamChanges(project.id, { add: [ada.id], remove: [], keep: [] });

    expect(outcome?.skipped).toEqual([ada.id]);
    expect(app.snapshot()).toBe(before);
    expect(outcome?.project.teamChanges?.joined.map((member) => member.id)).toEqual([ada.id]);
    expect(app.logged).toContain("team projects: no copy of Ada was made in Season one: the project folder is read-only");
    expect(existsSync(join(project.folder, TEAM_PROJECT_FOLDER, "bots", "ada"))).toBe(false);
  });
});

describe("a request's decisions", () => {
  it("are three lists of ids, each without repeats; anything else is no decision", () => {
    expect(teamChangesInput({ add: ["a", "a"], keep: ["b"] })).toEqual({ add: ["a"], remove: [], keep: ["b"] });
    expect(teamChangesInput({})).toEqual({ add: [], remove: [], keep: [] });
    for (const body of [null, [], "add", { add: "a" }, { remove: [1] }, { keep: Array.from({ length: 201 }, (_, n) => `${n}`) }]) {
      expect(teamChangesInput(body), JSON.stringify(body)).toBeNull();
    }
  });
});
