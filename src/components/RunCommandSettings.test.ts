// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { RunCommandSettings } from "./RunCommandSettings";

const fixture = vi.hoisted(() => ({
  config: undefined as Record<string, unknown> | undefined,
  api: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));

let host: HTMLDivElement;
let root: Root;
const render = () => flushSync(() => root.render(createElement(RunCommandSettings)));
const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label="Let API bots run commands"]');

beforeEach(() => {
  vi.clearAllMocks();
  setLocale("en");
  fixture.dispatch.mockImplementation((action: { type: string; config?: Record<string, unknown> }) => {
    if (action.type === "configStatus") fixture.config = action.config;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("Let API bots run commands setting", () => {
  it("is not shown by a server that does not offer it (a Cloud home or a hosted workspace)", () => {
    fixture.config = { features: { skillAuthoring: true } };
    render();
    expect(host.textContent).toBe("");
  });

  it("follows the server's answer, says what it allows, and saves the switch", async () => {
    fixture.config = { features: { runCommand: true } };
    const saved = { features: { runCommand: false } };
    fixture.api.mockResolvedValue(saved);
    render();
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("can run shell commands in their own folder");
    flushSync(() => [...host.querySelectorAll("button")].find((button) => !button.hasAttribute("aria-label"))!.click());
    expect(host.textContent).toContain("On by default.");
    expect(host.textContent).toContain("logs/run-command.log");

    flushSync(() => toggle()!.click());
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: saved }));
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/config", {
      method: "PATCH",
      body: JSON.stringify({ features: { runCommand: false } }),
    });
    render();
    expect(toggle()!.getAttribute("aria-checked")).toBe("false");
  });

  it("shows a refusal from the server when saving the switch", async () => {
    fixture.config = { features: { runCommand: true } };
    fixture.api.mockRejectedValue(new Error("only an admin may change this"));
    render();
    flushSync(() => toggle()!.click());
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("only an admin may change this"));
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/config", {
      method: "PATCH",
      body: JSON.stringify({ features: { runCommand: false } }),
    });
  });

  it("saves the environment allow-list as names, split on commas and spaces and de-duplicated", async () => {
    fixture.config = { features: { runCommand: true, runCommandEnv: ["IP_SCOUT_KEY"] } };
    const saved = { features: { runCommand: true, runCommandEnv: ["IP_SCOUT_KEY", "WBM_KEY"] } };
    fixture.api.mockResolvedValue(saved);
    render();
    const input = host.querySelector<HTMLInputElement>('[data-testid="run-command-env"]')!;
    expect(input.value).toBe("IP_SCOUT_KEY");
    expect(host.textContent).toContain("never written to logs or project files");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => {
      setter.call(input, " IP_SCOUT_KEY, WBM_KEY  WBM_KEY ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => input.dispatchEvent(new Event("blur", { bubbles: true })));
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: saved }));
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/config", {
      method: "PATCH",
      body: JSON.stringify({ features: { runCommandEnv: ["IP_SCOUT_KEY", "WBM_KEY"] } }),
    });
    expect(host.querySelector<HTMLInputElement>('[data-testid="run-command-env"]')!.value).toBe("IP_SCOUT_KEY WBM_KEY");
  });

  it("does not save an unchanged environment list", () => {
    fixture.config = { features: { runCommand: true, runCommandEnv: ["IP_SCOUT_KEY"] } };
    render();
    const input = host.querySelector<HTMLInputElement>('[data-testid="run-command-env"]')!;
    flushSync(() => input.dispatchEvent(new Event("blur", { bubbles: true })));
    expect(fixture.api).not.toHaveBeenCalled();
  });
});
