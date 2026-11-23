// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { PlanCard, type PlanCardProps, type PlanTask } from "./PlanCard";
import { click, render, textOf, useCardPage } from "./dom-test-kit";

useCardPage();

const TASKS: PlanTask[] = [
  { job: "script", status: "done", bot: { name: "Mo" }, count: 60 },
  { job: "character", status: "done", bot: { name: "Mei" }, count: 4 },
  { job: "scene", status: "failed", bot: { name: "Yan" } },
  { job: "storyboard", status: "working", bot: { name: "Jingchuan" } },
  { job: "post", status: "waiting" },
];

const draw = (props: Partial<PlanCardProps> = {}) => render(createElement(PlanCard, { tasks: TASKS, ...props }));
const rows = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>("[data-plan-task]")];

describe("the plan card", () => {
  it("numbers the tasks from T1, each with its job, its bot and its state", () => {
    const card = draw();
    expect(card.dataset.boardCard).toBe("plan");
    expect(rows(card).map((row) => row.dataset.planTask)).toEqual(["script", "character", "scene", "storyboard", "post"]);
    expect(rows(card).map((row) => textOf(row.querySelector("[data-task-code]")))).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(rows(card).map((row) => textOf(row.querySelector("[data-task-name]")))).toEqual([
      "Episode scripts ×60", "Characters ×4", "Scenes", "Storyboards and videos, per episode", "Post and film, per episode",
    ]);
    expect(rows(card).map((row) => textOf(row.querySelector("[data-bot-chip-name], [data-task-nobody]")))).toEqual(["Mo", "Mei", "Yan", "Jingchuan", "Nobody"]);
    expect(rows(card).map((row) => row.querySelector<HTMLElement>("[data-board-status]")!.dataset.boardStatus)).toEqual(["done", "done", "failed", "working", "idle"]);
    expect(rows(card).map((row) => textOf(row.querySelector("[data-board-status]")))).toEqual(["Done", "Done", "Failed", "Working", "Waiting"]);
  });

  it("marks the tasks that run side by side", () => {
    const marked = rows(draw()).filter((row) => row.querySelector("[data-task-parallel]")).map((row) => row.dataset.planTask);
    expect(marked).toEqual(["character", "scene"]);
  });

  it("counts the tasks done in its header", () => {
    expect(textOf(draw().querySelector("[data-plan-count]"))).toBe("2 / 5");
  });

  it("keeps a long bot name on its line", () => {
    const long = "A storyboard artist with a very long name indeed";
    const chip = draw({ tasks: [{ job: "storyboard", status: "working", bot: { name: long } }] }).querySelector<HTMLElement>("[data-bot-chip]")!;
    expect(chip.title).toBe(long);
    expect(chip.querySelector("[data-bot-chip-name]")!.className).toContain("truncate");
  });

  it("opens on a click, and speaks the person's language", () => {
    const onOpen = vi.fn();
    click(draw({ onOpen }).querySelector("[data-plan-task]"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    setLocale("zh");
    expect(textOf(draw().querySelector("[data-card-name]"))).toBe("任务拆分");
    expect(textOf(draw().querySelector("[data-task-parallel]"))).toBe("并行");
  });
});
