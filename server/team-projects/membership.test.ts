import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { TeamSetupRequest } from "../../shared/team-setup.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { isTemplateRoleKey, templateRoleKey } from "../../shared/template-library.ts";
import { closeTeamProjectsInstallation, teamProjectsInstallation, type TeamProjectsTestApp } from "./testing.ts";

let app: TeamProjectsTestApp | undefined;

async function withProject(name = "Stand-in bride") {
  app = await teamProjectsInstallation();
  const stop = app.projects.start();
  app.templates.set("sales", app.salesTemplate());
  app.projects.setRoot(app.root);
  const result = await app.projects.create({ name, templateId: "sales" });
  if (!("project" in result)) throw new Error(result.error);
  return { app, project: result.project, stop };
}

/** The app started again with a `projects.json` it cannot read: the bots still carry their projects. */
async function withUnreadableList() {
  const { app, project, stop } = await withProject();
  stop();
  const good = readFileSync(app.registryFile, "utf8");
  writeFileSync(app.registryFile, "{ not the list");
  const broken = app.restarted();
  broken.start();
  return { app, project, broken, repair: () => writeFileSync(app.registryFile, good) };
}

afterEach(async () => {
  await closeTeamProjectsInstallation(app);
  app = undefined;
});

const rolesOf = (app: TeamProjectsTestApp, project: TeamProjectWire) => [...app.byRole(project.id).keys()].sort();
const JOINED_LATER = /^member-[0-9a-f]{8}$/;
const roleOf = (app: TeamProjectsTestApp, botId: string) => app.store.bot(botId)!.teamProject!.role;

