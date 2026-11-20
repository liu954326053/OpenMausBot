import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectAiStep } from "./connect-ai-events";
import { loadWaitingFor } from "./app-load";
import { signInGateShown } from "./sign-in-gate";

const captured = vi.hoisted(() => [] as Array<{ event: string; props: unknown }>);
vi.mock("./analytics", () => ({ track: (event: string, props?: unknown) => void captured.push({ event, props }) }));

const HOSTILE = "Claude isn't signed in for ada@example.com with sk-ant-api03-SECRET0123456789";
const sent = (event: string) => captured.filter((entry) => entry.event === event).map((entry) => entry.props);

beforeEach(() => {
  captured.length = 0;
});

describe("Connect an AI steps", () => {
  it("names the engine by its kind and the failure by a word from its list, never the provider's text", () => {
    connectAiStep("test_failed", "meet", { driverKind: "claudeAgent", reason: "signed_out", seconds: 12.4 });
    connectAiStep("test_failed", "chat", { driverKind: "Ada's own engine", reason: HOSTILE });
    connectAiStep("chosen", "cloud_welcome", { driverKind: "codex", reason: HOSTILE });
    connectAiStep("opened", "meet", { aiReady: false });
    expect(sent("connect_ai")).toEqual([
      { step: "test_failed", place: "meet", engine: "claude", reason: "signed_out", seconds: 12 },
      { step: "test_failed", place: "chat", engine: "other", reason: "other" },
      { step: "chosen", place: "cloud_welcome", engine: "codex" },
      { step: "opened", place: "meet", ai_ready: false },
    ]);
    expect(JSON.stringify(captured)).not.toMatch(/ada@|sk-ant|Ada's/);
  });

  it("sends a step or a place it does not know as other", () => {
    connectAiStep("sneaky" as never, "settings" as never);
    expect(sent("connect_ai")).toEqual([{ step: "other", place: "other" }]);
  });
});

describe("the app's load", () => {
  it("says what it still waits for", () => {
    expect(loadWaitingFor({ connected: false, config: null })).toBe("server");
    expect(loadWaitingFor({ connected: true, config: null })).toBe("data");
    expect(loadWaitingFor({ connected: true, hydrated: true, config: null })).toBe("settings");
    expect(loadWaitingFor({ connected: true, hydrated: true, config: {} })).toBeNull();
  });
});

describe("the sign-in gate", () => {
  it("names the reason by a word from its list", () => {
    signInGateShown("service_trust");
    signInGateShown("/pair?code=SECRET" as never);
    expect(sent("sign_in_gate")).toEqual([{ reason: "service_trust" }, { reason: "other" }]);
  });
});
