// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationFailure, GenerationModel, ProjectGenerationSettings } from "../../../shared/project-generation";
import { loadLocale, setLocale } from "@/lib/i18n";
import type { MemoryCanvasBackend } from "@/lib/project-canvas/memory-backend";
import { SAMPLE_MODELS, SAMPLE_PROJECT_ID, sampleCanvasBackend, sampleCanvasSnapshot, sampleGenerationSettings } from "@/testing/project-canvas-sample";
import { ProjectCanvas } from "./ProjectCanvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class WideObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 4000, height: 3000 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

const PIXEL: GenerationModel = { id: "pixel-1", name: "Pixel 1", kind: "image", aspects: ["1:1", "16:9", "9:16"], qualities: ["standard", "hd"], maxCount: 4, referenceImages: true, referenceAudio: false };
const MODELS: Record<string, GenerationModel[]> = { ...SAMPLE_MODELS, "studio-images": [...SAMPLE_MODELS["studio-images"]!, PIXEL] };

let root: Root;
let host: HTMLElement;
let backend: MemoryCanvasBackend;

const settle = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
const dialog = () => document.body.querySelector<HTMLElement>("[data-project-canvas-settings]");
const tab = () => dialog()!.querySelector('[role="radio"][aria-checked="true"]')?.textContent;
const select = (label: string) => dialog()!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const options = (label: string) => [...select(label).options].map((option) => option.textContent);
const alerts = () => [...dialog()!.querySelectorAll('[role="alert"], [role="alert"] > span')].filter((line) => !line.querySelector("span")).map((line) => line.textContent);
const saved = async () => (await backend.readGenerationSettings(SAMPLE_PROJECT_ID)).settings;

async function openCard(nodeId: string) {
  const card = host.querySelector<HTMLElement>(`[data-canvas-node="${CSS.escape(nodeId)}"]`)!;
  const viewport = card.closest<HTMLElement>("[data-production-board]")!;
  await act(async () => {
    card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
  });
  await settle();
}

