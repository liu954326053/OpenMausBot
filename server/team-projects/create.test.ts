import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CreateTeamProjectResult, TeamProjectWire } from "../../shared/team-projects.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

async function installation(options: { maxBots?: number; root?: boolean } = {}) {
  app = await teamProjectsInstallation(options);
  app.projects.start();
  if (options.root !== false) expect(app.projects.setRoot(app.root)).toEqual({ root: app.root });
  app.templates.set("sales", app.salesTemplate());
  return app;
}

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

function made(result: CreateTeamProjectResult): { project: TeamProjectWire; missingSkills: string[] } {
  if (!("project" in result)) throw new Error(`not made: ${result.code}: ${result.error}`);
  return result;
}

const copy = (folder: string, path: string) => readFileSync(join(folder, ".magic-team", path), "utf8");

describe("making a project from a team template", () => {
  it("makes the folder, the team in its own department, the record and the copies", async () => {
    const app = await installation();
    const { project, missingSkills } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    const folder = join(app.root, "Stand-in bride");

    expect(project).toMatchObject({
      id: "project-1", name: "Stand-in bride", folder, section: "Stand-in bride",
      template: { id: "sales", name: "Sales crew", version: 3 }, folderState: "ready",
    });
    expect(project.archivedAt).toBeUndefined();
    expect(readdirSync(app.root)).toEqual(["Stand-in bride"]);
    expect(existsSync(join(folder, ".magic-team"))).toBe(true);

    const bots = app.byRole(project.id);
    expect([...bots.keys()].sort()).toEqual(["lead", "scout", "writer"]);
    const lead = bots.get("lead")!, scout = bots.get("scout")!, writer = bots.get("writer")!;
    expect([...project.botIds].sort()).toEqual([lead.id, scout.id, writer.id].sort());
    expect(project.leadBotId).toBe(lead.id);
    for (const bot of bots.values()) expect(bot).toMatchObject({ section: "Stand-in bride", cwd: folder });
    expect(app.store.sections).toContain("Stand-in bride");
    expect(lead).toMatchObject({ name: "Morgan", title: "Sales lead", chiefOfStaff: true });
    expect(scout.chiefOfStaff).toBeFalsy();
    expect([lead.name, scout.name, writer.name]).toEqual(["Morgan", "Scout", "Quill"]);

    expect(app.registry.projects()).toEqual([{
      id: "project-1", name: "Stand-in bride", folder, section: "Stand-in bride",
      template: { id: "sales", name: "Sales crew", version: 3 }, leadBotId: lead.id, createdAt: project.createdAt,
    }]);
    expect(app.projects.lookup("project-1")).toEqual({ folder });
    expect(missingSkills).toEqual(["not-in-library", "also-missing"]);
  });

  it("gives each bot the model, MCP servers and library skills its role names, and reports library skills that are not there", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    const bots = app.byRole(project.id);
    expect(bots.get("lead")).toMatchObject({
      modelSelection: { instanceId: "codex", model: "gpt-test", effort: "high" }, assignedSkills: ["beat-sheet"], mcpServers: ["crm", "drive"],
    });
    expect(bots.get("scout")).toMatchObject({ modelSelection: { instanceId: "claude", model: "default-model" }, assignedSkills: ["beat-sheet"], mcpServers: ["crm"] });
    expect(bots.get("writer")!.assignedSkills).toBeUndefined();
    expect(bots.get("writer")!.mcpServers).toBeUndefined();
    expect(bots.get("writer")).toMatchObject({ mascotFaceColor: "black", avatarZoom: 2, avatarFocusX: 0.25, avatarFocusY: 0.75 });
    expect(bots.get("lead")!.avatarZoom).toBeUndefined();
  });

  it("switches the template's own skills on, writes the context and the starter memory, and leaves the routines paused", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    const bots = app.byRole(project.id);
    expect(app.skills.listSkills(bots.get("lead")!.id)).toEqual([expect.objectContaining({ name: "pricing-policy", enabled: true })]);
    expect(app.skills.listSkills(bots.get("scout")!.id).map((skill) => [skill.name, skill.enabled]).sort()).toEqual([["pricing-policy", true], ["research-brief", true]]);
    expect(app.skills.listSkills(bots.get("writer")!.id)).toEqual([]);
    expect(app.sections.readSectionContext("Stand-in bride")?.text).toContain("We sell a team plan at 49 per seat.");
    expect(app.workspace.readMemoryFile(bots.get("lead")!.id).text).not.toBe("");
    const routines = app.routines.listRoutines();
    expect(routines.map((routine) => routine.name).sort()).toEqual(["Daily digest", "Weekly pipeline review"]);
    expect(routines.every((routine) => !routine.enabled && project.botIds.includes(routine.botId))).toBe(true);
    expect(app.store.groups.map((group) => [group.name, group.section])).toEqual([["Deal desk", "Stand-in bride"]]);
  });

  it("writes the copies: the record, the team by name only, each persona, the context", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    const lead = app.byRole(project.id).get("lead")!;
    expect(JSON.parse(copy(project.folder, "project.json"))).toEqual(app.registry.projects()[0]);
    const team = JSON.parse(copy(project.folder, "team/team.json"));
    expect(team).toMatchObject({ department: "Stand-in bride", lead: "lead" });
    expect(team.bots.map((bot: { role: string }) => bot.role)).toEqual(["lead", expect.any(String), expect.any(String)]);
    expect(team.bots[0]).toMatchObject({ name: "Morgan", model: { instanceId: "codex", model: "gpt-test" }, librarySkills: ["beat-sheet"], mcpServers: ["crm", "drive"] });
    expect(readdirSync(join(project.folder, ".magic-team", "team", "personas")).sort()).toEqual(["lead.md", "scout.md", "writer.md"]);
    expect(copy(project.folder, "team/personas/lead.md")).toContain(lead.soul!.trim());
    expect(copy(project.folder, "team/context.md")).toContain("We sell a team plan at 49 per seat.");
    expect(JSON.stringify(team)).not.toContain("mcp.example.com");
  });

  it("makes each bot a member of the project before the first of its own files is written", async () => {
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

    const { project } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));

    expect(seen.map((entry) => entry.step).sort()).toEqual(["memory", "place", "place", "place", "skill", "skill", "skill", "topic"]);
    for (const entry of seen) {
      expect(entry.membership).toEqual({ id: "project-1", role: expect.stringMatching(/^(lead|scout|writer)$/) });
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

  it("gives the team's group chats the project folder to work in", async () => {
    const app = await installation();
    made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    expect(app.store.groups.map((group) => [group.name, group.cwd])).toEqual([["Deal desk", join(app.root, "Stand-in bride")]]);
  });

  it("makes a second project from the same template, with the same names and its own team", async () => {
    const app = await installation();
    const first = made(await app.projects.create({ name: "Season one", templateId: "sales" })).project;
    const second = made(await app.projects.create({ name: "Season two", templateId: "sales" })).project;

    expect(readdirSync(app.root).sort()).toEqual(["Season one", "Season two"]);
    expect(app.projects.list().map((project) => [project.id, project.name, project.section])).toEqual([
      ["project-1", "Season one", "Season one"], ["project-2", "Season two", "Season two"],
    ]);
    for (const project of [first, second]) {
      const bots = app.byRole(project.id);
      expect([...bots.keys()].sort()).toEqual(["lead", "scout", "writer"]);
      expect(["lead", "scout", "writer"].map((role) => bots.get(role)!.name)).toEqual(["Morgan", "Scout", "Quill"]);
      expect(bots.get("lead")).toMatchObject({ chiefOfStaff: true, section: project.name, cwd: project.folder });
      expect(JSON.parse(copy(project.folder, "team/team.json")).bots.map((bot: { name: string }) => bot.name).sort()).toEqual(["Morgan", "Quill", "Scout"]);
    }
    expect(first.botIds.some((id) => second.botIds.includes(id))).toBe(false);
    expect(app.routines.listRoutines()).toHaveLength(4);
  });

  it("keeps the template's names when a bot outside the project already has one of them", async () => {
    const app = await installation();
    const outside = app.store.createBot({ name: "Morgan", section: "Sales" }, { seedMessages: false });
    const first = made(await app.projects.create({ name: "Season one", templateId: "sales" })).project;
    const second = made(await app.projects.create({ name: "Season two", templateId: "sales" })).project;
    for (const project of [first, second]) {
      expect(["lead", "scout", "writer"].map((role) => app.byRole(project.id).get(role)!.name)).toEqual(["Morgan", "Scout", "Quill"]);
    }
    expect(app.store.bot(outside.id)).toMatchObject({ name: "Morgan", section: "Sales" });
    expect(app.store.bot(outside.id)!.teamProject).toBeUndefined();
  });

  it("tells two roles of one template apart when the template gives them one name", async () => {
    const app = await installation();
    const template = app.salesTemplate();
    template.document.package.agents.find((agent) => agent.key === "scout")!.name = "Quill";
    app.templates.set("sales", template);
    app.store.createBot({ name: "Quill 2" }, { seedMessages: false });
    const { project } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    const bots = app.byRole(project.id);
    expect(["lead", "scout", "writer"].map((role) => bots.get(role)!.name).sort()).toEqual(["Morgan", "Quill", "Quill 2"]);
  });

  it("takes the name as a person typed it: spaces around it dropped, composed the same way everywhere", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create({ name: "  Cafe\u0301 nights ", templateId: "sales" }));
    expect(project.name).toBe("Caf\u00e9 nights");
    expect(readdirSync(app.root).map((name) => name.normalize("NFC"))).toEqual(["Caf\u00e9 nights"]);
  });

  it("gives a role a folder-safe name when the template's key is not one", async () => {
    const app = await installation();
    const template = app.salesTemplate();
    const rename = (key: string) => (key === "scout" ? "nul" : key === "writer" ? "copy_writer" : key);
    const pkg = template.document.package;
    for (const agent of pkg.agents) agent.key = rename(agent.key);
    for (const room of pkg.rooms ?? []) {
      room.members = room.members.map(rename);
    }
    for (const routine of pkg.routines ?? []) routine.agent = rename(routine.agent);
    template.extras = { lead: template.extras.lead!, nul: template.extras.scout!, copy_writer: template.extras.writer! };
    app.templates.set("odd", template);

    const { project } = made(await app.projects.create({ name: "Odd keys", templateId: "odd" }));
    expect([...app.byRole(project.id).keys()].sort()).toEqual(["copy-writer", "lead", "role-1"]);
    expect(readdirSync(join(project.folder, ".magic-team", "team", "personas")).sort()).toEqual(["copy-writer.md", "lead.md", "role-1.md"]);
  });
});

