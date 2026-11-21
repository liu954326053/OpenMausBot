import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

async function installation() {
  app = await teamProjectsInstallation();
  app.projects.start();
  app.salesTeam();
  return app;
}

async function withProject(name = "Stand-in bride") {
  const app = await installation();
  app.projects.setRoot(app.root);
  const result = await app.projects.create({ name, team: "Sales desk" });
  if (!("project" in result)) throw new Error(result.error);
  return { app, project: result.project };
}

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

const copy = (project: TeamProjectWire, path: string) => readFileSync(join(project.folder, ".magic-team", path), "utf8");
const DAILY = { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] };

describe("the list of projects", () => {
  it("is empty, with no folder for projects, on a new installation", async () => {
    const app = await installation();
    expect(app.projects.listWire()).toEqual({ root: null, projects: [] });
    expect(app.projects.lookup("anything")).toBeUndefined();
    expect(existsSync(app.registryFile)).toBe(false);
  });

  it("shows each project with its bots and whether its folder is there", async () => {
    const { app, project } = await withProject();
    const listed = app.projects.listWire();
    expect(listed.root).toBe(app.root);
    expect(listed.projects).toEqual([project]);
    expect(listed.projects[0]).toMatchObject({ folderState: "ready", botIds: app.store.bots.filter((bot) => bot.teamProject).map((bot) => bot.id) });
    expect(listed.projects[0]!.botIds).toHaveLength(3);
    expect(listed.projects[0]).not.toHaveProperty("pausedRoutineIds");
  });

  it("says a project's folder is missing, and never makes it again", async () => {
    const { app, project } = await withProject();
    renameSync(project.folder, join(app.home, "unplugged"));
    expect(app.projects.list()[0]).toMatchObject({ folderState: "missing", botIds: project.botIds });
    expect(app.projects.lookup(project.id)).toEqual({ folder: project.folder });
    app.store.patchBotProfile(project.botIds[0]!, { soul: "Changed while the drive was away." });
    app.projects.flushCopies();
    expect(existsSync(project.folder)).toBe(false);
  });

  it("is still there, with its bots, after a restart", async () => {
    const { app, project } = await withProject();
    app.projects.archive(project.id);
    const restarted = app.restarted();
    const listed = restarted.listWire();
    expect(listed.root).toBe(app.root);
    expect(listed.projects).toEqual([{ ...project, archivedAt: expect.any(Number) }]);
    expect(restarted.lookup(project.id)).toEqual({ folder: project.folder, archivedAt: listed.projects[0]!.archivedAt });
  });
});

describe("the folder for projects", () => {
  it("is saved when it can hold projects", async () => {
    const app = await installation();
    expect(app.projects.setRoot(`${app.root}/`)).toEqual({ root: app.root });
    expect(app.projects.listWire().root).toBe(app.root);
    expect(JSON.parse(readFileSync(app.registryFile, "utf8"))).toEqual({ version: 1, root: app.root, projects: [] });
  });

  it("is refused, and the one before kept, when it cannot", async () => {
    const app = await installation();
    app.projects.setRoot(app.root);
    mkdirSync(join(app.dataDir, "workspaces"), { recursive: true });
    for (const [path, key] of [
      ["dramas", "serverError.teamProject.rootNotAbsolute"],
      [join(app.home, "nowhere"), "serverError.teamProject.rootNotFolder"],
      [app.dataDir, "serverError.teamProject.rootInData"],
      [join(app.dataDir, "workspaces"), "serverError.teamProject.rootInData"],
      [undefined, "serverError.teamProject.rootNotAbsolute"],
    ] as const) {
      expect(app.projects.setRoot(path), String(path)).toMatchObject({ errorKey: key, error: expect.any(String) });
    }
    expect(app.projects.listWire().root).toBe(app.root);
  });

  it("can change without moving the projects made before", async () => {
    const { app, project } = await withProject();
    const other = join(app.home, "more dramas");
    mkdirSync(other);
    expect(app.projects.setRoot(other)).toEqual({ root: other });
    const second = await app.projects.create({ name: "Second", team: "Sales desk" });
    expect(second).toMatchObject({ project: { folder: join(other, "Second") } });
    expect(app.projects.list()[0]).toMatchObject({ folder: project.folder, folderState: "ready" });
  });
});

