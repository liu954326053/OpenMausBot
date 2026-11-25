// A local stand-in for an image plugin's HTTP API: a task, a status that is running once then done, a real PNG, and a
// refusal that echoes the key so masking is testable. No network beyond loopback.
import { createServer, type Server } from "node:http";

export const PLUGIN_KEY = "sk-plugin-9f2a71c4be03d5";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface FakePluginOptions {
  key?: string;
  /** `task` answers a task id; `files` answers the picture in the call. */
  mode?: "task" | "files";
  /** Echo the key in the refusal, to prove it is masked. */
  refuseWithKey?: boolean;
}

export interface FakePluginCall {
  path: string;
  method: string;
  body: unknown;
  authorization: string | undefined;
}

export async function startFakeGenerationPlugin(options: FakePluginOptions = {}) {
  const key = options.key ?? PLUGIN_KEY;
  const mode = options.mode ?? "task";
  const calls: FakePluginCall[] = [];
  const seen = new Map<string, number>();
  let tasks = 0;
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    calls.push({ path: url.pathname, method: req.method ?? "GET", body, authorization: req.headers.authorization });
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG);
      return;
    }
    if (req.headers.authorization !== `Bearer ${key}`) {
      json(401, { error: { message: options.refuseWithKey ? `the key ${req.headers.authorization ?? ""} is not accepted` : "the key is not accepted" } });
      return;
    }
    if (url.pathname === "/v1/images" && req.method === "POST") {
      const prompt = (body as { prompt?: unknown } | null)?.prompt;
      if (typeof prompt === "string" && prompt.includes("[refuse]")) {
        json(400, { error: { message: `the prompt was refused, key ${req.headers.authorization ?? ""}` } });
        return;
      }
      if (mode === "files") {
        json(200, { data: [{ url: `http://127.0.0.1:${port}/files/one.png`, name: "one.png" }] });
        return;
      }
      tasks += 1;
      json(200, { task: { id: `task-${tasks}` }, status: "queued" });
      return;
    }
    const status = /^\/v1\/tasks\/([\w-]+)$/.exec(url.pathname);
    if (status && req.method === "GET") {
      const id = status[1]!;
      const asked = (seen.get(id) ?? 0) + 1;
      seen.set(id, asked);
      if (asked === 1) {
        json(200, { state: "processing", percent: 40, retry_after: 1 });
        return;
      }
      json(200, { state: "completed", output: [{ url: `http://127.0.0.1:${port}/files/${id}.png` }] });
      return;
    }
    if (/^\/v1\/tasks\/[\w-]+\/cancel$/.test(url.pathname) && req.method === "POST") {
      json(200, { cancelled: true });
      return;
    }
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG);
      return;
    }
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG);
      return;
    }
    json(404, { error: { message: "no such route" } });
  });
  let port = 0;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The plugin manifest the tests install, pointed at `baseUrl`. */
export function pluginManifest(baseUrl: string) {
  return {
    schemaVersion: 1,
    id: "acme-images",
    name: "Acme Images",
    version: "1.0.0",
    description: "A local stand-in for an image API.",
    models: [
      { id: "pixel-1", name: "Pixel 1", kind: "image", aspects: ["1:1", "16:9"], qualities: ["standard", "hd"], maxCount: 4, referenceImages: true },
      { id: "motion-1", name: "Motion 1", kind: "video", resolutions: ["720p"], aspects: ["16:9"], durations: [5], referenceAudio: true },
    ],
    config: [
      { key: "baseUrl", label: "API address", type: "url", required: true, default: baseUrl },
      { key: "apiKey", label: "API key", type: "secret", required: true },
    ],
    requests: {
      generate: {
        method: "POST",
        url: "{{config.baseUrl}}/v1/images",
        headers: { authorization: "Bearer {{config.apiKey}}" },
        body: { model: "{{model}}", prompt: "{{prompt}}", n: "{{count}}", aspect_ratio: "{{aspect}}", quality: "{{quality}}", references: "{{referenceImages}}" },
        answer: { taskId: "task.id", files: "data[].url", status: "status", error: "error.message" },
      },
      status: {
        method: "GET",
        url: "{{config.baseUrl}}/v1/tasks/{{taskId}}",
        headers: { authorization: "Bearer {{config.apiKey}}" },
        answer: { status: "state", progress: "percent", files: "output[].url", error: "error.message", pollAfterSeconds: "retry_after" },
      },
      cancel: {
        method: "POST",
        url: "{{config.baseUrl}}/v1/tasks/{{taskId}}/cancel",
        headers: { authorization: "Bearer {{config.apiKey}}" },
      },
    },
    statusMap: { running: ["processing"], succeeded: ["completed"] },
  };
}
