// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { EpisodeStackCard, type EpisodeStackCardProps } from "./EpisodeStackCard";
import { click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const draw = (props: Partial<EpisodeStackCardProps> = {}) => render(createElement(EpisodeStackCard, {
  first: 4, last: 60, count: 57,
  titles: [{ episode: 4, title: "The ledger under the clock" }, { episode: 5, title: "A second blue lamp" }, { episode: 6, title: "The guild's dinner" }, { episode: 60, title: "The fog lifts" }],
  ...props,
}));

describe("the episode stack", () => {
  it("names the episodes it holds and how many", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("episodeStack");
    expect(card.dataset.boardSurface).toBe("paper");
    expect(textOf(card.querySelector("[data-stack-range]"))).toBe("EP04 – EP60");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("57 more episodes");
  });

  it("is a pile of punched script pages, its range stamped in ink", () => {
    const card = draw();
    expect(card.className).toContain("board-paper-stack");
    expect(card.querySelectorAll("[data-sc-holes] [data-sc-hole]")).toHaveLength(3);
    expect(card.querySelector("[data-stack-range] [data-paper-code]")!.className).toContain("bg-board-ink");
  });

  it("lists a few titles, with a gap where episodes are left out", () => {
    const items = [...draw().querySelectorAll<HTMLElement>("[data-stack-item]")].map((item) => textOf(item));
    expect(items).toEqual(["EP04 The ledger under the clock", "EP05 A second blue lamp", "EP06 The guild's dinner", "···", "EP60 The fog lifts"]);
  });

  it("sums up how its episodes stand", () => {
    const card = draw({ statuses: { done: 12, waiting: 44, failed: 1 } });
    expect([...card.querySelectorAll("[data-stack-status]")].map(textOf)).toEqual(["Done 12", "Not started 44", "Failed 1"]);
    expect(draw().querySelector("[data-stack-status]")).toBeNull();
  });

  it("opens on a click, and speaks the person's language", () => {
    const onOpen = vi.fn();
    click(draw({ onOpen }).querySelector("[data-stack-item]"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    setLocale("zh");
    expect(textOf(draw().querySelector("[data-card-name]"))).toBe("其余 57 集");
  });
});
