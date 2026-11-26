// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardIndex } from "@/lib/production-board/board-index";
import { panelRows } from "@/lib/production-board/panel-rows";
import { BOARD_BOTS, PRODUCTION_BOARD_LOOKS, productionBoardSample } from "@/testing/production-board-sample";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { SidePanel } from "./SidePanel";

useBoardPage();

function draw(open = true) {
  const snapshot = productionBoardSample({ episodes: 4 });
  const rows = panelRows(boardIndex(snapshot), (file) => `/files/${file.path}`, null);
  const calls = { onOpenChange: vi.fn(), onBot: vi.fn(), onAsset: vi.fn(), onEpisode: vi.fn() };
  const root = render(createElement("div", { className: "mj-board" }, createElement(SidePanel, { rows, looks: PRODUCTION_BOARD_LOOKS, open, ...calls })));
  return { panel: root.querySelector<HTMLElement>("[data-board-side-panel]")!, root, calls, rows };
}

describe("the panel at the board's right", () => {
  it("lists the team in the mockup's rows, the lead first, and ends with the legend of the lines", () => {
    const { panel, calls, rows } = draw();
    expect(panel.tagName).toBe("ASIDE");
    expect(panel.querySelector(".pane-head")).not.toBeNull();
    const team = [...panel.querySelectorAll(".pane-scroll button.rrow[data-bot]")];
    expect(team).toHaveLength(rows.team.drama.length + rows.team.episodes.length);
    expect(team[0]!.getAttribute("data-bot")).toBe(BOARD_BOTS.lead);
    expect(team[0]!.querySelector(".ava")).not.toBeNull();
    expect(team[0]!.querySelector(".st .led")).not.toBeNull();
    expect(panel.querySelectorAll(".legend li")).toHaveLength(4);
    click(team[0]);
    expect(calls.onBot).toHaveBeenCalledWith(BOARD_BOTS.lead);
  });

  it("has a tab for the assets by kind and one for the episodes", () => {
    const { panel, calls, rows } = draw();
    click(buttonNamed(panel, "Assets"));
    expect(panel.querySelectorAll(".pane-scroll .sec-lbl").length).toBeGreaterThanOrEqual(3);
    click(panel.querySelector(".pane-scroll button.rrow[data-card]"));
    expect(calls.onAsset).toHaveBeenCalledTimes(1);
    click(buttonNamed(panel, "Episodes"));
    const episodes = [...panel.querySelectorAll(".pane-scroll button.rrow[data-episode]")];
    expect(episodes).toHaveLength(rows.episodes.length);
    expect(textOf(episodes[0]!.querySelector(".mono"))).toBe("EP01");
    click(episodes[1]);
    expect(calls.onEpisode).toHaveBeenCalledWith(2);
  });

  it("folds to one button, and tells the board the room it takes", () => {
    const opened = draw(true);
    expect(opened.root.querySelector<HTMLElement>("[data-board-room]")!.style.width).toBe("304px");
    click(opened.panel.querySelector(".pane-head .tbtn"));
    expect(opened.calls.onOpenChange).toHaveBeenCalledWith(false);
    const folded = draw(false);
    expect(folded.root.querySelector<HTMLElement>("[data-board-room]")!.style.width).toBe("56px");
    expect(folded.root.querySelector("[data-board-side-panel]")).toBeNull();
  });
});
