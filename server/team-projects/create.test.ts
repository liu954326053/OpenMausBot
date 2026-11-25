import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CreateTeamProjectInput, CreateTeamProjectResult, TeamProjectWire } from "../../shared/team-projects.ts";
import type { BotRecord } from "../store.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

async function installation(options: { root?: boolean } = {}) {
  app = await teamProjectsInstallation();
  app.projects.start();
  if (options.root !== false) expect(app.projects.setRoot(app.root)).toEqual({ root: app.root });
  const sales = app.salesTeam();
  const source = (key: string) => app!.store.bot(sales.byKey.get(key)!.id)!;
  return Object.assign(app, { sales, source });
}

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

function made(result: CreateTeamProjectResult): { project: TeamProjectWire } {
  if (!("project" in result)) throw new Error(`not made: ${result.code}: ${result.error}`);
  return result;
}

const copy = (folder: string, path: string) => readFileSync(join(folder, ".magic-team", path), "utf8");
const sales = (name: string): CreateTeamProjectInput => ({ name, team: "Sales desk" });

describe("the teams a project can be made from", () => {
  it("lists each department with its context, its Chief first and each member's title", async () => {
    const app = await installation();
    const morgan = { id: app.source("lead").id, name: "Morgan", title: "Sales lead" };
    expect(app.projects.teams()).toEqual([{
      name: "Sales desk",
      context: expect.stringContaining("We sell a team plan at 49 per seat."),
      chief: morgan,
      members: [morgan, ...[
        { id: app.source("scout").id, name: "Scout", title: "Prospect researcher" },
        { id: app.source("writer").id, name: "Quill", title: "Outreach writer" },
      ].sort((a, b) => app.store.bots.findIndex((bot) => bot.id === a.id) - app.store.bots.findIndex((bot) => bot.id === b.id))],
    }]);
  });

  it("shows, with the reason, a team without bots, one without a Chief and one the main bot leads, and lists no project's team", async () => {
    const app = await installation();
    made(await app.projects.create(sales("Stand-in bride")));
    const main = app.store.createBot({ name: "MagicBot", section: "Front desk" }, { seedMessages: false });
    app.store.patchBot(main.id, { defaultBot: {} });
    app.store.setChiefOfStaff(main.id);
    app.store.createBot({ name: "Greeter", section: "Front desk" }, { seedMessages: false });
    app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    app.sections.ensureSections(["Empty"]);

    const unusable = Object.fromEntries(app.projects.teams().map((team) => [team.name, team.unusable ?? null]));
    expect(unusable).toEqual({ "Sales desk": null, "Front desk": "main_bot_chief", Marketing: "no_chief", Empty: "empty" });
    const front = app.projects.teams().find((team) => team.name === "Front desk")!;
    expect(front.chief).toMatchObject({ id: main.id });
    expect(front.members.map((member) => member.name)).toEqual(["Greeter"]);
  });
});