describe("a project that is refused", () => {
  async function refused(app: TeamProjectsTestApp, input: { name: string; templateId: string }) {
    const before = app.snapshot();
    const folders = existsSync(app.root) ? readdirSync(app.root) : null;
    const result = await app.projects.create(input);
    expect(app.snapshot()).toBe(before);
    expect(existsSync(app.root) ? readdirSync(app.root) : null).toEqual(folders);
    expect(app.store.bots.some((bot) => bot.teamProject)).toBe(false);
    if ("project" in result) throw new Error("it was made");
    return result;
  }

  it("says so when no folder for projects was chosen", async () => {
    const app = await installation({ root: false });
    expect(await refused(app, { name: "Drama", templateId: "sales" })).toMatchObject({ code: "no_root", errorKey: "serverError.teamProject.noRoot" });
  });

  it("says so when the folder for projects is not there, and does not make it", async () => {
    const app = await installation();
    rmSync(app.root, { recursive: true });
    expect(await refused(app, { name: "Drama", templateId: "sales" })).toMatchObject({ code: "root_missing", errorKey: "serverError.teamProject.rootMissing" });
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
      const result = await app.restarted().create({ name: "Drama", templateId: "sales" });
      expect(result, root).toMatchObject({ code: "failed", errorKey: "serverError.teamProject.failed", errorParams: { detail: expect.stringContaining("inside the app's own data folder") } });
    }
    expect(readdirSync(inside)).toEqual([]);
    expect(app.store.bots).toEqual([]);
    expect(app.store.sections).not.toContain("Drama");
  });

  it("refuses a name that cannot be a folder's", async () => {
    const app = await installation();
    for (const name of ["", "   ", "a/b", "..", "CON", "x".repeat(61), "what?"]) {
      expect(await refused(app, { name, templateId: "sales" }), name).toMatchObject({ code: "bad_name", errorKey: "serverError.teamProject.badName", errorParams: { max: 60 } });
    }
    expect(await refused(app, { name: 7 as unknown as string, templateId: "sales" })).toMatchObject({ code: "bad_name" });
  });

  it("refuses the name of another project, archived or not, and of a department, whatever the case", async () => {
    const app = await installation();
    const { project } = made(await app.projects.create({ name: "Stand-in bride", templateId: "sales" }));
    app.projects.archive(project.id);
    app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    const before = app.snapshot();
    for (const name of ["Stand-in bride", "STAND-IN BRIDE", "marketing"]) {
      const result = await app.projects.create({ name, templateId: "sales" });
      expect(result, name).toMatchObject({ code: "name_taken", errorKey: "serverError.teamProject.nameTaken", errorParams: { name } });
    }
    expect(app.snapshot()).toBe(before);
    expect(readdirSync(app.root)).toEqual(["Stand-in bride"]);
  });

  it("makes one project when two requests ask for one name at the same moment, and tells the other the name is taken", async () => {
    const app = await installation();
    const asked = { name: "Stand-in bride", templateId: "sales" };
    const outcomes = await Promise.all([app.projects.create(asked), app.projects.create(asked)]);
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
    expect(await refused(app, { name: "Old drama", templateId: "sales" })).toMatchObject({ code: "folder_exists", errorKey: "serverError.teamProject.folderExists", errorParams: { name: "Old drama" } });
    expect(await refused(app, { name: "Notes", templateId: "sales" })).toMatchObject({ code: "folder_exists" });
    expect(readdirSync(join(app.root, "Old drama"))).toEqual([]);
    expect(readFileSync(join(app.root, "Notes"), "utf8")).toBe("mine");
  });

  it("says so when the team template is not there", async () => {
    const app = await installation();
    expect(await refused(app, { name: "Drama", templateId: "gone" })).toMatchObject({ code: "no_template", errorKey: "serverError.teamProject.noTemplate" });
    expect(await refused(app, { name: "Drama", templateId: undefined as unknown as string })).toMatchObject({ code: "no_template" });
  });

  it("makes nothing while the list of projects cannot be read", async () => {
    const app = await installation();
    writeFileSync(app.registryFile, "{ not the list");
    const result = await app.restarted().create({ name: "Drama", templateId: "sales" });
    expect(result).toMatchObject({ code: "failed", errorKey: "serverError.teamProject.unreadable" });
    expect(readdirSync(app.root)).toEqual([]);
    expect(app.store.bots).toEqual([]);
    expect(readFileSync(app.registryFile, "utf8")).toBe("{ not the list");
  });
});

