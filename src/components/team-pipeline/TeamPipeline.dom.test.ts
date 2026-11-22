// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stageLines, type FlowLineWire, type FlowStage, type TeamPipelineLineInput, type TeamPipelineWire } from "../../../shared/team-pipeline";
import { CARD_HEIGHT } from "@/lib/team-canvas";
import { pipelineLayout } from "@/lib/team-pipeline";
import type { Bot } from "@/state/store";
import { TeamPipeline } from "./TeamPipeline";

const bot = (id: string, name: string, chiefOfStaff = false) => ({ id, name, section: "Studio", chiefOfStaff }) as unknown as Bot;
const sol = bot("sol", "Sol", true), story = bot("story", "Story"), ink = bot("ink", "Ink"), art = bot("art", "Art"), cut = bot("cut", "Cut"), ops = bot("ops", "Ops");
const team = [sol, story, ink, art, cut, ops];
const section = { key: "Studio", name: "Studio", chiefs: [sol], members: team.slice(1) };
const STAGES: Record<string, FlowStage[]> = { sol: ["lead"], story: ["script"], ink: ["script"], art: ["character", "storyboard"], cut: ["post"], ops: ["other"] };
const studio = (extra: Partial<TeamPipelineWire> = {}): TeamPipelineWire => ({
  section: "Studio", chiefId: "sol", stages: STAGES, pending: [], manual: [], lines: stageLines("sol", team.map((one) => one.id), STAGES), ...extra,
});

