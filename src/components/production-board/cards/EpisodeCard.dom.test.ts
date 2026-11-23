// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProductionEpisodeWire } from "../../../../shared/production";
import { EpisodeCard, type EpisodeCardProps } from "./EpisodeCard";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const EPISODE: ProductionEpisodeWire = {
  episode: 1, nodeId: "ep-1", title: "The lamplighter", status: "videos", storyboardBotId: "jingchuan-ep01", postBotId: "jianqiu-ep01",
  shots: 6, ready: 4, generating: 1, failed: 0,
};
const SCRIPT = "Scene 1. The pier at night.\nFog lies on the water.\nQingwu hangs a lamp on the post.";

const draw = (props: Partial<EpisodeCardProps> = {}) =>
  render(createElement(EpisodeCard, { episode: EPISODE, logline: "The harbour's lamps have been dark for ten years.", text: SCRIPT, to: { name: "Jingchuan EP01" }, ...props }));

describe("the episode card", () => {
  it("shows its code, title, state, logline and first lines", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("episode");
    expect(textOf(card.querySelector("[data-episode-code]"))).toBe("EP01");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("The lamplighter");
    expect(textOf(card.querySelector("[data-board-status]"))).toBe("Making videos");
    expect(textOf(card.querySelector("[data-episode-logline]"))).toBe("The harbour's lamps have been dark for ten years.");
    expect(card.querySelector("[data-episode-text]")!.textContent).toBe(SCRIPT);
  });

  it("says how many of its shots are ready and whom it went to", () => {
    const card = draw();
    expect(textOf(card.querySelector("[data-episode-shots]"))).toBe("Shots ready 4 / 6");
    const to = card.querySelector<HTMLElement>("[data-bot-chip]")!;
    expect([textOf(to.querySelector("[data-bot-chip-name]")), to.title]).toEqual(["Jingchuan EP01", "Went to Jingchuan EP01"]);
  });

  it("says how long its shots run together", () => {
    expect(textOf(draw({ seconds: 36 }).querySelector("[data-episode-length]"))).toBe("36s");
    expect(draw().querySelector("[data-episode-length]")).toBeNull();
    const alone = draw({ episode: { episode: 1, title: "The whole drama" }, to: undefined, seconds: 36 });
    expect(textOf(alone.querySelector("[data-episode-length]"))).toBe("36s");
  });

  it("draws an episode before the production opened it, or a script from before episodes", () => {
    const card = draw({ episode: { episode: 1, title: "The whole drama" }, logline: undefined, text: undefined, to: undefined });
    expect(card.querySelector("[data-board-status]")).toBeNull();
    expect(card.querySelector("[data-episode-shots]")).toBeNull();
    expect(textOf(card.querySelector("[data-episode-text]"))).toBe("No script yet");
  });

  it("offers a retry when it failed, which does not open it", () => {
    const onOpen = vi.fn();
    const onRetry = vi.fn();
    const card = draw({ episode: { ...EPISODE, status: "failed", failed: 1 }, onOpen, onRetry });
    expect(card.querySelector<HTMLElement>("[data-board-status]")!.dataset.boardStatus).toBe("failed");
    click(buttonNamed(card, "Retry"));
    expect([onRetry.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 0]);
    click(card.querySelector("[data-episode-logline]"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(buttonNamed(draw({ onRetry }), "Retry")).toBeUndefined();
  });

  it("cuts a long title, logline and script short inside it", () => {
    const long = "A title long enough to run past the width of the card it is written on";
    const card = draw({ episode: { ...EPISODE, title: long }, logline: long.repeat(3), text: `${long}\n`.repeat(20) });
    const name = card.querySelector<HTMLElement>("[data-card-name]")!;
    expect([name.className.includes("truncate"), name.title]).toEqual([true, long]);
    expect(card.querySelector<HTMLElement>("[data-episode-logline]")!.className).toContain("line-clamp-2");
    expect(card.querySelector<HTMLElement>("[data-episode-text]")!.className).toContain("overflow-hidden");
  });
});
