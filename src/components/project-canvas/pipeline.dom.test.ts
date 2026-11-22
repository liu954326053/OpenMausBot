// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));

import type { PipelineRunWire, PipelineStageStatus } from "../../../shared/pipeline-run";
import { botNodeId, type CanvasNodeMetadata, type CanvasSnapshot } from "../../../shared/project-canvas";
import type { StartGenerationInput } from "../../../shared/project-generation";
import type { PipelineStage } from "../../../shared/team-pipeline";
import { loadLocale, setLocale } from "@/lib/i18n";
import type { MemoryCanvasBackend } from "@/lib/project-canvas/memory-backend";
import { SAMPLE_PROJECT_ID, sampleCanvasBackend, sampleCanvasSnapshot } from "@/testing/project-canvas-sample";
import { ProjectCanvas } from "./ProjectCanvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class WideObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 8000, height: 4000 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

let root: Root;
let host: HTMLElement;
let backend: MemoryCanvasBackend;

const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const nodeElement = (id: string) => host.querySelector<HTMLElement>(`[data-canvas-node="${CSS.escape(id)}"]`)!;
const panel = () => host.querySelector<HTMLElement>("[data-node-panel]");
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
const shown = (id: string) => backend.current().nodes.find((node) => node.id === id)!;
const kind = (id: string) => nodeElement(id).querySelector("[data-node-kind]")?.textContent ?? null;
const takes = () => backend.current().nodes.filter((node) => node.metadata?.role === "take");