describe("a bot added to a project's department later", () => {
  it("belongs to the project from the moment it is made, with a role of its own and the project folder to work in", async () => {
    const { app, project } = await withProject();
    const seenByOthers: unknown[] = [];
    app.store.onChange((change) => {
      if (change.type === "bot" && change.botId === "editor-1") seenByOthers.push(app.store.bot("editor-1")?.teamProject);
    });
    const editor = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false, id: "editor-1" });
    const role = roleOf(app, editor.id);
    expect(role).toMatch(JOINED_LATER);
    expect(app.store.bot(editor.id)).toMatchObject({ teamProject: { id: project.id, role }, cwd: project.folder });
    expect(seenByOthers.length).toBeGreaterThan(0);
    expect(seenByOthers.every((membership) => JSON.stringify(membership) === JSON.stringify({ id: project.id, role }))).toBe(true);
    expect(rolesOf(app, project)).toEqual([role, "lead", "scout", "writer"].sort());
    expect(app.projects.list()[0]!.botIds).toContain(editor.id);
  });

  it("has its own files put into the project folder as soon as it has joined", async () => {
    const { app, project } = await withProject();
    app.placed.length = 0;
    const membershipThen: unknown[] = [];
    app.onPlace = (botId) => membershipThen.push(app.store.bot(botId)?.teamProject);
    const editor = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false });
    expect(app.placed).toEqual([editor.id]);
    expect(membershipThen).toEqual([{ id: project.id, role: expect.stringMatching(JOINED_LATER) }]);
    app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    expect(app.placed).toEqual([editor.id]);
  });

  it("still belongs to the project when its own files could not be put there, and the reason is logged", async () => {
    const { app, project } = await withProject();
    app.onPlace = () => { throw new Error("the drive is read-only"); };
    const editor = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false });
    expect(app.store.bot(editor.id)!.teamProject).toEqual({ id: project.id, role: expect.stringMatching(JOINED_LATER) });
    expect(app.logged.filter((line) => line.includes("Film Editor") && line.includes("the drive is read-only"))).toHaveLength(1);
  });

  it("gets a role no other bot of the project has and no team template gives a role, whatever its name", async () => {
    const { app } = await withProject();
    const names = ["Scout", "剪辑", "配音", "Scout", "Role 3", "member"];
    const roles = names.map((name) => roleOf(app, app.store.createBot({ name, section: "Stand-in bride" }, { seedMessages: false }).id));
    expect(roles.filter((role) => !JOINED_LATER.test(role) || !isTemplateRoleKey(role))).toEqual([]);
    expect(new Set(roles).size).toBe(names.length);
    const givenByATemplate = new Set<string>();
    for (const name of [...names, ...names, ...names]) givenByATemplate.add(templateRoleKey(name, givenByATemplate));
    expect(roles.filter((role) => givenByATemplate.has(role))).toEqual([]);
  });

  it("takes another role when the one its id gives is taken in the project", async () => {
    const { app, project } = await withProject();
    const first = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false, id: "editor-1" });
    const role = roleOf(app, first.id);
    app.store.deleteBot(first.id);
    app.store.patchBot(app.byRole(project.id).get("scout")!.id, { teamProject: { id: project.id, role } });
    const again = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false, id: "editor-1" });
    expect(roleOf(app, again.id)).toMatch(JOINED_LATER);
    expect(roleOf(app, again.id)).not.toBe(role);
  });

  it("keeps the working folder the person gave it", async () => {
    const { app, project } = await withProject();
    const bot = app.store.createBot({ name: "Archivist", section: "Stand-in bride", cwd: app.home }, { seedMessages: false });
    expect(app.store.bot(bot.id)).toMatchObject({ teamProject: { id: project.id, role: expect.stringMatching(JOINED_LATER) }, cwd: app.home });
  });

  it("joins when the project's lead makes it in a team setup", async () => {
    const { app, project } = await withProject();
    const lead = app.byRole(project.id).get("lead")!;
    const request: TeamSetupRequest = {
      version: 1, requestId: "setup-1", botId: lead.id, threadId: lead.threadId, reason: "Requested", createdAt: 1, requesterRevision: "fixture", newTeams: [],
      operations: [{ action: "create", botId: "new-colorist", threadId: "new-colorist-thread", fields: { name: "Colorist", section: "Stand-in bride", modelSelection: { instanceId: "claude", model: "default-model" } } }],
    };
    app.store.applyTeamSetup(request);
    expect(app.store.bot("new-colorist")).toMatchObject({ teamProject: { id: project.id, role: expect.stringMatching(JOINED_LATER) }, cwd: project.folder, section: "Stand-in bride" });
  });

  it("shows up in the project's copies", async () => {
    const { app, project } = await withProject();
    const editor = app.store.createBot({ name: "Film Editor", title: "Cuts the episodes", section: "Stand-in bride" }, { seedMessages: false });
    app.projects.flushCopies();
    expect(readFileSync(join(project.folder, ".magic-team", "team", "personas", `${roleOf(app, editor.id)}.md`), "utf8")).toBe("# Film Editor\n\nCuts the episodes\n");
  });

  it("does not join when it is made anywhere else", async () => {
    const { app, project } = await withProject();
    const elsewhere = app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    const nowhere = app.store.createBot({ name: "Loner" }, { seedMessages: false });
    expect(app.store.bot(elsewhere.id)!.teamProject).toBeUndefined();
    expect(app.store.bot(nowhere.id)!.teamProject).toBeUndefined();
    expect(rolesOf(app, project)).toEqual(["lead", "scout", "writer"]);
  });

  it("joins an archived project too: the department is still the project's", async () => {
    const { app, project } = await withProject();
    app.projects.archive(project.id);
    const bot = app.store.createBot({ name: "Latecomer", section: "Stand-in bride" }, { seedMessages: false });
    expect(app.store.bot(bot.id)!.teamProject).toEqual({ id: project.id, role: expect.stringMatching(JOINED_LATER) });
  });

  it("gets a role of its own when it arrives as a copy carrying another bot's", async () => {
    const { app, project } = await withProject();
    const copy = app.store.createBot({ name: "Quill again", section: "Stand-in bride" }, {
      seedMessages: false, settle: (bot) => { bot.teamProject = { id: project.id, role: "writer" }; },
    });
    expect(app.store.bot(copy.id)!.teamProject).toEqual({ id: project.id, role: expect.stringMatching(JOINED_LATER) });
    expect(app.byRole(project.id).get("writer")!.name).toBe("Quill");
  });
});