describe("a project that fails part-way", () => {
  async function failed(app: TeamProjectsTestApp, templateId = "sales") {
    const before = app.snapshot();
    const result = await app.projects.create({ name: "Stand-in bride", templateId });
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

  it("leaves nothing behind when a bot's own files cannot go into the project folder", async () => {
    const app = await installation();
    app.onPlace = (botId) => { if (app.placed.length === 2) throw new Error(`the folder for ${app.store.bot(botId)!.teamProject!.role} cannot be used`); };
    const result = await failed(app);
    expect(result).toMatchObject({ errorKey: "serverError.teamProject.failed", errorParams: { detail: "the folder for scout cannot be used" } });
    nothingLeft(app);
  });

  it("leaves nothing behind when a step after the team fails", async () => {
    const app = await installation();
    app.importDeps.skills.setEnabled = () => ({ error: "not allowed" });
    const result = await failed(app);
    expect(result.error).toContain("not allowed");
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

  it("leaves nothing behind when the team would not fit", async () => {
    const app = await installation({ maxBots: 2 });
    await failed(app);
    nothingLeft(app);
  });

  it("leaves nothing behind when the template holds no team", async () => {
    const app = await installation();
    const empty = app.salesTemplate();
    delete empty.document.package.team;
    app.templates.set("empty", empty);
    await failed(app, "empty");
    nothingLeft(app);
  });

  it("says so, and keeps the folder, when something it did not make is in the folder by then", async () => {
    const app = await installation();
    const folder = join(app.root, "Stand-in bride");
    app.importDeps.skills.setEnabled = () => {
      writeFileSync(join(folder, "episode-1.md"), "a person's work");
      return { error: "not allowed" };
    };
    const result = await failed(app);
    expect(result).toMatchObject({ errorKey: "serverError.teamProject.failedLeftovers" });
    expect(app.logged.filter((line) => line.includes("was not made"))).toEqual([expect.stringMatching(/^team projects: Stand-in bride was not made: .*not allowed; not everything could be taken back: /)]);
    expect(readdirSync(folder)).toEqual(["episode-1.md"]);
  });

  it("says why when the app cannot get ready to make bots", async () => {
    const app = await installation();
    const offline = app.restarted({ importDeps: async () => { throw new Error("no AI is set up"); } });
    expect(await offline.create({ name: "Drama", templateId: "sales" })).toMatchObject({ code: "failed", errorParams: { detail: "no AI is set up" } });
    nothingLeft(app);
  });
});
