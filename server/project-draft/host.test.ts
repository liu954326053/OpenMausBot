import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS } from "../routes/table.ts";
import { createProjectDraftHost, type ProjectDraftHost } from "./host.ts";
import type { JianyingInstall } from "./jianying.ts";
import { fakeMp4, fileRef, MemoryDraftCanvas } from "./testing.ts";
import { projectDraftToolRoutes } from "./tool-route.ts";
import { PROJECT_TIMELINE_TOOL_PATHS } from "./tools.ts";

const OWNER = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
const PAIRED = { kind: "session", scopes: ["admin"] } as unknown as RequestAuth;

const bases: string[] = [];
const hosts: ProjectDraftHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true });
});

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((done) => setTimeout(done, 10));
}

function installation(options: { onPersonsComputer?: boolean; jianying?: boolean } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "omb-draft-host-")));
  bases.push(base);
  const home = join(base, "home");
  const folder = join(base, "dramas", "Stand-in bride");
  const draftRoot = join(home, "Movies", "JianyingPro", "User Data", "Projects", "com.lveditor.draft");
  mkdirSync(join(folder, "产出", "视频"), { recursive: true });
  if (options.jianying !== false) {
    mkdirSync(draftRoot, { recursive: true });
    mkdirSync(join(base, "Applications", "VideoFusion-macOS.app", "Contents"), { recursive: true });
    writeFileSync(join(base, "Applications", "VideoFusion-macOS.app", "Contents", "Info.plist"), "<key>CFBundleShortVersionString</key>\n<string>11.8.0</string>");
  }
  const project: TeamProjectWire = { id: "p1", name: "Stand-in bride", folder, section: "Stand-in bride", leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "post"], follows: {} };
  const stages: Record<string, FlowStage[]> = { lead: ["lead"], post: ["post"] };
  const launched: JianyingInstall[] = [];
  const lines: string[] = [];
  const host = createProjectDraftHost({
    projects: { list: () => [project] },
    store: { bot: (id: string) => (project.botIds.includes(id) ? { teamProject: { id: "p1", role: id } } : id === "main" ? {} : undefined) },
    onPersonsComputer: options.onPersonsComputer ?? true,
    dataDir: join(base, "data"),
    places: { platform: "darwin", home, applications: [join(base, "Applications")] },
    launch: async (install) => { launched.push(install); return true; },
    stagesOf: (botId) => stages[botId] ?? [],
    watchEveryMs: 15,
    log: (line) => lines.push(line),
  });
  hosts.push(host);
  const canvas = new MemoryDraftCanvas();
  for (const shotId of ["s1", "s2"]) writeFileSync(join(folder, "产出", "视频", `${shotId}.mp4`), fakeMp4());
  canvas.set("p1", ["s1", "s2"].map((shotId) => ({ shotId, title: shotId, take: { nodeId: `take-${shotId}`, title: shotId, file: fileRef(`产出/视频/${shotId}.mp4`) } })));
  return { base, folder, draftRoot, project, host, canvas, launched, lines };
}

async function tool(botId: string, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, any> }> {
  let answered: { status: number; body: Record<string, any> } | undefined;
  const out = await projectDraftToolRoutes({
    method: "POST", path, botId, threadId: "t1", res: {} as ServerResponse, readBody: async () => body, folders: async () => ({ roots: [], vmWorkspace: null }),
    json: ((_res: ServerResponse, status: number, sent: Record<string, any>) => { answered = { status, body: sent }; }) as never,
  });
  if (out === PASS || !answered) throw new Error(`${path} was passed on`);
  return answered;
}

