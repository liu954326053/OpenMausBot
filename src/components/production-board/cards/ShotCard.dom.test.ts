// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ShotCard, type ShotCardProps } from "./ShotCard";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const draw = (props: Partial<ShotCardProps> = {}) => render(createElement(ShotCard, {
  number: 3, episode: 1, title: "Qingwu lights the lamp",
  design: { size: "Close-up", move: "Slow push-in", audio: "Qingwu: \"One more night.\"" },
  seconds: 5,
  prompt: "Her hand turns the brass key; the flame catches and the fog glows blue.",
  references: [{ kind: "character", name: "Qingwu", pictureUrl: "/files/qingwu.png" }, { kind: "scene", name: "Old pier" }],
  ...props,
}));

describe("the shot card", () => {
  it("shows its code, title, size, move, length, sound and what it shows, in words only", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("shot");
    expect(textOf(card.querySelector("[data-shot-code]"))).toBe("SH03");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Qingwu lights the lamp");
    expect([...card.querySelectorAll("[data-shot-fact]")].map(textOf)).toEqual(["Size Close-up", "Move Slow push-in", "Length 5s"]);
    expect(textOf(card.querySelector("[data-shot-audio]"))).toBe("Qingwu: \"One more night.\"");
    expect(textOf(card.querySelector("[data-shot-prompt]"))).toBe("Her hand turns the brass key; the flame catches and the fog glows blue.");
  });

  it("shows the characters and scene it uses as small pictures named on hover", () => {
    const refs = [...draw().querySelectorAll<HTMLElement>("[data-shot-reference]")];
    expect(refs.map((ref) => [ref.dataset.shotReference, ref.title])).toEqual([["character", "Qingwu"], ["scene", "Old pier"]]);
    expect(refs[0]!.querySelector("img")!.getAttribute("src")).toBe("/files/qingwu.png");
    expect(textOf(refs[1])).toBe("O");
  });

  it("names the characters and scene it uses beside their pictures when the names fit, and shows the pictures alone when they do not", () => {
    const names = (card: HTMLElement) => [...card.querySelectorAll("[data-shot-reference-name]")].map(textOf);
    const named = draw({ referenceNames: true });
    expect(names(named)).toEqual(["Qingwu", "Old pier"]);
    expect(named.querySelector("[data-shot-reference] img")!.getAttribute("src")).toBe("/files/qingwu.png");
    const chinese = [{ kind: "scene" as const, name: "栈桥尽头" }, { kind: "character" as const, name: "沈青梧" }, { kind: "character" as const, name: "陆沉舟" }];
    expect(names(draw({ referenceNames: true, references: chinese }))).toEqual(["栈桥尽头", "沈青梧", "陆沉舟"]);
    const crowd = Array.from({ length: 5 }, (_, index) => ({ kind: "character" as const, name: `Someone with a long name ${index + 1}` }));
    const crowded = draw({ referenceNames: true, references: crowd });
    expect(names(crowded)).toEqual([]);
    expect(crowded.querySelectorAll("[data-shot-reference]")).toHaveLength(5);
    expect(names(draw())).toEqual([]);
  });

  it("says where its video stands and offers to make one", () => {
    const onGenerate = vi.fn();
    const onOpen = vi.fn();
    const none = draw({ onGenerate, onOpen });
    expect(textOf(none.querySelector("[data-board-status]"))).toBe("No video yet");
    click(buttonNamed(none, "Generate video"));
    expect([onGenerate.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 0]);

    const making = draw({ generation: { status: "loading" }, onGenerate });
    expect(textOf(making.querySelector("[data-board-status]"))).toBe("Generating…");
    expect(buttonNamed(making, "Generate video")).toBeUndefined();

    const ready = draw({ takes: 2, onGenerate });
    expect(textOf(ready.querySelector("[data-board-status]"))).toBe("Video ready");
    expect(textOf(ready.querySelector("[data-shot-takes]"))).toBe("Takes: 2");

    const failed = draw({ generation: { status: "error", errorKey: "serverError.projectGeneration.noVideoServer", errorDetails: "No video server" }, onGenerate });
    expect(failed.querySelector<HTMLElement>("[data-board-status]")!.dataset.boardStatus).toBe("failed");
    expect(textOf(failed.querySelector("[data-shot-failure]"))).toBe("Choose an MCP server for videos in this project's settings first.");
    click(buttonNamed(failed, "Generate again"));
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  it("says where it plays in its episode", () => {
    const time = draw({ startsAt: 12 }).querySelector<HTMLElement>("[data-shot-time]")!;
    expect([textOf(time), time.title]).toEqual(["00:12 – 00:17", "At 00:12 – 00:17 in EP01"]);
    expect(textOf(draw({ startsAt: 0, seconds: undefined, episode: undefined }).querySelector("[data-shot-time]"))).toBe("00:00");
    expect(draw().querySelector("[data-shot-time]")).toBeNull();
  });

  it("marks itself, quietly, when something it was made from changed after it was made", () => {
    const badge = draw({ stale: true }).querySelector<HTMLElement>("[data-stale]")!;
    expect(textOf(badge)).toBe("Outdated");
    expect(badge.title).toBe("Something this shot was made from changed after it was made.");
    expect(draw().querySelector("[data-stale]")).toBeNull();
  });

  it("says when it has no description, and cuts long text short", () => {
    expect(textOf(draw({ prompt: undefined }).querySelector("[data-shot-prompt]"))).toBe("No description yet");
    const long = "A description that goes on and on, past what a shot card of this size can show in three lines of text";
    const card = draw({ prompt: long.repeat(3), design: { size: long, move: long, audio: long } });
    expect(card.querySelector<HTMLElement>("[data-shot-prompt]")!.className).toContain("line-clamp-2");
    expect(card.querySelector<HTMLElement>("[data-shot-fact] dd")!.className).toContain("truncate");
    expect(card.querySelector<HTMLElement>("[data-shot-audio]")!.className).toContain("truncate");
  });

  it("opens on a click, and speaks the person's language", () => {
    const onOpen = vi.fn();
    click(draw({ onOpen }).querySelector("[data-shot-prompt]"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    setLocale("zh");
    expect([...draw().querySelectorAll("[data-shot-fact] dt")].map(textOf)).toEqual(["景别", "运镜", "时长"]);
  });
});
