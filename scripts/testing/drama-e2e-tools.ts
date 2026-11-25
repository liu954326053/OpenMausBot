// Two loopback helpers for scripts/testing/drama-e2e.ts. A chat-completions engine has no shell of its own, so the run
// gives the project a terminal the way a person would: an MCP server with one `run_command` tool, added under Apps. And
// a recorder in front of the text model, so a step can show what each request carried. Neither writes a key down.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";

export interface TerminalCall {
  at: string;
  command: string;
  cwd: string;
  pid: number | null;
  exitCode: number | null;
  ms: number;
  output: string;
}

export interface Terminal {
  url: string;
  calls: TerminalCall[];
  close(): Promise<void>;
}

const RUN_COMMAND = {
  name: "run_command",
  description: "Run one shell command (/bin/sh -c) in the project's folder on this computer and answer with what it printed and its exit code. python3 is Python 3.12. Commands stop after timeout_seconds (default 900).",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command line." },
      cwd: { type: "string", description: "Full path of the folder to run in; the project's folder when left out." },
      timeout_seconds: { type: "integer", minimum: 1, maximum: 1800 },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

const readBody = (req: IncomingMessage) => new Promise<string>((done) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => { body += chunk; });
  req.on("end", () => done(body));
});

const listen = (server: Server) => new Promise<string>((done, fail) => {
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
});

const close = (server: Server) => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });

/** `root` bounds every cwd; `folder()` is the default one, read per call because the project is made after this starts.
 * `env` is the whole environment a command gets: nothing of the harness's own crosses unless it is named there. */
export async function startTerminal(options: { token: string; root: string; folder: () => string; env: Record<string, string>; log: string; secrets: string[] }): Promise<Terminal> {
  const calls: TerminalCall[] = [];
  const scrub = (text: string) => options.secrets.filter(Boolean).reduce((out, secret) => out.split(secret).join("sk-***"), text);
  const run = (command: string, cwd: string, timeoutMs: number) => new Promise<TerminalCall>((done) => {
    const started = Date.now();
    const child = spawn("/bin/sh", ["-c", command], { cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-200_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { output += `\n[stopped after ${timeoutMs / 1000} s]`; child.kill("SIGTERM"); }, timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ at: new Date(started).toISOString(), command: scrub(command), cwd, pid: child.pid ?? null, exitCode: code, ms: Date.now() - started, output: scrub(output) });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      done({ at: new Date(started).toISOString(), command: scrub(command), cwd, pid: null, exitCode: null, ms: Date.now() - started, output: error.message });
    });
  });
  const server = createServer((req, res) => {
    void (async () => {
      if ((req.url ?? "").split("?")[0] !== "/mcp") return res.writeHead(404).end();
      if (req.headers.authorization !== `Bearer ${options.token}`) return res.writeHead(401).end();
      if (req.method !== "POST") return res.writeHead(405).end();
      const frame = JSON.parse((await readBody(req)) || "{}") as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      const reply = (result: unknown) => res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "drama-terminal" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
      if (frame.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "terminal", version: "1" } });
      if (frame.method === "tools/list") return reply({ tools: [RUN_COMMAND] });
      if (frame.method === "tools/call" && frame.params?.name === RUN_COMMAND.name) {
        const args = frame.params.arguments ?? {};
        const command = typeof args.command === "string" ? args.command : "";
        if (!command.trim()) return reply({ content: [{ type: "text", text: "command is empty" }], isError: true });
        const cwd = resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : options.folder() || options.root);
        const inside = relative(options.root, cwd);
        if (inside.startsWith("..") || isAbsolute(inside)) {
          return reply({ content: [{ type: "text", text: `cwd must be inside ${options.root}` }], isError: true });
        }
        const seconds = Math.min(1800, Math.max(1, Number(args.timeout_seconds) || 900));
        const call = await run(command, cwd, seconds * 1000);
        calls.push(call);
        appendFileSync(options.log, `${JSON.stringify(call)}\n`);
        return reply({ content: [{ type: "text", text: `exit ${call.exitCode}\n${call.output.slice(-20_000)}` }], ...(call.exitCode === 0 ? {} : { isError: true }) });
      }
      if (frame.id === undefined) return res.writeHead(202).end();
      return res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: `Method not found: ${String(frame.method)}` } }));
    })().catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
  });
  const origin = await listen(server);
  return { url: `${origin}/mcp`, calls, close: () => close(server) };
}

export interface ModelRecorder {
  /** The base URL to give the server in place of the real one, ending in /v1. */
  url: string;
  close(): Promise<void>;
}

/** Forwards every request to `upstream` and appends one line per request to `log`: its path, its JSON body and the reply
 * as text. Headers are never written, so the key the server sends stays out of the file. */
export async function startModelRecorder(options: { upstream: string; log: string }): Promise<ModelRecorder> {
  const upstream = options.upstream.replace(/\/$/, "");
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").replace(/^\/v1/, "");
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const headers: Record<string, string> = {};
      for (const name of ["authorization", "content-type", "accept"]) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const started = Date.now();
      let answer: Response;
      try {
        answer = await fetch(upstream + path, { method: req.method, headers, body, signal: AbortSignal.timeout(900_000) });
      } catch (error) {
        res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `recorder could not reach the model: ${error instanceof Error ? error.message : String(error)}` } }));
        return;
      }
      res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/json" });
      let text = "";
      if (answer.body) {
        const reader = answer.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
          text += decoder.decode(value, { stream: true });
        }
      }
      res.end();
      let request: unknown = body;
      try { request = body ? JSON.parse(body) : null; } catch { /* kept as text */ }
      appendFileSync(options.log, `${JSON.stringify({ at: new Date(started).toISOString(), ms: Date.now() - started, path, status: answer.status, request, response: text.slice(0, 200_000) })}\n`);
    })().catch(() => { if (!res.headersSent) res.writeHead(500).end(); else res.end(); });
  });
  const origin = await listen(server);
  return { url: `${origin}/v1`, close: () => close(server) };
}
