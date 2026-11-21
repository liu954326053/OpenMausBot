import { afterEach, describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

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
  const followed = (project: TeamProjectWire) => app!.projects.list().find((candidate) => candidate.id === project.id)!.follows;
  return Object.assign(app, { stop, source, project, copyOf, followed });
}

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

describe("a copy following its source", () => {
  it("shows in every project at once the source's new name, title, description, persona, look and model", async () => {
    const app = await installation();
    const projects = [await app.project("Season one"), await app.project("Season two")];
    const scout = app.source("scout").id;

    app.store.patchBot(scout, { name: "Finder", title: "Lead finder", description: "Finds the leads worth a call.", color: "red", mascotExpression: "wink", avatarZoom: 1.5 });
    app.store.patchBotProfile(scout, { soul: "You find leads.\nOnly real ones." });
    app.store.applyModelDefault(scout, { instanceId: "codex", model: "gpt-test", effort: "high" });

    for (const project of projects) {
      expect(app.copyOf(project, "scout")).toMatchObject({
        name: "Finder", title: "Lead finder", description: "Finds the leads worth a call.", color: "red", mascotExpression: "wink", avatarZoom: 1.5,
        soul: "You find leads.\nOnly real ones.", modelSelection: { instanceId: "codex", model: "gpt-test", effort: "high" },
        teamProject: { id: project.id, role: "scout", source: scout },
      });
      expect(app.followed(project)[app.copyOf(project, "scout").id]).toBe(scout);
    }
    expect(app.source("scout").teamProject).toBeUndefined();
  });

  it("numbers a copy's new name only while another bot of its project has it, and gives the plain name back when it is free", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const names = () => ["lead", "scout", "writer"].map((key) => app.copyOf(project, key).name);

    app.store.patchBot(app.source("scout").id, { name: "Quill" });
    expect(names()).toEqual(["Morgan", "Quill 2", "Quill"]);
    app.store.patchBot(app.source("writer").id, { name: "Penn" });
    expect(names()).toEqual(["Morgan", "Quill", "Penn"]);
  });

  it("lets a busy copy finish its turn on its model, and gives it the new one when the turn ends", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const copy = app.copyOf(project, "scout");
    const before = copy.modelSelection;
    app.store.patchBot(copy.id, { busy: true });

    app.store.applyModelDefault(app.source("scout").id, { instanceId: "codex", model: "gpt-test" });
    app.store.patchBot(app.source("scout").id, { title: "Lead finder" });
    expect(app.store.bot(copy.id)).toMatchObject({ title: "Lead finder", modelSelection: before });

    app.store.patchBot(copy.id, { busy: false });
    expect(app.store.bot(copy.id)!.modelSelection).toEqual({ instanceId: "codex", model: "gpt-test" });
  });

  it("carries on with the other copies, and says so, when one cannot be brought in line", async () => {
    const app = await installation();
    const [one, two] = [await app.project("Season one"), await app.project("Season two")];
    const stuck = app.copyOf(one, "writer").id;
    const patchBotProfile = app.store.patchBotProfile.bind(app.store);
    app.store.patchBotProfile = (id, patch) => {
      if (id === stuck) throw new Error("the disk is full");
      return patchBotProfile(id, patch);
    };

    app.store.patchBotProfile(app.source("writer").id, { soul: "Short lines only." });
    expect(app.copyOf(two, "writer").soul).toBe("Short lines only.");
    expect(app.logged).toContainEqual(expect.stringContaining("Quill was not brought in line with its source: the disk is full"));
  });

  it("puts a copy changed past its source back in line with it", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const copy = app.copyOf(project, "writer");
    app.store.patchBot(copy.id, { title: "Something else", color: "blue" });
    expect(app.store.bot(copy.id)).toMatchObject({ title: app.source("writer").title, color: app.source("writer").color });
  });
});

