// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { episodeCode } from "../../../../shared/production";
import { SAMPLE_FAILED_EPISODE } from "@/testing/production-board-sample";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { BriefNode } from "./BriefNode";
import { EpisodeNode } from "./EpisodeNode";
import { EpisodeStackNode } from "./EpisodeStackNode";
import { TasksNode } from "./TasksNode";

useBoardPage();
const draw = (element: ReactElement) => render(createElement("div", null, element));

describe("the brief", () => {
  it("is a sheet headed by its code and version, ruled into label and value, stamped once the plan is agreed", () => {
    const { cardOf, ctx } = boardFixture();
    const root = draw(createElement(BriefNode, { card: cardOf("brief"), ctx }));
    expect([...root.querySelectorAll(".pp-head .mono")].map(textOf)).toEqual(["REQ", "v2"]);
    expect(root.querySelectorAll(".spec > div").length).toBe(cardOf("brief").rows.length);
    expect(textOf(root.querySelector(".spec > div dt"))).toBe(cardOf("brief").rows[0]![0]);
    expect(root.querySelector(".pp-foot .stamp")).not.toBeNull();
  });

  it("is not stamped before a plan is agreed", () => {
    const { cardOf, ctx } = boardFixture();
    const { agreedAt: _agreedAt, ...unagreed } = cardOf("brief");
    expect(draw(createElement(BriefNode, { card: unagreed, ctx })).querySelector(".stamp")).toBeNull();
  });
});

describe("the task split", () => {
  it("lists each task with its state, its number, whether it runs beside others, and the bot it goes to", () => {
    const { cardOf, ctx, actions } = boardFixture();
    const root = draw(createElement(TasksNode, { card: cardOf("plan"), ctx }));
    const rows = [...root.querySelectorAll(".tk > li")];
    expect(rows).toHaveLength(cardOf("plan").tasks.length);
    expect(textOf(rows[0]!.querySelector(".mono"))).toBe("T1");
    expect(["done", "run", "wait", "failed"]).toContain(rows[0]!.getAttribute("data-s"));
    expect(root.querySelectorAll(".tk-t em").length).toBeGreaterThan(0);
    click(rows[0]!.querySelector(".tk-who"));
    expect(actions.focusCard).toHaveBeenCalledWith(`bot:${cardOf("plan").tasks[0]!.botId}`);
  });
});

describe("an episode", () => {
  it("is a punched script page: its number, title and version, its script in lines, and the storyboard bot it went to", () => {
    const { cardOf, ctx } = boardFixture();
    const card = cardOf("episode", (one) => one.episode === 1);
    const root = draw(createElement(EpisodeNode, { card, ctx }));
    expect(root.querySelectorAll(".sc-holes i")).toHaveLength(3);
    expect(textOf(root.querySelector(".pp-head .ep-no"))).toBe("EP01");
    expect(textOf(root.querySelector(".pp-head h3"))).toBe(card.title);
    expect(root.querySelector(".sc-page")?.children.length).toBeGreaterThan(0);
    expect(root.querySelector(".pp-foot .tk-who")).not.toBeNull();
    expect(buttonNamed(root, "Retry")).toBeUndefined();
  });

  it("offers Retry once its episode failed", () => {
    const { cardOf, ctx, actions } = boardFixture();
    const root = draw(createElement(EpisodeNode, { card: cardOf("episode", (one) => one.status === "failed"), ctx }));
    click(buttonNamed(root, "Retry"));
    expect(actions.retry).toHaveBeenCalledWith({ episode: SAMPLE_FAILED_EPISODE });
  });
});

describe("the stack of episodes", () => {
  it("names its range and how many it holds, lists its first titles and its last, and opens the list of episodes", () => {
    const fixture = boardFixture({ episodes: 12 });
    const card = fixture.cardOf("stack");
    const root = draw(createElement(EpisodeStackNode, { card, ctx: fixture.ctx }));
    expect(textOf(root.querySelector(".pp-head .ep-no"))).toMatch(/^EP\d+ – EP12$/);
    expect(root.querySelector(".epm .epm-gap")).not.toBeNull();
    click(root.querySelector(".pp-head"));
    expect(fixture.actions.openStack).toHaveBeenCalled();
    expect([...root.querySelectorAll(".epm > li:not(.epm-gap) .mono")].map(textOf)).toEqual([...card.episodes.slice(0, 3), card.episodes.at(-1)!].map((one) => episodeCode(one.episode)));
  });

  it("lists all its episodes, with no gap, when it holds four or fewer", () => {
    const fixture = boardFixture({ episodes: 7 });
    const card = fixture.cardOf("stack");
    const root = draw(createElement(EpisodeStackNode, { card, ctx: fixture.ctx }));
    expect(root.querySelectorAll(".epm > li")).toHaveLength(card.episodes.length);
    expect(root.querySelector(".epm-gap")).toBeNull();
    click(root.querySelector(".epm"));
    expect(fixture.actions.openStack).toHaveBeenCalled();
  });
});