async function choose(field: HTMLSelectElement, value: string) {
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function click(button: HTMLButtonElement | undefined) {
  await act(async () => button!.click());
  await settle();
}

async function mount(settings: ProjectGenerationSettings = sampleGenerationSettings(), archived = false) {
  backend = sampleCanvasBackend({
    delayMs: 5, generation: { settings, servers: ["studio-images", "studio-video", "local-comfy"], models: MODELS },
    ...(archived ? { snapshot: { ...sampleCanvasSnapshot(), readOnly: "archived" as const } } : {}),
  });
  await act(async () => root.render(createElement(ProjectCanvas, { projectId: SAMPLE_PROJECT_ID, backend })));
  await settle();
}

const countLabels = () => [...dialog()!.querySelectorAll<HTMLLabelElement>("[data-project-settings-counts] label")];
const countsName = () => {
  const group = dialog()!.querySelector('[data-project-settings-counts][role="group"]');
  return document.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent;
};
const countField = (name: string) => {
  const label = countLabels().find((one) => one.textContent === name);
  return dialog()!.querySelector<HTMLInputElement>(`#${CSS.escape(label!.htmlFor)}`)!;
};

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function leave(field: HTMLInputElement) {
  await act(async () => field.blur());
}

const openFromHeader = () => click(host.querySelector<HTMLButtonElement>('button[aria-label="Project settings"], button[aria-label="项目设置"]')!);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", WideObserver);
  host = document.createElement("div");
  host.style.height = "900px";
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("the project's settings", () => {
  it("open on the first tab, and on the tab of the card open on the board", async () => {
    await mount();
    await openFromHeader();
    expect(tab()).toBe("Image");
    await click(buttonByText(dialog()!, "Cancel"));

    await openCard("shot-1");
    await openFromHeader();
    expect(tab()).toBe("Video");
    await click(buttonByText(dialog()!, "Cancel"));

    await openCard("city-night");
    await openFromHeader();
    expect(tab()).toBe("Image");
  });

  it("open on the tab of a shot's video open on the board when its kind has no server", async () => {
    const settings = sampleGenerationSettings();
    settings.video.server = null;
    await mount(settings);
    await openCard("shot-1-creation");
    await openFromHeader();
    expect(tab()).toBe("Video");
  });

  it("show a chosen model's defaults as ones it offers, and save them as shown", async () => {
    await mount();
    await openFromHeader();
    await choose(select("Default model"), "pixel-1");
    expect([select("Aspect ratio").value, select("Quality").value, select("Images per run").value]).toEqual(["16:9", "standard", "1"]);
    expect(options("Quality")).toEqual(["Standard", "HD"]);
    await click(buttonByText(dialog()!, "Save"));
    expect(dialog()).toBeNull();
    expect((await saved()).image.defaults).toEqual({ model: "pixel-1", aspect: "16:9", quality: "standard", count: 1 });

    await openCard("shot-1");
    await openFromHeader();
    await choose(select("Duration"), "10");
    await choose(select("Default model"), "veo-lite");
    expect([select("Resolution").value, select("Aspect ratio").value, select("Duration").value]).toEqual(["720p", "16:9", "5"]);
    expect(options("Duration")).toEqual(["5s"]);
    await click(buttonByText(dialog()!, "Save"));
    expect(dialog()).toBeNull();
    expect((await saved()).video.defaults).toEqual({ model: "veo-lite", resolution: "720p", aspect: "16:9", seconds: 5 });
  });

  it("name a model's qualities in the page's language", async () => {
    await loadLocale("zh");
    await mount();
    await openFromHeader();
    await choose(select("默认模型"), "pixel-1");
    expect(options("质量")).toEqual(["标准", "高清"]);
    await choose(select("默认模型"), "flux-pro");
    expect(options("质量")).toEqual(["自动", "高"]);
  });

  it("choose no model when the server no longer lists the saved one, and save that", async () => {
    const settings = sampleGenerationSettings();
    settings.image.defaults.model = "gone";
    await mount(settings);
    await openFromHeader();
    expect(select("Default model").value).toBe("");
    await click(buttonByText(dialog()!, "Save"));
    expect(dialog()).toBeNull();
    expect((await saved()).image.defaults.model).toBe("");
  });

  it("say a refused setting once, in the page's language, with its field and what to choose", async () => {
    await loadLocale("zh");
    await mount();
    const refused: GenerationFailure = {
      code: "setting_refused", error: "Pixel 1 doesn't offer the quality auto. It offers standard, hd.", errorKey: "serverError.projectGeneration.qualityRefused",
      errorParams: { model: "Pixel 1", value: "auto", offered: "standard, hd" }, problems: [{ key: "quality", value: "auto", offered: ["standard", "hd"] }],
    };
    backend.saveGenerationSettings = async () => ({ refused });
    await openFromHeader();
    await choose(select("默认模型"), "pixel-1");
    await click(buttonByText(dialog()!, "保存"));
    expect(alerts()).toEqual(["质量：Pixel 1 不提供“自动”，请选择标准或高清。"]);

    backend.saveGenerationSettings = async () => ({ refused: { ...refused, code: "model_unknown", problems: [{ key: "model", value: "pixel-9", offered: ["flux-pro", "pixel-1"] }] } });
    await click(buttonByText(dialog()!, "保存"));
    expect(alerts()).toEqual(["默认模型：studio-images 没有列出“pixel-9”，请选择Flux Pro或Pixel 1。"]);
  });

  it("say a server's refusal once when saving meets the refusal the models already showed", async () => {
    const settings = sampleGenerationSettings();
    settings.image.server = "local-comfy";
    await mount(settings);
    await openFromHeader();
    const shown = alerts();
    expect(shown).toEqual(["The MCP server local-comfy can't be used."]);
    backend.saveGenerationSettings = async () => ({ refused: { code: "server_unusable", error: "The MCP server local-comfy can't be used.", errorKey: "" } });
    await click(buttonByText(dialog()!, "Save"));
    expect(alerts()).toEqual(shown);
  });
});

describe("how much of the production runs at once", () => {
  const NAMES = ["Videos at once", "Images at once", "Episodes at once"];
  const counts = () => NAMES.map((name) => countField(name).value);
  const withCounts = (videos: number, images: number, episodes: number): ProjectGenerationSettings => ({ ...sampleGenerationSettings(), concurrency: { videos, images, episodes } });

  it("is the project's videos, images and episodes at once, under Production on both tabs", async () => {
    await mount(withCounts(4, 1, 6));
    await openFromHeader();
    expect(countsName()).toBe("Production");
    expect(countLabels().map((label) => label.textContent)).toEqual(NAMES);
    expect(counts()).toEqual(["4", "1", "6"]);
    await click(buttonByText(dialog()!, "Video"));
    expect(tab()).toBe("Video");
    expect(counts()).toEqual(["4", "1", "6"]);
  });

  it("saves the counts typed with the other settings", async () => {
    await mount(withCounts(2, 2, 3));
    await openFromHeader();
    await type(countField("Videos at once"), "5");
    await type(countField("Episodes at once"), "12");
    await click(buttonByText(dialog()!, "Save"));
    expect(dialog()).toBeNull();
    expect((await saved()).concurrency).toEqual({ videos: 5, images: 2, episodes: 12 });
  });

  it("says beside a count that is no whole number from 1 to 50 what to type once the field is left, and saves nothing until it is one", async () => {
    await mount(withCounts(2, 2, 3));
    await openFromHeader();
    const sent: ProjectGenerationSettings[] = [];
    const save = backend.saveGenerationSettings.bind(backend);
    backend.saveGenerationSettings = async (projectId, settings) => {
      sent.push(settings);
      return save(projectId, settings);
    };
    const images = countField("Images at once");
    await type(images, "51");
    expect(alerts()).toEqual([]);
    await leave(images);
    expect(alerts()).toEqual(["Images at once: enter a whole number from 1 to 50."]);
    expect(images.getAttribute("aria-invalid")).toBe("true");

    const videos = countField("Videos at once");
    await type(videos, "0");
    await click(buttonByText(dialog()!, "Save"));
    expect([dialog() !== null, sent.length]).toEqual([true, 0]);
    expect(alerts()).toEqual(["Videos at once: enter a whole number from 1 to 50.", "Images at once: enter a whole number from 1 to 50."]);
    expect(document.activeElement).toBe(videos);

    await type(videos, "1");
    await type(images, "50");
    expect(alerts()).toEqual([]);
    expect(images.hasAttribute("aria-invalid")).toBe(false);
    await click(buttonByText(dialog()!, "Save"));
    expect(dialog()).toBeNull();
    expect(sent.map((settings) => settings.concurrency)).toEqual([{ videos: 1, images: 50, episodes: 3 }]);
  });

  it("is named, and says what to type, in the page's language", async () => {
    await loadLocale("zh");
    await mount(withCounts(2, 2, 3));
    await openFromHeader();
    expect(countsName()).toBe("制作");
    expect(countLabels().map((label) => label.textContent)).toEqual(["视频并发", "图片并发", "同时进行的集数"]);
    const episodes = countField("同时进行的集数");
    await type(episodes, "2.5");
    await leave(episodes);
    expect(alerts()).toEqual(["同时进行的集数：请输入 1 到 50 之间的整数。"]);
  });

  it("cannot be changed in an archived project", async () => {
    await mount(withCounts(2, 2, 3), true);
    await openFromHeader();
    expect(NAMES.map((name) => countField(name).disabled)).toEqual([true, true, true]);
  });
});
