import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GenerationRefused } from "../project-generation/failure.ts";
import { pluginManifest, PLUGIN_KEY, startFakeGenerationPlugin, type FakePluginOptions } from "../testing/fake-generation-plugin-server.ts";
import { buildZip } from "../testing/zip-fixture.ts";
import { pluginEndpoint } from "./endpoint.ts";
import { GenerationPlugins } from "./store.ts";

const runtimes: Array<{ close(): Promise<void> }> = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function ready(options: FakePluginOptions = {}) {
  const fake = await startFakeGenerationPlugin(options);
  runtimes.push(fake);
  const dataDir = mkdtempSync(join(tmpdir(), "omb-plugin-endpoint-"));
  dirs.push(dataDir);
  const plugins = new GenerationPlugins({ dataDir, log: () => {} });
  plugins.install("acme.zip", buildZip([{ name: "plugin.json", data: JSON.stringify(pluginManifest(fake.url)) }]));
  plugins.save("acme-images", { values: { apiKey: PLUGIN_KEY } });
  return { fake, plugins, endpoint: pluginEndpoint(plugins, "acme-images") };
}

const imageSettings = { model: "pixel-1", aspect: "16:9", quality: "hd", count: 2 };

describe("a plugin endpoint", () => {
  it("lists the models its file declares and answers with a task", async () => {
    const { fake, endpoint } = await ready();
    expect((await endpoint.listModels(AbortSignal.timeout(1000))).map((model) => model.id)).toEqual(["pixel-1", "motion-1"]);
    const submitted = await endpoint.generate("image", imageSettings, { prompt: "a lighthouse", references: { images: [], audio: [] } }, AbortSignal.timeout(1000));
    expect(submitted).toEqual({ taskId: "task-1" });
    expect(fake.calls[0]!.body).toEqual({ model: "pixel-1", prompt: "a lighthouse", n: 2, aspect_ratio: "16:9", quality: "hd", references: [] });
    expect(fake.calls[0]!.authorization).toBe(`Bearer ${PLUGIN_KEY}`);
  });

  it("maps its own status words, its percent and its retry delay, then names the files", async () => {
    const { endpoint } = await ready();
    const running = await endpoint.status("task-1", AbortSignal.timeout(1000));
    expect(running).toEqual({ status: "running", progress: 0.4, pollAfterMs: 1000 });
    const done = await endpoint.status("task-1", AbortSignal.timeout(1000));
    expect(done).toMatchObject({ status: "succeeded" });
    expect("files" in done && done.files[0]).toMatchObject({ url: expect.stringContaining("/files/task-1.png") });
    expect(await endpoint.cancel("task-1", AbortSignal.timeout(1000))).toBe(true);
  });

  it("takes the pictures a plugin returns in the call, without a task", async () => {
    const { endpoint } = await ready({ mode: "files" });
    const submitted = await endpoint.generate("image", imageSettings, { prompt: "x", references: { images: [], audio: [] } }, AbortSignal.timeout(1000));
    expect(submitted).toMatchObject({ files: [{ url: expect.stringContaining("/files/one.png") }] });
  });

  it("masks the key the plugin echoes and clips the reason", async () => {
    const { endpoint } = await ready();
    const failure = await endpoint.generate("image", imageSettings, { prompt: "a [refuse] prompt", references: { images: [], audio: [] } }, AbortSignal.timeout(1000))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GenerationRefused);
    expect((failure as GenerationRefused).failure.code).toBe("task_failed");
    expect((failure as GenerationRefused).failure.reason).not.toContain(PLUGIN_KEY);
    expect((failure as GenerationRefused).failure.reason).toContain("«redacted»");
  });

  it("refuses a plugin that is off or not configured, and a plugin that is gone", async () => {
    const { plugins, endpoint } = await ready();
    plugins.save("acme-images", { enabled: false });
    await expect(endpoint.listModels(AbortSignal.timeout(1000))).rejects.toMatchObject({ failure: { code: "server_unusable", errorKey: "serverError.projectGeneration.pluginOff" } });
    plugins.save("acme-images", { enabled: true });
    plugins.remove("acme-images");
    await expect(endpoint.listModels(AbortSignal.timeout(1000))).rejects.toMatchObject({ failure: { code: "server_unusable", errorKey: "serverError.projectGeneration.pluginGone" } });
  });
});
