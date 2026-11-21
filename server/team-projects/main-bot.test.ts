import { afterEach, describe, expect, it } from "vitest";

import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

async function withMainBot(section?: string) {
  app = await teamProjectsInstallation();
  app.projects.start();
  app.salesTeam();
  const made = app.store.createBot({ name: "MagicBot", ...(section ? { section } : {}) }, { seedMessages: false });
  app.store.patchBot(made.id, { defaultBot: {} });
  return { app, main: app.store.bot(made.id)! };
}

const REFUSED = { errorKey: "serverError.mainBot.noDepartment", errorParams: { bot: "MagicBot" }, error: "MagicBot belongs to no department, so it can't be moved into one." };

describe("the main bot", () => {
  it("may not be moved into any department", async () => {
    const { app, main } = await withMainBot();
    for (const to of ["Sales desk", " Marketing ", "A new department"]) expect(app.projects.moveRefusalFor(main.id, to), to).toMatchObject(REFUSED);
    for (const to of ["", " ", null, undefined]) expect(app.projects.moveRefusalFor(main.id, to), String(to)).toBeNull();
  });

  it("may leave a department it is still in, and go to no other", async () => {
    const { app, main } = await withMainBot("Sales desk");
    expect(app.projects.moveRefusalFor(main.id, "")).toBeNull();
    expect(app.projects.moveRefusalFor(main.id, "Sales desk")).toBeNull();
    expect(app.projects.moveRefusalFor(main.id, "Marketing")).toMatchObject(REFUSED);
  });

  it("is kept out of departments by a team setup, when it is proposed and when it is confirmed", async () => {
    const { app, main } = await withMainBot();
    expect(app.projects.setupRefusal(main, { section: "Sales desk" })).toMatchObject(REFUSED);
    expect(() => app.projects.checkSetupChange(main, { section: "Sales desk" })).toThrow(REFUSED.error);
    expect(app.projects.setupRefusal(main, { title: "Front desk" })).toBeNull();
    expect(app.projects.setupRefusal(main, { section: "" })).toBeNull();
  });

  it("leaves every other bot free to move", async () => {
    const { app } = await withMainBot();
    const other = app.store.createBot({ name: "Ada" }, { seedMessages: false });
    expect(app.projects.moveRefusalFor(other.id, "Sales desk")).toBeNull();
    expect(app.projects.setupRefusal(app.store.bot(other.id)!, { section: "Sales desk" })).toBeNull();
  });

  it("does not hide that a team setup may not change what a copy takes from its source", async () => {
    const { app } = await withMainBot();
    app.projects.setRoot(app.root);
    const made = await app.projects.create({ name: "Season one", team: "Sales desk" });
    if (!("project" in made)) throw new Error(made.error);
    const writer = app.byRole(made.project.id).get("writer")!;
    expect(app.projects.setupRefusal(writer, { title: "Editor" })).toMatchObject({ errorKey: "serverError.teamProject.copyFollows" });
    expect(app.projects.setupRefusal(writer, { section: "Marketing" })).toMatchObject({ errorKey: "serverError.teamProject.botStays" });
  });
});
