import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { GenerationJob, GenerationJobStatus } from "../../shared/project-generation.ts";
import { fakePng } from "../testing/fake-generation-mcp-server.ts";
import { GENERATION_KEY, generationHarness, type GenerationHarness } from "../testing/project-generation-harness.ts";

let harness: GenerationHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function withProject(settings: Record<string, unknown> = {}) {
  harness = await generationHarness();
  const folder = harness.project("film");
  const saved = await harness.api.saveSettings("film", {
    image: { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } },
    video: { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } },
    ...settings,
  } as never);
  expect(saved).toHaveProperty("settings");
  return { h: harness, folder };
}

function watched() {
  const seen: GenerationJob[] = [];
  return { seen, onChange: (job: GenerationJob) => seen.push(job), statuses: () => seen.map((job) => job.status).filter((status, at, all) => status !== all[at - 1]) };
}

const started = (outcome: { job: GenerationJob } | { refused: unknown }): GenerationJob => {
  if (!("job" in outcome)) throw new Error(`refused: ${JSON.stringify(outcome.refused)}`);
  return outcome.job;
};

describe("a generation job", () => {
  it("hands the image tool the prompt, the references and the node's resolved settings as they are, and saves each picture under 产出/图片", async () => {
    const { h, folder } = await withProject();
    mkdirSync(join(folder, "参考"));
    const reference = fakePng("1:1", 7);
    writeFileSync(join(folder, "参考", "face.png"), reference);
    const watch = watched();
    const job = started(await h.api.start("film", {
      kind: "image", nodeId: "node-1", prompt: "  a lighthouse at dusk  ", name: "镜头 1", references: { images: ["参考/face.png"] }, overrides: { aspect: "16:9", count: 2 },
    }, { requester: { kind: "person" }, onChange: watch.onChange }));
    const done = await h.ended("film", job.id);

    expect(done.status).toBe("done");
    const call = h.fake.calls.find((entry) => entry.tool === "generate_image")!;
    expect(call.arguments).toEqual({
      model: "pixel-1", prompt: "  a lighthouse at dusk  ", aspect: "16:9", quality: "standard", count: 2,
      referenceImages: [{ name: "face.png", mimeType: "image/png", bytes: reference.length, sha256: createHash("sha256").update(reference).digest("hex") }],
    });
    expect(done.settings).toEqual({ model: "pixel-1", aspect: "16:9", quality: "standard", count: 2 });
    expect(done.files).toHaveLength(2);
    for (const file of done.files) {
      expect(file.path).toMatch(/^产出\/图片\/镜头 1-\d{8}-\d{6}-[A-Za-z0-9]{6}-[12]\.png$/);
      expect(file.mime).toBe("image/png");
      expect(readFileSync(join(folder, ...file.path.split("/"))).subarray(1, 4).toString()).toBe("PNG");
    }
    expect(watch.statuses()).toEqual(["queued", "running", "done"]);
  });

  it("follows a video through its task, telling each state and the progress, and saves the clip under 产出/视频", async () => {
    const { h, folder } = await withProject();
    const watch = watched();
    const job = started(await h.api.start("film", { kind: "video", nodeId: "node-2", prompt: "waves" }, { requester: { kind: "person" }, onChange: watch.onChange }));
    const done = await h.ended("film", job.id);

    expect(done.status).toBe("done");
    expect(done.taskId).toMatch(/^task-/);
    expect(watch.statuses()).toEqual(["queued", "running", "done"]);
    expect(watch.seen.some((seen) => seen.status === "running" && seen.progress !== undefined && seen.progress < 1)).toBe(true);
    expect(done.files).toEqual([expect.objectContaining({ mime: "video/mp4", path: expect.stringMatching(/^产出\/视频\/video-.+\.mp4$/) })]);
    const fixture = readFileSync(new URL("../testing/fixtures/generation-sample.mp4", import.meta.url));
    expect(readFileSync(join(folder, ...done.files[0]!.path.split("/"))).equals(fixture)).toBe(true);
    expect(h.fake.calls.find((entry) => entry.tool === "generate_video")!.arguments).toEqual({
      model: "motion-1", prompt: "waves", referenceImages: [], referenceAudio: [], resolution: "720p", aspect: "16:9", seconds: 5,
    });
  });

  it("fails with the server's own reason when the task fails there", async () => {
    const { h } = await withProject();
    const job = started(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "storm [fail:the model is overloaded]" }, { requester: { kind: "person" } }));
    const failed = await h.ended("film", job.id);
    expect(failed.status).toBe("failed");
    expect(failed.failure).toMatchObject({ code: "task_failed", reason: "the model is overloaded", error: "gen couldn't make it: the model is overloaded" });
  });

  it("is cancelled at once, and its task is cancelled on the server", async () => {
    const { h, folder } = await withProject();
    const watch = watched();
    const job = started(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "slow [hold]" }, { requester: { kind: "person" }, onChange: watch.onChange }));
    const running = await h.until(() => h.api.job("film", job.id)?.taskId);
    expect(h.api.cancel("film", job.id)?.status).toBe("cancelled");
    await h.until(() => h.fake.calls.some((entry) => entry.tool === "cancel_task"));
    expect(h.fake.calls.find((entry) => entry.tool === "cancel_task")!.arguments).toEqual({ taskId: running });
    h.fake.release();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(h.api.job("film", job.id)).toMatchObject({ status: "cancelled", files: [] });
    expect(existsSync(join(folder, "产出", "视频"))).toBe(false);
    expect(watch.statuses()).toEqual(["queued", "running", "cancelled"]);
    expect(h.api.cancel("film", "gen-none")).toBeNull();
  });

  it("cancelled while it is being handed over, cancels the task the server then names and keeps nothing it makes", async () => {
    const { h, folder } = await withProject();
    const person = { requester: { kind: "person" } as const };
    const video = started(await h.api.start("film", { kind: "video", nodeId: "v", prompt: "late [slow]" }, person));
    const picture = started(await h.api.start("film", { kind: "image", nodeId: "p", prompt: "late [slow]" }, person));
    await h.until(() => h.fake.calls.filter((entry) => entry.tool.startsWith("generate_")).length === 2);
    expect(h.api.cancel("film", video.id)?.status).toBe("cancelled");
    expect(h.api.cancel("film", picture.id)?.status).toBe("cancelled");
    await h.until(() => h.fake.calls.some((entry) => entry.tool === "cancel_task"));
    const [task] = [...h.fake.tasks.values()];
    expect(h.fake.calls.find((entry) => entry.tool === "cancel_task")!.arguments).toEqual({ taskId: task!.id });
    expect(task!.cancelled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(h.api.job("film", picture.id)).toMatchObject({ status: "cancelled", files: [] });
    expect(existsSync(join(folder, "产出"))).toBe(false);
  });

  it("is followed again from its task id after a restart, and finishes", async () => {
    const { h, folder } = await withProject();
    const job = started(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "held [hold]" }, { requester: { kind: "person" } }));
    const taskId = await h.until(() => h.api.job("film", job.id)?.taskId);
    const again = h.restart();
    const told: GenerationJobStatus[] = [];
    again.api.onJobChange((changed) => told.push(changed.status));
    expect(again.api.job("film", job.id)).toMatchObject({ status: "running", taskId });
    h.fake.release();
    const done = await h.ended("film", job.id);
    expect(done.status).toBe("done");
    expect(told.at(-1)).toBe("done");
    expect(readdirSync(join(folder, "产出", "视频"))).toHaveLength(1);
  });

  it("is reported interrupted when MagicBot stopped while handing it over, and waits again when it was not handed over yet", async () => {
    const { h } = await withProject();
    const handing = started(await h.api.start("film", { kind: "image", nodeId: "a", prompt: "a" }, { requester: { kind: "person" } }));
    h.generation.close();
    const again = h.restart();
    expect(again.api.job("film", handing.id)?.failure).toMatchObject({ code: "interrupted" });
    expect(again.api.job("film", handing.id)?.status).toBe("failed");
  });

  it("fails as unreachable when the server stops answering about its task", async () => {
    harness = await generationHarness({ timing: { pollFailures: 2 } });
    const h = harness;
    h.project("film");
    await h.api.saveSettings("film", { video: { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } } } as never);
    const job = started(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "[hold]" }, { requester: { kind: "person" } }));
    await h.until(() => h.api.job("film", job.id)?.taskId);
    await h.fake.close();
    const failed = await h.ended("film", job.id);
    expect(failed.failure?.code).toBe("unreachable");
    expect(failed.failure?.error).toMatch(/^The MCP server gen couldn't be reached/);
  });

  it("never carries the server's key into a job, a failure, a log line or a saved file", async () => {
    const { h } = await withProject();
    const echoed = started(await h.api.start("film", { kind: "video", nodeId: "n", prompt: "[fail:your key {authorization} is out of credit]" }, { requester: { kind: "person" } }));
    const refusedHere = started(await h.api.start("film", { kind: "image", nodeId: "n", prompt: "[refuse:{authorization} refused]" }, { requester: { kind: "person" } }));
    const failed = [await h.ended("film", echoed.id), await h.ended("film", refusedHere.id)];
    expect(failed.map((job) => job.failure?.code)).toEqual(["task_failed", "task_failed"]);
    expect(failed[0]!.failure!.reason).toBe("your key «redacted» is out of credit");
    expect(failed[1]!.failure!.reason).toBe("«redacted» refused");
    const stored = readdirSync(join(h.dataDir, "project-generation"), { recursive: true }).map(String)
      .filter((path) => path.endsWith(".json")).map((path) => readFileSync(join(h.dataDir, "project-generation", path), "utf8"));
    for (const text of [JSON.stringify(h.api.jobs("film")), ...h.logs, ...stored]) expect(text).not.toContain(GENERATION_KEY);
  });
});
