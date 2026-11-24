// A real fake-engine server in a temporary home that can be stopped and started again on the same data and port, so a
// test can prove what survives a restart. Same environment as control-omb's launch: no user data, no developer CLIs.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verificationServerArgs, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./cleanup.ts";
import { freePortBlock } from "./ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface RestartableServer {
  url: string;
  port: number;
  dataDir: string;
  logPath: string;
  /** The scripted engine's plan file (`room-plan.json`), present when launched with `scripted`. */
  planPath: string;
  /** The webhook receiver's base URL. */
  hooksUrl: string;
  stop(): Promise<void>;
  start(): Promise<void>;
  /** Stop and delete the temporary home. */
  close(): Promise<void>;
}

export async function healthAnswerer(url: string, ownPid: number | undefined): Promise<"nobody" | "ours" | "theirs"> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return "nobody";
  }
  const body = await response.json().catch(() => null) as { app?: unknown; pid?: unknown } | null;
  return ownPid !== undefined && response.ok && body?.app === "openmausbot" && body.pid === ownPid ? "ours" : "theirs";
}

export async function webhookPortRefusal(url: string, webhookPort: number, headers: Record<string, string> = {}): Promise<string | null> {
  const response = await fetch(`${url}/api/webhooks`, { headers, signal: AbortSignal.timeout(5_000) });
  const body = await response.json().catch(() => null) as { ingress?: { available?: unknown; error?: unknown } } | null;
  if (response.ok && body?.ingress?.available === true) return null;
  const reason = typeof body?.ingress?.error === "string" ? body.ingress.error : `GET /api/webhooks answered ${response.status}`;
  return reason.includes("EADDRINUSE")
    ? `webhook port ${webhookPort} is taken by another process: the server's own webhook receiver could not listen there (${reason})`
    : `the server's webhook receiver is not listening on port ${webhookPort}: ${reason}`;
}

export async function launchRestartableServer(options: { scripted?: boolean; dataDirRoot?: string; nodeArgs?: readonly string[] } = {}): Promise<RestartableServer> {
  const port = await freePortBlock([0, 1]);
  // Native browser daemons use UNIX sockets, and a macOS temp home can exceed their path limit.
  const dataDir = mkdtempSync(join(options.dataDirRoot ?? tmpdir(), "omb-restartable-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  const planPath = join(dataDir, "room-plan.json");
  if (options.scripted) writeFileSync(planPath, "{}");
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ language: "en", instances: { claude: {
    driver: "claudeAgent", displayName: "Verification fixture", config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") },
    ...(options.scripted ? { environment: { FAKE_CLAUDE_ROOM_PLAN: planPath } } : {}),
  } } }, null, 2));
  // Kept after close, for a failed run's evidence.
  const evidenceDir = join(tmpdir(), "openmausbot-verification-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const logPath = join(evidenceDir, `restartable-${Date.now()}-${process.pid}.log`);
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;

  const start = async () => {
    const env = verificationServerEnvironment(process.env, dataDir, port);
    const log = openSync(logPath, "a", 0o600);
    const spawned = spawn(process.execPath, [...(options.nodeArgs ?? []), ...verificationServerArgs(env)], { cwd: ROOT, env, stdio: ["ignore", log, log] });
    child = spawned;
    closeSync(log);
    const deadline = Date.now() + 30_000;
    for (;;) {
      const answerer = await healthAnswerer(url, spawned.pid);
      if (answerer === "ours") return;
      if (answerer === "theirs") {
        await stop();
        throw new Error(`port ${port} is taken by another process: it answers /api/health there, not this server (pid ${spawned.pid}); see ${logPath}`);
      }
      if (spawned.exitCode !== null) throw new Error(`the server exited before it was ready; see ${logPath}`);
      if (Date.now() > deadline) throw new Error(`the server did not become ready; see ${logPath}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  const stop = async () => {
    await waitForExit(child, { signal: "SIGTERM", graceMs: 15_000 });
    child = undefined;
  };
  await start();
  return {
    url, port, dataDir, logPath, planPath, hooksUrl: `http://127.0.0.1:${port + 1}`,
    start, stop,
    close: async () => { await stop(); await removeTempDir(dataDir); },
  };
}
