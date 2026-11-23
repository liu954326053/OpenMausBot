// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDraftWire } from "../../../../shared/project-draft";
import { setLocale } from "@/lib/i18n";
import { FinalCard, type FinalCardProps, type FinalClip } from "./FinalCard";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();
afterEach(() => vi.restoreAllMocks());

const CLIPS: FinalClip[] = [
  { number: 1, state: "ready", durationMs: 5000 },
  { number: 2, state: "ready", durationMs: 4000 },
  { number: 3, state: "generating" },
  { number: 4, state: "missing" },
];
const DRAFT: ProjectDraftWire = { state: "written", name: "Lamps of the Fog Harbour EP01", writtenAt: 1, exportFolder: "/tmp/out" };

const draw = (props: Partial<FinalCardProps> = {}) => render(createElement(FinalCard, { episode: 1, title: "The lamplighter", clips: CLIPS, ...props }));

describe("the final card", () => {
  it("names its episode's film and lists its shots, each ready or not", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("final");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Film · EP01");
    expect(textOf(card.querySelector("[data-final-title]"))).toBe("The lamplighter");
    const clips = [...card.querySelectorAll<HTMLElement>("[data-final-clip]")];
    expect(clips.map((clip) => [textOf(clip), clip.dataset.finalClip, clip.title])).toEqual([
      ["SH01", "ready", "SH01: ready"], ["SH02", "ready", "SH02: ready"], ["SH03", "generating", "SH03: not ready yet"], ["SH04", "missing", "SH04: not ready yet"],
    ]);
    expect(textOf(card.querySelector("[data-final-progress]"))).toBe("Waiting for shots 2 / 4");
  });

  it("draws an episode of many shots as a strip of colours, each shot still named on hover", () => {
    const many: FinalClip[] = Array.from({ length: 24 }, (_, index) => ({ number: index + 1, state: index < 20 ? "ready" : "missing" }));
    const clips = [...draw({ clips: many }).querySelectorAll<HTMLElement>("[data-final-clip]")];
    expect(clips).toHaveLength(24);
    expect(clips.every((clip) => textOf(clip) === "")).toBe(true);
    expect([clips[0]!.title, clips[23]!.title]).toEqual(["SH01: ready", "SH24: not ready yet"]);
  });

  it("shows no film until there is one", () => {
    expect(textOf(draw().querySelector("[data-final-media]"))).toBe("No film yet");
    expect(draw({ coverUrl: "/files/cover.png" }).querySelector("[data-final-media] img")!.getAttribute("src")).toBe("/files/cover.png");
  });

  it("plays its film in place and gives its length", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onPlay = vi.fn();
    const onOpen = vi.fn();
    const card = draw({ videoUrl: "/files/ep01.mp4", durationMs: 42_000, clips: CLIPS.map((clip) => ({ ...clip, state: "ready" as const })), onPlay, onOpen });
    expect(textOf(card.querySelector("[data-final-length]"))).toBe("00:42");
    expect(card.querySelector("[data-final-progress]")).toBeNull();
    click(buttonNamed(card, "Play Film · EP01"));
    expect([play.mock.calls.length, onPlay.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 1, 0]);
  });

  it("says where its JianYing draft stands and opens a written one", () => {
    const onOpenDraft = vi.fn();
    const onOpen = vi.fn();
    const written = draw({ draft: DRAFT, onOpenDraft, onOpen });
    expect(textOf(written.querySelector("[data-final-draft]"))).toContain("Lamps of the Fog Harbour EP01");
    click(buttonNamed(written, "Open in JianYing"));
    expect([onOpenDraft.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 0]);

    const kept = draw({ draft: { ...DRAFT, state: "kept", name: "Lamps EP01 (2)" }, onOpenDraft });
    expect(textOf(kept.querySelector("[data-final-draft-state]"))).toBe("Lamps EP01 (2), beside the copy JianYing saved");
    expect(buttonNamed(kept, "Open in JianYing")).toBeDefined();

    const states: Array<[Partial<ProjectDraftWire>, string]> = [
      [{ state: "none" }, "Written once every shot has a video"],
      [{ state: "unavailable", reason: "not-installed" }, "JianYing isn't installed on this computer"],
      [{ state: "unavailable", reason: "remote" }, "On the computer this app is connected to"],
      [{ state: "unavailable", reason: "unsupported-version" }, "This version of JianYing can't take a draft yet"],
    ];
    for (const [patch, text] of states) {
      const card = draw({ draft: { exportFolder: "/tmp/out", ...patch } as ProjectDraftWire, onOpenDraft });
      expect(textOf(card.querySelector("[data-final-draft-state]"))).toBe(text);
      expect(buttonNamed(card, "Open in JianYing")).toBeUndefined();
    }
    expect(draw().querySelector("[data-final-draft]")).toBeNull();
  });

  it("speaks the person's language", () => {
    setLocale("zh");
    const card = draw({ draft: DRAFT, onOpenDraft: () => {} });
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("成片 · EP01");
    expect(buttonNamed(card, "在剪映里打开")).toBeDefined();
  });
});
