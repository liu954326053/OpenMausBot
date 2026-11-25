import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { configurePluginImages, generateImage, imageToolReady, pluginImagesReady } from "../image-generation.ts";
import { pluginManifest, PLUGIN_KEY, startFakeGenerationPlugin } from "../testing/fake-generation-plugin-server.ts";
import { buildZip } from "../testing/zip-fixture.ts";
import { createPluginImages } from "./chat-image.ts";
import { GenerationPlugins } from "./store.ts";

const dirs: string[] = [];
const fakes: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  configurePluginImages(null);
  for (const fake of fakes.splice(0)) await fake.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function ready() {
  const fake = await startFakeGenerationPlugin();
  fakes.push(fake);
  const dataDir = mkdtempSync(join(tmpdir(), "omb-plugin-chat-"));
  dirs.push(dataDir);
  const plugins = new GenerationPlugins({ dataDir, log: () => {} });
  plugins.install("acme.zip", buildZip([{ name: "plugin.json", data: JSON.stringify(pluginManifest(fake.url)) }]));
  plugins.save("acme-images", { values: { apiKey: PLUGIN_KEY } });
  return { plugins, fake };
}

describe("the chat's picture channel", () => {
  it("is ready only for a plugin that is on, set up and makes pictures", async () => {
    configurePluginImages(null);
    expect(pluginImagesReady()).toBe(false);
    const { plugins } = await ready();
    plugins.save("acme-images", { enabled: false });
    expect(createPluginImages(plugins).ready()).toBe(false);
    plugins.save("acme-images", { enabled: true });
    expect(createPluginImages(plugins).ready()).toBe(true);
    configurePluginImages(createPluginImages(plugins));
    expect(imageToolReady({})).toBe(true);
  });

  it("makes the picture through the plugin and credits it, even with no provider configured", async () => {
    const { plugins } = await ready();
    configurePluginImages(createPluginImages(plugins));
    const image = await generateImage({}, { prompt: "a lighthouse", aspect: "16:9" });
    expect(image.mime).toBe("image/png");
    expect(image.by).toBe("Acme Images (pixel-1)");
    expect(image.bytes.length).toBeGreaterThan(0);
  });

  it("never takes an avatar draft to the plugin", async () => {
    const { plugins } = await ready();
    configurePluginImages(createPluginImages(plugins));
    await expect(generateImage({}, { prompt: "an avatar", draft: true })).rejects.toThrow(/key/i);
  });
});
