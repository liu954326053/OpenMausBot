// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamFlowLineInput, TeamFlowWire } from "../../../shared/team-flow";
import { flowLayout } from "@/lib/team-flow";
import type { Bot } from "@/state/store";
import { TeamFlowTree } from "./TeamFlowTree";

const bot = (id: string, name: string, chiefOfStaff = false) => ({ id, name, section: "Studio", chiefOfStaff }) as unknown as Bot;
const sol = bot("sol", "Sol", true), story = bot("story", "Story"), board = bot("board", "Board"), video = bot("video", "Video");
const section = { key: "Studio", name: "Studio", chiefs: [sol], members: [story, board, video] };
const flow: TeamFlowWire = { section: "Studio", chiefId: "sol", parents: { story: "sol", board: "sol", video: "board" }, placed: ["video"] };

let container: HTMLDivElement, root: Root, sent: TeamFlowLineInput[], answer: () => Promise<void>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sent = [];
  answer = async () => {};
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function show(props: Partial<{ canDraw: boolean; readable: boolean }> = {}) {
  await act(async () => root.render(createElement(TeamFlowTree, {
    section, flow, layout: flowLayout([sol, story, board, video], flow)!, canDraw: true, readable: true,
    renderBot: (one: Bot) => createElement("button", { "data-bot-id": one.id }, one.name),
    onLine: async (input: TeamFlowLineInput) => { sent.push(input); await answer(); },
    ...props,
  })));
}
const byLabel = <T extends Element>(label: string) => container.querySelector<T & HTMLElement>(`[aria-label="${label}"]`);
const press = async (element: Element | null) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

describe("drawing a team's flow on the map", () => {
  it("draws a line to every member and lets the person select only a line that does not come from the Chief", async () => {
    await show();
    expect([...container.querySelectorAll("[data-flow-line]")].map((line) => line.getAttribute("data-flow-line")).sort())
      .toEqual(["board:video", "sol:board", "sol:story"]);
    expect([...container.querySelectorAll("path[role=button]")].map((line) => line.getAttribute("aria-label"))).toEqual(["Line from Board to Video"]);
  });

  it("puts the bot chosen from a card's dot under that card's bot, and offers none that is already there", async () => {
    await show();
    await press(byLabel("Draw a line from Board"));
    const menu = byLabel("Put under Board")!;
    expect(menu.getAttribute("role")).toBe("menu");
    const rows = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
    expect(rows.map((row) => [row.textContent, row.disabled])).toEqual([["Story", false], ["Video" + "Already here", true]]);
    expect(document.activeElement).toBe(rows[0]);
    await press(rows[0]);
    expect(sent).toEqual([{ botId: "story", superiorId: "board" }]);
    expect(container.querySelector("[role=status]")!.textContent).toBe("Story now works under Board.");
    expect(byLabel("Put under Board")).toBeNull();
  });

  it("removes a selected line, and a line removed from the keyboard, putting the member back under the Chief", async () => {
    await show();
    await press(container.querySelector("path[role=button]"));
    await press(byLabel("Remove the line from Board to Video"));
    expect(sent).toEqual([{ botId: "video", superiorId: null }]);
    expect(container.querySelector("[role=status]")!.textContent).toBe("Video is back under Sol.");

    const line = container.querySelector<SVGPathElement & HTMLElement>("path[role=button]")!;
    await act(async () => line.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    expect(sent).toHaveLength(2);
  });

  it("says why a change was refused, next to the team, until the person dismisses it", async () => {
    answer = async () => { throw new Error("Video is already below Board, so Board can't go under Video: that would make a loop."); };
    await show();
    await press(byLabel("Draw a line from Video"));
    await press([...byLabel("Put under Video")!.querySelectorAll("[role=menuitem]")].find((row) => row.textContent === "Board")!);
    expect(container.querySelector("[role=alert]")!.textContent).toContain("that would make a loop");
    await press(byLabel("Dismiss"));
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("shows the lines but offers no way to change them when the flows can't be read, or to a person who can't manage teams", async () => {
    await show({ readable: false });
    expect(container.querySelectorAll("[data-flow-line]")).toHaveLength(3);
    expect(container.querySelector("[data-flow-dot]")).toBeNull();
    expect(container.querySelector("path[role=button]")).toBeNull();
    expect(container.textContent).toContain("Lines can't be changed right now: the team flows couldn't be read.");

    await show({ canDraw: false, readable: true });
    expect(container.querySelector("[data-flow-dot]")).toBeNull();
    expect(container.textContent).not.toContain("couldn't be read");
  });
});
