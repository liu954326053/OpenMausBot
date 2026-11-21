#!/usr/bin/env node
// A generation MCP server for tests, following docs/project-generation-mcp.md over streamable HTTP on loopback. It lists
// image and video models with different offers and makes small real PNG and MP4 files after a short delay. Run on its own
// (`node fake-generation-mcp-server.ts [--key K] [--task-ms N]`) it prints `{"url":…}` and serves until stopped.
// A prompt steers it:
//   [hold]             the task stays running until POST /control/release
//   [fail:<reason>]    the task fails on the server with that reason
//   [refuse:<reason>]  the generate call answers isError with that reason
//   [task]             an image generation answers a task id instead of its files
//   [inline]           results come as base64 data instead of a URL
//   [image-block]      an image generation answers MCP image content blocks only
// `{authorization}` in a reason becomes the Authorization header the server received, as a careless server echoes it.
// GET /control/calls lists every tools/call with its arguments, reference data replaced by its size and sha256.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

export interface FakeGenerationMcpOptions {
  /** Require `Authorization: Bearer <key>` on every MCP request. */
  key?: string;
  /** How long a task takes to succeed. */
  taskMs?: number;
  /** Leave these tools out of tools/list. */
  without?: string[];
}

export interface FakeGenerationCall {
  tool: string;
  arguments: Record<string, unknown>;
  at: number;
}

interface FakeTask {
  id: string;
  tool: string;
  prompt: string;
  createdAt: number;
  files: Array<{ name: string; mimeType: string }>;
  inline: boolean;
  hold: boolean;
  fail?: string;
  cancelled: boolean;
}

export const FAKE_GENERATION_MODELS = [
  { id: "pixel-1", name: "Pixel 1", kind: "image", aspects: ["1:1", "16:9", "9:16"], qualities: ["standard", "hd"], maxCount: 4, referenceImages: true, referenceAudio: false },
  { id: "sketch", name: "Sketch", kind: "image", referenceImages: false, referenceAudio: false },
  { id: "motion-1", name: "Motion 1", kind: "video", resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], durations: [5, 10], referenceImages: true, referenceAudio: true },
  { id: "motion-lite", name: "Motion Lite", kind: "video", resolutions: ["480p"], aspects: ["16:9"], durations: [4], referenceImages: false, referenceAudio: false },
] as const;

const SAMPLE_VIDEO = readFileSync(fileURLToPath(new URL("./fixtures/generation-sample.mp4", import.meta.url)));

const referenceSchema = {
  type: "array",
  items: { type: "object", properties: { name: { type: "string" }, mimeType: { type: "string" }, data: { type: "string", description: "base64" } }, required: ["mimeType", "data"] },
};

const TOOLS = [
  { name: "list_models", description: "List the image and video models and what each offers.", inputSchema: { type: "object", properties: {} } },
  {
    name: "generate_image",
    description: "Make pictures from a prompt.",
    inputSchema: {
      type: "object",
      properties: { model: { type: "string" }, prompt: { type: "string" }, referenceImages: referenceSchema, aspect: { type: "string" }, quality: { type: "string" }, count: { type: "integer" } },
      required: ["model", "prompt"],
    },
  },
  {
    name: "generate_video",
    description: "Start a video from a prompt.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" }, prompt: { type: "string" }, referenceImages: referenceSchema, referenceAudio: referenceSchema,
        resolution: { type: "string" }, aspect: { type: "string" }, seconds: { type: "number" },
      },
      required: ["model", "prompt"],
    },
  },
  { name: "task_status", description: "Where a task is.", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] } },
  { name: "cancel_task", description: "Cancel a task.", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] } },
];

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A real RGB PNG of the aspect's shape, tinted by `seed` so two results differ. */
export function fakePng(aspect: string, seed: number): Buffer {
  const [w, h] = aspect.split(":").map(Number);
  const ratio = w && h ? w / h : 1;
  const width = ratio >= 1 ? 48 : Math.max(1, Math.round(48 * ratio));
  const height = ratio >= 1 ? Math.max(1, Math.round(48 / ratio)) : 48;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = (x * 5 + seed * 40) & 255;
      row[2 + x * 3] = (y * 5 + seed * 70) & 255;
      row[3 + x * 3] = (seed * 90) & 255;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const marker = (prompt: string, name: string): string | undefined => {
  const found = new RegExp(`\\[${name}(?::([^\\]]*))?\\]`).exec(prompt);
  return found ? found[1] ?? "" : undefined;
};

const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  const parts: Buffer[] = [];
  req.on("data", (part: Buffer) => parts.push(part));
  req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  req.on("error", reject);
});

