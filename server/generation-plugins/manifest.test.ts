import { describe, expect, it } from "vitest";

import { ManifestProblem, readManifest } from "./manifest.ts";

const base = () => ({
  schemaVersion: 1, id: "acme-images", name: "Acme Images", version: "1.0.0",
  models: [{ id: "pixel-1", kind: "image", aspects: ["1:1"], maxCount: 4 }, { id: "motion-1", kind: "video", durations: [5] }],
  requests: { generate: { url: "https://api.example.com/images", answer: { files: "data[].url" } } },
});

const problemOf = (value: unknown, id?: string) => {
  try { readManifest(value, id); return null; } catch (error) {
    if (error instanceof ManifestProblem) return error.message;
    throw error;
  }
};

describe("a plugin file", () => {
  it("reads the models with the same fields list_models defines, and the common choices stay the caller's business", () => {
    const manifest = readManifest(base(), "acme-images");
    expect(manifest.models).toEqual([
      { id: "pixel-1", name: "pixel-1", kind: "image", aspects: ["1:1"], qualities: undefined, maxCount: 4, referenceImages: false, referenceAudio: false },
      { id: "motion-1", name: "motion-1", kind: "video", resolutions: undefined, aspects: undefined, durations: [5], referenceImages: false, referenceAudio: false },
    ]);
    expect(manifest.requests.generate.method).toBe("POST");
    expect(manifest.requests.generate.answer.files).toEqual({ path: "data[].url" });
  });

  it("needs its folder's id, a version, at least one model, and a request that names where the files are", () => {
    expect(problemOf({ ...base(), id: "Acme" })).toContain("id of 2-64 lowercase");
    expect(problemOf(base(), "other")).toContain("but it is installed as other");
    expect(problemOf({ ...base(), version: "1" })).toContain("version such as 1.0.0");
    expect(problemOf({ ...base(), models: [] })).toContain("at least one model");
    expect(problemOf({ ...base(), requests: { generate: { url: "https://x.test", answer: {} } } })).toContain("needs taskId or files");
    expect(problemOf({ ...base(), schemaVersion: 2 })).toContain("schemaVersion");
  });

  it("refuses a placeholder it cannot fill, and a config reference the plugin does not declare", () => {
    const request = { method: "POST", url: "https://x.test", body: { prompt: "{{prompt}}", oops: "{{nope}}" }, answer: { files: "data[].url" } };
    expect(problemOf({ ...base(), requests: { generate: request } })).toContain("MagicBot does not fill in");
    const keyed = { method: "POST", url: "{{config.apiKey}}", answer: { files: "data[].url" } };
    expect(problemOf({ ...base(), requests: { generate: keyed } })).toContain("not a config field");
  });

  it("needs a status request when generate answers a task", () => {
    const generate = { method: "POST", url: "https://x.test", answer: { taskId: "id" } };
    expect(problemOf({ ...base(), requests: { generate } })).toContain("requests.status is needed");
    const status = { method: "GET", url: "https://x.test/{{taskId}}", answer: { status: "state" } };
    expect(problemOf({ ...base(), requests: { generate, status } })).toBeNull();
  });

  it("refuses an entry that could escape the plugin's folder or a header that spans lines", () => {
    expect(problemOf({ ...base(), requests: { generate: { method: "POST", url: "https://x.test", headers: { "x-key": "a\r\nb" }, answer: { files: "data[].url" } } } })).toContain("one line");
    expect(problemOf({ ...base(), config: [{ key: "a", type: "select" }] })).toContain("needs choices");
    expect(problemOf({ ...base(), models: [{ id: "x", kind: "image", maxCount: 99 }] })).toBeNull();
  });
});