describe("making a project from a team", () => {
  it("makes the folder, a copy of each of the team's bots in the project's own department, the record and the copies", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    const folder = join(app.root, "Stand-in bride");

    expect(project).toMatchObject({
      id: "project-1", name: "Stand-in bride", folder, section: "Stand-in bride", team: { key: expect.stringMatching(/^team:/), name: "Sales desk" }, folderState: "ready",
    });
    expect(project.template).toBeUndefined();
    expect(readdirSync(app.root)).toEqual(["Stand-in bride"]);

    const bots = app.byRole(project.id);
    expect([...bots.keys()].sort()).toEqual(["lead", "scout", "writer"]);
    const lead = bots.get("lead")!, scout = bots.get("scout")!, writer = bots.get("writer")!;
    expect([...project.botIds].sort()).toEqual([lead.id, scout.id, writer.id].sort());
    for (const bot of bots.values()) expect(bot).toMatchObject({ section: "Stand-in bride", cwd: folder });
    expect([lead.name, scout.name, writer.name]).toEqual(["Morgan", "Scout", "Quill"]);
    expect(app.registry.projects()).toEqual([{
      id: "project-1", name: "Stand-in bride", folder, section: "Stand-in bride", team: project.team, leadBotId: lead.id, createdAt: project.createdAt,
    }]);
    expect(project.team!.key).toBe(app.sections.sectionMemoryKey("Sales desk"));
    expect(app.projects.lookup("project-1")).toEqual({ folder });
  });

  it("records on each copy the bot it was made from, and the copy of the team's Chief leads the project", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    const bots = app.byRole(project.id);
    for (const key of ["lead", "scout", "writer"]) {
      expect(bots.get(key)!.teamProject).toEqual({ id: "project-1", role: key, source: app.source(key).id });
    }
    expect(project.follows).toEqual(Object.fromEntries(["lead", "scout", "writer"].map((key) => [bots.get(key)!.id, app.source(key).id])));
    expect(project.leadBotId).toBe(bots.get("lead")!.id);
    expect(bots.get("lead")!.chiefOfStaff).toBe(true);
    expect(bots.get("scout")!.chiefOfStaff).toBeFalsy();
    expect(app.source("lead").chiefOfStaff).toBe(true);
    expect(app.source("lead").teamProject).toBeUndefined();
    expect(app.exports).toEqual(["Sales desk"]);
  });

  it("gives each copy its source's current model, look and persona, and no MCP server", async () => {
    const app = await installation();
    app.store.applyModelDefault(app.source("scout").id, { instanceId: "codex", model: "gpt-test", effort: "high" });
    app.store.patchBot(app.source("writer").id, { mascotFaceColor: "black", avatarZoom: 2, avatarFocusX: 0.25, avatarFocusY: 0.75 });
    app.store.patchBotProfile(app.source("writer").id, { soul: "You write every outreach email.\nKeep it short." });
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    const bots = app.byRole(project.id);

    expect(bots.get("scout")!.modelSelection).toEqual({ instanceId: "codex", model: "gpt-test", effort: "high" });
    expect(bots.get("lead")!.modelSelection).toEqual(app.source("lead").modelSelection);
    for (const bot of bots.values()) {
      expect(bot).not.toHaveProperty("assignedSkills");
      expect(bot.mcpServers).toBeUndefined();
    }
    expect(app.source("scout").mcpServers).toEqual(["crm"]);
    expect(bots.get("writer")).toMatchObject({ mascotFaceColor: "black", avatarZoom: 2, avatarFocusX: 0.25, avatarFocusY: 0.75, color: "green", mascotBody: app.source("writer").mascotBody });
    expect(bots.get("writer")!.soul).toBe("You write every outreach email.\nKeep it short.");
    expect(bots.get("lead")!.avatarUrl).toBe(app.source("lead").avatarUrl);
    for (const key of ["lead", "scout", "writer"] as const) {
      const [made, source] = [bots.get(key)!, app.source(key)];
      expect([made.title, made.description, made.soul]).toEqual([source.title, source.description, source.soul]);
    }
  });

  it("copies each bot's own skills once, and leaves memory and switched-on routines behind", async () => {
    const app = await installation();
    for (const routine of app.routines.listRoutines()) app.routines.update(routine.id, { enabled: true });
    const sourceRoutines = app.routines.listRoutines().map((routine) => routine.id);
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    const bots = app.byRole(project.id);

    expect(app.skills.listSkills(bots.get("lead")!.id).map((skill) => skill.name)).toEqual(["pricing-policy"]);
    expect(app.skills.listSkills(bots.get("scout")!.id).map((skill) => skill.name).sort()).toEqual(["pricing-policy", "research-brief"]);
    expect(app.skills.listSkills(bots.get("writer")!.id)).toEqual([]);
    expect(app.workspace.readMemoryFile(app.source("lead").id).text).not.toBe("");
    expect(app.workspace.readMemoryFile(bots.get("lead")!.id).text).toBe("");
    const copied = app.routines.listRoutines().filter((routine) => !sourceRoutines.includes(routine.id));
    expect(copied.map((routine) => routine.name).sort()).toEqual(["Daily digest", "Weekly pipeline review"]);
    expect(copied.every((routine) => !routine.enabled && project.botIds.includes(routine.botId))).toBe(true);
    expect(app.routines.listRoutines().filter((routine) => sourceRoutines.includes(routine.id)).every((routine) => routine.enabled)).toBe(true);
    expect(app.store.groups.filter((group) => group.section === "Stand-in bride").map((group) => [group.name, group.cwd])).toEqual([["Deal desk", project.folder]]);
  });

  it("gives the project's department the team's context, and writes the copies: the record, the team by name only, each persona", async () => {
    const app = await installation();
    app.sections.writeSectionContext("Sales desk", "We sell seats. Quote from the price list.");
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    const lead = app.byRole(project.id).get("lead")!;
    expect(app.sections.readSectionContext("Stand-in bride")?.text).toBe("We sell seats. Quote from the price list.");
    expect(JSON.parse(copy(project.folder, "project.json"))).toEqual(app.registry.projects()[0]);
    const team = JSON.parse(copy(project.folder, "team/team.json"));
    expect(team).toMatchObject({ department: "Stand-in bride", lead: "lead" });
    expect(team.bots[0]).toMatchObject({ name: "Morgan" });
    expect(readdirSync(join(project.folder, ".magic-team", "team", "personas")).sort()).toEqual(["lead.md", "scout.md", "writer.md"]);
    expect(copy(project.folder, "team/personas/lead.md")).toContain(lead.soul!.trim());
    expect(copy(project.folder, "team/context.md")).toContain("We sell seats.");
    expect(JSON.stringify(team)).not.toContain("mcp.example.com");
  });

  it("makes each copy a member of the project before the first of its own files is written", async () => {
    const app = await installation();
    const folder = join(app.root, "Stand-in bride");
    const seen: Array<{ step: string; membership: unknown; cwd: unknown; found: unknown }> = [];
    const note = (step: string, botId: string) => {
      const bot = app.store.bot(botId)!;
      seen.push({ step, membership: bot.teamProject, cwd: bot.cwd, found: bot.teamProject && app.projects.lookup(bot.teamProject.id) });
    };
    const { install } = app.importDeps.skills;
    const { writeIndex, writeTopic } = app.importDeps.memory;
    app.importDeps.skills.install = (botId, ...rest) => { note("skill", botId); return install(botId, ...rest); };
    app.importDeps.memory.writeIndex = (botId, text) => { note("memory", botId); writeIndex(botId, text); };
    app.importDeps.memory.writeTopic = (botId, name, text) => { note("topic", botId); writeTopic(botId, name, text); };
    app.onPlace = (botId) => note("place", botId);

    const { project } = made(await app.projects.create(sales("Stand-in bride")));

    expect(seen.map((entry) => entry.step).sort()).toEqual(["place", "place", "place", "skill", "skill", "skill"]);
    for (const entry of seen) {
      expect(entry.membership).toEqual({ id: "project-1", role: expect.stringMatching(/^(lead|scout|writer)$/), source: expect.any(String) });
      expect(entry.cwd).toBe(folder);
      expect(entry.found).toEqual({ folder });
    }
    expect([...app.placed].sort()).toEqual([...project.botIds].sort());
    for (const botId of project.botIds) {
      const role = app.store.bot(botId)!.teamProject!.role;
      const own = seen.filter((entry) => (entry.membership as { role: string }).role === role).map((entry) => entry.step);
      expect(own[0], role).toBe("place");
    }
  });

  it("makes two projects from one team, each with its own copies under the source's names", async () => {
    const app = await installation();
    app.store.createBot({ name: "Scout", section: "Elsewhere" }, { seedMessages: false });
    const first = made(await app.projects.create(sales("Season one"))).project;
    const second = made(await app.projects.create(sales("Season two"))).project;

    expect(readdirSync(app.root).sort()).toEqual(["Season one", "Season two"]);
    for (const project of [first, second]) {
      const bots = app.byRole(project.id);
      expect(["lead", "scout", "writer"].map((role) => bots.get(role)!.name)).toEqual(["Morgan", "Scout", "Quill"]);
      expect(["lead", "scout", "writer"].map((role) => bots.get(role)!.teamProject!.source)).toEqual(["lead", "scout", "writer"].map((key) => app.source(key).id));
      expect(bots.get("lead")).toMatchObject({ chiefOfStaff: true, section: project.name, cwd: project.folder });
    }
    expect(first.botIds.some((id) => second.botIds.includes(id))).toBe(false);
    expect(app.source("lead").name).toBe("Morgan");
    expect(app.routines.listRoutines()).toHaveLength(6);
  });

  it("tells two copies apart when two of the team's bots share a name", async () => {
    const app = await installation();
    app.store.patchBot(app.source("scout").id, { name: "Quill" });
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    const bots = app.byRole(project.id);
    expect(["lead", "scout", "writer"].map((role) => bots.get(role)!.name).sort()).toEqual(["Morgan", "Quill", "Quill 2"]);
  });

  it("finds the team whatever the case, and takes the name as a person typed it", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create({ name: "  Cafe\u0301 nights ", team: " sales DESK " }));
    expect(project.name).toBe("Caf\u00e9 nights");
    expect(project.team!.name).toBe("Sales desk");
    expect(readdirSync(app.root).map((name) => name.normalize("NFC"))).toEqual(["Caf\u00e9 nights"]);
  });

  it("gives a copy a folder-safe role when its key in the export is not one", async () => {
    const app = await installation();
    const chief = app.store.createBot({ name: "Lead", section: "Odd" }, { seedMessages: false });
    app.store.setChiefOfStaff(chief.id);
    app.store.createBot({ name: "NUL", section: "Odd" }, { seedMessages: false });
    app.store.createBot({ name: "Copy_writer", section: "Odd" }, { seedMessages: false });

    const { project } = made(await app.projects.create({ name: "Odd keys", team: "Odd" }));
    expect([...app.byRole(project.id).keys()].sort()).toEqual(["copy-writer", "lead", "role-1"]);
    expect(readdirSync(join(project.folder, ".magic-team", "team", "personas")).sort()).toEqual(["copy-writer.md", "lead.md", "role-1.md"]);
    expect(app.byRole(project.id).get("lead")!.chiefOfStaff).toBe(true);
  });
});