describe("a bot that was already there", () => {
  it("is left as it is when it turns up in a project's department by some other way", async () => {
    const { app, project } = await withProject();
    const outsider = app.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false });
    app.store.patchBot(outsider.id, { section: "Stand-in bride" });
    expect(app.store.bot(outsider.id)!.teamProject).toBeUndefined();
    expect(app.projects.list()[0]!.botIds).not.toContain(outsider.id);
    expect(rolesOf(app, project)).toEqual(["lead", "scout", "writer"]);
  });

  it("may not move into a project's department, nor a project's bot out of it", async () => {
    const { app, project } = await withProject();
    const outsider = app.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false });
    const writer = app.byRole(project.id).get("writer")!;

    expect(app.projects.moveRefusalFor(outsider.id, "Stand-in bride")).toMatchObject({
      errorKey: "serverError.teamProject.noJoin", errorParams: { department: "Stand-in bride" }, error: expect.stringContaining("Stand-in bride"),
    });
    for (const to of ["Marketing", "", null, undefined, "A new department"]) {
      expect(app.projects.moveRefusalFor(writer.id, to), String(to)).toMatchObject({ errorKey: "serverError.teamProject.botStays", errorParams: { bot: "Quill" } });
    }
    expect(app.projects.moveRefusalFor(writer.id, "Stand-in bride")).toBeNull();
    expect(app.projects.moveRefusalFor(writer.id, " Stand-in bride ")).toBeNull();
    expect(app.projects.moveRefusalFor(outsider.id, "Marketing")).toBeNull();
    expect(app.projects.moveRefusalFor(outsider.id, "Sales")).toBeNull();
    expect(app.projects.moveRefusalFor(outsider.id, null)).toBeNull();
    expect(app.projects.moveRefusalFor("no-such-bot", "Stand-in bride")).toBeNull();
  });

  it("may not move between two projects either", async () => {
    const { app, project } = await withProject("Season one");
    const second = await app.projects.create({ name: "Season two", templateId: "sales" });
    if (!("project" in second)) throw new Error(second.error);
    expect(app.projects.moveRefusalFor(app.byRole(project.id).get("writer")!.id, "Season two")).toMatchObject({ errorKey: "serverError.teamProject.botStays" });
  });

  it("refuses a Chief's team setup that would move a bot across a project's line, and lets its other changes through", async () => {
    const { app, project } = await withProject();
    const outsider = app.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false });
    const writer = app.byRole(project.id).get("writer")!;
    let thrown: unknown;
    try { app.projects.checkSetupChange(writer, { section: "Marketing" }); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ status: 409, errorKey: "serverError.teamProject.botStays", message: expect.stringContaining("Quill") });
    expect(() => app.projects.checkSetupChange(outsider, { section: "Stand-in bride" })).toThrow(/project's team/);
    expect(() => app.projects.checkSetupChange(writer, { section: "Stand-in bride" })).not.toThrow();
    expect(() => app.projects.checkSetupChange(writer, {})).not.toThrow();
    expect(() => app.projects.checkSetupChange(outsider, { section: "Sales" })).not.toThrow();
  });

  it("stays where it is while the list of projects cannot be read", async () => {
    const { app, project, broken } = await withUnreadableList();
    const writer = app.byRole(project.id).get("writer")!;
    expect(broken.moveRefusalFor(writer.id, "Marketing")).toMatchObject({ errorKey: "serverError.teamProject.botStays" });
    expect(broken.lookup(project.id)).toBeUndefined();
    expect(() => broken.flushCopies()).not.toThrow();
  });
});

