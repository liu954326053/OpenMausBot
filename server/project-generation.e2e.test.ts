import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GenerationJob } from "../shared/project-generation.ts";
import type { TeamProjectWire } from "../shared/team-projects.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { fakePng, startFakeGenerationMcp } from "./testing/fake-generation-mcp-server.ts";
import { GENERATION_KEY } from "./testing/project-generation-harness.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";

const TEAM = "Drama team";
const IMAGE = { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } };
const VIDEO = { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } };

/** Every file under `root` that holds `needle`, as a path from `root`; links are not followed. */
function filesHolding(root: string, needle: string): string[] {
  return readdirSync(root, { recursive: true }).map(String)
    .filter((path) => lstatSync(join(root, path)).isFile() && readFileSync(join(root, path)).includes(needle)).sort();
}

describe("project generation on a real server, through a test MCP server", () => {
  let server: RestartableServer;
  let fake: Awaited<ReturnType<typeof startFakeGenerationMcp>>;
  let root = "";
  let project: TeamProjectWire;
  const evidence: Record<string, unknown> = {};
  const answers: unknown[] = [];

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const answer = { status: response.status, body: await response.json() as any };
    answers.push(answer);
    return answer;
  };
  /** Another suite's server can take the port between the fixture's probe and its own listen, and answer its health check. */
  async function ownServerListening(starts: number) {
    const deadline = Date.now() + 30_000;
    while (readFileSync(server.logPath, "utf8").split(`openmausbot server on ${server.url}\n`).length - 1 < starts) {
      if (Date.now() > deadline) throw new Error(`something answered on ${server.url}, but this fixture's server never listened there; see ${server.logPath}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const jobs = (id?: string) => `/api/team-projects/${project.id}/generation/jobs${id ? `/${id}` : ""}`;
  const statusLines = (jobId: string) => readFileSync(server.logPath, "utf8").split("\n").filter((line) => line.includes(`project generation: job ${jobId} `))
    .map((line) => line.slice(line.indexOf("project generation:")));
  const kept = (job: GenerationJob) => job.files.map((file) => {
    const bytes = readFileSync(join(project.folder, ...file.path.split("/")));
    const copy = `${server.logPath}.project-generation-files`;
    mkdirSync(copy, { recursive: true });
    copyFileSync(join(project.folder, ...file.path.split("/")), join(copy, basename(file.path)));
    return { ...file, onDisk: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });

  /** Reads the job until `until` holds, keeping each status and progress it is seen with. */
  async function watch(jobId: string, until: (job: GenerationJob) => boolean, ms = 60_000) {
    const seen: Array<{ status: string; progress?: number }> = [];
    const deadline = Date.now() + ms;
    for (;;) {
      const job = (await api("GET", jobs(jobId))).body.job as GenerationJob;
      const last = seen.at(-1);
      if (!last || last.status !== job.status || last.progress !== job.progress) seen.push({ status: job.status, ...(job.progress === undefined ? {} : { progress: job.progress }) });
      if (until(job)) return { job, seen };
      if (Date.now() > deadline) throw new Error(`job ${jobId} stayed ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  beforeAll(async () => {
    fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 8_000 });
    server = await launchRestartableServer();
    await ownServerListening(1);
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-generation-e2e-")));
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const director = await api("POST", "/api/bots", { name: "Director", section: TEAM });
    expect(director.status).toBe(201);
    expect((await api("PATCH", `/api/bots/${director.body.bot.id}`, { chiefOfStaff: true })).status).toBe(200);
    const made = await api("POST", "/api/team-projects", { name: "First drama", team: TEAM });
    expect(made.status).toBe(201);
    project = made.body.project;
    const added = await api("POST", "/api/mcp/servers", { name: "gen", type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } });
    expect(added.status).toBe(201);
    expect((await api("PATCH", "/api/mcp/servers/gen", { enabled: true })).status).toBe(200);
    evidence.fixture = { url: server.url, dataDir: server.dataDir, logPath: server.logPath, projectFolder: project.folder, mcpServer: fake.url };
  }, 120_000);

  afterAll(async () => {
    if (server) {
      evidence.mcpCalls = fake?.calls;
      writeFileSync(`${server.logPath}.project-generation.json`, JSON.stringify(evidence, null, 2));
      console.info(JSON.stringify({ logPath: server.logPath, evidence: `${server.logPath}.project-generation.json`, files: `${server.logPath}.project-generation-files` }));
    }
    await server?.close();
    await fake?.close();
    if (root) await removeTempDir(root);
  });

  it("refuses a generation while the project has no MCP server chosen, saying where to choose one", async () => {
    const refused = await api("POST", jobs(), { kind: "image", nodeId: "node-1", prompt: "a lighthouse" });
    expect(refused).toEqual({ status: 422, body: {
      code: "no_server", error: "Choose an MCP server for pictures in this project's settings first.", errorKey: "serverError.projectGeneration.noImageServer",
    } });
    evidence.refusedWithoutServer = refused;
    expect(fake.calls).toEqual([]);
  });

  it("lists the models the MCP server offers", async () => {
    const settings = await api("GET", `/api/team-projects/${project.id}/generation/settings`);
    expect(settings.body.servers).toEqual(["gen"]);
    const image = await api("GET", `/api/team-projects/${project.id}/generation/models?kind=image&server=gen`);
    const video = await api("GET", `/api/team-projects/${project.id}/generation/models?kind=video&server=gen`);
    expect(image.body.models.map((model: { id: string }) => model.id)).toEqual(["pixel-1", "sketch"]);
    expect(video.body.models).toEqual([
      expect.objectContaining({ id: "motion-1", resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], durations: [5, 10], referenceAudio: true }),
      expect.objectContaining({ id: "motion-lite", resolutions: ["480p"], durations: [4], referenceImages: false }),
    ]);
    evidence.models = { image: image.body, video: video.body };
  });

  it("saves the project's settings, refusing what the model doesn't offer, and a new project starts from them", async () => {
    const path = `/api/team-projects/${project.id}/generation/settings`;
    const refused = await api("PUT", path, { image: { ...IMAGE, defaults: { ...IMAGE.defaults, quality: "auto" } } });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: "setting_refused", error: "Pixel 1 doesn't offer the quality auto. It offers standard, hd." });
    const saved = await api("PUT", path, { image: IMAGE, video: VIDEO });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ image: IMAGE, video: VIDEO });

    const second = await api("POST", "/api/team-projects", { name: "Second drama", team: TEAM });
    expect(second.status).toBe(201);
    const inherited = await api("GET", `/api/team-projects/${second.body.project.id}/generation/settings`);
    expect(inherited.body.settings).toEqual(saved.body.settings);
    evidence.settings = { refused: refused.body, saved: saved.body, newProject: { id: second.body.project.id, ...inherited.body } };
  });

  it("makes pictures with the node's settings resolved over the project's, handed to the tool exactly, and saves them in 产出/图片", async () => {
    const reference = fakePng("1:1", 42);
    mkdirSync(join(project.folder, "参考"), { recursive: true });
    writeFileSync(join(project.folder, "参考", "face.png"), reference);
    const unoffered = await api("POST", jobs(), { kind: "image", nodeId: "node-1", prompt: "a lighthouse", overrides: { aspect: "21:9" } });
    expect(unoffered.status).toBe(422);
    expect(unoffered.body.error).toBe("Pixel 1 doesn't make the shape 21:9. It makes 1:1, 16:9, 9:16.");

    const prompt = "  A lighthouse at dusk, 镜头一  ";
    const started = await api("POST", jobs(), {
      kind: "image", nodeId: "node-1", prompt, name: "镜头 1", references: { images: ["参考/face.png"] }, overrides: { aspect: "16:9", count: 2 },
    });
    expect(started.status).toBe(202);
    const { job, seen } = await watch(started.body.job.id, (current) => current.status !== "queued" && current.status !== "running");
    expect(job.status).toBe("done");
    const resolved = { model: "pixel-1", aspect: "16:9", quality: "standard", count: 2 };
    expect(job.settings).toEqual(resolved);
    const received = fake.calls.find((call) => call.tool === "generate_image")!.arguments;
    expect(received).toEqual({
      ...resolved, prompt,
      referenceImages: [{ name: "face.png", mimeType: "image/png", bytes: reference.length, sha256: createHash("sha256").update(reference).digest("hex") }],
    });
    expect(job.files.map((file) => file.path)).toEqual([expect.stringMatching(/^产出\/图片\/镜头 1-.+-1\.png$/), expect.stringMatching(/^产出\/图片\/镜头 1-.+-2\.png$/)]);
    expect(readdirSync(join(project.folder, "产出", "图片")).sort()).toEqual(job.files.map((file) => file.name).sort());
    evidence.image = { refusedOverride: unoffered.body, started: started.body.job, seen, received, resolved, job, files: kept(job), statusLog: statusLines(job.id) };
  }, 60_000);

  it("follows a video through a task that takes a while, telling each state, and saves it in 产出/视频", async () => {
    const started = await api("POST", jobs(), { kind: "video", nodeId: "shot-1", prompt: "waves against the lighthouse", name: "镜头 1" });
    expect(started.status).toBe(202);
    const { job, seen } = await watch(started.body.job.id, (current) => current.status === "done" || current.status === "failed");
    expect(job.status).toBe("done");
    expect(job.taskId).toMatch(/^task-/);
    expect(seen.some((state) => state.status === "running" && state.progress !== undefined && state.progress > 0 && state.progress < 1)).toBe(true);
    expect(seen.at(-1)).toEqual({ status: "done", progress: 1 });
    expect(job.files).toEqual([expect.objectContaining({ mime: "video/mp4", path: expect.stringMatching(/^产出\/视频\/镜头 1-.+\.mp4$/) })]);
    const statusLog = statusLines(job.id);
    expect(statusLog.map((line) => line.split(" is ").at(-1))).toEqual(["queued", "running", "done"]);
    evidence.video = { started: started.body.job, seen, job, files: kept(job), statusLog };
  }, 60_000);

  it("cancels a job, and its task on the server", async () => {
    const started = await api("POST", jobs(), { kind: "video", nodeId: "shot-2", prompt: "a slow pan [hold]" });
    const { job: running } = await watch(started.body.job.id, (current) => Boolean(current.taskId));
    const cancelled = await api("POST", `${jobs(running.id)}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job.status).toBe("cancelled");
    await expect.poll(() => fake.tasks.get(running.taskId!)?.cancelled, { timeout: 10_000 }).toBe(true);
    expect(fake.calls.filter((call) => call.tool === "cancel_task").map((call) => call.arguments)).toEqual([{ taskId: running.taskId }]);
    const after = (await api("GET", jobs(running.id))).body.job as GenerationJob;
    expect(after).toMatchObject({ status: "cancelled", files: [] });
    evidence.cancelled = { job: after, task: fake.tasks.get(running.taskId!), statusLog: statusLines(running.id) };
  }, 60_000);

  it("fails a job with the reason the server gave", async () => {
    const started = await api("POST", jobs(), { kind: "video", nodeId: "shot-3", prompt: "a crowd [fail:the model is overloaded, try again in an hour]" });
    const { job } = await watch(started.body.job.id, (current) => current.status === "failed" || current.status === "done");
    expect(job.failure).toEqual({
      code: "task_failed", reason: "the model is overloaded, try again in an hour", error: "gen couldn't make it: the model is overloaded, try again in an hour",
      errorKey: "serverError.projectGeneration.taskFailed", errorParams: { server: "gen", reason: "the model is overloaded, try again in an hour" },
    });
    evidence.failed = { job, statusLog: statusLines(job.id) };
  }, 60_000);

  it("finishes a video whose task was held across a restart of the server", async () => {
    const started = await api("POST", jobs(), { kind: "video", nodeId: "shot-4", prompt: "a storm over the sea [hold]", name: "镜头 4" });
    const { job: before } = await watch(started.body.job.id, (current) => Boolean(current.taskId));
    await server.stop();
    const stored = JSON.parse(readFileSync(join(server.dataDir, "project-generation", "projects", project.id, "jobs.json"), "utf8")) as Array<{ job: GenerationJob; phase: string }>;
    const whileStopped = stored.find((entry) => entry.job.id === before.id)!;
    expect(whileStopped).toMatchObject({ phase: "submitted", job: { status: "running", taskId: before.taskId } });
    await server.start();
    await ownServerListening(2);
    const afterRestart = (await api("GET", jobs(before.id))).body.job as GenerationJob;
    expect(afterRestart).toMatchObject({ status: "running", taskId: before.taskId });
    fake.release();
    const { job, seen } = await watch(before.id, (current) => current.status === "done" || current.status === "failed");
    expect(job.status).toBe("done");
    expect(job.files).toEqual([expect.objectContaining({ path: expect.stringMatching(/^产出\/视频\/镜头 4-.+\.mp4$/) })]);
    expect(fake.calls.filter((call) => call.tool === "generate_video" && String(call.arguments.prompt).includes("storm"))).toHaveLength(1);
    evidence.restart = { before, whileStopped, afterRestart, seen, job, files: kept(job), statusLog: statusLines(job.id) };
  }, 120_000);

  it("keeps the MCP server's key out of every job, answer, stored file and log line", async () => {
    const log = readFileSync(server.logPath, "utf8");
    const holding = filesHolding(server.dataDir, GENERATION_KEY);
    evidence.key = {
      inLog: log.includes(GENERATION_KEY),
      inAnswers: JSON.stringify(answers).includes(GENERATION_KEY),
      inProjectFolder: filesHolding(project.folder, GENERATION_KEY),
      filesHoldingIt: holding,
      generationLogLines: log.split("\n").filter((line) => line.includes("project generation:")).length,
    };
    expect(log).toContain("project generation: job");
    expect(log).not.toContain(GENERATION_KEY);
    expect(JSON.stringify(answers)).not.toContain(GENERATION_KEY);
    expect(filesHolding(project.folder, GENERATION_KEY)).toEqual([]);
    expect(holding.filter((path) => path.startsWith("project-generation"))).toEqual([]);
    expect(existsSync(join(server.dataDir, "project-generation", "last-settings.json"))).toBe(true);
  });
});
