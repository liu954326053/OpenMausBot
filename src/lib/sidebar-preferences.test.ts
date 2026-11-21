import { describe, expect, it, vi } from "vitest";

import {
  SIDEBAR_COLLAPSED_SECTIONS_KEY,
  SIDEBAR_DENSITY_KEY,
  SIDEBAR_TOOLS_LAYOUT_KEY,
  SIDEBAR_WIDTH_KEY,
  SIMPLE_SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  loadCollapsedSections,
  loadSidebarDensity,
  loadSidebarToolsLayout,
  loadSidebarWidth,
  parseSidebarDensity,
  parseSidebarToolsLayout,
  saveCollapsedSections,
  saveSidebarDensity,
  saveSidebarToolsLayout,
  saveSidebarWidth,
  setSidebarToolsLayout,
  subscribeSidebarToolsLayout,
  toggleCollapsedSection,
} from "./sidebar-preferences";

describe("sidebar density preferences", () => {
  it("keeps the column of avatars the sidebar was dragged to; every other value, an older app's included, opens it", () => {
    expect(parseSidebarDensity("avatars")).toBe("icons");
    expect(parseSidebarDensity("comfortable")).toBe("comfortable");
    expect(parseSidebarDensity("compact"), "Settings' compact density, gone").toBe("comfortable");
    expect(parseSidebarDensity("icons"), "Settings' avatars only, gone: the person drags instead").toBe("comfortable");
    expect(parseSidebarDensity(null)).toBe("comfortable");
  });

  it("loads and saves without making storage availability a launch dependency", () => {
    const setItem = vi.fn();
    saveSidebarDensity("icons", { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_DENSITY_KEY, "avatars");
    saveSidebarDensity("comfortable", { setItem });
    expect(setItem).toHaveBeenLastCalledWith(SIDEBAR_DENSITY_KEY, "comfortable");
    expect(loadSidebarDensity({ getItem: () => "avatars" })).toBe("icons");
    expect(loadSidebarDensity({ getItem: () => "compact" })).toBe("comfortable");
    expect(loadSidebarDensity({ getItem: () => { throw new Error("blocked"); } })).toBe("comfortable");
  });
});

describe("sidebar width preference", () => {
  it("keeps the chat usable and rejects invalid saved widths", () => {
    expect(clampSidebarWidth(500, 900)).toBe(480);
    expect(clampSidebarWidth(500, 768)).toBe(448);
    expect(clampSidebarWidth(100, 900)).toBe(240);
    expect(loadSidebarWidth({ getItem: () => "360" })).toBe(360);
    for (const raw of ["NaN", "9999", "-1", "320.5"]) {
      expect(loadSidebarWidth({ getItem: () => raw })).toBeNull();
    }
  });

  it("persists width without requiring local storage", () => {
    const setItem = vi.fn();
    saveSidebarWidth(360, { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_WIDTH_KEY, "360");
    expect(loadSidebarWidth({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(() => saveSidebarWidth(360, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("keeps Simple mode's width under its own key, so resizing one mode leaves the other alone", () => {
    const setItem = vi.fn();
    saveSidebarWidth(300, { setItem }, SIMPLE_SIDEBAR_WIDTH_KEY);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(SIMPLE_SIDEBAR_WIDTH_KEY, "300");
    const saved: Record<string, string> = { [SIDEBAR_WIDTH_KEY]: "360", [SIMPLE_SIDEBAR_WIDTH_KEY]: "300" };
    const storage = { getItem: (key: string) => saved[key] ?? null };
    expect(loadSidebarWidth(storage)).toBe(360);
    expect(loadSidebarWidth(storage, SIMPLE_SIDEBAR_WIDTH_KEY)).toBe(300);
    expect(loadSidebarWidth({ getItem: (key) => key === SIDEBAR_WIDTH_KEY ? "360" : null }, SIMPLE_SIDEBAR_WIDTH_KEY)).toBeNull();
  });
});

describe("sidebar section preferences", () => {
  it("round-trips unique collapsed section ids", () => {
    const collapsedSet = vi.fn();
    saveCollapsedSections(["builtin:tools", "builtin:tools", "section:Work"], {
      setItem: collapsedSet,
    });
    expect(collapsedSet).toHaveBeenCalledWith(
      SIDEBAR_COLLAPSED_SECTIONS_KEY,
      JSON.stringify(["builtin:tools", "section:Work"]),
    );
    expect(
      loadCollapsedSections({
        getItem: () => JSON.stringify(["builtin:tools", "section:Work"]),
      }),
    ).toEqual(["builtin:tools", "section:Work"]);
  });

  it("ignores malformed storage and toggles ids without mutating the source", () => {
    expect(loadCollapsedSections({ getItem: () => "not-json" })).toEqual([]);
    expect(loadCollapsedSections({ getItem: () => JSON.stringify({ nope: true }) })).toEqual([]);
    const current = ["section:Work"];
    expect(toggleCollapsedSection(current, "builtin:tools")).toEqual([
      "section:Work",
      "builtin:tools",
    ]);
    expect(toggleCollapsedSection(current, "section:Work")).toEqual([]);
    expect(current).toEqual(["section:Work"]);
  });

  it("supports newlines, caps untrusted arrays, and tolerates blocked storage", () => {
    const withNewline = "section:Line\nBreak";
    expect(loadCollapsedSections({ getItem: () => JSON.stringify([withNewline]) })).toEqual([withNewline]);

    const oversized = Array.from({ length: 105 }, (_, index) => `section:${index}`);
    expect(loadCollapsedSections({ getItem: () => JSON.stringify(oversized) })).toHaveLength(100);
    expect(loadCollapsedSections({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
    expect(() => saveCollapsedSections(["section:Work"], { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});

describe("sidebar tools layout preference", () => {
  it("tools layout defaults to rows and ignores malformed values", () => {
    expect(parseSidebarToolsLayout("rows")).toBe("rows");
    expect(parseSidebarToolsLayout("toolbar")).toBe("toolbar");
    expect(parseSidebarToolsLayout("icons")).toBe("rows");
    expect(parseSidebarToolsLayout("")).toBe("rows");
    expect(parseSidebarToolsLayout(null)).toBe("rows");
    expect(loadSidebarToolsLayout({ getItem: () => null })).toBe("rows");
    expect(loadSidebarToolsLayout({ getItem: () => "menu" })).toBe("rows");
    expect(loadSidebarToolsLayout({ getItem: () => { throw new Error("blocked"); } })).toBe("rows");

    const setItem = vi.fn();
    saveSidebarToolsLayout("toolbar", { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_TOOLS_LAYOUT_KEY, "toolbar");
    expect(loadSidebarToolsLayout({ getItem: (key) => (key === SIDEBAR_TOOLS_LAYOUT_KEY ? "toolbar" : null) })).toBe("toolbar");
  });

  it("setSidebarToolsLayout notifies subscribers and persists", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    const listener = vi.fn();
    const unsubscribe = subscribeSidebarToolsLayout(listener);
    try {
      setSidebarToolsLayout("toolbar");
      expect(listener).toHaveBeenCalledOnce();
      expect(values.get(SIDEBAR_TOOLS_LAYOUT_KEY)).toBe("toolbar");
      expect(loadSidebarToolsLayout()).toBe("toolbar");
      setSidebarToolsLayout("rows");
      expect(listener).toHaveBeenCalledTimes(2);
      expect(values.get(SIDEBAR_TOOLS_LAYOUT_KEY)).toBe("rows");
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }
  });
});
