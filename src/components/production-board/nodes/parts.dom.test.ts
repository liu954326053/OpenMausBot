// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOARD_BOTS, boarderOf } from "@/testing/production-board-sample";
import { boardFixture } from "../testing/board-fixture";
import { click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { NodeFrame, type NodeFrameProps } from "./NodeFrame";
import { BotButton, BotFace, Chips, clock, jobKey, Meter, Pal } from "./parts";

useBoardPage();
const draw = (element: ReactElement) => render(createElement("div", null, element));

describe("a node's frame", () => {
  const frame = (props: Partial<Omit<NodeFrameProps, "card" | "onHeight" | "children">> = {}) => {
    const fixture = boardFixture();
    const card = fixture.cardOf("bot", (one) => one.lead);
    const onHeight = vi.fn();
    const element = createElement(NodeFrame, { card, rect: { x: 120, y: 340, w: 380, h: 500 }, kind: "k-bot", label: "Bot: 云舟", onHeight, ...props, children: createElement("p", null, "inside") });
    return { root: draw(element), card, onHeight };
  };

  let height = 0;
  const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  const measureAs = (value: number) => {
    height = value;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => height });
  };
  afterEach(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", realHeight));

  it("is the mockup's article: its kind's class, its card's marks, its state, reachable by keyboard, placed and sized", () => {
    const { root, card } = frame({ state: "working", vstate: "gen" });
    const article = root.querySelector("article")!;
    expect([...article.classList]).toEqual(["node", "k-bot"]);
    expect(article.getAttribute("data-id")).toBe(card.id);
    expect(article.getAttribute("data-board-card-id")).toBe(card.id);
    expect(article.getAttribute("data-board-card")).toBe("bot");
    expect(article.getAttribute("data-state")).toBe("working");
    expect(article.getAttribute("data-vstate")).toBe("gen");
    expect(article.getAttribute("tabindex")).toBe("0");
    expect(article.getAttribute("aria-label")).toBe("Bot: 云舟");
    expect([article.style.left, article.style.top, article.style.width]).toEqual(["120px", "340px", "380px"]);
    expect(textOf(article)).toBe("inside");
  });

  it("is marked selected, related, dragged and still to enter only when it is", () => {
    const { root } = frame({ selected: true, related: true, dragging: true, entering: true });
    expect([...root.querySelector("article")!.classList]).toEqual(["node", "k-bot", "is-sel", "is-rel", "is-drag", "pre"]);
    const plain = frame().root.querySelector("article")!;
    expect(plain.hasAttribute("data-state")).toBe(false);
    expect(plain.hasAttribute("data-vstate")).toBe(false);
  });

  it("reports its height once it has one, and again only when it changes", () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resized.push(callback); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    measureAs(0);
    const { onHeight, card } = frame();
    expect(onHeight).not.toHaveBeenCalled();
    measureAs(512);
    act(() => resized.forEach((callback) => callback()));
    expect(onHeight).toHaveBeenCalledTimes(1);
    expect(onHeight).toHaveBeenLastCalledWith(card.id, 512);
    act(() => resized.forEach((callback) => callback()));
    expect(onHeight).toHaveBeenCalledTimes(1);
    measureAs(530);
    act(() => resized.forEach((callback) => callback()));
    expect(onHeight).toHaveBeenCalledTimes(2);
    expect(onHeight).toHaveBeenLastCalledWith(card.id, 530);
  });

  it("reports the height it mounts with", () => {
    measureAs(420);
    const { onHeight, card } = frame();
    expect(onHeight).toHaveBeenCalledExactlyOnceWith(card.id, 420);
  });
});

describe("the mockup's small parts", () => {
  it("writes tags as chips", () => {
    const root = draw(createElement(Chips, { items: ["倔强", "话少"] }));
    expect([...root.querySelectorAll(".chips > .chip")].map(textOf)).toEqual(["倔强", "话少"]);
  });

  it("draws a palette as one named picture of its colours", () => {
    const root = draw(createElement(Pal, { colors: ["#f2c230", "#1f2a44"], label: "Palette" }));
    const pal = root.querySelector("span.pal")!;
    expect(pal.getAttribute("role")).toBe("img");
    expect(pal.getAttribute("aria-label")).toBe("Palette");
    expect([...pal.querySelectorAll(":scope > i")].map((swatch) => (swatch as HTMLElement).style.background)).toEqual(["#f2c230", "#1f2a44"]);
  });

  it("fills a meter as far as its percent", () => {
    const root = draw(createElement(Meter, { percent: 60, label: "Progress" }));
    const meter = root.querySelector(".meter")!;
    expect(meter.getAttribute("role")).toBe("progressbar");
    expect(meter.getAttribute("aria-label")).toBe("Progress");
    expect(meter.getAttribute("aria-valuenow")).toBe("60");
    expect([meter.getAttribute("aria-valuemin"), meter.getAttribute("aria-valuemax")]).toEqual(["0", "100"]);
    expect((meter.querySelector(":scope > i") as HTMLElement).style.width).toBe("60%");
  });

  it("writes a length as minutes and seconds", () => {
    expect(clock(6000)).toBe("00:06");
    expect(clock(75_400)).toBe("01:15");
  });

  it("keys a bot's job: the lead's own, its job, or other without one", () => {
    expect(jobKey({ lead: true, job: "script" })).toBe("lead");
    expect(jobKey({ lead: false, job: "storyboard" })).toBe("storyboard");
    expect(jobKey({ lead: false })).toBe("other");
  });
});

describe("a bot named on a card", () => {
  it("is an ink button with its face and name that brings its card into view", () => {
    const { ctx, actions, snapshot } = boardFixture();
    const root = draw(createElement(BotButton, { botId: BOARD_BOTS.writer, ctx }));
    const button = root.querySelector("button.tk-who")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(textOf(button)).toBe(snapshot.bots[BOARD_BOTS.writer]!.name);
    click(button);
    expect(actions.focusCard).toHaveBeenCalledWith(`bot:${BOARD_BOTS.writer}`);
  });

  it("adds what it is named for, and takes a label for a reader", () => {
    const { ctx, snapshot } = boardFixture();
    const root = draw(createElement(BotButton, { botId: boarderOf(1), ctx, suffix: "EP01", label: "Storyboard bot of EP01" }));
    const button = root.querySelector("button.tk-who")!;
    expect(textOf(button)).toBe(`${snapshot.bots[boarderOf(1)]!.name} · EP01`);
    expect(button.getAttribute("aria-label")).toBe("Storyboard bot of EP01");
  });

  it("is not drawn for a bot the project does not have", () => {
    const { ctx } = boardFixture();
    expect(draw(createElement(BotButton, { botId: "gone", ctx })).childElementCount).toBe(0);
  });
});

describe("a bot's face", () => {
  it("is its avatar when the board has its look", () => {
    const { ctx } = boardFixture();
    const root = draw(createElement(BotFace, { botId: BOARD_BOTS.lead, ctx, size: 40, fallback: "lead" }));
    expect(root.querySelector("[data-avatar-kind='bot']")).not.toBeNull();
    expect(root.querySelector("svg.ic")).toBeNull();
  });

  it("is its job's icon when the board has no look for it", () => {
    const { ctx } = boardFixture();
    const root = draw(createElement(BotFace, { botId: BOARD_BOTS.lead, ctx: { ...ctx, looks: {} }, size: 40, fallback: "storyboard" }));
    expect(root.querySelector("[data-avatar-kind]")).toBeNull();
    const icon = root.querySelector("svg.ic")!;
    expect(icon.classList.contains("lucide-clapperboard")).toBe(true);
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });
});
