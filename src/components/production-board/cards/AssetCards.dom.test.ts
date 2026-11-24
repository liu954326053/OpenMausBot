// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { CharacterCard, type CharacterCardProps } from "./CharacterCard";
import { SceneCard, type SceneCardProps } from "./SceneCard";
import { BOARD_CARD_SIZES } from "./sizes";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const character = (props: Partial<CharacterCardProps> = {}) => render(createElement(CharacterCard, {
  name: "Qingwu",
  facts: { badge: "Lead", subtitle: "24 · lamplighter", tags: ["Stubborn", "Kind"], rows: [["Look", "Grey coat, blue lamp"], ["Voice", "Low and quick"]], palette: ["#334455", "#ddeeff", "red"] },
  pictureUrl: "/files/qingwu.png",
  shots: [{ episode: 1, number: 1 }, { episode: 1, number: 3 }],
  ...props,
}));

const scene = (props: Partial<SceneCardProps> = {}) => render(createElement(SceneCard, {
  name: "Old pier",
  facts: { subtitle: "Night, fog", tags: ["Exterior"] },
  pictureUrl: "/files/pier.png",
  shots: [{ episode: 1, number: 1 }, { episode: 2, number: 4 }],
  ...props,
}));

describe("the character card", () => {
  it("shows the character's picture, name, part, line, tags, look and palette", () => {
    const card = character();
    expect(card.dataset.boardCard).toBe("character");
    expect(card.dataset.boardSurface).toBe("paper");
    expect(card.style.height).toBe(`${BOARD_CARD_SIZES.character.height}px`);
    const picture = card.querySelector("img")!;
    expect([picture.getAttribute("src"), picture.alt]).toEqual(["/files/qingwu.png", "Picture of Qingwu"]);
    expect(card.querySelector("[data-asset-picture]")!.className).toContain("w-38");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Qingwu");
    expect(card.querySelector("[data-card-name]")!.className).toContain("text-[21px]");
    expect(textOf(card.querySelector("[data-asset-badge]"))).toBe("Lead");
    expect(textOf(card.querySelector("[data-asset-subtitle]"))).toBe("24 · lamplighter");
    expect([...card.querySelectorAll("[data-asset-tag]")].map(textOf)).toEqual(["Stubborn", "Kind"]);
    expect([...card.querySelectorAll("[data-asset-row]")].map(textOf)).toEqual(["Look Grey coat, blue lamp", "Voice Low and quick"]);
    expect([...card.querySelectorAll<HTMLElement>("[data-asset-swatch]")].map((swatch) => swatch.title)).toEqual(["#334455", "#ddeeff"]);
    const swatches = [...card.querySelectorAll<HTMLElement>("[data-asset-swatch]")];
    expect([swatches[0]!.className.includes("size-4"), swatches[0]!.className.includes("-ms-1"), swatches[1]!.className.includes("-ms-1")]).toEqual([true, false, true]);
  });

  it("names the shots it is in", () => {
    expect(textOf(character().querySelector("[data-asset-shots]"))).toBe("In SH01 · SH03");
    expect(textOf(character({ shots: [] }).querySelector("[data-asset-shots]"))).toBe("In no shot yet");
  });

  it("offers to make a picture when it has none, and says when one is being made or failed", () => {
    const onGenerate = vi.fn();
    const onOpen = vi.fn();
    const none = character({ pictureUrl: undefined, onGenerate, onOpen });
    expect(textOf(none.querySelector("[data-asset-picture]"))).toContain("No picture yet");
    click(buttonNamed(none, "Generate picture"));
    expect([onGenerate.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 0]);

    const making = character({ pictureUrl: undefined, generation: { status: "loading" }, onGenerate });
    expect(textOf(making.querySelector("[data-asset-picture]"))).toBe("Generating…");
    expect(buttonNamed(making, "Generate picture")).toBeUndefined();

    const failed = character({ pictureUrl: undefined, generation: { status: "error", errorDetails: "The model refused the prompt" }, onGenerate });
    expect(textOf(failed.querySelector("[data-asset-failure]"))).toBe("The model refused the prompt");
    click(buttonNamed(failed, "Generate again"));
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  it("keeps its picture while a new one is made", () => {
    const card = character({ generation: { status: "loading" } });
    expect(card.querySelector("img")).not.toBeNull();
    expect(textOf(card.querySelector("[data-asset-generating]"))).toBe("Generating…");
  });

  it("cuts long words short inside it", () => {
    const long = "A name long enough to run past the width of the card it is written on";
    const card = character({ name: long, facts: { subtitle: long, rows: [["Look", long.repeat(3)]] } });
    expect(card.querySelector<HTMLElement>("[data-card-name]")!.className).toContain("truncate");
    expect(card.querySelector<HTMLElement>("[data-asset-subtitle]")!.className).toContain("truncate");
    expect(card.querySelector<HTMLElement>("[data-asset-row] dd")!.className).toContain("truncate");
  });

  it("opens on a click", () => {
    const onOpen = vi.fn();
    click(character({ onOpen }).querySelector("img"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("the scene card", () => {
  it("shows the scene's picture, name, line and the shots that use it, across episodes", () => {
    const card = scene();
    expect(card.dataset.boardCard).toBe("scene");
    expect(card.dataset.boardSurface).toBe("paper");
    expect(card.querySelector("img")!.getAttribute("src")).toBe("/files/pier.png");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Old pier");
    expect(card.querySelector("[data-card-name]")!.className).toContain("text-[18px]");
    expect(textOf(card.querySelector("[data-asset-subtitle]"))).toBe("Night, fog");
    expect(textOf(card.querySelector("[data-asset-shots]"))).toBe("Used in EP01 SH01 · EP02 SH04");
  });

  it("draws its palette as a 6px strip along the foot of the card", () => {
    const strip = scene({ facts: { subtitle: "Night, fog", palette: ["#223344", "#ffcc88", "blue"] } }).querySelector<HTMLElement>("[data-scene-palette]");
    expect(strip!.className).toContain("h-1.5");
    expect([...strip!.querySelectorAll<HTMLElement>("[data-asset-swatch]")].map((swatch) => swatch.title)).toEqual(["#223344", "#ffcc88"]);
    expect(scene().querySelector("[data-scene-palette]")).toBeNull();
  });

  it("marks a refined scene with an amber tag naming the bot that refined it", () => {
    const tag = scene({ refinedBy: "Jingchuan EP01" }).querySelector<HTMLElement>("[data-scene-refined]")!;
    expect(textOf(tag)).toBe("Refined");
    expect(tag.title).toBe("Refined by Jingchuan EP01");
    expect(tag.className).toContain("bg-board-amber");
    expect(scene().querySelector("[data-scene-refined]")).toBeNull();
  });

  it("offers to make a picture when it has none", () => {
    const onGenerate = vi.fn();
    click(buttonNamed(scene({ pictureUrl: undefined, onGenerate }), "Generate picture"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("speaks the person's language", () => {
    setLocale("zh");
    expect(textOf(scene().querySelector("[data-asset-shots]"))).toBe("用于 EP01 SH01 · EP02 SH04");
  });
});