describe("while the list of projects cannot be read", () => {
  it("keeps a project's department closed to bots from outside, and from being renamed or deleted", async () => {
    const { app, broken } = await withUnreadableList();
    const outsider = app.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false });
    expect(broken.moveRefusalFor(outsider.id, "Stand-in bride")).toMatchObject({ errorKey: "serverError.teamProject.noJoin" });
    expect(broken.departmentRefusal("Stand-in bride")).toMatchObject({ errorKey: "serverError.teamProject.departmentFixed" });
    expect(() => broken.checkSetupChange(outsider, { section: "Stand-in bride" })).toThrow(/project's team/);
    expect(broken.moveRefusalFor(outsider.id, "Growth")).toBeNull();
    expect(broken.departmentRefusal("Marketing")).toBeNull();
    expect(app.store.bot(outsider.id)!.teamProject).toBeUndefined();
  });

  it("still takes a bot made in a project's department into the project, without a folder it cannot know", async () => {
    const { app, project, broken } = await withUnreadableList();
    const editor = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false });
    expect(app.store.bot(editor.id)!.teamProject).toEqual({ id: project.id, role: expect.stringMatching(JOINED_LATER) });
    expect(app.store.bot(editor.id)!.cwd).toBeUndefined();
    const second = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false });
    expect(app.store.bot(second.id)!.teamProject).toEqual({ id: project.id, role: expect.stringMatching(JOINED_LATER) });
    expect(roleOf(app, second.id)).not.toBe(roleOf(app, editor.id));
    expect(broken.moveRefusalFor(editor.id, "Marketing")).toMatchObject({ errorKey: "serverError.teamProject.botStays" });
    const elsewhere = app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    expect(app.store.bot(elsewhere.id)!.teamProject).toBeUndefined();
  });

  it("gives that bot the project folder once the list reads again: at its next change, or when the app starts", async () => {
    const { app, project, repair } = await withUnreadableList();
    const editor = app.store.createBot({ name: "Film Editor", section: "Stand-in bride" }, { seedMessages: false });
    const sound = app.store.createBot({ name: "Sound", section: "Stand-in bride" }, { seedMessages: false });
    app.store.patchBot(editor.id, { title: "Cuts the episodes" });
    expect(app.store.bot(editor.id)!.cwd).toBeUndefined();
    repair();
    app.store.patchBot(editor.id, { title: "Cuts every episode" });
    expect(app.store.bot(editor.id)!.cwd).toBe(project.folder);
    expect(app.store.bot(sound.id)!.cwd).toBeUndefined();
    app.restarted().start();
    expect(app.store.bot(sound.id)!.cwd).toBe(project.folder);
  });
});

describe("the folder a project's bot works in", () => {
  it("is the project folder again when its own choice is cleared, and stays the one a person chose", async () => {
    const { app, project } = await withProject();
    const writer = app.byRole(project.id).get("writer")!;
    app.store.patchBot(writer.id, { cwd: undefined });
    expect(app.store.bot(writer.id)!.cwd).toBe(project.folder);
    const drafts = join(project.folder, "drafts");
    app.store.patchBot(writer.id, { cwd: drafts });
    app.store.patchBot(writer.id, { title: "Head writer" });
    expect(app.store.bot(writer.id)!.cwd).toBe(drafts);
  });

  it("is left alone for a bot in no project", async () => {
    const { app } = await withProject();
    const outsider = app.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false });
    app.store.patchBot(outsider.id, { title: "Helper" });
    app.restarted().start();
    expect(app.store.bot(outsider.id)!.cwd).toBeUndefined();
  });
});

