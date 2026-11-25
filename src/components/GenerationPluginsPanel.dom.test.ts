// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationPluginSummary } from "../../shared/generation-plugins";
import { loadLocale, setLocale } from "@/lib/i18n";

const plugin = (over: Partial<GenerationPluginSummary> = {}): GenerationPluginSummary => ({
  id: "acme-images", name: "Acme Images", version: "1.0.0", kinds: ["image"], enabled: true, configured: false,
  values: { baseUrl: "https://api.acme.test/v1" }, secrets: [], installedAt: 1,
  models: [{ id: "pixel-1", name: "Pixel 1", kind: "image", referenceImages: false, referenceAudio: false }],
  fields: [
    { key: "baseUrl", label: "API address", type: "url", required: true, default: "https://api.acme.test/v1" },
    { key: "apiKey", label: "API key", type: "secret", required: true },
  ],
  ...over,
});

const load = vi.fn(async () => ({ plugins: [plugin()] }));
const install = vi.fn(async (_name: string, _data: string) => ({ plugin: plugin({ configured: true }) }));
const save = vi.fn(async (_id: string, _patch: unknown) => ({ plugin: plugin({ configured: true, secrets: ["apiKey"] }) }));
const remove = vi.fn(async (_id: string) => ({ ok: true }));
vi.mock("@/lib/generation-plugins", () => ({
  loadGenerationPlugins: () => load(),
  installGenerationPlugin: (name: string, data: string) => install(name, data),
  saveGenerationPlugin: (id: string, patch: unknown) => save(id, patch),
  deleteGenerationPlugin: (id: string) => remove(id),
  pluginFileData: async () => "UEsDBAo=",
}));

const { GenerationPluginsPanel } = await import("./GenerationPluginsPanel");

let root: Root;
let host: HTMLElement;
const settle = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const buttonByText = (text: string) => [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

beforeEach(async () => {
  await loadLocale("en");
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(GenerationPluginsPanel)); });
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("the plugin manager", () => {
  it("lists an installed plugin, says it needs setup, and saves its settings with a saved word", async () => {
    expect(host.textContent).toContain("Acme Images");
    expect(host.textContent).toContain("Needs setup");
    await act(async () => buttonByText("Settings")!.click());
    expect(input("API address").value).toBe("https://api.acme.test/v1");
    await act(async () => {
      const key = input("API key");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(key, "sk-typed-key-1234");
      key.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText("Save")!.click());
    await settle();
    expect(save).toHaveBeenCalledWith("acme-images", { values: { baseUrl: "https://api.acme.test/v1", apiKey: "sk-typed-key-1234" } });
    expect(host.textContent).toContain("Saved. It applies straight away.");
    expect(host.textContent).not.toContain("sk-typed-key-1234");
  });

  it("uploads a chosen zip, and asks twice before deleting", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "acme.zip", { type: "application/zip" });
    const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, "files", { value: [file] });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    expect(install).toHaveBeenCalledWith("acme.zip", "UEsDBAo=");

    const first = host.querySelector<HTMLButtonElement>('[data-generation-plugin-delete]')!;
    await act(async () => first.click());
    expect(remove).not.toHaveBeenCalled();
    expect(first.getAttribute("aria-label")).toContain("Delete Acme Images?");
    await act(async () => first.click());
    await settle();
    expect(remove).toHaveBeenCalledWith("acme-images");
  });
});
