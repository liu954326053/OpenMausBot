import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = new URL("../../", import.meta.url);

function shippedCode(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "index.html", "src", "electron", "server", "shared", "packages"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.(ts|tsx|mts|js|mjs|cjs|html)$/.test(file) && !/\.(test|node-test|e2e\.test)\.|\.d\.m?ts$/.test(file));
}

const REACHES_POSTHOG = [/["'`]posthog-js["'`/]/, /["'`]@posthog\//, /\bphc_[A-Za-z0-9]{20,}/, /\bi\.posthog\.com\b/, /\bapp\.posthog\.com\b/];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("posthog-js");
  vi.resetModules();
});

describe("usage analytics", () => {
  it("is an event named and dropped: nothing is loaded, stored or sent", async () => {
    const network = { fetch: vi.fn(), sendBeacon: vi.fn(), XMLHttpRequest: vi.fn(), WebSocket: vi.fn(), EventSource: vi.fn(), Image: vi.fn() };
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const page = { createElement: vi.fn(), cookie: "" };
    const posthogLoaded = vi.fn();
    vi.stubGlobal("fetch", network.fetch);
    vi.stubGlobal("XMLHttpRequest", network.XMLHttpRequest);
    vi.stubGlobal("WebSocket", network.WebSocket);
    vi.stubGlobal("EventSource", network.EventSource);
    vi.stubGlobal("Image", network.Image);
    vi.stubGlobal("navigator", { sendBeacon: network.sendBeacon });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("document", page);
    vi.doMock("posthog-js", () => {
      posthogLoaded();
      return { default: {} };
    });

    const { track } = await import("./analytics");
    const events = await import("./product-events");
    const { connectAiStep } = await import("./connect-ai-events");
    const { signInGateShown } = await import("./sign-in-gate");
    track("app_opened", { surface: "local", app_version: "0.1.140" });
    events.keySaved("anthropic", "settings", "ok");
    events.botCreated("template", "research");
    connectAiStep("test_failed", "meet", { driverKind: "claudeAgent", reason: "signed_out" });
    signInGateShown("signed_out");
    await new Promise((settled) => setTimeout(settled, 10));

    expect(Object.entries(network).filter(([, call]) => call.mock.calls.length > 0).map(([name]) => name)).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(page.createElement).not.toHaveBeenCalled();
    expect(page.cookie).toBe("");
    expect(posthogLoaded).not.toHaveBeenCalled();
  });

  it("has no PostHog library, key or host in the app's own code", () => {
    const files = shippedCode();
    expect(files).toEqual(expect.arrayContaining(["src/lib/analytics.ts", "electron/main.mjs", "server/index.ts"]));
    const found = files.flatMap((file) => {
      const text = readFileSync(new URL(file, ROOT), "utf8");
      return REACHES_POSTHOG.filter((pattern) => pattern.test(text)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(found).toEqual([]);
  });

  it("has no launch report in the desktop app", () => {
    expect(shippedCode().filter((file) => /^electron\/.*analytics/.test(file))).toEqual([]);
    expect(readFileSync(new URL("electron/main.mjs", ROOT), "utf8")).not.toMatch(/\bdesktop_launch\b|analytics/i);
  });
});