describe("archiving a project and restoring it", () => {
  async function withRoutines() {
    const { app, project } = await withProject();
    const sources = new Set(app.routines.listRoutines().filter((routine) => !project.botIds.includes(routine.botId)).map((routine) => routine.id));
    const listed = () => app.routines.listRoutines().filter((routine) => !sources.has(routine.id));
    const [daily, weekly] = ["Daily digest", "Weekly pipeline review"].map((name) => listed().find((routine) => routine.name === name)!);
    app.routines.update(daily!.id, { enabled: true });
    const outsider = app.store.createBot({ name: "Outsider" }, { seedMessages: false });
    const other = app.routines.create({ name: "Other", prompt: "Check the news.", botId: outsider.id, runOn: "maus", enabled: true, schedule: DAILY, durationMinutes: 30 });
    const enabled = () => Object.fromEntries(listed().map((routine) => [routine.name, routine.enabled]));
    return { app, project, daily: daily!, weekly: weekly!, other, enabled, listed };
  }

  it("pauses the project's routines that were running and no others, and remembers which", async () => {
    const { app, project, daily, enabled } = await withRoutines();
    expect(enabled()).toEqual({ "Daily digest": true, "Weekly pipeline review": false, Other: true });

    const archived = app.projects.archive(project.id)!;
    expect(archived).toMatchObject({ id: project.id, archivedAt: expect.any(Number), folderState: "ready", botIds: project.botIds });
    expect(archived).not.toHaveProperty("pausedRoutineIds");
    expect(enabled()).toEqual({ "Daily digest": false, "Weekly pipeline review": false, Other: true });
    expect(app.registry.find(project.id)).toMatchObject({ archivedAt: archived.archivedAt, pausedRoutineIds: [daily.id] });
    expect(app.projects.lookup(project.id)).toEqual({ folder: project.folder, archivedAt: archived.archivedAt });
    expect(existsSync(project.folder)).toBe(true);
    expect(app.store.bots.filter((bot) => bot.teamProject)).toHaveLength(3);
  });

  it("resumes on restore only the routines the archive paused", async () => {
    const { app, project, enabled } = await withRoutines();
    app.projects.archive(project.id);
    const restored = app.projects.restore(project.id)!;
    expect(restored.archivedAt).toBeUndefined();
    expect(enabled()).toEqual({ "Daily digest": true, "Weekly pipeline review": false, Other: true });
    expect(app.registry.find(project.id)).not.toHaveProperty("pausedRoutineIds");
    expect(app.registry.find(project.id)).not.toHaveProperty("archivedAt");
    expect(app.projects.lookup(project.id)).toEqual({ folder: project.folder });
  });

  it("keeps the copy of the record in step, without what the server keeps to itself", async () => {
    const { app, project } = await withRoutines();
    const archived = app.projects.archive(project.id)!;
    expect(JSON.parse(copy(project, "project.json"))).toEqual({ ...app.registry.projects()[0], pausedRoutineIds: undefined });
    expect(JSON.parse(copy(project, "project.json")).archivedAt).toBe(archived.archivedAt);
    expect(copy(project, "project.json")).not.toContain("pausedRoutineIds");
    app.projects.restore(project.id);
    expect(JSON.parse(copy(project, "project.json"))).not.toHaveProperty("archivedAt");
  });

  it("changes nothing the second time, and answers null for a project that is not there", async () => {
    const { app, project, weekly, enabled } = await withRoutines();
    expect(app.projects.restore(project.id)).toMatchObject({ id: project.id });
    expect(enabled()["Daily digest"]).toBe(true);
    const first = app.projects.archive(project.id)!;
    app.routines.update(weekly.id, { enabled: true });
    expect(app.projects.archive(project.id)).toEqual(first);
    expect(enabled()["Weekly pipeline review"]).toBe(true);
    expect(app.projects.archive("nope")).toBeNull();
    expect(app.projects.restore("nope")).toBeNull();
  });

  it("leaves a routine alone on restore when it was deleted or switched on meanwhile", async () => {
    const { app, project, daily, weekly, listed } = await withRoutines();
    app.routines.update(weekly.id, { enabled: true });
    app.projects.archive(project.id);
    expect(app.registry.find(project.id)!.pausedRoutineIds!.sort()).toEqual([daily.id, weekly.id].sort());
    app.routines.remove(daily.id);
    app.routines.update(weekly.id, { enabled: true });
    expect(app.projects.restore(project.id)).toMatchObject({ id: project.id });
    expect(listed().map((routine) => [routine.name, routine.enabled]).sort()).toEqual([["Other", true], ["Weekly pipeline review", true]]);
  });

  it("is archived as it was when the archive cannot be saved: its routines run again", async () => {
    const { app, project, enabled } = await withRoutines();
    rmSync(app.registryFile);
    mkdirSync(app.registryFile);
    writeFileSync(join(app.registryFile, "in-the-way"), "x");
    expect(() => app.projects.archive(project.id)).toThrow();
    expect(enabled()).toEqual({ "Daily digest": true, "Weekly pipeline review": false, Other: true });
    expect(app.projects.list()[0]!.archivedAt).toBeUndefined();
  });

  it("stays archived when the restore cannot be saved: its routines are paused again", async () => {
    const { app, project, enabled } = await withRoutines();
    app.projects.archive(project.id);
    rmSync(app.registryFile);
    mkdirSync(app.registryFile);
    writeFileSync(join(app.registryFile, "in-the-way"), "x");
    expect(() => app.projects.restore(project.id)).toThrow();
    expect(enabled()["Daily digest"]).toBe(false);
    expect(app.projects.list()[0]!.archivedAt).toEqual(expect.any(Number));
  });

  it("restores the project although one routine can no longer run, and leaves that one paused", async () => {
    const { app, project, daily, weekly, enabled } = await withRoutines();
    app.routines.update(weekly.id, { enabled: true });
    app.projects.archive(project.id);
    const { update } = app.routines;
    app.routines.update = ((id: string, patch: { enabled?: boolean }) => {
      if (id === daily.id && patch.enabled) throw new Error("Its time has passed. Edit it to pick a new time.");
      return update.call(app.routines, id, patch);
    }) as typeof app.routines.update;
    expect(app.projects.restore(project.id)!.archivedAt).toBeUndefined();
    expect(enabled()).toEqual({ "Daily digest": false, "Weekly pipeline review": true, Other: true });
    expect(app.logged.some((line) => line.includes(daily.id) && line.includes("Its time has passed"))).toBe(true);
  });

  it("does not restore while the routines cannot be changed at all", async () => {
    const { app, project, daily, weekly, enabled } = await withRoutines();
    app.routines.update(weekly.id, { enabled: true });
    app.projects.archive(project.id);
    const { update } = app.routines;
    let resumes = 0;
    app.routines.update = ((id: string, patch: { enabled?: boolean }) => {
      if (patch.enabled && ++resumes === 2) throw Object.assign(new Error("Saved routines could not be read."), { status: 503 });
      return update.call(app.routines, id, patch);
    }) as typeof app.routines.update;
    expect(() => app.projects.restore(project.id)).toThrow("Saved routines could not be read.");
    expect(enabled()).toMatchObject({ "Daily digest": false, "Weekly pipeline review": false });
    expect(app.registry.find(project.id)).toMatchObject({ archivedAt: expect.any(Number), pausedRoutineIds: expect.arrayContaining([daily.id, weekly.id]) });
  });
});

