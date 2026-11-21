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
});