function recorded(args: Record<string, unknown>): Record<string, unknown> {
  const summarize = (list: unknown) => Array.isArray(list)
    ? list.map((item) => {
      const { data, ...rest } = (item ?? {}) as { data?: unknown };
      const bytes = typeof data === "string" ? Buffer.from(data, "base64") : Buffer.alloc(0);
      return { ...rest, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    })
    : list;
  return {
    ...args,
    ...("referenceImages" in args ? { referenceImages: summarize(args.referenceImages) } : {}),
    ...("referenceAudio" in args ? { referenceAudio: summarize(args.referenceAudio) } : {}),
  };
}

export async function startFakeGenerationMcp(options: FakeGenerationMcpOptions = {}) {
  const taskMs = options.taskMs ?? 1500;
  const calls: FakeGenerationCall[] = [];
  const tasks = new Map<string, FakeTask>();
  const files = new Map<string, { mimeType: string; bytes: Buffer }>();
  const tools = TOOLS.filter((tool) => !options.without?.includes(tool.name));
  let origin = "";

  const answer = (value: Record<string, unknown>) => ({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] });
  const refuse = (text: string) => ({ isError: true, content: [{ type: "text", text }] });
  const makeFile = (kind: "image" | "video", aspect: string) => {
    const name = `${randomUUID().slice(0, 8)}.${kind === "image" ? "png" : "mp4"}`;
    files.set(name, kind === "image" ? { mimeType: "image/png", bytes: fakePng(aspect, files.size + 1) } : { mimeType: "video/mp4", bytes: SAMPLE_VIDEO });
    return { name, mimeType: kind === "image" ? "image/png" : "video/mp4" };
  };
  const releaseHeld = () => {
    let released = 0;
    for (const task of tasks.values()) {
      if (!task.hold) continue;
      task.hold = false;
      task.createdAt = Date.now() - taskMs;
      released += 1;
    }
    return released;
  };
  const resultFiles = (list: FakeTask["files"], inline: boolean) => list.map((file) => inline
    ? { name: file.name, mimeType: file.mimeType, data: files.get(file.name)!.bytes.toString("base64") }
    : { name: file.name, mimeType: file.mimeType, url: `${origin}/files/${file.name}` });
  const statusOf = (task: FakeTask) => {
    const elapsed = Date.now() - task.createdAt;
    if (task.cancelled) return { taskId: task.id, status: "cancelled" };
    if (task.fail !== undefined && elapsed >= taskMs / 2) return { taskId: task.id, status: "failed", error: task.fail };
    if (task.hold) return { taskId: task.id, status: "running", progress: 0.5, pollAfterMs: 500 };
    if (elapsed < taskMs / 5) return { taskId: task.id, status: "queued", pollAfterMs: 500 };
    if (elapsed < taskMs) return { taskId: task.id, status: "running", progress: Math.round((elapsed / taskMs) * 100) / 100, pollAfterMs: 500 };
    return { taskId: task.id, status: "succeeded", files: resultFiles(task.files, task.inline) };
  };
  const offered = (model: (typeof FAKE_GENERATION_MODELS)[number], key: "aspects" | "qualities" | "resolutions" | "durations", value: unknown) => {
    const list = (model as Partial<Record<typeof key, readonly unknown[]>>)[key];
    return !list || list.includes(value);
  };

  const call = async (tool: string, args: Record<string, unknown>, authorization: string) => {
    if (!tools.some((listed) => listed.name === tool)) return null;
    const reason = (prompt: string, name: string) => marker(prompt, name)?.replaceAll("{authorization}", authorization);
    calls.push({ tool, arguments: recorded(args), at: Date.now() });
    if (tool === "list_models") return answer({ models: FAKE_GENERATION_MODELS });
    if (tool === "task_status" || tool === "cancel_task") {
      const task = tasks.get(String(args.taskId));
      if (!task) return refuse(`No task ${String(args.taskId)}`);
      if (tool === "cancel_task") task.cancelled = true;
      return answer(statusOf(task));
    }
    const kind = tool === "generate_image" ? "image" : "video";
    const prompt = String(args.prompt ?? "");
    const model = FAKE_GENERATION_MODELS.find((candidate) => candidate.id === args.model && candidate.kind === kind);
    if (!model) return refuse(`Unknown ${kind} model ${String(args.model)}`);
    const refused = reason(prompt, "refuse");
    if (refused !== undefined) return refuse(refused || "Refused");
    for (const [key, value] of kind === "image" ? [["aspects", args.aspect], ["qualities", args.quality]] as const : [["resolutions", args.resolution], ["aspects", args.aspect], ["durations", args.seconds]] as const) {
      if (!offered(model, key, value)) return refuse(`${model.id} does not offer ${String(value)}`);
    }
    const aspect = typeof args.aspect === "string" ? args.aspect : "1:1";
    const count = kind === "image" ? Math.max(1, Number(args.count) || 1) : 1;
    const results = Array.from({ length: count }, () => makeFile(kind, aspect));
    const inline = marker(prompt, "inline") !== undefined;
    if (kind === "image" && marker(prompt, "task") === undefined) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(300, taskMs / 4)));
      if (marker(prompt, "image-block") !== undefined) {
        return { content: results.map((file) => ({ type: "image", mimeType: file.mimeType, data: files.get(file.name)!.bytes.toString("base64") })) };
      }
      return answer({ files: resultFiles(results, inline) });
    }
    const task: FakeTask = {
      id: `task-${randomUUID()}`, tool, prompt, createdAt: Date.now(), files: results, inline,
      hold: marker(prompt, "hold") !== undefined, fail: reason(prompt, "fail"), cancelled: false,
    };
    tasks.set(task.id, task);
    return answer({ taskId: task.id, status: "queued" });
  };

  const control = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (path === "/control/calls") return send(200, { calls });
    if (path === "/control/tasks") return send(200, { tasks: [...tasks.values()].map((task) => ({ ...task, ...statusOf(task) })) });
    if (path === "/control/release" && req.method === "POST") return send(200, { released: releaseHeld() });
    return send(404, { error: "Not found" });
  };

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0]!;
      if (path.startsWith("/control/")) return control(req, res, path);
      if (path.startsWith("/files/") && req.method === "GET") {
        const file = files.get(path.slice("/files/".length));
        if (!file) return res.writeHead(404).end();
        return res.writeHead(200, { "content-type": file.mimeType, "content-length": file.bytes.length }).end(file.bytes);
      }
      if (path !== "/mcp") return res.writeHead(404).end();
      if (options.key && req.headers.authorization !== `Bearer ${options.key}`) {
        return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      }
      if (req.method !== "POST") return res.writeHead(405).end();
      const frame = JSON.parse((await readBody(req)) || "{}") as { id?: unknown; method?: string; params?: { name?: unknown; arguments?: unknown } };
      const reply = (result: unknown) => res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fake-generation" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
      if (frame.method === "initialize") {
        return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-generation-mcp", version: "1" } });
      }
      if (frame.method === "tools/list") return reply({ tools });
      if (frame.method === "tools/call") {
        const args = frame.params?.arguments && typeof frame.params.arguments === "object" ? frame.params.arguments as Record<string, unknown> : {};
        const result = await call(String(frame.params?.name), args, req.headers.authorization ?? "");
        if (result) return reply(result);
        return res.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32602, message: `Unknown tool ${String(frame.params?.name)}` } }));
      }
      if (frame.id === undefined) return res.writeHead(202).end();
      return res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: `Method not found: ${String(frame.method)}` } }));
    })().catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${origin}/mcp`,
    origin,
    calls,
    tasks,
    release: releaseHeld,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flag = (name: string) => {
    const at = process.argv.indexOf(`--${name}`);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  const fake = await startFakeGenerationMcp({ key: flag("key"), taskMs: flag("task-ms") ? Number(flag("task-ms")) : undefined });
  process.stdout.write(`${JSON.stringify({ url: fake.url, origin: fake.origin })}\n`);
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void fake.close().then(() => process.exit(0)));
}
