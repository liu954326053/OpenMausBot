// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultCard, type BoardTake, type ResultCardProps } from "./ResultCard";
import { buttonNamed, click, press, render, textOf, useCardPage } from "./dom-test-kit";

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
    expect(card.dataset.boardSurface).toBe("monitor");
    expect(card.querySelector("[data-result-media]")!.className).toContain("aspect-video");
    expect(textOf(card.querySelector("[data-shot-code]"))).toBe("SH03");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Qingwu lights the lamp");
    expect(textOf(card.querySelector("[data-result-count]"))).toBe("Takes: 3");
    expect(versions(card).map((button) => [textOf(button), button.getAttribute("aria-pressed")])).toEqual([["V1", "false"], ["V2", "true"], ["V3", "false"]]);
    expect(shown(card)).toBe("/files/sh03-v2.mp4");
    expect(card.querySelector("video")!.getAttribute("preload")).toBe("metadata");
    expect(textOf(card.querySelector("[data-result-selected]"))).toBe("In the film");
    expect(textOf(card.querySelector("[data-result-length]"))).toBe("00:05");
    expect(card.querySelector<HTMLElement>("[data-result-status]")!.dataset.resultStatus).toBe("done");
    expect(buttonNamed(card, "Play SH03 Qingwu lights the lamp")!.className).toContain("size-12");
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

  describe("with more takes than fit", () => {
    const MANY: BoardTake[] = Array.from({ length: 8 }, (_, index) => ({ id: `m${index + 1}`, videoUrl: `/files/m${index + 1}.mp4`, selected: index === 1 }));
    const strip = (card: HTMLElement) => [...card.querySelectorAll("[data-result-strip] > [data-result-take]")].map(textOf);
    const more = (card: HTMLElement) => card.querySelector<HTMLButtonElement>("[data-result-more]")!;
    const panelOf = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-controls")!)!;

    it("keeps the selected and the newest takes in view, and reaches the rest from one button", () => {
      const onOpen = vi.fn();
      const card = draw({ takes: MANY, onOpen });
      expect(strip(card)).toEqual(["V2", "V7", "V8"]);
      const button = more(card);
      expect([textOf(button), button.getAttribute("aria-label"), button.getAttribute("aria-expanded"), panelOf(button).hidden]).toEqual(["+5", "5 more takes", "false", true]);
      click(button);
      expect([button.getAttribute("aria-expanded"), panelOf(button).hidden]).toEqual(["true", false]);
      const others = [...panelOf(button).querySelectorAll<HTMLButtonElement>("[data-result-take]")];
      expect(others.map(textOf)).toEqual(["V1", "V3", "V4", "V5", "V6"]);
      click(others[2]);
      expect(shown(card)).toBe("/files/m4.mp4");
      expect([button.getAttribute("aria-expanded"), document.activeElement]).toEqual(["false", button]);
      expect(strip(card)).toEqual(["V2", "V4", "V8"]);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("closes the other takes on Escape and gives the focus back to the button that opened them", () => {
      const card = draw({ takes: MANY });
      const button = more(card);
      click(button);
      const first = panelOf(button).querySelector<HTMLButtonElement>("[data-result-take]")!;
      first.focus();
      press(first, "Escape");
      expect([button.getAttribute("aria-expanded"), panelOf(button).hidden, document.activeElement]).toEqual(["false", true, button]);
    });

    it("shows every take when they all fit", () => {
      const card = draw({ takes: MANY.slice(0, 4) });
      expect(strip(card)).toEqual(["V1", "V2", "V3", "V4"]);
      expect(card.querySelector("[data-result-more]")).toBeNull();
    });
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
    click(card.querySelector("video"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks the take it shows, quietly, when that take was made before a change to what it was made from", () => {
    const card = draw({ takes: [{ ...TAKES[0]!, stale: true }, TAKES[1]!, TAKES[2]!] });
    expect(card.querySelector("[data-stale]")).toBeNull();
    click(versions(card)[0]);
    const badge = card.querySelector<HTMLElement>("[data-stale]")!;
    expect(textOf(badge)).toBe("Outdated");
    expect(badge.title).toBe("Something this take was made from changed after it was made. Generate it again to bring it up to date.");
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
