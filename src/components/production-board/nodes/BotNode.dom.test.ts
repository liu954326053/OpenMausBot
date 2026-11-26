// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BOARD_BOTS, boarderOf } from "@/testing/production-board-sample";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { BotNode } from "./BotNode";

useBoardPage();

const draw = (botId: string, fixture = boardFixture()) => {
  const card = fixture.cardOf("bot", (one) => one.botId === botId);
  return { root: render(createElement("div", null, createElement(BotNode, { card, ctx: fixture.ctx }))), ...fixture, card };
};

describe("a bot's card", () => {
  it("is the mockup's console: a pin for the far view, its head, its task with a meter, its steps and its skills", () => {
    const { root, snapshot } = draw(BOARD_BOTS.lead);
    expect(root.querySelector(".pin")?.getAttribute("aria-hidden")).toBe("true");
    expect(textOf(root.querySelector(".bot-head .bot-id strong"))).toBe(snapshot.bots[BOARD_BOTS.lead]!.name);
    expect(root.querySelector(".bot-head .bot-ava")?.childElementCount).toBe(1);
    expect(root.querySelector(".bot-head .bot-status .led")).not.toBeNull();
    expect(root.querySelector(".bot-task .meter")?.getAttribute("role")).toBe("progressbar");
    expect([...root.querySelectorAll(".bot-foot .chip")].map(textOf)).toEqual(["Brief", "Source picking", "Task split"]);
  });

  it("carries the source on the lead's card alone: its title, who wrote it, a line from it and what it becomes", () => {
    const { root } = draw(BOARD_BOTS.lead);
    expect(textOf(root.querySelector(".bot-book h3"))).toBe("雨城");
    expect(textOf(root.querySelector(".bot-book .nv-meta"))).toBe("南渡 · 都市悬疑 · 46 章 · 38.6 万字");
    expect(textOf(root.querySelector(".bot-book blockquote"))).toBe("雨城的灯，十年没亮过了。");
    expect(textOf(root.querySelector(".bot-book .tag"))).toBe("Adapted into 4 episodes");
    expect(textOf(root.querySelector(".bot-book .nv-cover .nv-title"))).toBe("雨城");
    expect(draw(BOARD_BOTS.writer).root.querySelector(".bot-book")).toBeNull();
  });

  it("shows the source's cover from the project's files when it has one", () => {
    const fixture = boardFixture();
    const lead = fixture.cardOf("bot", (one) => one.lead);
    const cover = { path: "产出/图片/封面.png", mime: "image/png", bytes: 1, name: "封面.png" };
    const root = render(createElement("div", null, createElement(BotNode, { card: { ...lead, source: { ...lead.source!, cover } }, ctx: fixture.ctx })));
    expect(root.querySelector(".bot-book .nv-cover img")?.getAttribute("src")).toBe("/files/产出/图片/封面.png");
    expect(root.querySelector(".bot-book .nv-cover img")?.getAttribute("alt")).toBe("Cover of “雨城”");
  });

  it("names no skills for a bot without a job", () => {
    expect(draw(BOARD_BOTS.operations).root.querySelector(".bot-foot .chip")).toBeNull();
  });

  it("marks an episode's storyboard bot with its episode and what it waits for", () => {
    const { root } = draw(boarderOf(1));
    expect(textOf(root.querySelector(".bot-ep"))).toBe("EP01");
    expect(textOf(root.querySelector(".bot-id strong"))).toBe("小满 EP01");
    expect(root.querySelectorAll(".bot-gate .gt")).toHaveLength(3);
    expect(textOf(root.querySelector(".pin"))).toContain("EP01");
  });

  it("opens its chat from its button, and offers Retry where its job failed", () => {
    const { root, actions } = draw(BOARD_BOTS.lead);
    click(root.querySelector(".bot-talk"));
    expect(actions.openChat).toHaveBeenCalledWith(BOARD_BOTS.lead);
    const fixture = boardFixture();
    const stopped = fixture.cardOf("bot", (one) => Boolean(one.retry));
    const failed = draw(stopped.botId, fixture);
    click(buttonNamed(failed.root, "Retry"));
    expect(fixture.actions.retry).toHaveBeenCalledWith(stopped.retry);
  });
});