let container: HTMLDivElement, root: Root, sent: TeamPipelineLineInput[], answer: () => Promise<void>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sent = [];
  answer = async () => {};
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function show(pipeline = studio(), props: Partial<{ canDraw: boolean; readable: boolean }> = {}) {
  await act(async () => root.render(createElement(TeamPipeline, {
    section, pipeline, layout: pipelineLayout(team, pipeline)!, canDraw: true, readable: true,
    renderBot: (one: Bot, note?: ReactNode) => createElement("button", { "data-bot-id": one.id }, one.name, note),
    onLine: async (input: TeamPipelineLineInput) => { sent.push(input); await answer(); },
    ...props,
  })));
}
const all = <T extends Element = HTMLElement>(selector: string) => [...container.querySelectorAll<T>(selector)];
const byLabel = <T extends Element>(label: string) => container.querySelector<T & HTMLElement>(`[aria-label="${label}"]`);
const card = (id: string) => container.querySelector<HTMLElement>(`[data-pipeline-card="${id}"]`)!;
const drawn = () => all("[data-pipeline-line]").map((line) => line.getAttribute("data-pipeline-line")).sort();
const status = () => container.querySelector("[role=status]")!.textContent;
const press = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const key = async (element: Element, name: string) => {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));
};
const pointer = (type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  return event;
};
async function dragDot(from: string, onto: Element) {
  const dot = container.querySelector<HTMLElement>(`[data-pipeline-dot="${from}"]`)!;
  Object.assign(dot, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  Object.assign(document, { elementFromPoint: () => onto });
  await act(async () => dot.dispatchEvent(pointer("pointerdown", 10, 10)));
  await act(async () => dot.dispatchEvent(pointer("pointermove", 60, 40)));
  await act(async () => dot.dispatchEvent(pointer("pointerup", 60, 40)));
}

describe("a team's pipeline on the map", () => {
  it("stands the cards in columns by stage, with `other` under the lead, each at the place the layout gives", async () => {
    await show();
    expect(Object.fromEntries(all("[data-pipeline-card]").map((one) => [one.dataset.pipelineCard, one.dataset.column])))
      .toEqual({ sol: "lead", ops: "other", story: "script", ink: "script", art: "character", cut: "post" });
    const left = (id: string) => parseFloat(card(id).style.left), top = (id: string) => parseFloat(card(id).style.top);
    expect(left("sol")).toBeLessThan(left("story"));
    expect(left("story")).toBe(left("ink"));
    expect(left("story")).toBeLessThan(left("art"));
    expect(left("art")).toBeLessThan(left("cut"));
    expect([top("story"), top("art"), top("cut")]).toEqual([top("sol"), top("sol"), top("sol")]);
    expect(top("ink")).toBeGreaterThan(top("story"));
    expect(top("ops")).toBeGreaterThan(top("sol"));
    expect(left("ops")).toBeGreaterThan(left("sol"));
    expect(left("ops")).toBeLessThan(left("story"));
  });

  it("draws every line of the pipeline, several into one card, and lets the person select each", async () => {
    await show();
    expect(drawn()).toEqual(["art:cut", "ink:art", "sol:ink", "sol:ops", "sol:story", "story:art"]);
    expect(all("path[role=button]").map((line) => line.getAttribute("aria-label")).sort()).toEqual([
      "Line from Art to Cut", "Line from Ink to Art", "Line from Sol to Ink", "Line from Sol to Ops", "Line from Sol to Story", "Line from Story to Art",
    ]);
  });

  it("writes each card's stages in the team map's language, and nothing for `other`", async () => {
    await show();
    const stages = (id: string) => all(`[data-pipeline-note="${id}"] [data-pipeline-stage]`).map((stage) => stage.textContent);
    expect(stages("sol")).toEqual(["Lead"]);
    expect(stages("story")).toEqual(["Script"]);
    expect(stages("art")).toEqual(["Characters", "Storyboard"]);
    expect(stages("cut")).toEqual(["Post"]);
    expect(container.querySelector('[data-pipeline-note="ops"]')).toBeNull();
    expect(card("art").getAttribute("role")).toBe("group");
    expect(card("art").getAttribute("aria-label")).toBe("Art");
    expect(document.getElementById(card("art").getAttribute("aria-describedby")!)!.textContent).toBe("Characters Storyboard");
  });

  it("marks a member being placed with still words, and a member the person changed as set by hand", async () => {
    await show(studio({ pending: ["ops"], manual: ["art", "cut"] }));
    const placing = container.querySelector<HTMLElement>('[data-pipeline-note="ops"] [data-pipeline-pending]')!;
    expect(placing.textContent).toBe("Being placed…");
    expect(placing.title).toBe("Working out this bot's stage. Its lines appear when that's done.");
    expect(container.querySelector('[data-pipeline-note="ops"] [class*="animate-"]')).toBeNull();
    expect(container.querySelector('[data-pipeline-note="ops"] svg')).toBeNull();
    const byHand = container.querySelector<HTMLElement>('[data-pipeline-note="art"] [data-pipeline-manual]')!;
    expect(byHand.textContent).toBe("By hand");
    expect(byHand.title).toBe("You changed this bot's lines, so judging leaves it as it is. Judge again in the team's menu clears that.");
    expect(all("[data-pipeline-manual]")).toHaveLength(2);
    expect(container.querySelector('[data-pipeline-note="story"] [data-pipeline-manual]')).toBeNull();
  });

  it("adds a line to the card a dot is dragged onto, another team's included, and none when the drag ends on its own card", async () => {
    await show();
    await dragDot("story", card("cut").querySelector("[data-bot-id]")!);
    expect(sent).toEqual([{ from: "story", to: "cut", present: true }]);
    expect(status()).toBe("Story's work now goes to Cut.");

    const elsewhere = document.body.appendChild(document.createElement("button"));
    elsewhere.dataset.botId = "scout";
    await dragDot("story", elsewhere);
    expect(sent.at(-1)).toEqual({ from: "story", to: "scout", present: true });
    elsewhere.remove();

    await dragDot("story", card("story").querySelector("[data-bot-id]")!);
    expect(sent).toHaveLength(2);
  });

  it("adds and removes a line from the keyboard, in a menu on the card's dot that ticks who gets its work", async () => {
    await show();
    await press(byLabel("Draw a line from Story"));
    const menu = byLabel("Story's work goes to")!;
    expect(menu.getAttribute("role")).toBe("menu");
    const rows = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]")];
    expect(rows.map((row) => [row.textContent, row.getAttribute("aria-checked")])).toEqual([["Ink", "false"], ["Art", "true"], ["Cut", "false"], ["Ops", "false"]]);
    expect(document.activeElement).toBe(rows[0]);
    await key(rows[0]!, "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    await press(rows[2]);
    expect(sent).toEqual([{ from: "story", to: "cut", present: true }]);
    expect(byLabel("Story's work goes to")).toBeNull();

    await press(byLabel("Draw a line from Story"));
    await press([...byLabel("Story's work goes to")!.querySelectorAll("[role=menuitemcheckbox]")].find((row) => row.textContent === "Art"));
    expect(sent.at(-1)).toEqual({ from: "story", to: "art", present: false });
    expect(status()).toBe("Story's work no longer goes to Art.");

    await press(byLabel("Draw a line from Story"));
    await key(byLabel("Story's work goes to")!, "Escape");
    expect(byLabel("Story's work goes to")).toBeNull();
    expect(document.activeElement).toBe(byLabel("Draw a line from Story"));
  });

  it("removes a line the person selected with the pointer, or with Enter or Delete on the line", async () => {
    await show();
    await press(byLabel("Line from Sol to Story"));
    expect(byLabel("Line from Sol to Story")!.getAttribute("aria-pressed")).toBe("true");
    await press(byLabel("Remove the line from Sol to Story"));
    expect(sent).toEqual([{ from: "sol", to: "story", present: false }]);
    expect(byLabel("Remove the line from Sol to Story")).toBeNull();

    const line = byLabel("Line from Ink to Art")!;
    await act(async () => line.focus());
    await key(line, "Enter");
    expect(document.activeElement).toBe(byLabel("Remove the line from Ink to Art"));
    await key(document.activeElement!, "Escape");
    expect(byLabel("Remove the line from Ink to Art")).toBeNull();
    await key(line, "Delete");
    expect(sent.at(-1)).toEqual({ from: "ink", to: "art", present: false });
  });

  it("says in the server's words why a line was refused, at the card the person drew from, until they dismiss it or act again", async () => {
    answer = async () => { throw new Error("Art already sends its work to Story, so a line from Story to Art would make a loop."); };
    await show();
    await dragDot("art", card("story").querySelector("[data-bot-id]")!);
    const alert = container.querySelector<HTMLElement>("[role=alert]")!;
    expect(alert.textContent).toContain("would make a loop");
    expect(alert.style.left).toBe(card("art").style.left);
    expect(parseFloat(alert.style.top)).toBe(parseFloat(card("art").style.top) + CARD_HEIGHT + 8);
    await press(byLabel("Dismiss"));
    expect(container.querySelector("[role=alert]")).toBeNull();

    await press(byLabel("Line from Sol to Story"));
    await press(byLabel("Remove the line from Sol to Story"));
    expect(container.querySelector("[role=alert]")!.textContent).toContain("would make a loop");
    answer = async () => {};
    await key(byLabel("Line from Ink to Art")!, "Delete");
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("shows the lines but offers no way to change them when the pipelines can't be read, or to a person who can't manage teams", async () => {
    await show(studio(), { readable: false });
    expect(drawn()).toHaveLength(6);
    expect(container.querySelector("[data-pipeline-dot]")).toBeNull();
    expect(container.querySelector("path[role=button]")).toBeNull();
    expect(container.textContent).toContain("Lines can't be changed right now: the team's pipeline couldn't be read.");

    await show(studio(), { canDraw: false, readable: true });
    expect(container.querySelector("[data-pipeline-dot]")).toBeNull();
    expect(container.textContent).not.toContain("couldn't be read");
  });

  it("draws a line the person added beside the ones the stages give", async () => {
    const lines: FlowLineWire[] = [...studio().lines, { from: "ops", to: "cut" }];
    await show(studio({ lines, manual: ["ops", "cut"] }));
    expect(drawn()).toContain("ops:cut");
    expect(all('[data-pipeline-line$=":cut"]')).toHaveLength(2);
  });
});
