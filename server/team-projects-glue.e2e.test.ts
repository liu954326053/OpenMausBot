import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const TEAM = "Drama team";

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
    const director = await api("POST", "/api/bots", { name: "Director", section: TEAM });
    expect(director.status).toBe(201);
    expect((await api("POST", "/api/bots", { name: "Writer", section: TEAM })).status).toBe(201);
    expect((await api("PATCH", `/api/bots/${director.body.bot.id}`, { chiefOfStaff: true })).status).toBe(200);
    const made = await api("POST", "/api/team-projects", { name: "First drama", team: TEAM });
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
