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
