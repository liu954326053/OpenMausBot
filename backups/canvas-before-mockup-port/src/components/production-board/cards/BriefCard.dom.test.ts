// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { BriefCard, type BriefCardProps } from "./BriefCard";
import { BOARD_CARD_SIZES } from "./sizes";
import { click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const ROWS: Array<[string, string]> = [
  ["Project", "Lamps of the Fog Harbour, as a comic drama"],
  ["Episodes", "60, about 40 seconds each"],
  ["Format", "16:9, 1080p"],
];

const draw = (props: Partial<BriefCardProps> = {}) => render(createElement(BriefCard, { rows: ROWS, ...props }));

describe("the brief card", () => {
  it("is the size the board lays it out at, titled and marked agreed", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("brief");
    expect(card.dataset.boardSurface).toBe("paper");
    expect(card.style.width).toBe(`${BOARD_CARD_SIZES.brief.width}px`);
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Brief");
    expect(textOf(card.querySelector("[data-brief-agreed]"))).toBe("Agreed");
  });

  it("heads a sheet of paper with its code and version, ruled in ink", () => {
    const card = draw();
    const header = card.querySelector("[data-brief-code]")!.parentElement!;
    expect(header.className).toContain("border-b-[1.5px]");
    expect(textOf(card.querySelector("[data-brief-code]"))).toBe("REQ-001");
    expect(textOf(card.querySelector("[data-brief-version]"))).toBe("v1");
    expect(card.querySelector("[data-brief-agreed]")!.className).toContain("-rotate-4");
  });

  it("lists its lines as a label and a value each, in a part that scrolls", () => {
    const card = draw();
    const rows = [...card.querySelectorAll("[data-brief-row]")].map((row) => [textOf(row.querySelector("dt")), textOf(row.querySelector("dd"))]);
    expect(rows).toEqual(ROWS);
    expect(card.querySelector("dl")!.hasAttribute("data-canvas-scroll")).toBe(true);
    expect(card.querySelector("[data-brief-row]")!.className).toContain("border-dashed");
    expect(card.querySelector("dt")!.className).toContain("w-10");
  });

  it("cuts a long value at two lines, keeping it whole in its tooltip", () => {
    const long = "A value that goes on for longer than two lines of a card that is only three hundred and twenty pixels wide";
    const card = draw({ rows: [["Style", long]] });
    const value = card.querySelector<HTMLElement>("dd")!;
    expect(value.className).toContain("line-clamp-2");
    expect(value.title).toBe(long);
  });

  it("shows its text when it has no lines, and says when it has neither", () => {
    expect(textOf(draw({ rows: [], text: "A drama in sixty parts." }).querySelector("[data-brief-text]"))).toBe("A drama in sixty parts.");
    expect(textOf(draw({ rows: [] }).querySelector("[data-brief-text]"))).toBe("No lines yet");
  });

  it("names who wrote it and when", () => {
    const card = draw({ by: "Ace", at: new Date(2026, 10, 24, 10, 12).getTime() });
    expect(textOf(card.querySelector("[data-brief-by]"))).toMatch(/^Written by Ace · 10:12/);
    expect(draw().querySelector("[data-brief-by]")).toBeNull();
  });

  it("opens on a click", () => {
    const onOpen = vi.fn();
    click(draw({ onOpen }).querySelector("dd"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