describe("a copy no longer following", () => {
  it("keeps what it has when its source is deleted, archived or moved to another department, and stays the project's own", async () => {
    const app = await installation();
    const projects = [await app.project("Season one"), await app.project("Season two")];
    const titles = projects.map((project) => ["lead", "writer"].map((key) => app.copyOf(project, key).title));

    app.store.deleteBot(app.source("scout").id);
    app.store.patchBot(app.source("writer").id, { hidden: true });
    expect(app.store.setBotsSection([app.source("lead").id], "Elsewhere")).toMatchObject({ ok: true });

    for (const [index, project] of projects.entries()) {
      for (const key of ["lead", "scout", "writer"]) {
        expect(app.copyOf(project, key).teamProject, key).toMatchObject({ id: project.id, role: key, sourceLeft: true });
      }
      expect(app.followed(project)).toEqual({});
      expect(["lead", "writer"].map((key) => app.copyOf(project, key).title)).toEqual(titles[index]);
    }
    expect(app.logged.filter((line) => line.includes("follows nobody now"))).toHaveLength(6);

    app.store.patchBot(app.source("writer").id, { hidden: false, title: "Back again" });
    for (const project of projects) expect(app.copyOf(project, "writer")).toMatchObject({ title: titles[0]![1], teamProject: { sourceLeft: true } });
  });

  it("goes on following when the team's department is renamed, and stops when it is deleted", async () => {
    const app = await installation();
    const project = await app.project("Season one");

    expect(app.store.renameSection("Sales desk", "Sales floor")).toBeUndefined();
    app.store.patchBot(app.source("scout").id, { title: "Lead finder" });
    expect(app.copyOf(project, "scout").title).toBe("Lead finder");
    expect(app.copyOf(project, "scout").teamProject!.sourceLeft).toBeUndefined();
    expect(app.registry.projects()[0]!.team).toEqual({ key: project.team!.key, name: "Sales floor" });

    expect(app.store.deleteSection("Sales floor")).toBeUndefined();
    for (const key of ["lead", "scout", "writer"]) expect(app.copyOf(project, key).teamProject).toMatchObject({ sourceLeft: true });
    app.store.patchBot(app.source("scout").id, { title: "Somebody else" });
    expect(app.copyOf(project, "scout").title).toBe("Lead finder");
  });

  it("decides nothing while the departments cannot be read, and catches up once they can", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    app.stop();
    app.store.deleteBot(app.source("scout").id);

    const unreadable = () => { throw new Error("section-contexts.json is not JSON"); };
    const stopBlind = app.restarted({ teamOfKey: unreadable }).start();
    expect(app.copyOf(project, "scout").teamProject!.sourceLeft).toBeUndefined();
    stopBlind();

    app.restarted().start();
    expect(app.copyOf(project, "scout").teamProject!.sourceLeft).toBe(true);
    expect(app.copyOf(project, "writer").teamProject!.sourceLeft).toBeUndefined();
  });
});

describe("following across a restart", () => {
  it("catches up at start with what changed while nothing followed", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    app.stop();

    app.store.patchBot(app.source("writer").id, { name: "Penn", title: "Copywriter" });
    app.store.patchBotProfile(app.source("lead").id, { soul: "You run the sales desk.\nAsk before you promise." });
    app.store.deleteBot(app.source("scout").id);
    app.sections.writeSectionContext("Sales desk", "Quote from the new price list.");
    expect(app.copyOf(project, "writer").name).toBe("Quill");

    app.restarted().start();
    expect(app.copyOf(project, "writer")).toMatchObject({ name: "Penn", title: "Copywriter" });
    expect(app.copyOf(project, "lead").soul).toBe("You run the sales desk.\nAsk before you promise.");
    expect(app.copyOf(project, "scout").teamProject!.sourceLeft).toBe(true);
    expect(app.sections.readSectionContext("Season one")?.text).toBe("Quote from the new price list.");
  });
});

describe("the context of a project", () => {
  it("is its team's context, changed or cleared there", async () => {
    const app = await installation();
    const projects = [await app.project("Season one"), await app.project("Season two")];

    app.sections.writeSectionContext("Sales desk", "Quote from the new price list.");
    app.projects.contextsChanged();
    for (const project of projects) expect(app.sections.readSectionContext(project.section)?.text).toBe("Quote from the new price list.");

    app.sections.writeSectionContext("Sales desk", "");
    app.projects.contextsChanged();
    for (const project of projects) expect(app.sections.readSectionContext(project.section)).toBeNull();
  });

  it("stays the project's own once the team is deleted", async () => {
    const app = await installation();
    const project = await app.project("Season one");
    const context = app.sections.readSectionContext(project.section)?.text;
    expect(context).toContain("We sell a team plan at 49 per seat.");

    expect(app.store.deleteSection("Sales desk")).toBeUndefined();
    app.projects.contextsChanged();
    expect(app.sections.readSectionContext(project.section)?.text).toBe(context);
  });
});
