// A drama's production on a real server with the scripted fake engine and generation's test MCP server: the lead
// plans it once, and from there the script, the characters and scenes, each episode's storyboard, its videos and its
// post follow by themselves, an episode at a time as the project allows.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { botNodeId } from "../shared/project-canvas.ts";
import { serverLine } from "./server-lines.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { keep, productionPlan, startProductionFixture, type Line, type ProductionFixture } from "./testing/production-fixture.ts";

const notesIn = (lines: Line[]) => lines.filter((line) => line.kind === "activity" && line.tool?.name.startsWith("Production:")).map((line) => line.tool!.name);

describe("a drama's production", () => {
  let fixture: ProductionFixture;
  const retry = (body: unknown, projectId = fixture.project.id) => fixture.api("POST", `/api/team-projects/${projectId}/production/retry`, body);

  beforeAll(async () => {
    fixture = await startProductionFixture({ concurrency: { episodes: 1, videos: 2, images: 2 } });
    fixture.script(productionPlan(fixture.copies));
    keep("00-fixture.json", { url: fixture.server.url, dataDir: fixture.server.dataDir, logPath: fixture.server.logPath, project: fixture.project, copies: fixture.copies, mcpServer: fixture.fake.url });
    await fixture.settled();
  }, hostTimeout(120_000));

  afterAll(async () => {
    keep("99-mcp-calls.json", fixture?.fake.calls);
    await fixture?.close();
  });

  it("says who does what from the members' titles before any plan, and has no production yet", async () => {
    const drawn = await fixture.canvas();
    expect(drawn.production).toBeUndefined();
    expect(Object.fromEntries(Object.values(fixture.copies).map((bot) => [bot.name, drawn.bots[bot.id]!.stages]))).toEqual({
      Mo: ["lead"], Ink: ["script"], Jade: ["character"], Hall: ["scene"], Frame: ["storyboard"], Cut: ["post"],
    });
    expect(await retry({ job: "script" })).toMatchObject({ status: 409, body: { errorKey: "serverError.production.notPlanned" } });
  });

  it("runs by itself from the lead's plan to every episode's film: script, characters and scenes side by side, then an episode at a time with its own storyboard and post bot", async () => {
    const { copies, fake, server, project, turns, stored, messages, room } = fixture;
    await fixture.send(copies.lead, "MAKE-THE-DRAMA");

    await expect.poll(async () => (await fixture.production())?.endedAt, { timeout: 240_000, interval: 1_000 }).toBeTypeOf("number");
    await fixture.settled();
    const drawn = await fixture.canvas();
    const ended = drawn.production!;
    keep("01-production-ended.json", ended);
    expect(turns().filter((turn) => turn.unplanned)).toEqual([]);
    expect(ended.plan).toMatchObject({ episodes: 2, assignments: { script: copies.writer.id, character: copies.faces.id, scene: copies.sets.id, storyboard: copies.boarder.id, post: copies.cutter.id } });
    expect(ended.jobs).toEqual([
      { job: "script", botId: copies.writer.id, status: "done" }, { job: "character", botId: copies.faces.id, status: "done" }, { job: "scene", botId: copies.sets.id, status: "done" },
    ]);
    expect(ended.ready).toBe(true);
    expect(ended.episodes).toEqual([
      { episode: 1, nodeId: "ep-1", title: "The swap", status: "done", storyboardBotId: expect.any(String), postBotId: expect.any(String), shots: 2, ready: 2, generating: 0, failed: 0 },
      { episode: 2, nodeId: "ep-2", title: "The flight", status: "done", storyboardBotId: expect.any(String), postBotId: expect.any(String), shots: 1, ready: 1, generating: 0, failed: 0 },
    ]);
    expect(ended.tasks.map((task) => [task.job, task.episode ?? 0, task.status])).toEqual([
      ["script", 0, "done"], ["character", 0, "done"], ["scene", 0, "done"], ["storyboard", 1, "done"], ["post", 1, "done"], ["storyboard", 2, "done"], ["post", 2, "done"],
    ]);

    const now = await fixture.listed();
    const own = (episode: number, job: string) => Object.entries(now.episodeBots).find(([, one]) => one.number === episode && one.job === job)![0];
    expect(Object.keys(now.episodeBots)).toHaveLength(4);
    expect([ended.episodes[0]!.storyboardBotId, ended.episodes[0]!.postBotId, ended.episodes[1]!.storyboardBotId, ended.episodes[1]!.postBotId])
      .toEqual([own(1, "storyboard"), own(1, "post"), own(2, "storyboard"), own(2, "post")]);
    const names = Object.fromEntries(stored().filter((bot) => now.episodeBots[bot.id]).map((bot) => [bot.id, bot.name]));
    expect([names[own(1, "storyboard")], names[own(2, "storyboard")], names[own(1, "post")], names[own(2, "post")]]).toEqual(["Frame EP01", "Frame EP02", "Cut EP01", "Cut EP02"]);
    expect([...room().memberIds].sort()).toEqual(Object.values(copies).map((bot) => bot.id).sort());

    const node = (id: string) => drawn.nodes.find((one) => one.id === id)!;
    const links = (id: string) => drawn.connections.filter((one) => one.kind === "content" && (one.fromNodeId === id || one.toNodeId === id)).map((one) => `${one.fromNodeId} > ${one.toNodeId}`);
    const brief = drawn.nodes.find((one) => one.metadata?.role === "brief")!;
    expect(brief).toMatchObject({ type: "text", title: "Brief", createdBy: { kind: "bot", botId: copies.lead.id }, metadata: { card: { rows: [["Episodes", "2 × 1 min"], ["Style", "Period romance"]] } } });
    expect(links(brief.id)).toEqual([`${botNodeId(copies.lead.id)} > ${brief.id}`, `${brief.id} > ${botNodeId(copies.writer.id)}`]);
    expect(drawn.nodes.filter((one) => one.metadata?.role === "plan")).toHaveLength(1);
    expect(node("ep-1")).toMatchObject({ title: "The swap", metadata: { role: "episode", episode: 1, card: { subtitle: "Logline 1" } } });
    expect(links("ep-2")).toEqual([`${botNodeId(copies.writer.id)} > ep-2`, `ep-2 > ${botNodeId(own(2, "storyboard"))}`]);
    expect(node("mei")).toMatchObject({ groupId: expect.any(String), metadata: { role: "character", card: { badge: "Lead", palette: ["#f5f0e6"] } } });
    expect(node("mei-front")).toMatchObject({ groupId: node("mei").groupId, metadata: { status: "success", file: { mime: "image/png" } } });
    expect(node("harbour-night").metadata).toMatchObject({ status: "success", file: { mime: "image/png" } });
    expect(node("ep1-s1")).toMatchObject({ type: "shot", createdBy: { kind: "bot", botId: own(1, "storyboard") }, metadata: { episode: 1, shot: { size: "wide", move: "slow push-in", audio: "waves" }, settings: { seconds: 5 } } });
    expect(node("ep2-s1").metadata).toMatchObject({ episode: 2 });
    const takes = drawn.nodes.filter((one) => one.metadata?.role === "take");
    expect(takes.map((take) => [take.metadata?.shotId, take.metadata?.episode, take.metadata?.selected]).sort()).toEqual([["ep1-s1", 1, true], ["ep1-s2", 1, true], ["ep2-s1", 2, true]]);
    const firstTake = takes.find((take) => take.metadata?.shotId === "ep1-s1")!;
    expect(links(firstTake.id)).toContain(`${firstTake.id} > ${botNodeId(own(1, "post"))}`);
    expect(drawn.bots[own(2, "post")]).toMatchObject({ stages: ["post"], episode: 2 });
    const generated = (tool: string) => fake.calls.filter((call) => call.tool === tool).map((call) => call.arguments as { prompt: string; referenceImages: unknown[] });
    expect(generated("generate_image").map((call) => call.prompt.split("\n")[0]).sort()).toEqual(["A stone quay at night, lamps in fog", "Front view, white dress"]);
    const videos = generated("generate_video");
    expect(videos.map((call) => call.prompt.split("\n").at(-1))).toEqual(["1-1: the bride runs along the water", "1-2: the bride runs along the water", "2-1: the bride runs along the water"]);
    expect(videos.map((call) => call.referenceImages.length)).toEqual([2, 0, 0]);

    const roomLines = await messages(room().threadId);
    const notes = notesIn(roomLines);
    keep("02-group-chat.json", roomLines.map(({ role, kind, text, tool, from }) => ({ role, kind, text, tool, from })));
    expect(notes).toEqual([
      "Production: the plan is set.", "Production: script goes to Ink.", "Production: character design goes to Jade.", "Production: scene design goes to Hall.",
      "Production: EP01 storyboard goes to Frame EP01.", "Production: EP01 post-production goes to Cut EP01.", "Production: EP01 is done.",
      "Production: EP02 storyboard goes to Frame EP02.", "Production: EP02 post-production goes to Cut EP02.", "Production: EP02 is done.",
      "Production: every episode is done.",
    ]);
    const tasked = (name: string, words: string) => roomLines.some((line) => line.role === "user" && line.text?.startsWith(`@${name} `) && line.text.includes(words));
    expect([tasked("Ink", "adapt the source into 2 episodes"), tasked("Jade", "Design the drama's characters"), tasked("Hall", "Design the drama's scenes")]).toEqual([true, true, true]);
    expect(roomLines.some((line) => line.role === "user" && line.text === `@Mo ${serverLine("en", "server.production.lead.done", { project: "Harbour bride" })}`)).toBe(true);
    const boarder = stored().find((bot) => bot.id === own(1, "storyboard"))!;
    const asked = (await messages(boarder.threadId)).filter((line) => line.role === "user").map((line) => line.text ?? "");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("you are the storyboard bot of EP01");
    expect(asked[0]).toContain("EXT. HARBOUR, NIGHT. Episode 1.");
    expect(roomLines.some((line) => line.text?.includes("storyboard bot of EP01"))).toBe(false);

    const refusedPlan = turns().find((turn) => turn.botId === copies.writer.id)!.evidence.filter((item) => item.step)[1].response;
    keep("03-writer-plans.json", { refusedPlan, calls: fake.calls });
    expect(refusedPlan.error).toMatchObject({ message: "Unknown tool: production_plan" });
    const file = join(server.dataDir, "productions", `${project.id}.json`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, projectId: project.id, production: { plan: { episodes: 2 } } });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  }, hostTimeout(360_000));

  it("refuses a retry of what has not stopped, one that names nothing, and one for no project", async () => {
    expect(await retry({ episode: 1 })).toMatchObject({ status: 409, body: { errorKey: "serverError.production.notStopped" } });
    expect(await retry({ job: "script" })).toMatchObject({ status: 409, body: { errorKey: "serverError.production.notStopped" } });
    expect((await retry({})).status).toBe(400);
    expect((await retry({ job: "script" }, "no-such-project")).status).toBe(404);
  });

  it("made no JianYing folder in the server's home", () => {
    expect(existsSync(join(fixture.server.dataDir, "Movies"))).toBe(false);
  });
});
