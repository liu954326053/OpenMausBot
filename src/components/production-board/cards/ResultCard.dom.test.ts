// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultCard, type BoardTake, type ResultCardProps } from "./ResultCard";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();
afterEach(() => vi.restoreAllMocks());

const TAKES: BoardTake[] = [
  { id: "t1", videoUrl: "/files/sh03-v1.mp4", durationMs: 5000 },
  { id: "t2", videoUrl: "/files/sh03-v2.mp4", durationMs: 5200, selected: true },
  { id: "t3", videoUrl: "/files/sh03-v3.mp4", durationMs: 4800 },
];

const draw = (props: Partial<ResultCardProps> = {}) => render(createElement(ResultCard, { number: 3, title: "Qingwu lights the lamp", takes: TAKES, ...props }));
const versions = (card: HTMLElement) => [...card.querySelectorAll<HTMLButtonElement>("[data-result-take]")];
const shown = (card: HTMLElement) => card.querySelector("video")?.getAttribute("src");

describe("the result card", () => {
  it("shows the selected take, how many takes there are, and a button per take", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("result");
    expect(textOf(card.querySelector("[data-shot-code]"))).toBe("SH03");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Qingwu lights the lamp");
    expect(textOf(card.querySelector("[data-result-count]"))).toBe("Takes: 3");
    expect(versions(card).map((button) => [textOf(button), button.getAttribute("aria-pressed")])).toEqual([["V1", "false"], ["V2", "true"], ["V3", "false"]]);
    expect(shown(card)).toBe("/files/sh03-v2.mp4");
    expect(card.querySelector("video")!.getAttribute("preload")).toBe("metadata");
    expect(textOf(card.querySelector("[data-result-selected]"))).toBe("In the film");
    expect(textOf(card.querySelector("[data-result-length]"))).toBe("00:05");
  });

  it("shows the newest take when none is selected", () => {
    const card = draw({ takes: TAKES.map((take) => ({ ...take, selected: false })) });
    expect(shown(card)).toBe("/files/sh03-v3.mp4");
    expect(card.querySelector("[data-result-selected]")).toBeNull();
  });

  it("switches takes without opening, and selects the one it shows", () => {
    const onOpen = vi.fn();
    const onSelectTake = vi.fn();
    const card = draw({ onOpen, onSelectTake });
    click(versions(card)[2]);
    expect(shown(card)).toBe("/files/sh03-v3.mp4");
    expect(card.querySelector("[data-result-selected]")).toBeNull();
    click(buttonNamed(card, "Use this take"));
    expect(onSelectTake).toHaveBeenCalledWith("t3");
    expect(onOpen).not.toHaveBeenCalled();
    click(versions(card)[1]);
    expect(buttonNamed(card, "Use this take")).toBeUndefined();
  });

  it("plays the take it shows in place", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onPlay = vi.fn();
    const onOpen = vi.fn();
    const card = draw({ onPlay, onOpen });
    click(buttonNamed(card, "Play SH03 Qingwu lights the lamp"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith("t2");
    expect(onOpen).not.toHaveBeenCalled();
    expect(card.querySelector("video")!.hasAttribute("controls")).toBe(true);
  });

  it("says a take is being made without inventing how far along it is", () => {
    const first = draw({ takes: [], generation: { status: "loading" } });
    expect(textOf(first.querySelector("[data-result-media]"))).toBe("Generating…");
    expect(first.textContent).not.toMatch(/\d+\s*%/);
    const again = draw({ generation: { status: "loading" } });
    expect(shown(again)).toBe("/files/sh03-v2.mp4");
    expect(textOf(again.querySelector("[data-result-generating]"))).toBe("Generating…");
  });

  it("says why a take failed and offers to make it again", () => {
    const onGenerate = vi.fn();
    const failed = draw({ takes: [], generation: { status: "error", errorDetails: "The video model is busy" }, onGenerate });
    expect(failed.dataset.boardTone).toBe("failed");
    expect(textOf(failed.querySelector("[data-result-failure]"))).toBe("The video model is busy");
    click(buttonNamed(failed, "Generate again"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const none = draw({ takes: [], onGenerate });
    expect(textOf(none.querySelector("[data-result-media]"))).toContain("No video yet");
    click(buttonNamed(none, "Generate video"));
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  it("keeps a long title on one line", () => {
    const long = "A shot title long enough to run past the width of the card it is written on";
    const name = draw({ title: long }).querySelector<HTMLElement>("[data-card-name]")!;
    expect([name.className.includes("truncate"), name.title]).toEqual([true, long]);
  });
});
