// A python.org macOS build ships an empty OpenSSL trust store: .../Versions/<x.y>/etc/openssl is writable by the admin
// group but holds no cert.pem, so ssl.create_default_context() carries 0 CAs and every HTTPS call in Python fails with
// CERTIFICATE_VERIFY_FAILED. This probes that store, writes a known CA bundle into it when the folder allows, and
// otherwise points each bot's processes at a bundle through SSL_CERT_FILE. It never runs sudo: a repair that needs root
// is a repair the person did not ask this app to make.
import { spawn } from "node:child_process";
import { accessSync, appendFileSync, constants, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { rootCertificates } from "node:tls";

import { writeFileAtomic, writeFileAtomicIfChanged } from "./atomic.ts";
import { augmentedPath } from "./env-path.ts";

export type PythonTrustStatus = "ok" | "empty" | "unknown";

export interface PythonTrustProbe {
  status: PythonTrustStatus;
  /** x509 certificates in the context a program gets by default; null when the interpreter did not answer. */
  certificates: number | null;
  /** The file CPython loads as its trust store. */
  cafile: string | null;
  /** SSL_CERT_FILE as the interpreter saw it; it wins over the compiled-in store. */
  envCafile: string | null;
  reason: string | null;
}

export interface PythonTrustRepair {
  status: PythonTrustStatus;
  certificates: number | null;
  cafile: string | null;
  /** Where a bundle was written, when the store was repaired. */
  written: string | null;
  /** The bundle bot processes are pointed at, when one is known. */
  source: string | null;
  /** True when bot processes depend on the environment variable rather than a repaired store. */
  degraded: boolean;
  reason: string | null;
}

export interface PythonTrustOptions {
  /** Environment of the probe and its children (a fixture points SSL_CERT_FILE and SSL_CERT_DIR at a fake store). */
  env?: NodeJS.ProcessEnv;
  /** The store to write to; defaults to the interpreter's own. */
  target?: string;
  /** CA bundles to try, in order; defaults to certifi, the system, the framework, then Node's roots. */
  sources?: readonly string[];
  dataDir?: string;
  timeoutMs?: number;
}

const PROBE_SCRIPT = [
  "import json, os, ssl",
  "try:",
  " ctx = ssl.create_default_context()",
  " paths = ssl.get_default_verify_paths()",
  " print(json.dumps({'x509': int(ctx.cert_store_stats().get('x509', 0)), 'cafile': paths.cafile, 'env_cafile': os.environ.get('SSL_CERT_FILE') or None, 'openssl_cafile': paths.openssl_cafile}))",
  "except Exception:",
  " print(json.dumps({'error': 'probe-failed'}))",
].join("\n");

const COUNT_SCRIPT = [
  "import json, ssl, sys",
  "try:",
  " ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)",
  " ctx.load_verify_locations(cafile=sys.argv[1])",
  " print(json.dumps({'x509': int(ctx.cert_store_stats().get('x509', 0))}))",
  "except Exception:",
  " print(json.dumps({'x509': 0}))",
].join("\n");

const DEFAULT_TIMEOUT_MS = 10_000;

/** The same PATH a bot's shell gets (env-path.ts), so the probe reads the interpreter a bot would run. */
function probeEnv(options: PythonTrustOptions): NodeJS.ProcessEnv {
  return options.env ?? { ...process.env, PATH: augmentedPath() };
}

function pathText(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function answerJson(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function ask(interpreter: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; error: string | null }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: { code: number | null; stdout: string; error: string | null }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(interpreter, args, { env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch (error) {
      finish({ code: null, stdout: "", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* it exited meanwhile */ }
      finish({ code: null, stdout: "", error: `the interpreter took longer than ${timeoutMs} ms` });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { if (stdout.length < 4_096) stdout += chunk.slice(0, 4_096 - stdout.length); });
    child.once("error", (error: NodeJS.ErrnoException) => finish({ code: null, stdout: "", error: error.code ?? error.message }));
    child.once("close", (code) => finish({ code, stdout, error: null }));
  });
}

/** No network: one short Python process reads the interpreter's default trust paths and counts what they load. */
export async function pythonTrustStatus(interpreter: string, options: PythonTrustOptions = {}): Promise<PythonTrustProbe> {
  const probe = await ask(interpreter, ["-c", PROBE_SCRIPT], probeEnv(options), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parsed = answerJson(probe.stdout);
  if (probe.code !== 0 || !parsed || parsed.error !== undefined || typeof parsed.x509 !== "number") {
    return { status: "unknown", certificates: null, cafile: null, envCafile: null, reason: probe.error ?? "the interpreter did not report its trust store" };
  }
  const envCafile = pathText(parsed.env_cafile);
  const cafile = envCafile ?? pathText(parsed.cafile) ?? pathText(parsed.openssl_cafile);
  return { status: parsed.x509 > 0 ? "ok" : "empty", certificates: parsed.x509, cafile, envCafile, reason: null };
}

/** How many certificates a context loading exactly this file holds. */
export async function certificatesIn(interpreter: string, cafile: string, options: PythonTrustOptions = {}): Promise<number> {
  const counted = await ask(interpreter, ["-c", COUNT_SCRIPT, cafile], probeEnv(options), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parsed = answerJson(counted.stdout);
  return counted.code === 0 && parsed && typeof parsed.x509 === "number" ? parsed.x509 : 0;
}

/** `bin/../etc/openssl` of the interpreter's own installation. */
function opensslDir(interpreter: string): string {
  return join(dirname(interpreter), "..", "etc", "openssl");
}

function sized(path: string | null): string | null {
  if (!path) return null;
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Node's roots, written once so a Python process with no usable store still has a bundle to point at. */
export function nodeCaBundle(): string {
  const path = join(tmpdir(), "omb-python-ca", "node-roots.pem");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomicIfChanged(path, `${rootCertificates.join("\n")}\n`, { mode: 0o600 });
  return path;
}

function certifiBundle(interpreter: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string | null> {
  return ask(interpreter, ["-c", "import certifi; print(certifi.where())"], env, timeoutMs)
    .then((found) => (found.code === 0 ? sized(found.stdout.trim()) : null));
}

/** The bundles beside this interpreter: a framework keeps one per installed version. */
function frameworkBundles(interpreter: string): string[] {
  const versions = join(dirname(interpreter), "..", "..");
  if (basename(versions) !== "Versions") return [];
  try {
    return readdirSync(versions).sort().reverse().map((version) => join(versions, version, "etc", "openssl", "cert.pem"));
  } catch {
    return [];
  }
}

async function caSource(interpreter: string, options: PythonTrustOptions): Promise<string | null> {
  if (options.sources) {
    for (const candidate of options.sources) if (sized(candidate)) return candidate;
    return null;
  }
  return (await certifiBundle(interpreter, probeEnv(options), options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    ?? sized("/etc/ssl/cert.pem")
    ?? frameworkBundles(interpreter).map((candidate) => sized(candidate)).find((candidate) => candidate !== null)
    ?? nodeCaBundle();
}

function writable(folder: string): boolean {
  try {
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function record(dataDir: string | undefined, interpreter: string, repair: PythonTrustRepair): void {
  const at = new Date().toISOString();
  const row = {
    at, interpreter, status: repair.status, certificates: repair.certificates,
    cafile: repair.cafile, written: repair.written, source: repair.source, degraded: repair.degraded, reason: repair.reason,
  };
  const dir = dataDir ?? process.env.OMB_DATA_DIR;
  if (dir) {
    try {
      mkdirSync(join(dir, "logs"), { recursive: true, mode: 0o700 });
      appendFileSync(join(dir, "logs", "python-trust.log"), `${at} ${JSON.stringify(row)}\n`, { mode: 0o600 });
    } catch { /* the line below still reaches the server log */ }
  }
  const counts = repair.certificates === null ? "" : `, ${repair.certificates} CAs`;
  const outcome = repair.written ? `wrote ${repair.source} to ${repair.written}` : repair.degraded ? "bot processes use SSL_CERT_FILE instead" : "the store is already usable";
  const line = `[python-trust] ${interpreter}: ${repair.status}${counts}; ${outcome}${repair.reason ? `; ${repair.reason}` : ""}`;
  if (repair.status === "ok" && !repair.written) console.log(line);
  else console.warn(line);
}

const repairs = new Map<string, Promise<PythonTrustRepair>>();

function restore(target: string, original: Buffer | null, mode = 0o644): void {
  try {
    if (original) writeFileAtomic(target, original, { mode });
    else unlinkSync(target);
  } catch { /* the bundle written a moment ago is still readable */ }
}

/** Probes the interpreter's store and, when it holds no CA, writes a known bundle into it if the folder allows,
 * verifying the result and rolling back a write that did not help. Never throws: a failed repair degrades to the
 * environment variable, and the caller keeps working. */
export async function repairPythonTrust(interpreter: string, options: PythonTrustOptions = {}): Promise<PythonTrustRepair> {
  const probe = await pythonTrustStatus(interpreter, options);
  const own = opensslDir(interpreter);
  const elsewhere = probe.envCafile && dirname(probe.envCafile) !== own ? probe.envCafile : null;
  const target = options.target ?? (probe.cafile && dirname(probe.cafile) === own ? probe.cafile : join(own, "cert.pem"));
  const key = `${interpreter}\0${target}\0${options.dataDir ?? process.env.OMB_DATA_DIR ?? ""}`;
  if (probe.status === "ok") {
    const usable: PythonTrustRepair = {
      status: probe.status, certificates: probe.certificates, cafile: probe.cafile,
      written: null, source: sized(probe.cafile), degraded: false, reason: null,
    };
    record(options.dataDir, interpreter, usable);
    return usable;
  }
  const started = repairs.get(key);
  if (started) return started;
  const work = (async (): Promise<PythonTrustRepair> => {
    const base = { status: probe.status, certificates: probe.certificates, cafile: probe.cafile };
    if (elsewhere) {
      const repair: PythonTrustRepair = {
        ...base, written: null, source: elsewhere, degraded: true,
        reason: "SSL_CERT_FILE names another bundle, which this repair leaves alone",
      };
      record(options.dataDir, interpreter, repair);
      return repair;
    }
    let source: string | null;
    try { source = await caSource(interpreter, options); } catch { source = null; }
    if (!source) {
      const repair: PythonTrustRepair = { ...base, written: null, source: null, degraded: true, reason: "no CA bundle is available on this computer" };
      record(options.dataDir, interpreter, repair);
      return repair;
    }
    if (probe.status === "unknown" || !writable(dirname(target))) {
      const repair: PythonTrustRepair = {
        ...base, written: null, source, degraded: true,
        reason: probe.status === "unknown" ? probe.reason : `${dirname(target)} cannot be written without an administrator`,
      };
      record(options.dataDir, interpreter, repair);
      return repair;
    }
    let original: Buffer | null = null;
    let mode = 0o644;
    try { original = readFileSync(target); mode = statSync(target).mode & 0o777; } catch { /* a store with no cert.pem */ }
    try {
      writeFileAtomic(target, readFileSync(source), { mode: original ? mode : 0o644 });
      const certificates = await certificatesIn(interpreter, target, options);
      if (certificates <= 0) throw new Error("the written bundle holds no certificate");
      const repair: PythonTrustRepair = { ...base, certificates, written: target, source: target, degraded: false, reason: null };
      record(options.dataDir, interpreter, repair);
      return repair;
    } catch (error) {
      restore(target, original, mode);
      const repair: PythonTrustRepair = {
        ...base, written: null, source, degraded: true,
        reason: `the store could not be repaired: ${error instanceof Error ? error.message : String(error)}`,
      };
      record(options.dataDir, interpreter, repair);
      return repair;
    }
  })();
  repairs.set(key, work);
  return work;
}

export function defaultPythonInterpreter(): string {
  return process.platform === "win32" ? "python" : "python3";
}

let priming: Promise<PythonTrustRepair> | null = null;
let ready: string | null = null;

/** Repairs the default interpreter once per process, in the background, so no spawned bot waits on it. */
export function primePythonTrust(dataDir?: string): Promise<PythonTrustRepair> {
  priming ??= repairPythonTrust(defaultPythonInterpreter(), { dataDir })
    .then((repair) => {
      ready = repair.written ?? repair.source ?? sized(repair.cafile) ?? nodeCaBundle();
      return repair;
    })
    .catch((error: unknown) => {
      const repair: PythonTrustRepair = {
        status: "unknown", certificates: null, cafile: null, written: null, source: null, degraded: true,
        reason: error instanceof Error ? error.message : String(error),
      };
      record(dataDir, defaultPythonInterpreter(), repair);
      return repair;
    });
  return priming;
}

/** A bot's environment with a CA bundle Python, requests and curl read, unless the person set those names already.
 * Never throws: a bundle that cannot be written leaves the environment as it was. */
export function withPythonTrustEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  let bundle = ready;
  if (!bundle) {
    try { bundle = nodeCaBundle(); } catch { return env; }
  }
  const next = { ...env };
  if (!next.SSL_CERT_FILE) next.SSL_CERT_FILE = bundle;
  if (!next.REQUESTS_CA_BUNDLE) next.REQUESTS_CA_BUNDLE = bundle;
  return next;
}
