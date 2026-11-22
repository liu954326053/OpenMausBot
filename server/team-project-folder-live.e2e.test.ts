// A project's folder that goes missing and comes back, on a real server: the open apps hear of it within seconds, on
// the projects' event and on the project's canvas, and the list and the canvas say so when read again. Nothing here
// reaches the user's data or port 8799.
import { mkdtempSync, realpathSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { openSse, type SseRecorder } from "./testing/sse.ts";

const TEAM = "Folder crew";

describe("a project's folder, live", () => {
  let fixture: VerificationServer;
  let root: string;
  let events: SseRecorder;
  let project: TeamProjectWire;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const listed = async () => ((await api("GET", "/api/team-projects")).body.projects as TeamProjectWire[]).find((one) => one.id === project.id)?.folderState;
  const drawn = async () => (await api("GET", `/api/team-projects/${project.id}/canvas`)).body.project?.folderState;
  const heard = (folderState: string, after: number) => events.until((frame) => events.frames.indexOf(frame) >= after
    && frame.kind === "team-projects" && frame.projectId === project.id && frame.folderState === folderState, 10_000);
  const redrawn = (after: number) => events.until((frame) => events.frames.indexOf(frame) >= after
    && frame.kind === "project-canvas" && frame.projectId === project.id && frame.reason === "bots", 10_000);

  beforeAll(async () => {
    fixture = await launchVerificationServer();
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-folder-live-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const chief = await api("POST", "/api/bots", { name: "Director", section: TEAM });
    expect(chief.status).toBe(201);
    expect((await api("PATCH", `/api/bots/${chief.body.bot.id}`, { chiefOfStaff: true })).status).toBe(200);
    const made = await api("POST", "/api/team-projects", { name: "Lost drive", team: TEAM });
    expect(made.status).toBe(201);
    project = made.body.project;
    expect(await drawn()).toBe("ready");
    events = await openSse(`${fixture.info.url}/api/events`, { origin: fixture.info.url });
  });

  afterAll(async () => {
    events?.close();
    await fixture?.close();
    if (root) await removeTempDir(root);
  });

  it("tells the open apps when it goes missing and when it comes back, without being asked", async () => {
    const away = `${project.folder}-unplugged`;
    let mark = events.frames.length;
    renameSync(project.folder, away);
    await heard("missing", mark);
    await redrawn(mark);
    expect(await listed()).toBe("missing");
    expect(await drawn()).toBe("missing");

    mark = events.frames.length;
    renameSync(away, project.folder);
    await heard("ready", mark);
    await redrawn(mark);
    expect(await listed()).toBe("ready");
    expect(await drawn()).toBe("ready");
  });

  it("tells the open apps when a project is made, archived and restored, so they read the list again", async () => {
    const changed = (projectId: string, after: number) => events.until((frame) => events.frames.indexOf(frame) >= after
      && frame.kind === "team-projects" && frame.projectId === projectId && frame.folderState === undefined, 10_000);
    let mark = events.frames.length;
    const made = await api("POST", "/api/team-projects", { name: "Second season", team: TEAM });
    expect(made.status).toBe(201);
    const second = made.body.project as TeamProjectWire;
    await changed(second.id, mark);

    mark = events.frames.length;
    expect((await api("POST", `/api/team-projects/${second.id}/archive`)).status).toBe(200);
    await changed(second.id, mark);

    mark = events.frames.length;
    expect((await api("POST", `/api/team-projects/${second.id}/restore`)).status).toBe(200);
    await changed(second.id, mark);
  });
});
