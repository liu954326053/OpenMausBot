// On a Team Cloud an admin reads a project's canvas, and a member's private conversation with one of its bots gives
// the admin nothing of what was said there: not its reply, not its id. Real servers, the synthetic Claude CLI.
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { launchCloudSendFixture, type CloudSendFixture, type CloudTeamFixture } from "../scripts/testing/cloud-send-fixture.ts";
import type { CanvasSnapshot } from "../shared/project-canvas.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const ADA = { email: "ada@acme.test", role: "admin" as const };
const MIRA = { email: "mira@acme.test", role: "member" as const };
const ADA_REPLY = "The outline is ready for the whole team.";
const MIRA_REPLY = "Kumquat salary plan, for Mira only.";
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

type Bot = { id: string; threadId: string; mainThreadId?: string };
type Line = { role?: string; text?: string };

let fx: CloudSendFixture, team: CloudTeamFixture;
let ada = "", mira = "";
let root = "";
let project: TeamProjectWire;
let writer: Bot;

const said = (token: string, threadId: string, text: string) =>
  expect.poll(async () => ((await team.as(token, "GET", `/api/threads/${threadId}/messages`)).body.messages as Line[] ?? []).map((line) => `${line.role}: ${line.text}`), { timeout: 45_000 }).toContain(`bot: ${text}`);

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-privacy-")));
  const replies = join(root, "replies.json");
  writeFileSync(replies, JSON.stringify({ "MIRA-ASKS": MIRA_REPLY, "ADA-ASKS": ADA_REPLY }));
  fx = await launchCloudSendFixture({
    onePasswordToken: `ops_fake-team-${randomBytes(8).toString("hex")}`,
    team: { id: "team-canvas-3", name: "Acme", engine: `process.env.FAKE_CLAUDE_MARKER_REPLIES = ${JSON.stringify(replies)};` },
  });
  team = fx.team!;
  ada = (await team.pair(ADA)).token!;
  mira = (await team.pair(MIRA)).token!;
  expect((await team.as(ada, "PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
  const member = async (name: string) => {
    const made = await team.as(ada, "POST", "/api/bots", { name, section: "Crew", visibility: "everyone" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body.bot as Bot;
  };
  const director = await member("Director");
  await member("Writer");
  expect((await team.as(ada, "PATCH", `/api/bots/${director.id}`, { chiefOfStaff: true })).status).toBe(200);
  const made = await team.as(ada, "POST", "/api/team-projects", { name: "Private drama", team: "Crew" });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  project = made.body.project;
  const all = (await team.as(ada, "GET", "/api/bots?messages=0")).body.bots as Bot[];
  writer = all.find((bot) => project.botIds.includes(bot.id) && bot.id !== project.leadBotId)!;
  expect(writer).toBeTruthy();
  const shown = await team.as(ada, "PATCH", `/api/bots/${writer.id}`, { visibility: "everyone" });
  expect(shown.status, JSON.stringify(shown.body)).toBe(200);
}, hostTimeout(150_000));

afterAll(async () => {
  await fx?.close();
  if (root) await removeTempDir(root);
});

it("gives an admin no text from a member's private conversation with a project's bot", async () => {
  const shared = writer.mainThreadId ?? writer.threadId;
  const asked = await team.as(ada, "POST", `/api/bots/${writer.id}/messages`, { text: "ADA-ASKS", threadId: shared, sendId: crypto.randomUUID() });
  expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
  await said(ada, shared, ADA_REPLY);

  const opened = await team.as(mira, "POST", `/api/bots/${writer.id}/tasks`, { title: "Salary" });
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  const privateThread = opened.body.task.threadId as string;
  const sent = await team.as(mira, "POST", `/api/bots/${writer.id}/messages`, { text: "MIRA-ASKS", threadId: privateThread, sendId: crypto.randomUUID() });
  expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
  await said(mira, privateThread, MIRA_REPLY);

  const read = await team.as(ada, "GET", `/api/team-projects/${project.id}/canvas`);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const snapshot = read.body as CanvasSnapshot;
  const forMira = await team.as(mira, "GET", `/api/team-projects/${project.id}/canvas`);
  const adaOpensIt = await team.as(ada, "GET", `/api/threads/${privateThread}/messages`);
  if (evidenceDir) writeFileSync(join(evidenceDir, "10-privacy-team-cloud.json"), `${JSON.stringify({ adminSnapshotOfWriter: snapshot.bots[writer.id], memberReadsCanvas: forMira, adminOpensPrivateThread: { status: adaOpensIt.status } }, null, 2)}\n`);
  expect(snapshot.bots[writer.id]).toMatchObject({ status: "idle", output: { text: ADA_REPLY, threadId: shared } });
  expect(JSON.stringify(snapshot)).not.toContain("Kumquat");
  expect(JSON.stringify(snapshot)).not.toContain(privateThread);
  expect(forMira.status).toBe(403);
  expect(adaOpensIt.status).toBe(404);
}, hostTimeout(120_000));