describe("a project that is refused", () => {
  async function refused(app: TeamProjectsTestApp, input: CreateTeamProjectInput) {
    const before = app.snapshot();
    const folders = existsSync(app.root) ? readdirSync(app.root) : null;
    const projectBots = JSON.stringify(app.store.bots.filter((bot) => bot.teamProject));
    const result = await app.projects.create(input);
    expect(app.snapshot()).toBe(before);
    expect(existsSync(app.root) ? readdirSync(app.root) : null).toEqual(folders);
    expect(JSON.stringify(app.store.bots.filter((bot) => bot.teamProject))).toBe(projectBots);
    if ("project" in result) throw new Error("it was made");
    return result;
  }
  const noProjectBots = (app: TeamProjectsTestApp) => expect(app.store.bots.filter((bot: BotRecord) => bot.teamProject)).toEqual([]);

  it("says so when no folder for projects was chosen", async () => {
    const app = await installation({ root: false });
    expect(await refused(app, sales("Drama"))).toMatchObject({ code: "no_root", errorKey: "serverError.teamProject.noRoot" });
  });

  it("says so when the folder for projects is not there, and does not make it", async () => {
    const app = await installation();
    rmSync(app.root, { recursive: true });
    expect(await refused(app, sales("Drama"))).toMatchObject({ code: "root_missing", errorKey: "serverError.teamProject.rootMissing" });
    expect(existsSync(app.root)).toBe(false);
  });

  it("makes nothing in a folder for projects that has come to lie inside the app's own data, as written or through a link", async () => {
    const app = await installation();
    const inside = join(app.dataDir, "dramas");
    const link = join(app.home, "link-to-dramas");
    mkdirSync(inside);
    symlinkSync(inside, link, "dir");
    for (const root of [inside, link]) {
      writeFileSync(app.registryFile, JSON.stringify({ version: 1, root, projects: [] }));
      const result = await app.restarted().create(sales("Drama"));
      expect(result, root).toMatchObject({ code: "failed", errorKey: "serverError.teamProject.failed", errorParams: { detail: expect.stringContaining("inside the app's own data folder") } });
    }
    expect(readdirSync(inside)).toEqual([]);
    noProjectBots(app);
    expect(app.store.sections).not.toContain("Drama");
  });

  it("refuses a name that cannot be a folder's", async () => {
    const app = await installation();
    for (const name of ["", "   ", "a/b", "..", "CON", "x".repeat(61), "what?"]) {
      expect(await refused(app, sales(name)), name).toMatchObject({ code: "bad_name", errorKey: "serverError.teamProject.badName", errorParams: { max: 60 } });
    }
    expect(await refused(app, { name: 7 as unknown as string, team: "Sales desk" })).toMatchObject({ code: "bad_name" });
  });

  it("refuses the name of another project, archived or not, and of a department, whatever the case", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create(sales("Stand-in bride")));
    app.projects.archive(project.id);
    app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    const before = app.snapshot();
    for (const name of ["Stand-in bride", "STAND-IN BRIDE", "marketing", "sales desk"]) {
      const result = await app.projects.create(sales(name));
      expect(result, name).toMatchObject({ code: "name_taken", errorKey: "serverError.teamProject.nameTaken", errorParams: { name } });
    }
    expect(app.snapshot()).toBe(before);
    expect(readdirSync(app.root)).toEqual(["Stand-in bride"]);
  });

  it("makes one project when two requests ask for one name at the same moment, and tells the other the name is taken", async () => {
    const app = await installation();
    const outcomes = await Promise.all([app.projects.create(sales("Stand-in bride")), app.projects.create(sales("Stand-in bride"))]);
    expect(outcomes.filter((outcome) => "project" in outcome)).toHaveLength(1);
    expect(outcomes.find((outcome) => !("project" in outcome))).toMatchObject({ code: "name_taken", errorParams: { name: "Stand-in bride" } });
    expect(app.projects.list().map((project) => project.name)).toEqual(["Stand-in bride"]);
    expect(readdirSync(app.root)).toEqual(["Stand-in bride"]);
    expect(app.store.bots.filter((bot) => bot.teamProject)).toHaveLength(3);
    expect(app.store.sections.filter((section) => section.toLowerCase() === "stand-in bride")).toEqual(["Stand-in bride"]);
  });

  it("refuses a name the folder for projects already holds, as a folder or as a file", async () => {
    const app = await installation();
    mkdirSync(join(app.root, "Old drama"));
    writeFileSync(join(app.root, "Notes"), "mine");
    expect(await refused(app, sales("Old drama"))).toMatchObject({ code: "folder_exists", errorKey: "serverError.teamProject.folderExists", errorParams: { name: "Old drama" } });
    expect(await refused(app, sales("Notes"))).toMatchObject({ code: "folder_exists" });
    expect(readdirSync(join(app.root, "Old drama"))).toEqual([]);
    expect(readFileSync(join(app.root, "Notes"), "utf8")).toBe("mine");
  });

  it("says so when there is no such team, a project's own team included", async () => {
    const app = await installation();
    made(await app.projects.create(sales("Season one")));
    for (const team of ["Gone", "Season one", "", undefined]) {
      expect(await refused(app, { name: "Drama", team: team as string }), String(team)).toMatchObject({ code: "no_team", errorKey: "serverError.teamProject.noTeam" });
    }
  });

  it("refuses a team without a Chief, one without bots and one the main bot leads, saying why", async () => {
    const app = await installation();
    app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    app.sections.ensureSections(["Empty"]);
    const main = app.store.createBot({ name: "MagicBot", section: "Front desk" }, { seedMessages: false });
    app.store.patchBot(main.id, { defaultBot: {} });
    app.store.setChiefOfStaff(main.id);
    app.store.createBot({ name: "Greeter", section: "Front desk" }, { seedMessages: false });
    const exportsBefore = app.exports.length;

    expect(await refused(app, { name: "Drama", team: "Marketing" })).toMatchObject({ code: "team_unusable", errorKey: "serverError.teamProject.teamNoChief", errorParams: { team: "Marketing" } });
    expect(await refused(app, { name: "Drama", team: "Empty" })).toMatchObject({ code: "team_unusable", errorKey: "serverError.teamProject.teamEmpty", errorParams: { team: "Empty" } });
    expect(await refused(app, { name: "Drama", team: "Front desk" })).toMatchObject({ code: "team_unusable", errorKey: "serverError.teamProject.teamMainBotChief", errorParams: { team: "Front desk" } });
    expect(app.exports).toHaveLength(exportsBefore);
  });

  it("makes nothing when the team cannot be exported", async () => {
    const app = await installation();
    app.onExport = () => { throw new Error("a skill changed while it was read"); };
    expect(await refused(app, sales("Drama"))).toMatchObject({ code: "failed", errorKey: "serverError.teamProject.failed", errorParams: { detail: expect.stringContaining("a skill changed") } });
  });

  it("makes nothing while the list of projects cannot be read", async () => {
    const app = await installation();
    writeFileSync(app.registryFile, "{ not the list");
    const result = await app.restarted().create(sales("Drama"));
    expect(result).toMatchObject({ code: "failed", errorKey: "serverError.teamProject.unreadable" });
    expect(readdirSync(app.root)).toEqual([]);
    noProjectBots(app);
    expect(readFileSync(app.registryFile, "utf8")).toBe("{ not the list");
  });
});

