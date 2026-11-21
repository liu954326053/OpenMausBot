// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { inSidebarOrder, nextShortcutBot, numberShortcutTarget, shownBotIds, shownProjectIds } from "./sidebar-shortcut-order";

const bot = (id: string) => ({ id });

function sidebar(html: string): HTMLElement {
  const root = document.createElement("aside");
  root.innerHTML = html;
  return root;
}

describe("shownBotIds", () => {
  it("reads the bot rows in the order the sidebar renders them", () => {
    const root = sidebar(`
      <div data-sidebar-section-id="section:Design"><div data-sidebar-bot-row="d"></div><div data-sidebar-bot-row="b"></div></div>
      <div data-sidebar-section-id="builtin:bots"><div data-sidebar-bot-row="a"></div></div>
    `);
    expect(shownBotIds(root)).toEqual(["d", "b", "a"]);
  });

  it("leaves out bots of a collapsed section, which renders no rows", () => {
    const root = sidebar(`
      <div data-sidebar-section-id="section:Design"></div>
      <div data-sidebar-section-id="builtin:bots"><div data-sidebar-bot-row="a"></div><div data-sidebar-bot-row="c"></div></div>
    `);
    expect(shownBotIds(root)).toEqual(["a", "c"]);
  });

  it("counts a bot shown twice, as a pinned tile and a row, at its first place", () => {
    const root = sidebar(`<div data-sidebar-bot-row="p"></div><div data-sidebar-bot-row="a"></div><div data-sidebar-bot-row="p"></div>`);
    expect(shownBotIds(root)).toEqual(["p", "a"]);
  });

  it("is empty without a sidebar", () => {
    expect(shownBotIds(null)).toEqual([]);
  });
});

describe("shownProjectIds", () => {
  it("reads the project rows in the order the sidebar renders them, not the bot rows", () => {
    const root = sidebar(`
      <div data-sidebar-bot-row="magic"></div>
      <div data-sidebar-team-projects=""><div data-sidebar-team-project="bride"></div><div data-sidebar-team-project="work"></div></div>
    `);
    expect(shownProjectIds(root)).toEqual(["bride", "work"]);
    expect(shownBotIds(root)).toEqual(["magic"]);
  });

  it("is empty without a sidebar", () => {
    expect(shownProjectIds(undefined)).toEqual([]);
  });
});

describe("inSidebarOrder", () => {
  const bots = [bot("a"), bot("b"), bot("c"), bot("d")];

  it("orders the bots like the sidebar, so ⌘⇧] starts from the first row on screen", () => {
    expect(inSidebarOrder(bots, ["d", "b", "a"]).map((b) => b.id)).toEqual(["d", "b", "a"]);
  });

  it("drops ids that are not among the bots, such as a hidden bot", () => {
    expect(inSidebarOrder([bot("a")], ["x", "a"]).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps the bots' own order when no sidebar is on screen", () => {
    expect(inSidebarOrder(bots, []).map((b) => b.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("numberShortcutTarget", () => {
  const main = bot("magic");
  const projects = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"].map(bot);

  it("opens the main bot on ⌘1", () => {
    expect(numberShortcutTarget("1", main, projects)).toEqual({ bot: main });
  });

  it("opens the first eight projects on ⌘2 to ⌘9, and never a ninth", () => {
    expect(numberShortcutTarget("2", main, projects)).toEqual({ project: projects[0] });
    expect(numberShortcutTarget("9", main, projects)).toEqual({ project: projects[7] });
    expect(["2", "3", "4", "5", "6", "7", "8", "9"].map((key) => numberShortcutTarget(key, main, projects))).not.toContainEqual({ project: projects[8] });
  });

  it("opens nothing for a number with no project, without a main bot, or for any other key", () => {
    expect(numberShortcutTarget("4", main, projects.slice(0, 2))).toBeUndefined();
    expect(numberShortcutTarget("1", undefined, projects)).toBeUndefined();
    expect(numberShortcutTarget("2", undefined, projects)).toEqual({ project: projects[0] });
    for (const key of ["0", "n", "!", "10"]) expect(numberShortcutTarget(key, main, projects)).toBeUndefined();
  });
});

describe("nextShortcutBot", () => {
  const bots = [bot("a"), bot("b"), bot("c")];

  it("steps forward and back through the list, wrapping at both ends", () => {
    expect(nextShortcutBot(bots, "b", 1)?.id).toBe("c");
    expect(nextShortcutBot(bots, "c", 1)?.id).toBe("a");
    expect(nextShortcutBot(bots, "a", -1)?.id).toBe("c");
  });

  it("starts from either end when the selected bot is not shown, as in a collapsed section", () => {
    expect(nextShortcutBot(bots, "hidden", 1)?.id).toBe("a");
    expect(nextShortcutBot(bots, "hidden", -1)?.id).toBe("c");
    expect(nextShortcutBot(bots, null, -1)?.id).toBe("c");
  });

  it("opens nothing without bots", () => {
    expect(nextShortcutBot([], "a", 1)).toBeUndefined();
  });
});
