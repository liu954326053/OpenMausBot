// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenericCard, type GenericCardProps } from "./GenericCard";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();
afterEach(() => vi.restoreAllMocks());

const draw = (node: GenericCardProps["node"], props: Partial<GenericCardProps> = {}) => render(createElement(GenericCard, { node, ...props }));

describe("the generic card", () => {
  it("shows a text node's title and the start of its text", () => {
    const card = draw({ type: "text", title: "Notes", metadata: { content: "Fog lies on the water.\nThe lamps are dark." } });
    expect(card.dataset.boardCard).toBe("generic");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Notes");
    const text = card.querySelector<HTMLElement>("[data-generic-text]")!;
    expect(text.textContent).toBe("Fog lies on the water.\nThe lamps are dark.");
    expect(text.className).toContain("overflow-hidden");
    expect(textOf(draw({ type: "text", title: "Empty" }).querySelector("[data-generic-text]"))).toBe("Nothing here yet");
  });

  it("shows an image node's picture, or that it is being made, or why it failed", () => {
    const onGenerate = vi.fn();
    expect(draw({ type: "image", title: "Pier at dawn" }, { fileUrl: "/files/pier.png" }).querySelector("img")!.getAttribute("src")).toBe("/files/pier.png");
    expect(textOf(draw({ type: "image", title: "Pier", metadata: { status: "loading" } }).querySelector("[data-generic-media]"))).toBe("Generating…");
    const failed = draw({ type: "image", title: "Pier", metadata: { status: "error", errorDetails: "Refused" } }, { onGenerate });
    expect(textOf(failed.querySelector("[data-generic-failure]"))).toBe("Refused");
    click(buttonNamed(failed, "Generate again"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("plays a video node in place", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onPlay = vi.fn();
    const onOpen = vi.fn();
    const card = draw({ type: "video", title: "Teaser", metadata: { durationMs: 12_000 } }, { fileUrl: "/files/teaser.mp4", onPlay, onOpen });
    expect(card.querySelector("video")!.getAttribute("src")).toBe("/files/teaser.mp4");
    click(buttonNamed(card, "Play Teaser"));
    expect([play.mock.calls.length, onPlay.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 1, 0]);
  });

  it("gives a sound its player, whose controls leave the card closed, and a file its name", () => {
    const onOpen = vi.fn();
    const audio = draw({ type: "audio", title: "Theme" }, { fileUrl: "/files/theme.mp3", onOpen }).querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("/files/theme.mp3");
    click(audio);
    expect(onOpen).not.toHaveBeenCalled();
    expect(textOf(draw({ type: "file", title: "script.pdf" }).querySelector("[data-card-name]"))).toBe("script.pdf");
  });

  it("opens on a click", () => {
    const onOpen = vi.fn();
    click(draw({ type: "text", title: "Notes", metadata: { content: "x" } }, { onOpen }).querySelector("[data-generic-text]"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