describe("a project that fails part-way", () => {
  async function failed(app: TeamProjectsTestApp) {
    const before = app.snapshot();
    const result = await app.projects.create(sales("Stand-in bride"));
    if ("project" in result) throw new Error("it was made");
    expect(result.code).toBe("failed");
    expect(app.snapshot()).toBe(before);
    expect(app.store.bots.some((bot) => bot.teamProject)).toBe(false);
    expect(app.projects.lookup("project-1")).toBeUndefined();
    expect(app.sections.readSectionContext("Stand-in bride")).toBeNull();
    return result;
  }
  const nothingLeft = (app: TeamProjectsTestApp) => expect(readdirSync(app.root)).toEqual([]);

  it("leaves nothing behind when the team cannot be made", async () => {
    const app = await installation();
    let calls = 0;
    const { install } = app.importDeps.skills;
    app.importDeps.skills.install = (...args) => (++calls === 3 ? { error: "the disk is full" } : install(...args));
    const result = await failed(app);
    expect(result).toMatchObject({ errorKey: "serverError.teamProject.failed", errorParams: { detail: expect.stringContaining("the disk is full") } });
    expect(app.logged.filter((line) => line.includes("was not made"))).toEqual([expect.stringMatching(/^team projects: Stand-in bride was not made: .*the disk is full/)]);
    nothingLeft(app);
  });

  it("leaves nothing behind when a copy's own files cannot go into the project folder", async () => {
    const app = await installation();
    app.onPlace = (botId) => { if (app.placed.length === 2) throw new Error(`the folder for ${app.store.bot(botId)!.teamProject!.role} cannot be used`); };
    const result = await failed(app);
    expect(result).toMatchObject({ errorKey: "serverError.teamProject.failed", errorParams: { detail: "the folder for scout cannot be used" } });
    nothingLeft(app);
  });

  it("leaves nothing behind when a copy cannot be brought in line with its source", async () => {
    const app = await installation();
    const { patchBot } = app.store;
    app.store.patchBot = (id, patch) => {
      if ("avatarUrl" in patch) throw new Error("the picture could not be saved");
      return patchBot.call(app.store, id, patch);
    };
    const result = await failed(app);
    expect(result.error).toContain("the picture could not be saved");
    nothingLeft(app);
  });

  it("leaves nothing behind when the record cannot be saved", async () => {
    const app = await installation();
    rmSync(app.registryFile);
    mkdirSync(app.registryFile);
    writeFileSync(join(app.registryFile, "in-the-way"), "x");
    await failed(app);
    nothingLeft(app);
  });

  it("leaves nothing behind, the record included, when the copies cannot be written", async () => {
    const app = await installation();
    app.memory.get = () => { throw new Error("team memory is unreadable"); };
    const result = await failed(app);
    expect(result.error).toContain("team memory is unreadable");
    expect(app.registry.projects()).toEqual([]);
    nothingLeft(app);
  });

  it("says so, and keeps the folder, when something it did not make is in the folder by then", async () => {
    const app = await installation();
    const folder = join(app.root, "Stand-in bride");
    app.memory.get = () => {
      writeFileSync(join(folder, "episode-1.md"), "a person's work");
      throw new Error("team memory is unreadable");
    };
    const result = await failed(app);
    expect(result).toMatchObject({ errorKey: "serverError.teamProject.failedLeftovers" });
    expect(app.logged.filter((line) => line.includes("was not made"))).toEqual([expect.stringMatching(/^team projects: Stand-in bride was not made: .*team memory is unreadable; not everything could be taken back: /)]);
    expect(readdirSync(folder)).toEqual(["episode-1.md"]);
  });

  it("says why when the app cannot get ready to make bots", async () => {
    const app = await installation();
    const offline = app.restarted({ importDeps: async () => { throw new Error("no AI is set up"); } });
    expect(await offline.create(sales("Drama"))).toMatchObject({ code: "failed", errorParams: { detail: "no AI is set up" } });
    nothingLeft(app);
  });
});
