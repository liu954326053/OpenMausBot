import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";

import { certificatesIn, nodeCaBundle, pythonTrustStatus, repairPythonTrust, withPythonTrustEnv } from "./python-trust.ts";
import { killCliTree, spawnCli } from "./procs.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

/** The real interpreter behind a fixture's `bin/python3`, or null where this computer has none. */
const REAL_PYTHON = (() => {
  try {
    const found = execFileSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
})();

const CERT = `${rootCertificates[0]}\n`;

/** A fake installation: `bin/python3` is a wrapper that points the real interpreter at `etc/openssl`, the layout a
 * python.org macOS build has. */
function installation(certPem?: string): { root: string; python: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), "omb-python-trust-"));
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "etc", "openssl", "certs"), { recursive: true });
  const store = join(root, "etc", "openssl", "cert.pem");
  if (certPem !== undefined) writeFileSync(store, certPem);
  const python = join(root, "bin", "python3");
  writeFileSync(python, [
    "#!/bin/sh",
    'root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)',
    `SSL_CERT_FILE="$root/etc/openssl/cert.pem" SSL_CERT_DIR="$root/etc/openssl/certs" exec '${REAL_PYTHON}' "$@"`,
    "",
  ].join("\n"), { mode: 0o755 });
  return { root, python, store };
}

function bundle(content = CERT): string {
  const path = join(mkdtempSync(join(tmpdir(), "omb-ca-bundle-")), "ca.pem");
  writeFileSync(path, content);
  return path;
}

describe.skipIf(REAL_PYTHON === null)("python trust store", () => {
  it("reads an installation with no cert.pem as zero CAs", async () => {
    const { python, store } = installation();
    const probe = await pythonTrustStatus(python);
    expect(probe.status).toBe("empty");
    expect(probe.certificates).toBe(0);
    expect(probe.cafile).toBe(store);
  }, hostTimeout(20_000));

  it("counts the store it finds, so a working installation is left alone", async () => {
    const { python, store } = installation(CERT);
    const probe = await pythonTrustStatus(python);
    expect(probe.status).toBe("ok");
    expect(probe.certificates).toBe(1);
    const before = statSync(store).mtimeMs;
    const repair = await repairPythonTrust(python, { sources: [bundle()] });
    expect(repair.written).toBeNull();
    expect(repair.degraded).toBe(false);
    expect(statSync(store).mtimeMs).toBe(before);
  }, hostTimeout(20_000));

  it("writes a bundle into a writable store and verifies it", async () => {
    const { python, store } = installation();
    const repair = await repairPythonTrust(python, { sources: [bundle()] });
    expect(repair.status).toBe("empty");
    expect(repair.written).toBe(store);
    expect(repair.source).toBe(store);
    expect(repair.degraded).toBe(false);
    expect(await certificatesIn(python, store)).toBe(1);
    expect((await pythonTrustStatus(python)).certificates).toBe(1);
  }, hostTimeout(20_000));

  it("does not write twice, and reports the same answer", async () => {
    const { python, store } = installation();
    const first = await repairPythonTrust(python, { sources: [bundle()] });
    expect(first.written).toBe(store);
    const written = statSync(store).mtimeMs;
    const second = await repairPythonTrust(python, { sources: [bundle()] });
    expect(second.written).toBeNull();
    expect(statSync(store).mtimeMs).toBe(written);
    expect(second.certificates).toBe(1);
  }, hostTimeout(20_000));

  it("degrades to the environment variable on a folder it may not write, without failing", async () => {
    const { root, python } = installation();
    const folder = join(root, "etc", "openssl");
    const source = bundle();
    chmodSync(folder, 0o555);
    try {
      const repair = await repairPythonTrust(python, { sources: [source] });
      expect(repair.written).toBeNull();
      expect(repair.degraded).toBe(true);
      expect(repair.source).toBe(source);
      expect(repair.reason).toContain("cannot be written without an administrator");
      expect(existsSync(join(folder, "cert.pem"))).toBe(false);
    } finally {
      chmodSync(folder, 0o755);
    }
  }, hostTimeout(20_000));

  it("rolls back a bundle that holds no certificate", async () => {
    const { python, store } = installation("not a certificate\n");
    const repair = await repairPythonTrust(python, { sources: [bundle("still not a certificate\n")] });
    expect(repair.degraded).toBe(true);
    expect(repair.written).toBeNull();
    expect(repair.reason).toContain("could not be repaired");
    expect(readFileSync(store, "utf8")).toBe("not a certificate\n");
  }, hostTimeout(20_000));

  it("answers unknown, and never throws, for an interpreter that is not there", async () => {
    const missing = join(mkdtempSync(join(tmpdir(), "omb-python-trust-")), "python3");
    expect(await pythonTrustStatus(missing)).toMatchObject({ status: "unknown", certificates: null });
    const repair = await repairPythonTrust(missing, { sources: [bundle()] });
    expect(repair.status).toBe("unknown");
    expect(repair.written).toBeNull();
    expect(repair.degraded).toBe(true);
  }, hostTimeout(20_000));
});

describe("the environment bots run with", () => {
  it("points Python, requests and curl at a bundle, and keeps the person's own values", () => {
    const injected = withPythonTrustEnv({ PATH: "/usr/bin" });
    expect(injected.SSL_CERT_FILE).toBeTruthy();
    expect(injected.REQUESTS_CA_BUNDLE).toBe(injected.SSL_CERT_FILE);
    expect(statSync(injected.REQUESTS_CA_BUNDLE!).size).toBeGreaterThan(0);

    const kept = withPythonTrustEnv({ SSL_CERT_FILE: "/their/ca.pem", REQUESTS_CA_BUNDLE: "/their/requests.pem" });
    expect(kept.SSL_CERT_FILE).toBe("/their/ca.pem");
    expect(kept.REQUESTS_CA_BUNDLE).toBe("/their/requests.pem");
  });

  it("writes Node's roots once for that bundle", () => {
    const path = nodeCaBundle();
    const before = statSync(path).mtimeMs;
    expect(nodeCaBundle()).toBe(path);
    expect(statSync(path).mtimeMs).toBe(before);
    expect(readFileSync(path, "utf8")).toContain("BEGIN CERTIFICATE");
  });

  it("reaches an engine started for a bot", async () => {
    const child = spawnCli(process.execPath, ["-e", "process.stdout.write(process.env.SSL_CERT_FILE ?? '')"], { stdio: ["pipe", "pipe", "pipe"] }, "bot");
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    await new Promise((resolve) => child.once("close", resolve));
    await killCliTree(child);
    expect(stdout).toBeTruthy();
    expect(statSync(stdout).size).toBeGreaterThan(0);
  }, hostTimeout(20_000));
});
