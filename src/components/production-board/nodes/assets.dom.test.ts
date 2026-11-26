// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SAMPLE_GENERATING_SHOT } from "@/testing/production-board-sample";
import type { BoardCard } from "@/lib/production-board/types";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { NODE_CLASS, NodeBody, nodeFacts } from "./index";

useBoardPage();
const draw = (card: BoardCard, fixture: ReturnType<typeof boardFixture>) => render(createElement("div", null, createElement(NodeBody, { card, ctx: fixture.ctx })));

describe("a character's card", () => {
  it("shows its picture beside its part, its name, its tags, its look and voice, its palette and the shots it is in", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("character");
    const root = draw(card, fixture);
    expect(root.querySelector(".ch .ch-art img")?.getAttribute("src")).toMatch(/^\/files\//);
    expect(textOf(root.querySelector(".ch-body h3"))).toBe(card.name);
    expect(textOf(root.querySelector(".ch-top .mono"))).toBe("Look 1");
    expect(root.querySelectorAll(".ch-foot .pal i").length).toBe(card.facts.palette?.length ?? 0);
  });
});

describe("a scene's card", () => {
  it("shows its picture under its name, its mood, its camera positions and its palette as a strip", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("scene", (one) => !one.refinedBy);
    const root = draw(card, fixture);
    expect(textOf(root.querySelector(".sn-art .sn-cap h3"))).toBe(card.name);
    expect(textOf(root.querySelector(".sn-meta .cams"))).toBe("3 camera positions");
    expect(textOf(root.querySelector(".sn-uses .mono"))).toBe("v2");
    expect(root.querySelector(".sn-pal")?.getAttribute("role")).toBe("img");
  });
});

describe("a shot's card", () => {
  it("is a storyboard sheet: its number, its size, move and length, what it shows and what is heard, and what it uses", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("shot", (one) => one.status === "done");
    const root = draw(card, fixture);
    expect(textOf(root.querySelector(".sh-head .sh-no"))).toMatch(/^SH\d\d$/);
    expect(root.querySelectorAll(".sh-dl > div")).toHaveLength(3);
    expect(root.querySelector(".sh-frame video, .sh-frame.is-wip")).not.toBeNull();
    expect(root.querySelectorAll(".sh-refs .ref").length).toBe(card.references.length);
    expect(root.querySelector(".sh-foot .st.done")).not.toBeNull();
  });

  it("offers to generate its video while it has none, and shows it generating", () => {
    const fixture = boardFixture();
    const idle = fixture.cardOf("shot", (one) => one.status === "idle" && Boolean(one.creationId));
    click(draw(idle, fixture).querySelector(".sh-foot .btn-gen"));
    expect(fixture.actions.generate).toHaveBeenCalledWith(idle.creationId);
    const busy = fixture.cardOf("shot", (one) => one.id === SAMPLE_GENERATING_SHOT);
    expect(nodeFacts(busy, fixture.snapshot).vstate).toBe("gen");
    expect(draw(busy, fixture).querySelector(".sh-foot .st.run")).not.toBeNull();
  });
});

describe("a shot's video", () => {
  it("is a monitor: the take the film uses, its number and versions, a play button, and its length and name below", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("result", (one) => one.status === "done");
    const root = draw(card, fixture);
    expect(root.querySelector(".rs-screen video")?.getAttribute("src")).toMatch(/^\/files\/.*#t=0\.1$/);
    expect(textOf(root.querySelector(".rs-tag"))).toMatch(/^SH\d\d$/);
    expect(root.querySelector(".rs-play")).not.toBeNull();
    expect(root.querySelector(".rs-foot .rs-ok")).not.toBeNull();
    expect(nodeFacts(card, fixture.snapshot).state).toBe("done");
  });

  it("lets the person switch to another take and use it", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("result", (one) => one.takes.length > 1);
    const root = draw(card, fixture);
    const other = card.takes.find((take) => !take.selected)!;
    click(root.querySelectorAll(".rs-takes .take")[card.takes.indexOf(other)]);
    click(buttonNamed(root, "Use this take"));
    expect(fixture.actions.selectTake).toHaveBeenCalledWith(other.nodeId);
  });
});

describe("an episode's film", () => {
  it("is a monitor over a timeline: a clip for each shot by its state, and the tracks the draft has", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("final", (one) => one.episode === 1);
    const root = draw(card, fixture);
    expect(root.querySelectorAll(".fn-video .clip")).toHaveLength(card.clips.length);
    expect([...root.querySelectorAll(".fn-tl .fn-row .fn-lbl")].map(textOf).filter(Boolean)).toEqual(["Picture", "Voice", "Music"]);
    expect(root.querySelectorAll(".fn-lane .seg")).toHaveLength(2);
    click(buttonNamed(root, "Open JianYing"));
    expect(fixture.actions.openDraft).toHaveBeenCalled();
  });
});

describe("every kind of card", () => {
  it("has the mockup's class", () => {
    expect(NODE_CLASS).toEqual({ bot: "k-bot", brief: "k-brief", plan: "k-tasks", episode: "k-ep", stack: "k-epmore", character: "k-char", scene: "k-scene", shot: "k-shot", result: "k-result", final: "k-final", other: "k-other" });
  });
});
