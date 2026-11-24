// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BoardFarLabel, farLabelScale, type BoardFarLabelProps } from "./BoardFarLabel";
import { BOARD_CARD_SIZES } from "./sizes";
import { render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const draw = (props: Partial<BoardFarLabelProps> = {}) =>
  render(createElement(BoardFarLabel, { kind: "bot", name: "Jingchuan EP01", tone: "working", zoom: 0.25, statusLabel: "Working", ...props }));

describe("the far view label", () => {
  it("takes its card's place and shows its name with its state's colour", () => {
    const label = draw();
    expect(label.dataset.boardFar).toBe("bot");
    expect([label.style.width, label.style.height]).toEqual([`${BOARD_CARD_SIZES.bot.width}px`, `${BOARD_CARD_SIZES.bot.height}px`]);
    expect(textOf(label.querySelector("[data-far-name]"))).toBe("Jingchuan EP01");
    expect(label.querySelector("[data-far-dot]")!.className).toContain("bg-warning");
    expect(label.title).toBe("Jingchuan EP01 · Working");
    expect(draw({ tone: "failed" }).querySelector("[data-far-dot]")!.className).toContain("bg-danger");
  });

  it("grows as the board zooms out, so it stays readable, up to a limit", () => {
    expect(farLabelScale(1)).toBeCloseTo(0.86);
    expect(farLabelScale(2)).toBeCloseTo(0.86);
    expect(farLabelScale(0.25)).toBeCloseTo(3.44);
    expect(farLabelScale(0.01)).toBeCloseTo(0.86 * 13);
    expect(draw({ zoom: 0.25 }).querySelector<HTMLElement>("[data-far-pill]")!.style.transform).toBe(`scale(${farLabelScale(0.25)})`);
  });

  it("is never much wider on the board than its card, so neighbouring labels do not run into each other", () => {
    for (const zoom of [1, 0.25, 0.08]) {
      const pill = draw({ zoom }).querySelector<HTMLElement>("[data-far-pill]")!;
      expect(Number.parseFloat(pill.style.maxWidth) * farLabelScale(zoom)).toBeCloseTo(BOARD_CARD_SIZES.bot.width * 1.25);
    }
    expect(draw().querySelector("[data-far-name]")!.className).toContain("truncate");
  });
});
