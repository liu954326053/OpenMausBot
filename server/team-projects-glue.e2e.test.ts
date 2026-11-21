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
  let directorId: string;
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
    directorId = director.body.bot.id;
    expect((await api("PATCH", `/api/bots/${directorId}`, { chiefOfStaff: true })).status).toBe(200);
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
    const pinned = await api("PATCH", `/api/bots/${project.leadBotId}`, { pinned: true });
    expect(pinned.status).toBe(200);
    expect(pinned.body.bot).not.toHaveProperty("teamProject");
  });

  it("refuses a direct change to what a copy takes from its source on every route, and shows the source's change on the copy", async () => {
    const lead = project.leadBotId;
    expect(project.follows[lead]).toBe(directorId);
    const refused = { errorKey: "serverError.teamProject.copyFollows", errorParams: { bot: "Director", source: "Director", team: TEAM } };
    for (const [method, path, body] of [
      ["PATCH", `/api/bots/${lead}`, { title: "Leads the team" }],
      ["PATCH", `/api/bots/${lead}/profile`, { soul: "Lead the drama." }],
      ["PATCH", `/api/bots/${lead}/model`, { instanceId: "fake", model: "another-model" }],
      ["POST", `/api/bots/${lead}/avatar/generate`, { prompt: "A director" }],
      ["POST", `/api/bots/${lead}/history/rollback`, { id: "row", expectedRevision: "r" }],
    ] as const) {
      const answer = await api(method, path, body);
      expect({ status: answer.status, body: answer.body }, `${method} ${path}`).toMatchObject({ status: 409, body: refused });
    }
    const instructions = await api("PUT", `/api/section-context?section=${encodeURIComponent(project.section)}`, { text: "Our own." });
    expect(instructions).toMatchObject({ status: 409, body: { errorKey: "serverError.teamProject.contextFollows", errorParams: { department: project.section, team: TEAM } } });

    expect((await api("PATCH", `/api/bots/${directorId}`, { title: "Runs the drama" })).status).toBe(200);
    expect((await api("PUT", `/api/section-context?section=${encodeURIComponent(TEAM)}`, { text: "Two minutes an episode." })).status).toBe(200);
    const bots = (await api("GET", "/api/bots")).body.bots as Array<{ id: string; title?: string }>;
    expect(bots.find((bot) => bot.id === lead)?.title).toBe("Runs the drama");
    await expect.poll(async () => (await api("GET", `/api/section-context?section=${encodeURIComponent(project.section)}`)).body.text, { timeout: 10_000 }).toBe("Two minutes an episode.");
  });
});
