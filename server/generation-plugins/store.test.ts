import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pluginManifest } from "../testing/fake-generation-plugin-server.ts";
import { buildZip } from "../testing/zip-fixture.ts";
import { GenerationPlugins, PluginRefused } from "./store.ts";

const dirs: string[] = [];
const pluginsIn = () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-plugins-"));
  dirs.push(dataDir);
  return new GenerationPlugins({ dataDir, log: () => {} });
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const zipOf = (manifest: unknown, extra: Array<{ name: string; data: string }> = []) => buildZip([
  { name: "acme-images/plugin.json", data: JSON.stringify(manifest) },
  ...extra.map((file) => ({ name: `acme-images/${file.name}`, data: file.data })),
]);

describe("installed plugins", () => {
  it("installs a zip with a wrapping folder, keeps it off until it is configured, and never hands back a secret", () => {
    const plugins = pluginsIn();
    const plugin = plugins.install("acme.zip", zipOf(pluginManifest("http://127.0.0.1:9/")));
    expect(plugin).toMatchObject({ id: "acme-images", name: "Acme Images", enabled: true, configured: false, kinds: ["image", "video"] });
    expect(plugin.models.map((model) => model.id)).toEqual(["pixel-1", "motion-1"]);

    const saved = plugins.save("acme-images", { values: { apiKey: "sk-secret-value-1234", baseUrl: "http://127.0.0.1:9" } });
    expect(saved.configured).toBe(true);
    expect(saved.secrets).toEqual(["apiKey"]);
    expect(JSON.stringify(saved)).not.toContain("sk-secret-value-1234");
    expect(plugins.resolve("acme-images")!.secrets.apiKey).toBe("sk-secret-value-1234");
    expect(readFileSync(join(plugins.root, "config.json"), "utf8")).not.toContain("sk-secret-value-1234");
    if (process.platform !== "win32") expect(statSync(join(plugins.root, "secrets.json")).mode & 0o777).toBe(0o600);

    expect(plugins.save("acme-images", { values: { apiKey: "" } }).secrets).toEqual(["apiKey"]);
    expect(plugins.save("acme-images", { enabled: false }).enabled).toBe(false);
    expect(plugins.list()[0]!.enabled).toBe(false);
  });

  it("reads the file on disk every time, so a replaced plugin's models are there at once", () => {
    const plugins = pluginsIn();
    plugins.install("acme.zip", zipOf(pluginManifest("http://127.0.0.1:9/")));
    expect(plugins.manifest("acme-images")!.models).toHaveLength(2);
    const next = pluginManifest("http://127.0.0.1:9/");
    next.models = [{ id: "pixel-2", name: "Pixel 2", kind: "image", aspects: ["1:1"], qualities: ["auto"], maxCount: 1, referenceImages: false }] as never;
    writeFileSync(join(plugins.root, "acme-images", "plugin.json"), JSON.stringify(next));
    expect(plugins.manifest("acme-images")!.models.map((model) => model.id)).toEqual(["pixel-2"]);
    expect(plugins.list()[0]!.models.map((model) => model.id)).toEqual(["pixel-2"]);
  });

  it("removes the plugin with its settings, and refuses an id it does not have", () => {
    const plugins = pluginsIn();
    plugins.install("acme.zip", zipOf(pluginManifest("http://127.0.0.1:9/")));
    plugins.save("acme-images", { values: { apiKey: "sk-secret-value-1234" } });
    plugins.remove("acme-images");
    expect(plugins.list()).toEqual([]);
    expect(() => plugins.remove("acme-images")).toThrow(PluginRefused);
    expect(() => plugins.install("bad.zip", buildZip([{ name: "readme.txt", data: "no manifest" }]))).toThrow(/plugin.json/);
  });

  it("refuses a value the field does not allow, and a key the plugin does not declare", () => {
    const plugins = pluginsIn();
    plugins.install("acme.zip", zipOf(pluginManifest("http://127.0.0.1:9/")));
    expect(() => plugins.save("acme-images", { values: { apiKey: "sk-a", baseUrl: "ftp://x.test" } })).toThrow(/https/);
    expect(() => plugins.save("acme-images", { values: { nope: "x" } })).toThrow(/no setting called nope/);
  });
});