describe("keeping a project's copies up to date", () => {
  const aged = (project: TeamProjectWire, paths: string[]) => {
    const old = new Date(1_600_000_000_000);
    for (const path of paths) utimesSync(join(project.folder, ".magic-team", path), old, old);
    return (path: string) => statSync(join(project.folder, ".magic-team", path)).mtimeMs === old.getTime();
  };

  it("writes a bot's persona again a moment after it changes", async () => {
    const { app, project } = await withProject();
    const writer = app.byRole(project.id).get("writer")!;
    const before = app.scheduled();
    app.store.patchBotProfile(writer.id, { soul: "You write every episode's script.", title: "Head writer" });
    expect(app.scheduled()).toBeGreaterThan(before);
    expect(copy(project, "team/personas/writer.md")).not.toContain("You write every episode's script.");
    app.projects.flushCopies();
    expect(copy(project, "team/personas/writer.md")).toBe("# Quill\n\nHead writer\n\nDrafts outreach for approval.\n\nYou write every episode's script.\n");
    expect(JSON.parse(copy(project, "team/team.json")).bots.find((bot: { role: string }) => bot.role === "writer").title).toBe("Head writer");
  });

  it("follows the context and the team memory when their files change", async () => {
    const { app, project } = await withProject();
    app.sections.writeSectionContext("Stand-in bride", "Eighty episodes, two minutes each.");
    app.memory.set("Stand-in bride", [{ kind: "person", name: "Gu Yan", detail: "The male lead.", aliases: [], status: "accepted" }]);
    app.projects.touchAll();
    app.projects.flushCopies();
    expect(copy(project, "team/context.md")).toBe("Eighty episodes, two minutes each.\n");
    expect(copy(project, "team/memory.md")).toBe("- **Gu Yan** (person): The male lead.\n");
  });

  it("drops the persona of a bot that was deleted", async () => {
    const { app, project } = await withProject();
    app.store.deleteBot(app.byRole(project.id).get("writer")!.id);
    app.projects.flushCopies();
    expect(readdirSync(join(project.folder, ".magic-team", "team", "personas")).sort()).toEqual(["lead.md", "scout.md"]);
    expect(JSON.parse(copy(project, "team/team.json")).bots).toHaveLength(2);
    expect(app.projects.list()[0]!.botIds).toHaveLength(2);
  });

  it("touches no file when nothing a copy holds has changed", async () => {
    const { app, project } = await withProject();
    const paths = ["project.json", "team/team.json", "team/context.md", "team/memory.md", "team/personas/lead.md"];
    const untouched = aged(project, paths);
    app.store.patchBot(app.byRole(project.id).get("lead")!.id, { unread: true });
    app.projects.flushCopies();
    for (const path of paths) expect(untouched(path), path).toBe(true);
  });

  it("writes only the project whose bot changed", async () => {
    const { app, project } = await withProject("Season one");
    const second = await app.projects.create({ name: "Season two", team: "Sales desk" });
    if (!("project" in second)) throw new Error(second.error);
    app.projects.flushCopies();
    rmSync(join(second.project.folder, ".magic-team", "team", "context.md"));
    app.store.patchBotProfile(app.byRole(project.id).get("writer")!.id, { soul: "New." });
    app.projects.flushCopies();
    expect(copy(project, "team/personas/writer.md")).toContain("New.");
    expect(existsSync(join(second.project.folder, ".magic-team", "team", "context.md"))).toBe(false);
  });

  it("catches up when a project's folder comes back", async () => {
    const { app, project } = await withProject();
    const away = join(app.home, "unplugged");
    renameSync(project.folder, away);
    app.store.patchBotProfile(app.byRole(project.id).get("writer")!.id, { soul: "Written while away." });
    app.projects.flushCopies();
    renameSync(away, project.folder);
    expect(copy(project, "team/personas/writer.md")).not.toContain("Written while away.");
    const before = app.scheduled();
    expect(app.projects.list()[0]!.folderState).toBe("ready");
    expect(app.scheduled()).toBeGreaterThan(before);
    app.projects.flushCopies();
    expect(copy(project, "team/personas/writer.md")).toContain("Written while away.");
  });

  it("brings the copies up to date when the app starts", async () => {
    const { app, project } = await withProject();
    rmSync(join(project.folder, ".magic-team", "team"), { recursive: true });
    let scheduled = 0;
    const restarted = app.restarted({ schedule: () => { scheduled += 1; } });
    const stop = restarted.start();
    expect(scheduled).toBe(1);
    restarted.flushCopies();
    stop();
    expect(readdirSync(join(project.folder, ".magic-team", "team", "personas")).sort()).toEqual(["lead.md", "scout.md", "writer.md"]);
    expect(copy(project, "team/context.md")).toContain("We sell a team plan");
  });

  it("carries on when one project's copies cannot be written", async () => {
    const { app, project } = await withProject("Season one");
    const second = await app.projects.create({ name: "Season two", team: "Sales desk" });
    if (!("project" in second)) throw new Error(second.error);
    rmSync(join(project.folder, ".magic-team", "team"), { recursive: true });
    writeFileSync(join(project.folder, ".magic-team", "team"), "not a folder");
    app.sections.writeSectionContext("Season two", "Second season.");
    app.store.patchBotProfile(app.byRole(project.id).get("writer")!.id, { soul: "New." });
    app.projects.touchAll();
    expect(() => app.projects.flushCopies()).not.toThrow();
    expect(copy(second.project, "team/context.md")).toBe("Second season.\n");
    expect(app.logged.filter((line) => line.includes("Season one") && line.includes("not a real folder"))).toHaveLength(1);
    app.projects.touchAll();
    app.projects.flushCopies();
    expect(app.logged.filter((line) => line.includes("Season one") && line.includes("not a real folder"))).toHaveLength(1);
  });
});