async function clickNode(id: string) {
  await act(async () => {
    nodeElement(id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    host.querySelector("[data-project-canvas-stage]")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
  });
}

async function mount(options: Parameters<typeof sampleCanvasBackend>[0] = {}, change: (snapshot: CanvasSnapshot) => void = () => {}) {
  const snapshot = sampleCanvasSnapshot();
  change(snapshot);
  backend = sampleCanvasBackend({ delayMs: 5, snapshot, ...options });
  await act(async () => root.render(createElement(ProjectCanvas, { projectId: SAMPLE_PROJECT_ID, backend })));
  await settle();
  await settle();
}

const mark = (id: string, metadata: CanvasNodeMetadata) => (snapshot: CanvasSnapshot) => {
  const node = snapshot.nodes.find((one) => one.id === id)!;
  node.metadata = { ...node.metadata, ...metadata };
};

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

describe("the pipeline on the project canvas", () => {
  it("names a bot's stages above its node, each of several, and nothing for a bot outside the pipeline", async () => {
    const staged = (snapshot: CanvasSnapshot) => {
      snapshot.bots.lena!.stages = ["character", "storyboard"];
      snapshot.bots.otto!.stages = ["other"];
    };
    await mount({}, staged);
    expect(["mira", "kai", "lena", "otto"].map((id) => kind(botNodeId(id)))).toEqual(["Lead", "Script", "Character design · Storyboard", null]);

    act(() => root.unmount());
    root = createRoot(host);
    await loadLocale("zh");
    await mount({}, (snapshot) => {
      staged(snapshot);
      snapshot.bots.otto!.stages = ["post"];
    });
    expect(["mira", "kai", "lena", "otto"].map((id) => kind(botNodeId(id)))).toEqual(["负责人", "编剧", "角色设计 · 分镜", "后期"]);
  });

  it("says what the script, a character's profile and its group, a creation node and the finished film are, and nothing of any other node", async () => {
    await mount({}, (snapshot) => {
      mark("logline", { role: "script" })(snapshot);
      snapshot.nodes.push(
        { id: "hero", type: "group", title: "Ava", position: { x: 0, y: 900 }, width: 760, height: 480, createdBy: { kind: "bot", botId: "kai" } },
        { id: "hero-profile", type: "text", title: "Ava", position: { x: 24, y: 952 }, width: 340, height: 240, groupId: "hero", createdBy: { kind: "bot", botId: "kai" }, metadata: { role: "character", content: "A courier." } },
        { id: "film", type: "video", title: "Rain City.mp4", position: { x: 900, y: 900 }, width: 420, height: 236, createdBy: { kind: "person" }, metadata: { role: "final" } },
        { id: "loose", type: "group", title: "Board", position: { x: 1500, y: 900 }, width: 760, height: 480, createdBy: { kind: "person" } },
      );
    });
    expect(["logline", "hero", "hero-profile", "shot-1-creation", "film"].map(kind)).toEqual(["Script", "Character", "Character profile", "Video creation", "Finished film"]);
    expect(["shot-1", "shot-1-take-1", "city-night", "loose"].map(kind)).toEqual([null, null, null, null]);
  });

  it("keeps a shot's description and references on the shot, and generation off it", async () => {
    await mount();
    await clickNode("shot-1");
    const open = panel()!;
    expect(open.querySelector<HTMLTextAreaElement>('textarea[aria-label="Shot prompt"]')!.value).toBe(shown("shot-1").metadata!.prompt);
    expect([...open.querySelectorAll("[data-reference]")].map((thumb) => thumb.textContent)).toEqual(["Image 1"]);
    expect(open.textContent).not.toContain("Generate");
    expect(open.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
    expect(nodeElement("shot-1").textContent).not.toContain("Kling 2");
  });

  it("generates a shot from its creation node, which shows the shot's description and has the model, the settings and the references but no prompt of its own", async () => {
    const inputs: StartGenerationInput[] = [];
    await mount({ fail: (input) => { inputs.push(input); } });
    const creation = nodeElement("shot-1-creation");
    expect(creation.textContent).toContain(shown("shot-1").metadata!.prompt);
    for (const chip of ["10s", "720p", "Kling 2"]) expect(creation.textContent).toContain(chip);

    await clickNode("shot-1-creation");
    const open = panel()!;
    expect(open.querySelector("textarea")).toBeNull();
    expect(open.textContent).not.toContain("Makes");
    expect([...open.querySelectorAll("[data-reference]")].map((thumb) => thumb.textContent)).toEqual(["Image 1"]);
    expect(open.querySelectorAll('button[aria-haspopup="dialog"]').length).toBeGreaterThan(0);
    await act(async () => buttonByText(open, "Generate")!.click());
    await settle(40);
    expect(inputs).toMatchObject([{ nodeId: "shot-1-creation", prompt: shown("shot-1").metadata!.prompt, overrides: { seconds: 10 } }]);
    expect(takes()).toHaveLength(2);
  });

  it("says why a creation node can't generate while its shot has no description, or once its shot is gone", async () => {
    await mount({}, mark("shot-1", { prompt: " " }));
    await clickNode("shot-1-creation");
    expect(buttonByText(panel()!, "Generate")!.disabled).toBe(true);
    expect(panel()!.textContent).toContain("The shot has no description yet. Write one on the shot first.");

    await act(async () => { await backend.applyOps(SAMPLE_PROJECT_ID, { ops: [{ type: "delete_node", id: "shot-1" }] }); });
    await settle();
    expect(buttonByText(panel()!, "Generate")!.disabled).toBe(true);
    expect(panel()!.textContent).toContain("This node's shot was deleted, so there is nothing to generate.");
  });

  it("marks the take a shot uses, and Use this take on another makes that one the shot's", async () => {
    await mount();
    expect(nodeElement("shot-1-take-1").querySelector("[data-take-selected]")!.textContent).toBe("In the film");
    expect(buttonByText(nodeElement("shot-1-take-1"), "Use this take")).toBeUndefined();

    await act(async () => { await backend.startGeneration(SAMPLE_PROJECT_ID, { nodeId: "shot-1-creation" }); });
    await settle(40);
    const second = takes().find((node) => node.id !== "shot-1-take-1")!;
    expect(nodeElement(second.id).querySelector("[data-take-selected]")).not.toBeNull();
    expect(nodeElement("shot-1-take-1").querySelector("[data-take-selected]")).toBeNull();

    await act(async () => buttonByText(nodeElement("shot-1-take-1"), "Use this take")!.click());
    await settle();
    expect(takes().filter((node) => node.metadata?.selected).map((node) => node.id)).toEqual(["shot-1-take-1"]);
    expect(nodeElement("shot-1-take-1").querySelector("[data-take-selected]")).not.toBeNull();
    expect(buttonByText(nodeElement(second.id), "Use this take")).toBeDefined();
  });

  it("offers no take to use before it has a clip or on an archived project, and says why a choice didn't go through", async () => {
    const twoTakes = (snapshot: CanvasSnapshot) => {
      const first = snapshot.nodes.find((node) => node.id === "shot-1-take-1")!;
      snapshot.nodes.push({ ...first, id: "take-2", position: { x: first.position.x, y: first.position.y + 300 }, metadata: { ...first.metadata, selected: undefined } }, { ...first, id: "take-3", position: { x: first.position.x, y: first.position.y + 600 }, metadata: { role: "take", shotId: "shot-1", status: "error", errorDetails: "No luck." } });
    };
    await mount({}, twoTakes);
    expect(buttonByText(nodeElement("take-3"), "Use this take")).toBeUndefined();
    backend.selectTake = () => Promise.reject(new Error("The server is away."));
    await act(async () => buttonByText(nodeElement("take-2"), "Use this take")!.click());
    await settle();
    expect([...host.querySelectorAll('[role="status"]')].map((notice) => notice.textContent)).toContain("The take wasn't changed: The server is away.");
    expect(shown("shot-1-take-1").metadata!.selected).toBe(true);

    act(() => root.unmount());
    root = createRoot(host);
    await mount({}, (snapshot) => {
      twoTakes(snapshot);
      snapshot.readOnly = "archived";
    });
    expect(nodeElement("shot-1-take-1").querySelector("[data-take-selected]")).not.toBeNull();
    expect(buttonByText(nodeElement("take-2"), "Use this take")).toBeUndefined();
  });

  it("marks a node quietly when something it was made from changed, and only then", async () => {
    await mount({}, mark("shot-1-take-1", { stale: true }));
    const stale = nodeElement("shot-1-take-1").querySelector<HTMLElement>("[data-node-stale]")!;
    expect(stale.textContent).toBe("Upstream changed");
    expect(stale.title).toBe("Something this was made from changed after it was made.");
    expect(host.querySelectorAll("[data-node-stale]")).toHaveLength(1);

    await act(async () => backend.updateBots((snapshot) => {
      delete snapshot.nodes.find((node) => node.id === "shot-1-take-1")!.metadata!.stale;
      snapshot.revision += 1;
    }));
    await settle();
    expect(host.querySelector("[data-node-stale]")).toBeNull();
  });

  it("draws a line the pipeline made like any content line, and lets the person delete it like one", async () => {
    await mount();
    const line = host.querySelector<SVGGElement>('[data-connection="c-shot-creation"]')!;
    expect(line.getAttribute("data-kind")).toBe("content");
    await act(async () => line.querySelector("path")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Delete connection"]')!.click());
    await settle();
    expect(backend.current().connections.some((connection) => connection.id === "c-shot-creation")).toBe(false);
  });

  it("copies a take as a plain clip, with none of the pipeline's marks", async () => {
    await mount({}, mark("shot-1-take-1", { stale: true }));
    await clickNode("shot-1-take-1");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "d", metaKey: true })); });
    await settle();
    const copy = backend.current().nodes.find((node) => node.id !== "shot-1-take-1" && node.metadata?.file?.path === shown("shot-1-take-1").metadata!.file!.path)!;
    expect(copy.metadata).not.toHaveProperty("role");
    expect(copy.metadata).not.toHaveProperty("shotId");
    expect(copy.metadata).not.toHaveProperty("selected");
    expect(copy.metadata).not.toHaveProperty("stale");
  });
});

