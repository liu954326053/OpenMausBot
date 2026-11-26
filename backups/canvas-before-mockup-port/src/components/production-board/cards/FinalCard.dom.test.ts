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
    expect(card.dataset.boardSurface).toBe("monitor");
    expect(card.className).toContain("border-board-line-2");
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("Film · EP01");
    expect(textOf(card.querySelector("[data-final-title]"))).toBe("The lamplighter");
    expect(card.querySelector("[data-final-headline]")!.className).toContain("text-[32px]");
    expect(card.querySelector("[data-final-media]")!.className).toContain("aspect-video");
    expect(card.querySelectorAll("[data-final-audio]")).toHaveLength(CLIPS.length);
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
    expect(textOf(draw({ clips: many.slice(0, 11) }).querySelector("[data-final-clip]"))).toBe("SH01");
    expect(textOf(draw({ clips: many.slice(0, 13) }).querySelector("[data-final-clip]"))).toBe("");
  });

  it("draws a still of each ready shot on the strip while there is room, and colours alone when there is not", () => {
    const stills = (card: HTMLElement) => [...card.querySelectorAll("[data-final-clip]")].map((clip) => clip.querySelector("img")?.getAttribute("src") ?? null);
    const card = draw({ clips: CLIPS.map((clip) => ({ ...clip, posterUrl: `/files/sh0${clip.number}.jpg` })) });
    expect(stills(card)).toEqual(["/files/sh01.jpg", "/files/sh02.jpg", null, null]);
    expect(textOf(card.querySelector("[data-final-clip]"))).toBe("SH01");
    const many: FinalClip[] = Array.from({ length: 13 }, (_, index) => ({ number: index + 1, state: "ready", posterUrl: "/files/still.jpg" }));
    expect(stills(draw({ clips: many })).every((still) => still === null)).toBe(true);
  });

  it("shows no film until there is one", () => {
    expect(textOf(draw().querySelector("[data-final-media]"))).toContain("No film yet");
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

  it("says where its JianYing draft stands and opens JianYing for a written one", () => {
    const onOpenDraft = vi.fn();
    const onOpen = vi.fn();
    const written = draw({ draft: DRAFT, onOpenDraft, onOpen });
    expect(textOf(written.querySelector("[data-final-draft-name]"))).toBe("Lamps of the Fog Harbour EP01");
    expect(written.querySelector("[data-final-draft-state]")).toBeNull();
    click(buttonNamed(written, "Open JianYing"));
    expect([onOpenDraft.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 0]);

    const kept = draw({ draft: { ...DRAFT, state: "kept", name: "Lamps EP01 (2)" }, onOpenDraft });
    expect([textOf(kept.querySelector("[data-final-draft-name]")), textOf(kept.querySelector("[data-final-draft-state]"))]).toEqual(["Lamps EP01 (2)", "Written beside the copy JianYing saved"]);
    expect(buttonNamed(kept, "Open JianYing")).toBeDefined();

    const states: Array<[Partial<ProjectDraftWire>, string]> = [
      [{ state: "none" }, "Written once every shot has a video"],
      [{ state: "unavailable", reason: "not-installed" }, "JianYing isn't installed on this computer"],
      [{ state: "unavailable", reason: "remote" }, "On the computer this app is connected to"],
      [{ state: "unavailable", reason: "unsupported-version" }, "This version of JianYing can't take a draft yet"],
    ];
    for (const [patch, text] of states) {
      const card = draw({ draft: { exportFolder: "/tmp/out", ...patch } as ProjectDraftWire, onOpenDraft });
      expect(textOf(card.querySelector("[data-final-draft-state]"))).toBe(text);
      expect(buttonNamed(card, "Open JianYing")).toBeUndefined();
    }
    expect(draw().querySelector("[data-final-draft]")).toBeNull();
  });

  it("names the draft to look for in JianYing's list, and says so on the button, which only brings JianYing up", () => {
    const onOpenDraft = vi.fn();
    const onOpen = vi.fn();
    const card = draw({ draft: DRAFT, draftName: "Fog Harbour EP01", onOpenDraft, onOpen });
    const name = card.querySelector<HTMLElement>("[data-final-draft-name]")!;
    expect([textOf(name), name.title, name.className.includes("truncate")]).toEqual(["Fog Harbour EP01", "Fog Harbour EP01", true]);
    const open = buttonNamed(card, "Open JianYing")!;
    expect(open.title).toBe("Find “Fog Harbour EP01” in JianYing's drafts");
    click(open);
    expect([onOpenDraft.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 0]);
  });

  it("shows no name while it knows none, or while there is no draft yet", () => {
    expect(draw({ draft: { ...DRAFT, name: undefined }, onOpenDraft: () => {} }).querySelector("[data-final-draft-name]")).toBeNull();
    expect(draw({ draft: { state: "none", exportFolder: "/tmp/out" }, draftName: "Fog Harbour EP01" }).querySelector("[data-final-draft-name]")).toBeNull();
  });

  it("speaks the person's language", () => {
    setLocale("zh");
    const card = draw({ draft: DRAFT, onOpenDraft: () => {} });
    expect(textOf(card.querySelector("[data-card-name]"))).toBe("成片 · EP01");
    expect(buttonNamed(card, "打开剪映")!.title).toBe("在剪映的草稿里找「Lamps of the Fog Harbour EP01」");
  });
});