describe("the draft host", () => {
  it("has no shot to write a draft from until a canvas is connected to it", async () => {
    const { host, draftRoot } = installation();
    expect(await host.drafts.timeline("p1")).toEqual({ projectId: "p1", clips: [], missingShots: [] });
    await host.writeDraftIfReady("p1");
    expect(readdirSync(draftRoot)).toEqual([]);
  });

  it("finds JianYing, writes the draft into its draft folder and keeps the timeline in the data folder, beside the canvases", async () => {
    const { host, canvas, draftRoot, base, folder } = installation();
    host.connectCanvas(canvas);
    const changed: string[] = [];
    host.onDraftChange((projectId) => changed.push(projectId));
    await host.writeDraftIfReady("p1");
    expect(readdirSync(draftRoot)).toEqual(["Stand-in bride"]);
    expect(readdirSync(join(draftRoot, "Stand-in bride")).sort()).toEqual(["draft_info.json", "draft_meta_info.json"]);
    expect(readdirSync(join(base, "data"))).toEqual(["project-timelines"]);
    expect(JSON.parse(readFileSync(join(base, "data", "project-timelines", "p1.json"), "utf8")).draft.name).toBe("Stand-in bride");
    expect(readdirSync(folder)).toEqual(["产出"]);
    expect(changed).toEqual(["p1"]);
    expect(host.draftWire("p1", OWNER)).toEqual({ state: "written", name: "Stand-in bride", writtenAt: expect.any(Number), exportFolder: join(folder, "产出") });
    expect(host.draftWire("p1", PAIRED)).toMatchObject({ state: "unavailable", reason: "remote" });
  });

  it("answers the snapshot for a project it does not know with nothing, never with a throw", async () => {
    const { host } = installation();
    expect(host.draftWire("gone", OWNER)).toBeUndefined();
  });

  it("says JianYing is not installed once it has looked and not found it", async () => {
    const { host, canvas } = installation({ jianying: false });
    host.connectCanvas(canvas);
    await host.writeDraftIfReady("p1");
    expect(host.draftWire("p1", OWNER)).toMatchObject({ state: "unavailable", reason: "not-installed" });
  });

  it("never throws from writing the draft: a project that is gone is logged, without its folder", async () => {
    const { host, lines } = installation();
    await expect(host.writeDraftIfReady("gone")).resolves.toBeUndefined();
    expect(lines.join("\n")).toContain("gone");
  });

  it("tells who listens when the order of the shots is set", async () => {
    const { host, canvas } = installation();
    host.connectCanvas(canvas);
    const heard: string[] = [];
    const stop = host.onTimelineChange((projectId) => heard.push(projectId));
    await host.drafts.setOrder("p1", { shotIds: ["s2", "s1"] });
    stop();
    await host.drafts.setOrder("p1", { shotIds: ["s1", "s2"] });
    expect(heard).toEqual(["p1"]);
  });

  it("gives the project's post bot its timeline tools, and no other bot", async () => {
    const { host, canvas } = installation();
    host.connectCanvas(canvas);
    const read = await tool("post", PROJECT_TIMELINE_TOOL_PATHS.read);
    expect(read).toMatchObject({ status: 200 });
    expect(JSON.parse(read.body.text).clips).toHaveLength(2);
    for (const botId of ["lead", "main", "nobody"]) expect(await tool(botId, PROJECT_TIMELINE_TOOL_PATHS.read), botId).toMatchObject({ status: 403 });
  });

  it("watches the output folder: a film exported there reaches the canvas", async () => {
    const { host, canvas, folder } = installation();
    host.connectCanvas(canvas);
    await host.writeDraftIfReady("p1");
    writeFileSync(join(folder, "产出", "成片.mp4"), fakeMp4({ seconds: 12 }));
    await until(() => canvas.finals.length > 0);
    expect(canvas.finals.map((one) => one.film.file.path)).toEqual(["产出/成片.mp4"]);
  });

  it("stops watching when stopped", async () => {
    const { host, canvas, folder } = installation();
    host.connectCanvas(canvas);
    await host.writeDraftIfReady("p1");
    host.stop();
    writeFileSync(join(folder, "产出", "成片.mp4"), fakeMp4());
    await new Promise((done) => setTimeout(done, 120));
    expect(canvas.finals).toEqual([]);
  });

  it("opens JianYing through the launcher it is given", async () => {
    const { host, launched, base } = installation();
    expect(await host.drafts.open("p1", OWNER)).toEqual({ opened: "app" });
    expect(launched.map((install) => install.app)).toEqual([join(base, "Applications", "VideoFusion-macOS.app")]);
  });
});