describe("a group chat of a project's bots", () => {
  async function withRooms() {
    const { app, project } = await withProject();
    const [lead, writer] = ["lead", "writer"].map((role) => app.byRole(project.id).get(role)!.id);
    const outsider = app.store.createBot({ name: "Outsider", section: "Marketing" }, { seedMessages: false }).id;
    const folderOf = (groupId: string) => app.store.group(groupId)!.cwd;
    return { app, project, lead: lead!, writer: writer!, outsider, folderOf };
  }

  it("works in the project folder, whether it is a room or two bots talking", async () => {
    const { app, project, lead, writer, folderOf } = await withRooms();
    const room = app.store.createGroup("Writers' room", [lead, writer], false, "Stand-in bride");
    const elsewhere = app.store.createGroup("Filed elsewhere", [writer], false, "Marketing");
    const direct = app.store.createGroup("", [lead, writer], true);
    expect([room, elsewhere, direct].map((group) => folderOf(group.id))).toEqual([project.folder, project.folder, project.folder]);
  });

  it("keeps a folder of its own", async () => {
    const { app, lead, writer, folderOf } = await withRooms();
    const room = app.store.createGroup("Writers' room", [lead, writer], false, "Stand-in bride");
    app.store.patchGroup(room.id, { cwd: app.home });
    app.store.patchGroup(room.id, { bulletin: "Episode 3 is due." });
    expect(folderOf(room.id)).toBe(app.home);
  });

  it("is left alone while a bot from outside the project is in it, and gets the folder once only the project's bots are", async () => {
    const { app, project, lead, writer, outsider, folderOf } = await withRooms();
    const mixed = app.store.createGroup("Mixed", [lead, outsider]);
    const others = app.store.createGroup("Others", [outsider], false, "Stand-in bride");
    const empty = app.store.createGroup("Empty", [], false, "Stand-in bride");
    expect([mixed, others, empty].map((group) => folderOf(group.id))).toEqual([undefined, undefined, undefined]);
    app.store.patchGroup(mixed.id, { memberIds: [lead, writer] });
    expect(folderOf(mixed.id)).toBe(project.folder);
  });

  it("of two projects' bots is left alone", async () => {
    const { app, lead, folderOf } = await withRooms();
    const second = await app.projects.create({ name: "Season two", templateId: "sales" });
    if (!("project" in second)) throw new Error(second.error);
    const across = app.store.createGroup("Across", [lead, app.byRole(second.project.id).get("lead")!.id]);
    expect(folderOf(across.id)).toBeUndefined();
  });
});

describe("a project's department", () => {
  it("may not be renamed or deleted, while any other may", async () => {
    const { app } = await withProject();
    app.store.createBot({ name: "Helper", section: "Marketing" }, { seedMessages: false });
    expect(app.projects.departmentRefusal("Stand-in bride")).toMatchObject({ errorKey: "serverError.teamProject.departmentFixed", errorParams: { department: "Stand-in bride" } });
    expect(app.projects.departmentRefusal(" Stand-in bride ")).not.toBeNull();
    expect(app.projects.departmentRefusal("Marketing")).toBeNull();
    expect(app.projects.departmentRefusal("")).toBeNull();
    expect(app.projects.departmentRefusal(undefined)).toBeNull();
  });
});

describe("a project's lead", () => {
  it("is whoever the department's Chief is", async () => {
    const { app, project } = await withProject();
    const scout = app.byRole(project.id).get("scout")!;
    app.store.setChiefOfStaff(scout.id);
    expect(app.registry.find(project.id)!.leadBotId).toBe(scout.id);
    expect(app.projects.list()[0]!.leadBotId).toBe(scout.id);
    app.projects.flushCopies();
    expect(JSON.parse(readFileSync(join(project.folder, ".magic-team", "project.json"), "utf8")).leadBotId).toBe(scout.id);
    expect(JSON.parse(readFileSync(join(project.folder, ".magic-team", "team", "team.json"), "utf8")).lead).toBe("scout");
  });

  it("stays on record while the department has no Chief", async () => {
    const { app, project } = await withProject();
    const lead = app.byRole(project.id).get("lead")!;
    app.store.deleteBot(lead.id);
    expect(app.registry.find(project.id)!.leadBotId).toBe(lead.id);
    app.projects.flushCopies();
    expect(JSON.parse(readFileSync(join(project.folder, ".magic-team", "team", "team.json"), "utf8")).lead).toBeNull();
  });

  it("is not taken from a Chief of another department", async () => {
    const { app, project } = await withProject();
    const lead = app.byRole(project.id).get("lead")!;
    const outsider = app.store.createBot({ name: "Other chief", section: "Marketing" }, { seedMessages: false });
    app.store.setChiefOfStaff(outsider.id);
    expect(app.registry.find(project.id)!.leadBotId).toBe(lead.id);
  });
});
