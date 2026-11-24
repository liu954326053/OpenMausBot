// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasSnapshot } from "../../../../shared/project-canvas";
import { setLocale } from "@/lib/i18n";
import { bigBoardSnapshot } from "./testing/board-sample";
import { renderOverlay, type OverlayHarness } from "./testing/render-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let harness: OverlayHarness;

afterEach(() => {
  harness.unmount();
  setLocale("en");
});

const panel = () => harness.host.querySelector<HTMLElement>("[data-board-side-panel]")!;
const tab = (name: string) => [...harness.host.querySelectorAll<HTMLElement>("[role=tab]")].find((each) => each.textContent === name)!;
const rows = () => [...panel().querySelectorAll<HTMLButtonElement>("[role=tabpanel] button")];
const row = (text: string) => rows().find((each) => each.textContent?.includes(text))!;
const click = (element: HTMLElement) => act(async () => {
  element.click();
});
const press = (element: HTMLElement, key: string) => act(async () => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
});

describe("the board's side panel", () => {
  it("opens on a wide board with the team in work order, each with their title and status", async () => {
    harness = await renderOverlay();
    expect(panel().hidden).toBe(false);
    expect(tab("Team").getAttribute("aria-selected")).toBe("true");
    expect([...panel().querySelectorAll("[data-team-row]")].map((each) => each.getAttribute("data-team-row"))).toEqual([
      "lead", "writer", "designer", "scenery", "board", "post", "publicist", "board-1", "post-1", "board-2", "board-3",
    ]);
    expect(row("阿策").querySelector("[aria-label='Lead']")).not.toBeNull();
    expect(row("墨白").querySelector("[aria-label='Lead']")).toBeNull();
    expect(row("镜川 EP02").textContent).toContain("分镜脚本设计师");
    expect(row("镜川 EP02").textContent).toContain("Working");
    expect(row("镜川 EP02").querySelector("[aria-label='New messages']")).not.toBeNull();
    expect(row("镜川 EP03").querySelector("[aria-label='New messages']")).toBeNull();
    expect(row("镜川 EP03").textContent).toContain("Waiting for you");
    expect(panel().textContent).toContain("Each episode");
  });

  it("starts folded on a narrow board, and folds and unfolds when the person says", async () => {
    harness = await renderOverlay({}, { width: 800, height: 600 });
    expect(panel().hidden).toBe(true);
    const show = harness.host.querySelector<HTMLButtonElement>("button[aria-label='Show the team and assets']")!;
    expect(show.getAttribute("aria-expanded")).toBe("false");
    expect(show.getAttribute("aria-controls")).toBe(panel().id);
    await click(show);
    expect(panel().hidden).toBe(false);
    await click(harness.host.querySelector<HTMLButtonElement>("button[aria-label='Hide the team and assets']")!);
    expect(panel().hidden).toBe(true);
  });

  it("measures out the room it keeps at the board's right edge: the open panel with its inset, the folded button with the gap beside it", async () => {
    harness = await renderOverlay();
    const rooms = () => [...harness.host.querySelectorAll<HTMLElement>("[data-board-room]")];
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]).toBe(panel());
    expect(rooms()[0].style.width).toBe("304px");
    await click(harness.host.querySelector<HTMLButtonElement>("button[aria-label='Hide the team and assets']")!);
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]).not.toBe(panel());
    expect(rooms()[0].style.width).toBe("68px");
    const show = harness.host.querySelector<HTMLButtonElement>("button[aria-label='Show the team and assets']")!;
    expect(rooms()[0].contains(show)).toBe(true);
    await click(show);
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]).toBe(panel());
    expect(rooms()[0].style.width).toBe("304px");
  });

  it("brings a bot's card into view and opens its chat", async () => {
    harness = await renderOverlay();
    await click(row("墨白"));
    expect(harness.focusNode).toHaveBeenCalledWith("bot:writer");
    expect(harness.open).toHaveBeenCalledWith({ kind: "bot", botId: "writer" });
    expect(row("墨白").getAttribute("aria-current")).toBe("true");
  });

  it("sorts the assets by kind and brings a card into view, a shot inside its episode", async () => {
    harness = await renderOverlay();
    await click(tab("Assets"));
    expect(panel().textContent).toContain("Characters");
    expect(panel().textContent).toContain("Scenes");
    await click(row("沈青梧"));
    expect(harness.focusNode).toHaveBeenLastCalledWith("group-qingwu");
    expect(row("沈青梧").querySelector("img")?.getAttribute("src")).toContain(encodeURIComponent("产出/qingwu.png"));
    const episode = row("EP02");
    expect(episode.getAttribute("aria-expanded")).toBe("false");
    expect(row("SH03")).toBeUndefined();
    await click(episode);
    expect(row("EP02").getAttribute("aria-expanded")).toBe("true");
    await click(row("SH03"));
    expect(harness.focusNode).toHaveBeenLastCalledWith("shot-2-3");
    await click(row("点灯的人 成片"));
    expect(harness.focusNode).toHaveBeenLastCalledWith("final-1");
  });

  it("lists each episode with its status and selected shots, and brings it into view", async () => {
    harness = await renderOverlay();
    await click(tab("Episodes"));
    expect(rows().map((each) => each.textContent?.slice(0, 4))).toEqual(["EP01", "EP02", "EP03", "EP04"]);
    expect(row("EP02").textContent).toContain("不在航表上的船");
    expect(row("EP02").textContent).toContain("Making videos");
    expect(row("EP02").textContent).toContain("3/5 selected");
    expect(row("EP04").textContent).toContain("Not started");
    expect(row("EP04").textContent).toContain("No shots yet");
    await click(row("EP02"));
    expect(harness.focusEpisode).toHaveBeenCalledWith(2);
  });

  it("moves between the tabs with the arrow keys", async () => {
    harness = await renderOverlay();
    tab("Team").focus();
    await press(tab("Team"), "ArrowRight");
    expect(tab("Assets").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Assets"));
    await press(tab("Assets"), "End");
    expect(document.activeElement).toBe(tab("Episodes"));
    await press(tab("Episodes"), "ArrowRight");
    expect(document.activeElement).toBe(tab("Team"));
    await press(tab("Team"), "ArrowLeft");
    expect(tab("Episodes").getAttribute("aria-selected")).toBe("true");
    expect(tab("Team").tabIndex).toBe(-1);
  });

  it("holds a drama of 60 episodes and its 127 bots", async () => {
    harness = await renderOverlay({ snapshot: bigBoardSnapshot(60) });
    expect(panel().querySelectorAll("[data-team-row]")).toHaveLength(127);
    await click(tab("Episodes"));
    expect(rows()).toHaveLength(60);
    await click(tab("Assets"));
    expect(rows().filter((each) => each.hasAttribute("aria-expanded"))).toHaveLength(60);
  });

  it("speaks the person's language", async () => {
    setLocale("zh");
    harness = await renderOverlay();
    expect([...harness.host.querySelectorAll("[role=tab]")].map((each) => each.textContent)).toEqual(["团队", "素材分类", "分集"]);
    expect(row("镜川 EP03").textContent).toContain("等你回答");
  });

  const inTrouble = (snapshot: CanvasSnapshot): CanvasSnapshot => ({
    ...snapshot,
    production: { ...snapshot.production!, episodes: snapshot.production!.episodes.map((one) => (one.episode === 3 ? { ...one, status: "failed" as const } : one)) },
    bots: { ...snapshot.bots, writer: { ...snapshot.bots.writer!, status: "error" } },
  });

  it("says what the team and the episodes are doing in the words of the board's cards", async () => {
    harness = await renderOverlay();
    await harness.update({ snapshot: inTrouble(harness.current().snapshot) });
    expect(row("阿策").textContent).toContain("Idle");
    expect(row("墨白").textContent).toContain("Error");
    await click(tab("Episodes"));
    expect(row("EP03").textContent).toContain("Failed");
    expect(row("EP04").textContent).toContain("Not started");
  });

  it("says them in the words of the board's cards in the person's language too", async () => {
    setLocale("zh");
    harness = await renderOverlay();
    await harness.update({ snapshot: inTrouble(harness.current().snapshot) });
    expect(row("阿策").textContent).toContain("空闲");
    expect(row("墨白").textContent).toMatch(/出错$/);
    await click(tab("分集"));
    expect(row("EP03").textContent).toContain("失败");
    expect(row("EP04").textContent).toContain("待开工");
  });
});
