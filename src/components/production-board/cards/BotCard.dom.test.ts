// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasBotState } from "../../../../shared/project-canvas";
import { setLocale } from "@/lib/i18n";
import { BotCard, type BotCardProps } from "./BotCard";
import { BOARD_CARD_SIZES } from "./sizes";
import { buttonNamed, click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const bot = (patch: Partial<CanvasBotState> = {}): CanvasBotState => ({
  botId: "jingchuan-ep01", name: "Jingchuan EP01", title: "Storyboard artist", lead: false, stages: ["storyboard"], episode: 1,
  status: "working", placed: false, ...patch,
});

const draw = (props: Partial<BotCardProps> = {}) => render(createElement(BotCard, { bot: bot(), job: "storyboard", task: "working", ...props }));
const status = (card: HTMLElement) => card.querySelector<HTMLElement>("[data-board-status]");

describe("the bot card", () => {
  it("is the size the board lays it out at", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("bot");
    expect(card.dataset.boardSurface).toBe("panel");
    expect([card.style.width, card.style.height]).toEqual([`${BOARD_CARD_SIZES.bot.width}px`, `${BOARD_CARD_SIZES.bot.height}px`]);
  });

  it("wears its state as a stripe across its top", () => {
    const stripe = (patch: Partial<BotCardProps>) => draw(patch).querySelector<HTMLElement>("[data-bot-stripe]")!;
    expect(stripe({}).className).toContain("bg-board-amber");
    expect(stripe({ bot: bot({ status: "idle" }), job: undefined, task: undefined }).className).toContain("bg-ink-tertiary");
    expect(stripe({ bot: bot({ status: "idle" }), task: "done" }).className).toContain("bg-board-teal");
    expect(stripe({ bot: bot({ status: "error" }) }).className).toContain("bg-danger");
  });

  it("shows an episode's bot by its own name, its episode code, its job title and what it does for that episode", () => {
    const card = draw();
    expect(textOf(card.querySelector("[data-bot-name]"))).toBe("Jingchuan");
    expect(card.querySelector<HTMLElement>("[data-bot-name]")!.title).toBe("Jingchuan EP01");
    expect(textOf(card.querySelector("[data-episode-code]"))).toBe("EP01");
    expect(textOf(card.querySelector("[data-bot-title]"))).toBe("Storyboard artist");
    expect(textOf(card.querySelector("[data-current-task]"))).toBe("Storyboard EP01 and make its shot videos");
    expect(textOf(status(card))).toBe("Working");
    expect(status(card)!.dataset.boardStatus).toBe("working");
  });

  it("crowns the lead and names its task even before the production has one", () => {
    const card = draw({ bot: bot({ botId: "ace", name: "Ace", title: "Producer", lead: true, stages: ["lead"], episode: undefined, status: "idle" }), job: undefined, task: undefined });
    expect(textOf(card.querySelector("[data-bot-lead]"))).toBe("Lead");
    expect(card.querySelector("[data-episode-code]")).toBeNull();
    expect(textOf(card.querySelector("[data-current-task]"))).toBe("Agree on the brief with you and follow the work");
    expect(textOf(status(card))).toBe("Idle");
  });

  it("shows a bot with no task as having none, and while it works the step it is on", () => {
    const other = (patch: Partial<CanvasBotState>) => bot({ episode: undefined, name: "Otto", stages: ["other"], ...patch });
    const idle = draw({ bot: other({ status: "idle", doing: "Reading the script" }), job: undefined, task: undefined });
    expect(textOf(idle.querySelector("[data-current-task]"))).toBe("No task yet");
    const working = draw({ bot: other({ status: "working", doing: "Reading the script" }), job: undefined, task: undefined });
    expect(textOf(working.querySelector("[data-current-task]"))).toBe("Reading the script");
    expect(working.querySelector("[data-bot-doing]")).toBeNull();
    const storyboarding = draw({ bot: bot({ doing: "Splitting EP01 into shots" }) });
    expect(textOf(storyboarding.querySelector("[data-current-task]"))).toBe("Storyboard EP01 and make its shot videos");
    expect(textOf(storyboarding.querySelector("[data-bot-doing]"))).toBe("Splitting EP01 into shots");
  });

  it("shows its progress as a meter with its words and percent", () => {
    const card = draw({ progress: { kind: "videos", done: 4, total: 6 } });
    const meter = card.querySelector<HTMLElement>("[role=progressbar]")!;
    expect([meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuemax"), meter.getAttribute("aria-label")]).toEqual(["4", "6", "Shot videos 4 / 6"]);
    expect(textOf(card.querySelector("[data-progress]"))).toBe("Shot videos 4 / 6 done 67%");
    expect(draw({ progress: undefined }).querySelector("[role=progressbar]")).toBeNull();
  });

  it("lists its latest steps with their times, at most four, the newest last", () => {
    const at = (hour: number, minute: number) => new Date(2026, 10, 24, hour, minute).getTime();
    const card = draw({
      steps: [
        { text: "Read EP01", state: "done", at: at(10, 47) },
        { text: "Split it into 6 shots", state: "done", at: at(10, 52) },
        { text: "Refined the pier", state: "done", at: at(10, 58) },
        { text: "SH05 is generating", state: "working", at: at(11, 26) },
        { text: "SH06 waits", state: "waiting" },
      ],
    });
    const rows = [...card.querySelectorAll<HTMLElement>("[data-step]")];
    expect(rows.map((row) => row.dataset.step)).toEqual(["done", "done", "working", "waiting"]);
    expect(rows.map((row) => textOf(row.querySelector("[data-step-text]")))).toEqual(["Split it into 6 shots", "Refined the pier", "SH05 is generating", "SH06 waits"]);
    expect(textOf(rows[0]!.querySelector("time"))).toMatch(/10:52/);
    expect(rows[3]!.querySelector("time")).toBeNull();
  });

  it("shows a storyboard bot's start conditions as tags, each ready or still awaited", () => {
    const card = draw({ gate: { characters: { done: 4, total: 4 }, scenes: { done: 2, total: 4 }, script: true } });
    const gate = card.querySelector<HTMLElement>("[data-bot-gate]")!;
    expect(gate.getAttribute("aria-label")).toBe("Start conditions");
    const items = [...gate.querySelectorAll<HTMLElement>("[data-gate-item]")];
    expect(items.map((item) => item.dataset.gateItem)).toEqual(["characters", "scenes", "script"]);
    expect(items.map((item) => [textOf(item.querySelector("[data-gate-label]")), textOf(item.querySelector("[data-gate-value]"))])).toEqual([["Cast", "4/4"], ["Scenes", "2/4"], ["Script", ""]]);
    expect(items.map((item) => item.dataset.gateReady)).toEqual(["true", "false", "true"]);
    expect(items.map((item) => item.title)).toEqual(["Cast 4/4 · Ready", "Scenes 2/4 · Not ready yet", "Script EP01 · Ready"]);
  });

  it("shows only the start conditions it is given, and counts one with nothing made as not ready", () => {
    const items = [...draw({ gate: { script: false } }).querySelectorAll<HTMLElement>("[data-gate-item]")];
    expect(items.map((item) => [item.dataset.gateItem, item.dataset.gateReady])).toEqual([["script", "false"]]);
    expect(draw({ gate: { characters: { done: 0, total: 0 } } }).querySelector<HTMLElement>("[data-gate-item]")!.dataset.gateReady).toBe("false");
    expect(draw().querySelector("[data-bot-gate]")).toBeNull();
  });

  it("shows its newest reply where it has no steps to show", () => {
    const output = { text: "All six shots of EP01 are split.", threadId: "t1", messageId: "m1", at: 1 };
    const card = draw({ bot: bot({ status: "idle", output }) });
    const reply = card.querySelector<HTMLElement>("[data-bot-output]")!;
    expect(textOf(reply)).toBe("All six shots of EP01 are split.");
    expect(reply.className).toContain("line-clamp-3");
    expect(textOf(card.querySelector("[data-bot-output-label]"))).toBe("Latest reply");
    expect(draw({ bot: bot({ output }), steps: [{ text: "Split the shots", state: "done" }] }).querySelector("[data-bot-output]")).toBeNull();
  });

  it("opens on a click anywhere on it, and from the keyboard through its name", () => {
    const onOpen = vi.fn();
    const card = draw({ onOpen });
    click(card.querySelector("[data-current-task]"));
    click(card.querySelector("[data-bot-name]"));
    expect(card.querySelector("[data-bot-name]")!.closest("button")).not.toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("puts its job and a chat pill at its foot, the pill opening the chat without opening the card twice", () => {
    const onOpen = vi.fn();
    const card = draw({ onOpen });
    expect(textOf(card.querySelector("[data-bot-job]"))).toBe("Storyboards and videos, per episode");
    const talk = card.querySelector<HTMLButtonElement>("[data-bot-talk]")!;
    expect(textOf(talk)).toBe("Chat");
    expect(talk.className).toContain("rounded-full");
    click(talk);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(draw().querySelector("[data-bot-talk]")).toBeNull();
  });

  it("offers a retry when its task failed, which does not open it", () => {
    const onOpen = vi.fn();
    const onRetry = vi.fn();
    const card = draw({ bot: bot({ status: "idle" }), task: "failed", onOpen, onRetry });
    expect(textOf(status(card))).toBe("Failed");
    expect(status(card)!.dataset.boardStatus).toBe("failed");
    click(buttonNamed(card, "Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(buttonNamed(draw({ task: "working", onRetry }), "Retry")).toBeUndefined();
  });

  it("says a question waits on the person, and its answer opens the chat", () => {
    const onOpen = vi.fn();
    const waiting = { threadId: "t1", messageId: "m1", card: { title: "Which take of SH05?", subtitle: "", options: ["V1", "V2"] } };
    const card = draw({ bot: bot({ status: "waiting", waiting }), onOpen });
    expect(textOf(status(card))).toBe("Waiting for you");
    expect(status(card)!.dataset.boardStatus).toBe("asking");
    const hint = card.querySelector<HTMLElement>("[data-bot-asking]")!;
    expect(textOf(hint)).toContain("Waiting for your answer");
    expect(textOf(hint)).toContain("Which take of SH05?");
    click(buttonNamed(hint, "Answer"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps a long name, title and task on their lines, with the full text reachable", () => {
    const long = "A name that goes on and on well past what one line of a card can hold";
    const card = draw({ bot: bot({ name: long, title: long, episode: undefined }) });
    const name = card.querySelector<HTMLElement>("[data-bot-name]")!;
    expect(name.className).toContain("truncate");
    expect(name.title).toBe(long);
    expect(card.querySelector<HTMLElement>("[data-bot-title]")!.className).toContain("truncate");
    expect(card.querySelector<HTMLElement>("[data-current-task]")!.className).toContain("line-clamp-2");
  });

  it("speaks the person's language", () => {
    setLocale("zh");
    const card = draw({ progress: { kind: "videos", done: 4, total: 6 } });
    expect(textOf(status(card))).toBe("工作中");
    expect(textOf(card.querySelector("[data-progress]"))).toBe("分镜视频 4 / 6 完成 67%");
  });
});
