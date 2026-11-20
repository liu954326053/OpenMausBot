import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import type { TeamTemplateInput, TemplateRole } from "../shared/template-library.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const role = (key: string, name: string, extra: Partial<TemplateRole> = {}): TemplateRole => ({
  key, name, title: `${name} of the team`, description: `${name} of the team`, soul: `You are the ${name}.`,
  look: { color: "red" }, ownSkills: [], memory: "", librarySkills: [], ...extra,
});
const TEMPLATE: TeamTemplateInput = {
  name: "Drama team", genre: "Romance", context: "Vertical short dramas.", lead: "director",
  roles: [role("director", "Director"), role("writer", "Writer", { memory: "Every episode ends on a hook." })], skills: [],
};

describe("team projects joined to the rest of the server", () => {
  let fixture: VerificationServer;
  let root: string;
  let project: TeamProjectWire;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    fixture = await launchVerificationServer();
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-team-projects-glue-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const template = await api("POST", "/api/template-library/teams", TEMPLATE);
    expect(template.status).toBe(201);
    const made = await api("POST", "/api/team-projects", { name: "First drama", templateId: template.body.template.id });
    expect(made.status).toBe(201);
    project = made.body.project;
  });

  afterAll(async () => {
    await fixture?.close();
    if (root) await removeTempDir(root);
  });

  it("keeps a bot's place in a project off the wire: the app learns a project's bots from the project list", async () => {
    const listed = await api("GET", "/api/bots");
    const projectBots = listed.body.bots.filter((bot: { id: string }) => project.botIds.includes(bot.id));
    expect(projectBots).toHaveLength(2);
    for (const bot of listed.body.bots) expect(bot).not.toHaveProperty("teamProject");
    const renamed = await api("PATCH", `/api/bots/${project.leadBotId}`, { title: "Leads the team" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.bot).not.toHaveProperty("teamProject");
  });

  describe("template sync", () => {
    const botOf = async (name: string) => {
      const bot = (await api("GET", "/api/bots")).body.bots.find((candidate: { id: string; name: string }) => project.botIds.includes(candidate.id) && candidate.name === name);
      expect(bot).toBeDefined();
      return bot as { id: string; name: string; soul?: string };
    };
    const listed = async () => (await api("GET", "/api/team-projects")).body.projects.find((candidate: TeamProjectWire) => candidate.id === project.id) as TeamProjectWire;
    const memoryOf = async (botId: string) => (await api("GET", `/api/bots/${botId}/memory/file`)).body.text as string;
    const template = async () => (await api("GET", `/api/template-library/teams/${project.template.id}`)).body.template as { version: number; roles: TemplateRole[] };
    const shorter = "You are the Writer. Keep every line short.";

    it("shows what a newer version of the template would change in the project, and changes nothing yet", async () => {
      const writer = await botOf("Writer");
      const saved = await api("PUT", `/api/template-library/teams/${project.template.id}`, {
        ...TEMPLATE, roles: [TEMPLATE.roles[0], { ...TEMPLATE.roles[1], soul: shorter }, role("editor", "Editor")],
      });
      expect(saved.body.template.version).toBe(2);

      const preview = await api("POST", `/api/template-sync/projects/${project.id}/update/preview`);

      expect(preview.status).toBe(200);
      expect(preview.body.can).toBe(true);
      expect(preview.body.diff).toMatchObject({ templateId: project.template.id, fromVersion: 1, toVersion: 2, removed: [] });
      expect(preview.body.diff.changed).toEqual([{ key: "writer", botId: writer.id, templateName: "Writer", currentName: "Writer", fields: ["persona"] }]);
      expect(preview.body.diff.unchanged.map((entry: { key: string }) => entry.key)).toEqual(["director"]);
      expect(preview.body.diff.added).toEqual([{ key: "editor", name: "Editor", title: "Editor of the team" }]);
      expect((await botOf("Writer")).soul).toBe("You are the Writer.");
      expect((await listed()).template.version).toBe(1);
    });

    it("brings the project's bots up to the template and records the version, leaving their memory and the team's size alone", async () => {
      const writer = await botOf("Writer");
      const remembered = await memoryOf(writer.id);
      expect(remembered).toContain("Every episode ends on a hook.");

      const applied = await api("POST", `/api/template-sync/projects/${project.id}/update`);

      expect(applied).toEqual({ status: 200, body: { applied: 1, toVersion: 2 } });
      expect((await botOf("Writer")).soul).toBe(shorter);
      expect(await memoryOf(writer.id)).toBe(remembered);
      const now = await listed();
      expect(now.template).toEqual({ id: project.template.id, name: "Drama team", version: 2 });
      expect(now.botIds).toEqual(project.botIds);
      const again = await api("POST", `/api/template-sync/projects/${project.id}/update/preview`);
      expect(again.body.can).toBe(false);
      expect(again.body.diff.changed).toEqual([]);
    });

    it("saves the project's team back as the template's next version, and as a new template that the project does not move to", async () => {
      const director = await botOf("Director");
      expect((await api("PATCH", `/api/bots/${director.id}`, { soul: "You are the Director. Approve every cut yourself." })).status).toBe(200);

      const next = await api("POST", `/api/template-sync/projects/${project.id}/save-back`, { mode: "version" });

      expect(next).toEqual({ status: 200, body: { templateId: project.template.id, name: "Drama team", version: 3, mode: "version" } });
      const saved = await template();
      expect(saved.version).toBe(3);
      expect(saved.roles.find((entry) => entry.key === "director")?.soul).toBe("You are the Director. Approve every cut yourself.");
      expect(saved.roles.map((entry) => entry.key).sort()).toEqual(["director", "writer"]);
      expect((await listed()).template.version).toBe(3);

      const copy = await api("POST", `/api/template-sync/projects/${project.id}/save-back`, { mode: "new" });

      expect(copy.status).toBe(200);
      expect(copy.body).toMatchObject({ mode: "new", version: 1 });
      expect(copy.body.templateId).not.toBe(project.template.id);
      expect((await listed()).template).toEqual({ id: project.template.id, name: "Drama team", version: 3 });
    });

    it("adds what a project's bot remembers to its role's starter memory in the template, and refuses a bot outside projects", async () => {
      const writer = await botOf("Writer");
      const note = "The heroine is called Lin Wan.";
      expect((await api("PUT", `/api/bots/${writer.id}/memory/file`, { path: "memory/cast.md", text: note })).status).toBe(200);

      const added = await api("POST", "/api/template-sync/memory/deposit", { botId: writer.id, path: "memory/cast.md" });

      expect(added).toEqual({ status: 201, body: { id: project.template.id, name: "Drama team", version: 4 } });
      expect((await template()).roles.find((entry) => entry.key === "writer")?.memory).toContain(note);
      expect((await listed()).template.version).toBe(3);
      expect((await api("POST", "/api/template-sync/memory/deposit", { botId: writer.id, path: "memory/nothing.md" })).status).toBe(404);
      const loner = (await api("GET", "/api/bots")).body.bots.find((candidate: { id: string }) => !project.botIds.includes(candidate.id));
      const outside = await api("POST", "/api/template-sync/memory/deposit", { botId: loner.id, path: "MEMORY.md" });
      expect(outside.status).toBe(422);
      expect(outside.body.errorKey).toBe("serverError.templateSync.notProjectBot");
    });

    it("gives a role's bot the skill its role gained in the template, as a copy of its own", async () => {
      const writer = await botOf("Writer");
      const skillsOf = async () => (await api("GET", `/api/bots/${writer.id}/skills`)).body.skills as Array<{ name: string; enabled: boolean }>;
      expect((await skillsOf()).map((skill) => skill.name)).not.toContain("hook-check");
      const before = await template() as unknown as TeamTemplateInput;
      const caughtUp = await api("POST", `/api/template-sync/projects/${project.id}/update`);
      expect(caughtUp.status).toBe(200);
      const hookCheck = "---\nname: hook-check\ndescription: Check that an episode ends on a hook.\n---\n\nRead the last scene and say what makes a viewer come back.\n";
      const saved = await api("PUT", `/api/template-library/teams/${project.template.id}`, {
        name: before.name, genre: before.genre, context: before.context, lead: before.lead,
        roles: before.roles.map((entry) => entry.key === "writer" ? { ...entry, ownSkills: ["hook-check"] } : entry),
        skills: [{ name: "hook-check", description: "Check that an episode ends on a hook.", text: hookCheck }],
      });
      expect(saved.status).toBe(200);

      const preview = await api("POST", `/api/template-sync/projects/${project.id}/update/preview`);
      const applied = await api("POST", `/api/template-sync/projects/${project.id}/update`);

      expect(preview.body.diff.changed).toEqual([{ key: "writer", botId: writer.id, templateName: "Writer", currentName: "Writer", fields: ["skills"] }]);
      expect(applied).toEqual({ status: 200, body: { applied: 1, toVersion: saved.body.template.version } });
      expect(await skillsOf()).toContainEqual(expect.objectContaining({ name: "hook-check", enabled: true }));
      expect((await listed()).template.version).toBe(saved.body.template.version);
      const again = await api("POST", `/api/template-sync/projects/${project.id}/update/preview`);
      expect(again.body).toMatchObject({ can: false, diff: { changed: [] } });
    });
  });
});
