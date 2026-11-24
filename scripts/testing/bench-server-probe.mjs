// Loaded with --import into a fixture server that scripts/bench-many-bots.ts starts, never into the app: it times each
// request on the server's side and the calls of a few methods, tallies file writes, and on SIGUSR2 writes what it saw
// since the signal before, with CPU, memory and event-loop delay, to bench-probe.json in the fixture's data folder.
import fs from "node:fs";
import http from "node:http";
import module from "node:module";
import { basename, dirname, join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const out = join(process.env.OMB_DATA_DIR ?? ".", "bench-probe.json");
const { openSync, closeSync, writeFileSync, writeSync, renameSync } = fs;

let routes = new Map();
let methods = new Map();
let writes = new Map();
const record = (table, key, ms) => {
  const entry = table.get(key) ?? { calls: 0, totalMs: 0, samples: [] };
  entry.calls += 1;
  entry.totalMs += ms;
  if (entry.samples.length < 2_000) entry.samples.push(Math.round(ms * 1000) / 1000);
  table.set(key, entry);
};

const ID = /^(?=.*\d)[\w-]{8,}$/;
const routeKey = (method, url = "") => {
  const [path, query = ""] = url.split("?");
  const shape = path.split("/").map((part) => (ID.test(part) ? ":id" : part)).join("/");
  const messages = new URLSearchParams(query).get("messages");
  return `${method} ${shape}${messages === null ? "" : `?messages=${messages}`}`;
};
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, request, response) {
  if (event === "request" && !String(request.url).startsWith("/api/events")) {
    const at = performance.now();
    const key = routeKey(request.method, request.url);
    response.once("finish", () => record(routes, key, performance.now() - at));
  }
  return emit.apply(this, arguments);
};

const fdPaths = new Map();
const fileKey = (path) => {
  const name = basename(String(path)).replace(/\.\d+\.[0-9a-f-]{36}\.tmp$/, "").replace(/\.tmp$/, "").replace(/^[0-9a-f-]{36}(?=\.)/, "<id>");
  return name.startsWith("<id>") ? `${basename(dirname(String(path)))}/${name}` : name;
};
const tallyWrite = (target, data) => {
  const path = typeof target === "number" ? fdPaths.get(target) : target;
  if (path === undefined) return;
  const entry = writes.get(fileKey(path)) ?? { calls: 0, bytes: 0, renames: 0 };
  entry.calls += 1;
  entry.bytes += typeof data === "string" ? Buffer.byteLength(data) : data?.byteLength ?? 0;
  writes.set(fileKey(path), entry);
};
fs.openSync = function (path, ...rest) { const fd = openSync.call(this, path, ...rest); fdPaths.set(fd, String(path)); return fd; };
fs.closeSync = function (fd) { fdPaths.delete(fd); return closeSync.call(this, fd); };
fs.writeFileSync = function (target, data, ...rest) { tallyWrite(target, data); return writeFileSync.call(this, target, data, ...rest); };
fs.writeSync = function (fd, data, ...rest) { tallyWrite(fd, data); return writeSync.call(this, fd, data, ...rest); };
fs.renameSync = function (from, to, ...rest) {
  const entry = writes.get(fileKey(to));
  if (entry) entry.renames += 1;
  return renameSync.call(this, from, to, ...rest);
};
module.syncBuiltinESMExports();

const timed = (label, original) => function (...args) {
  const at = performance.now();
  const result = original.apply(this, args);
  if (result instanceof Promise) return result.finally(() => record(methods, label, performance.now() - at));
  record(methods, label, performance.now() - at);
  return result;
};
const wrap = async (file, className, names) => {
  const loaded = await import(new URL(`../../server/${file}`, import.meta.url).href);
  const prototype = loaded[className]?.prototype;
  for (const name of names) {
    if (typeof prototype?.[name] !== "function") throw new Error(`bench probe: ${className}.${name} is not a method any more`);
    prototype[name] = timed(`${className}.${name}`, prototype[name]);
  }
};
await wrap("team-projects/service.ts", "TeamProjects", ["list", "episodeBot"]);
await wrap("project-canvas/service.ts", "ProjectCanvasService", ["snapshot", "document"]);
await wrap("project-canvas/document-store.ts", "CanvasDocuments", ["read"]);
await wrap("production/engine.ts", "Productions", ["advance", "wire", "shots"]);
await wrap("store.ts", "Store", ["saveBots"]);
await wrap("registry-store.ts", "JsonRegistry", ["writeBots"]);

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let cpuBefore = process.cpuUsage();
const summary = (table) => Object.fromEntries([...table].map(([key, { calls, totalMs, samples }]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return [key, { calls, totalMs: Math.round(totalMs * 100) / 100, medianMs: sorted[Math.floor(sorted.length / 2)] ?? null, maxMs: sorted.at(-1) ?? null, samples }];
}));
process.on("SIGUSR2", () => {
  const cpu = process.cpuUsage(cpuBefore);
  writeFileSync(out, JSON.stringify({
    at: Date.now(),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    memory: process.memoryUsage(),
    loopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 },
    routes: summary(routes),
    methods: summary(methods),
    writes: Object.fromEntries(writes),
  }));
  routes = new Map();
  methods = new Map();
  writes = new Map();
  loop.reset();
  cpuBefore = process.cpuUsage();
});