describe("the run on the project canvas", () => {
  const run = (videos: PipelineRunWire["videos"], stages: Array<[PipelineStage, PipelineStageStatus]> = [["script", "done"], ["storyboard", "done"], ["post", "waiting"]]): PipelineRunWire => ({
    id: "run-1",
    startedAt: 1,
    stages: stages.map(([stage, status]) => ({ stage, botIds: [], status })),
    videos,
  });
  const withRun = (value: PipelineRunWire) => (snapshot: CanvasSnapshot) => { snapshot.run = value; };
  const bar = () => host.querySelector<HTMLElement>("[data-pipeline-run]");
  const steps = () => [...bar()!.querySelectorAll<HTMLElement>("[data-run-step]")].map((step) => `${step.dataset.runStep}:${step.dataset.status}`);

  it("shows nothing of a run while the project has none, and adds nothing to the canvas's top bar when it has one", async () => {
    await mount();
    expect(bar()).toBeNull();
    const buttons = host.querySelector("header")!.querySelectorAll("button").length;
    await act(async () => backend.updateBots(withRun(run({ status: "waiting", shots: 0, ready: 0, failed: 0 }))));
    await settle();
    expect(bar()).not.toBeNull();
    expect(host.querySelector("header")!.querySelectorAll("button")).toHaveLength(buttons);
    expect(host.querySelector("header")!.contains(bar())).toBe(false);
  });

  it("shows the run's stages in order with where each stands, the videos before post and counted while they generate", async () => {
    await mount({}, withRun(run({ status: "working", shots: 8, ready: 3, failed: 0 }, [["script", "done"], ["character", "failed"], ["storyboard", "working"], ["post", "waiting"]])));
    expect(steps()).toEqual(["script:done", "character:failed", "storyboard:working", "videos:working", "post:waiting"]);
    expect([...bar()!.querySelectorAll<HTMLElement>("[data-run-step]")].map((step) => step.textContent)).toEqual(["ScriptDone", "Character designFailed", "StoryboardIn progress", "Videos3/8In progress", "PostWaiting"]);
    expect(bar()!.querySelectorAll("button")).toHaveLength(0);
  });

  it("leaves the videos out of a run that has no storyboard stage and no shots, and puts them last in one with no post stage", async () => {
    await mount({}, withRun(run({ status: "waiting", shots: 0, ready: 0, failed: 0 }, [["script", "working"], ["post", "waiting"]])));
    expect(steps()).toEqual(["script:working", "post:waiting"]);
    await act(async () => backend.updateBots(withRun(run({ status: "waiting", shots: 0, ready: 0, failed: 0 }, [["script", "done"], ["storyboard", "working"]]))));
    await settle();
    expect(steps()).toEqual(["script:done", "storyboard:working", "videos:waiting"]);
  });

  it("waits for the person before the videos: how many shots there are and one action, which starts the ones that have none", async () => {
    await mount({}, withRun(run({ status: "confirm", shots: 8, ready: 2, failed: 0 })));
    expect(steps()).toContain("videos:confirm");
    expect(bar()!.textContent).toContain("8 shots are ready.");
    expect([...bar()!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Generate 6 videos"]);
    await act(async () => buttonByText(bar()!, "Generate 6 videos")!.click());
    await settle();
    expect(backend.videoAnswers).toEqual(["start"]);
    expect(steps()).toContain("videos:working");
    expect(bar()!.querySelectorAll("button")).toHaveLength(0);
  });

  it("counts one shot and one video as one", async () => {
    await mount({}, withRun(run({ status: "confirm", shots: 1, ready: 0, failed: 0 })));
    expect(bar()!.textContent).toContain("1 shot is ready.");
    expect(buttonByText(bar()!, "Generate 1 video")).toBeDefined();
  });

  it("says how many shots have no video once generating ended without them, to try them again or go on without them", async () => {
    await mount({}, withRun(run({ status: "failed", shots: 8, ready: 6, failed: 2 })));
    expect(steps()).toContain("videos:failed");
    expect(bar()!.textContent).toContain("2 shots have no video.");
    expect([...bar()!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Try the failed shots again", "Go on without them"]);
    await act(async () => buttonByText(bar()!, "Try the failed shots again")!.click());
    await settle();
    expect(backend.videoAnswers).toEqual(["retry"]);
    expect(steps()).toContain("videos:working");

    await act(async () => backend.updateBots(withRun(run({ status: "failed", shots: 8, ready: 7, failed: 1 }))));
    await settle();
    expect(bar()!.textContent).toContain("1 shot has no video.");
    await act(async () => buttonByText(bar()!, "Go on without them")!.click());
    await settle();
    expect(backend.videoAnswers).toEqual(["retry", "skip"]);
    expect(steps()).toContain("videos:done");
    expect(bar()!.querySelectorAll("button")).toHaveLength(0);
  });

  it("says beside the action why an answer didn't go through, and keeps the action to try again", async () => {
    await mount({}, withRun(run({ status: "confirm", shots: 3, ready: 0, failed: 0 })));
    const answer = backend.answerVideos.bind(backend);
    backend.answerVideos = () => Promise.reject(new Error("Not found"));
    await act(async () => buttonByText(bar()!, "Generate 3 videos")!.click());
    await settle();
    expect(bar()!.querySelector('[role="alert"]')!.textContent).toBe("That didn't go through: Not found");
    expect(buttonByText(bar()!, "Generate 3 videos")!.disabled).toBe(false);

    backend.answerVideos = answer;
    await act(async () => buttonByText(bar()!, "Generate 3 videos")!.click());
    await settle();
    expect(bar()!.querySelector('[role="alert"]')).toBeNull();
    expect(backend.videoAnswers).toEqual(["start"]);
  });

  it("takes no answer on an archived project", async () => {
    await mount({}, (snapshot) => {
      snapshot.run = run({ status: "failed", shots: 4, ready: 3, failed: 1 });
      snapshot.readOnly = "archived";
    });
    expect([...bar()!.querySelectorAll("button")].map((button) => button.disabled)).toEqual([true, true]);
  });

  it("names the stages and the ask in Chinese", async () => {
    await loadLocale("zh");
    await mount({}, withRun(run({ status: "confirm", shots: 8, ready: 0, failed: 0 }, [["script", "done"], ["character", "done"], ["storyboard", "done"], ["post", "waiting"]])));
    expect([...bar()!.querySelectorAll<HTMLElement>("[data-run-step] [data-run-label]")].map((label) => label.textContent)).toEqual(["编剧", "角色设计", "分镜", "视频", "后期"]);
    expect(bar()!.textContent).toContain("8 个镜头已就绪。");
    expect(buttonByText(bar()!, "生成 8 段视频")).toBeDefined();
  });
});
