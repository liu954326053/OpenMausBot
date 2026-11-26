// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { renderOverlay, type OverlayHarness } from "./testing/render-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let harness: OverlayHarness;

afterEach(() => {
  harness.unmount();
  setLocale("en");
});

const details = () => document.querySelector<HTMLElement>("[data-board-asset]");
const named = (name: string) =>
  [...details()!.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.getAttribute("aria-label") === name || each.textContent?.trim() === name);
const facts = () => Object.fromEntries([...details()!.querySelectorAll("dl > div")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
const marked = (attribute: string) => [...details()!.querySelectorAll(`[${attribute}]`)].map((each) => each.getAttribute(attribute) || each.textContent);
const click = (element: HTMLElement) => act(async () => {
  element.click();
});
const press = (element: HTMLElement, init: KeyboardEventInit) => act(async () => {
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
});

async function openAsset(nodeId: string) {
  await harness.update({ opened: { kind: "asset", nodeId } });
  await harness.settle();
}

describe("an asset's details", () => {
  it("is the mockup's dialog: a 980px sheet over a scrim, risen 220ms and still for reduced motion", async () => {
    harness = await renderOverlay();
    await openAsset("image-qingwu");
    const modal = details()!;
    expect(modal.className).toContain("max-w-[980px]");
    expect(modal.className).toContain("rounded-[14px]");
    expect(modal.className).toContain("border-board-line-2");
    expect(modal.className).toContain("board-modal-shadow");
    expect(modal.className).toContain("animate-details-in");
    expect(modal.className).toContain("motion-reduce:animate-none");
    expect(modal.parentElement!.className).toContain("ui-scrim");
  });

  it("heads with the kind, the version and a 17px title", async () => {
    harness = await renderOverlay();
    await openAsset("group-qingwu");
    const kind = details()!.querySelector<HTMLElement>("[data-details-kind]")!;
    expect(kind.textContent).toBe("Character");
    expect(kind.className).toContain("text-[12px]");
    expect(kind.className).toContain("text-ink-tertiary");
    await openAsset("shot-1-3");
    expect(details()!.querySelector<HTMLElement>("[data-version]")!.textContent).toBe("EP01 SH03");
    expect(details()!.querySelector<HTMLElement>("[data-version]")!.className).toContain("font-mono");
    const title = document.getElementById(details()!.getAttribute("aria-labelledby")!)!;
    expect(title.className).toContain("text-[17px]");
    expect(title.className).toContain("font-semibold");
    expect(title.className).toContain("truncate");
  });

  it("gives the media 1.3 parts against the facts' 1, a character's picture 0.85, and a hairline between them", async () => {
    harness = await renderOverlay();
    await openAsset("shot-1-3");
    expect(details()!.querySelector<HTMLElement>("[data-media]")!.className).toContain("flex-[1.3_1_0]");
    const info = details()!.querySelector<HTMLElement>("[data-info]")!;
    expect(info.className).toContain("flex-[1_1_0]");
    expect(info.className).toContain("border-s");
    expect(info.className).toContain("border-hairline");
    await openAsset("group-qingwu");
    expect(details()!.querySelector<HTMLElement>("[data-media]")!.className).toContain("flex-[0.85_1_0]");
  });

  it("sets a picture in an 8px figure with its size under it", async () => {
    harness = await renderOverlay();
    await openAsset("image-qingwu");
    const figure = details()!.querySelector<HTMLElement>("figure")!;
    expect(figure.className).toContain("gap-2.5");
    expect(figure.querySelector("img")!.className).toContain("rounded-lg");
    const caption = details()!.querySelector<HTMLElement>("[data-caption]")!;
    expect(caption.className).toContain("text-[12px]");
    expect(caption.className).toContain("text-ink-tertiary");
    expect(caption.querySelector("[data-resolution]")!.textContent).toBe("768 × 1024");
  });

  it("renders a document as a still sheet that reads and selects like paper", async () => {
    harness = await renderOverlay();
    await openAsset("brief");
    const sheet = details()!.querySelector<HTMLElement>("[data-sheet]")!;
    expect(sheet.className).toContain("select-text");
    expect(sheet.className).toContain("cursor-default");
    expect(sheet.className).toContain("rounded-[10px]");
    expect(sheet.textContent).toContain("把《雾港灯语》改成竖屏漫剧");
    expect(sheet.querySelector("[draggable]")).toBeNull();
    expect(sheet.getAttribute("data-board-card")).toBeNull();
    expect(sheet.dataset.boardSurface).toBe("paper");
  });

  it("sets a shot still to be drawn on a still sheet, with a dashed frame where its sketch goes", async () => {
    harness = await renderOverlay();
    await openAsset("shot-3-1");
    const sheet = details()!.querySelector<HTMLElement>("[data-sheet]")!;
    expect(sheet.hasAttribute("data-sketch")).toBe(true);
    expect(sheet.className).toContain("select-text");
    expect(sheet.querySelector("[data-sketch-frame]")!.className).toContain("aspect-video");
    expect(sheet.querySelector("[data-sketch-frame]")!.className).toContain("border-dashed");
    expect(sheet.querySelector("[data-sketch-frame]")!.textContent).toBe("远景 · 缓慢推近 · 6s · 汽笛声，海浪");
    expect(details()!.querySelector("[data-screen]")).toBeNull();
  });

  it("shows a video on a 16:9 screen with its takes, the one in use marked", async () => {
    harness = await renderOverlay();
    await openAsset("take-1-3-1");
    expect(details()!.querySelector("video")!.closest("[data-screen]")!.className).toContain("aspect-video");    const takes = [...details()!.querySelectorAll<HTMLElement>("[data-take]")];
    expect(takes.map((take) => take.textContent?.replace("✓", ""))).toEqual(["V1", "V2", "V3"]);
    expect(takes[2]!.hasAttribute("data-cur")).toBe(true);
    expect(takes[2]!.className).toContain("border-board-teal-ink");
    expect(takes[2]!.className).toContain("text-board-teal-ink");
    expect(takes[0]!.hasAttribute("data-cur")).toBe(false);
    expect(takes[0]!.className).toContain("h-6");
    expect(takes[0]!.className).toContain("font-mono");
  });

  it("lays its facts out under 64px terms and its prompt on a card", async () => {
    harness = await renderOverlay();
    await openAsset("shot-1-3");
    expect(details()!.querySelector<HTMLElement>("dt")!.className).toContain("w-16");
    const prompt = details()!.querySelector<HTMLElement>("[data-prompt]")!;
    expect(prompt.className).toContain("bg-card");
    expect(prompt.className).toContain("rounded-lg");
    expect(prompt.className).toContain("text-[13px]");
  });

  it("lists the shots it appears in as 108px cards with a 16:9 picture on top", async () => {
    harness = await renderOverlay();
    await openAsset("group-qingwu");
    const uses = [...details()!.querySelectorAll<HTMLElement>("[data-appearance]")];
    expect(uses).toHaveLength(7);
    expect(uses[0]!.className).toContain("w-[108px]");
    expect(uses[0]!.className).toContain("text-[12px]");
    expect(uses[0]!.querySelector("[data-use-thumb]")!.className).toContain("aspect-video");
  });

  it("stacks its two columns under 760px and scrolls inside the dialog there", async () => {
    harness = await renderOverlay();
    await openAsset("group-qingwu");
    const body = details()!.querySelector<HTMLElement>("[data-details-body]")!;
    expect(body.className).toContain("[@media(max-width:760px)]:flex-col");
    expect(body.className).toContain("[@media(max-width:760px)]:overflow-y-auto");
    const media = details()!.querySelector<HTMLElement>("[data-media]")!;
    expect(media.className).toContain("[@media(max-width:760px)]:flex-none");
    expect(media.className).toContain("[@media(max-width:760px)]:overflow-visible");
    const picture = details()!.querySelector("figure img")!;
    expect(picture.className).toContain("[@media(max-width:760px)]:max-h-[52vh]");
    expect(details()!.querySelector<HTMLElement>("[data-info]")!.className).toContain("[@media(max-width:760px)]:flex-none");
  });

  it("shows a character with its picture, facts, profile, prompt and the shots it is in", async () => {
    harness = await renderOverlay();
    await openAsset("image-qingwu");
    const modal = details()!;
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(modal.getAttribute("aria-labelledby")!)!.textContent).toBe("沈青梧");
    expect(modal.dataset.boardAsset).toBe("profile-qingwu");
    expect(modal.textContent).toContain("Character");
    expect(modal.textContent).toContain("女主");
    expect(modal.textContent).toContain("17 岁 · 灯铺传人");
    expect(marked("data-tag")).toEqual(["倔强", "心细", "怕水"]);
    expect(facts()).toMatchObject({ 造型: "青灰短袄，发间别一枚铜灯钩", 声线: "清亮，急了会结巴" });
    expect(modal.querySelectorAll("[data-swatch]")).toHaveLength(3);
    expect(modal.querySelector("img")!.getAttribute("src")).toContain(encodeURIComponent("产出/qingwu.png"));
    expect(modal.textContent).toContain("沈青梧：17 岁 · 灯铺传人。");
    expect(modal.textContent).toContain("少女，青灰短袄，铜灯钩发饰，雾中提灯，电影感侧光");
    expect(modal.textContent).toContain("In 7 shots");
    expect(marked("data-appearance")).toEqual(["shot-1-1", "shot-1-3", "shot-1-5", "shot-2-1", "shot-2-3", "shot-2-5", "shot-3-1"]);
  });
  it("says so when a character is in no shot yet", async () => {
    harness = await renderOverlay();
    await openAsset("group-aman");
    expect(details()!.textContent).toContain("Not in any shot yet.");
  });

  it("takes the focus, keeps Tab inside, and closes with Escape or its close button", async () => {
    harness = await renderOverlay();
    await openAsset("group-qingwu");
    expect(details()!.contains(document.activeElement)).toBe(true);
    const buttons = [...details()!.querySelectorAll<HTMLButtonElement>("button")];
    buttons.at(-1)!.focus();
    await press(buttons.at(-1)!, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    await press(details()!, { key: "Escape" });
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(details()).toBeNull();
    await openAsset("group-qingwu");
    await click(named("Close")!);
    expect(harness.close).toHaveBeenCalledTimes(2);
  });

  it("shows a shot's size, camera, length, sound, prompt and its selected take", async () => {
    harness = await renderOverlay();
    await openAsset("shot-1-3");
    expect(details()!.textContent).toContain("EP01 SH03");
    expect(facts()).toEqual({ Episode: "EP01", "Shot size": "全景", Camera: "固定", Length: "4s", Sound: "雾中传来的钟声" });
    expect(details()!.textContent).toContain("船影：雾中的码头，全景，固定");
    expect(details()!.querySelector("video")!.getAttribute("src")).toContain(encodeURIComponent("产出/ep1-sh3-v3.mp4"));
  });

  it("shows a shot video's versions, the one selected and whether it is still generating", async () => {
    harness = await renderOverlay();
    await openAsset("take-1-3-1");
    expect(details()!.dataset.boardAsset).toBe("creation-1-3");
    expect(details()!.textContent).toContain("Shot video");
    expect(facts()).toMatchObject({ Episode: "EP01", Versions: "3", Selected: "Version 3" });
    expect(details()!.textContent).toContain("船影：雾中的码头，全景，固定");
    await openAsset("creation-2-4");
    expect(facts()).toMatchObject({ Versions: "0", Selected: "None yet", Status: "Generating" });
    await openAsset("creation-2-5");
    expect(facts()).toMatchObject({ Status: "Didn't generate" });
  });

  it("shows a finished film's length and its JianYing draft", async () => {
    harness = await renderOverlay();
    await openAsset("final-1");
    expect(facts()).toMatchObject({ Episode: "EP01", Length: "29s", "JianYing draft": "Written: 雾港灯语 EP01" });
    expect(details()!.querySelector("video")!.getAttribute("src")).toContain(encodeURIComponent("成片/EP01.mp4"));
  });

  it("shows an episode's logline, status, shots and script", async () => {
    harness = await renderOverlay();
    await openAsset("episode-2");
    expect(details()!.textContent).toContain("Episode script");
    expect(facts()).toEqual({ Logline: "一艘不该存在的船靠了岸", Status: "Making videos", Shots: "3/5 selected" });
    expect(details()!.textContent).toContain("第 2 集《不在航表上的船》");
    expect(details()!.querySelector("img, video")).toBeNull();
  });

  it("asks the bot whose job made it to change it, with the asset as a reference", async () => {
    harness = await renderOverlay();
    await openAsset("group-qingwu");
    await click(named("Ask 画眉 to change it")!);
    expect(harness.focusNode).toHaveBeenCalledWith("bot:designer");
    expect(harness.open).toHaveBeenLastCalledWith({ kind: "bot", botId: "designer", references: ["profile-qingwu"] });
    expect(details()).toBeNull();
    expect(harness.host.querySelector("[data-reference='profile-qingwu']")).not.toBeNull();
    const owners: Array<[string, string]> = [
      ["group-pier-end", "镜川 EP01"],
      ["shot-2-3", "镜川 EP02"],
      ["creation-2-4", "镜川 EP02"],
      ["final-1", "剪秋 EP01"],
      ["episode-1", "墨白"],
      ["brief", "阿策"],
    ];
    for (const [nodeId, name] of owners) {
      await openAsset(nodeId);
      expect(named(`Ask ${name} to change it`), nodeId).toBeDefined();
    }
  });

  it("shows its card on the board", async () => {
    harness = await renderOverlay();
    await openAsset("image-qingwu");
    await click(named("Show on the board")!);
    expect(harness.focusNode).toHaveBeenCalledWith("group-qingwu");
    expect(details()).toBeNull();
  });

  it("opens a shot it appears in", async () => {
    harness = await renderOverlay();
    await openAsset("group-qingwu");
    await click(details()!.querySelector<HTMLElement>("[data-appearance='shot-1-3']")!);
    expect(harness.open).toHaveBeenLastCalledWith({ kind: "asset", nodeId: "shot-1-3" });
    expect(details()!.dataset.boardAsset).toBe("shot-1-3");
    expect(details()!.contains(document.activeElement)).toBe(true);
  });

  it("closes when the asset leaves the board", async () => {
    harness = await renderOverlay();
    await openAsset("final-1");
    const snapshot = harness.current().snapshot;
    await harness.update({ snapshot: { ...snapshot, nodes: snapshot.nodes.filter((node) => node.id !== "final-1") } });
    expect(harness.close).toHaveBeenCalled();
    expect(details()).toBeNull();
  });

  it("speaks the person's language", async () => {
    setLocale("zh");
    harness = await renderOverlay();
    await openAsset("shot-1-3");
    expect(facts()).toMatchObject({ 景别: "全景", 时长: "4 秒" });
    expect(named("让 镜川 EP01 调整")).toBeDefined();
    expect(named("在看板上定位")).toBeDefined();
  });
});
