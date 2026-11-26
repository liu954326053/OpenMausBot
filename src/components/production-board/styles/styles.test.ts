import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`./${name}.css`, import.meta.url), "utf8");
const COPIED = ["shell", "nodes", "panels"] as const;
const all = () => [...COPIED, "skin", "additions"].map(read).join("\n");

describe("the mockup's styles in the app", () => {
  it("are kept under the board's root: no rule reaches the page, the body or the document", () => {
    for (const name of COPIED) {
      const css = read(name);
      expect(css, name).not.toMatch(/(^|[\s,}])(:root|html|body)\s*[,{]/m);
      expect(css, name).toMatch(/^\.mj-board\s*\{/m);
    }
  });

  it("name every animation mj-, so none meets one of the app's", () => {
    const names = [...all().matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names.filter((name) => !name!.startsWith("mj-"))).toEqual([]);
    const used = [...all().matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)].map((match) => match[1]!).filter((name) => name !== "none");
    expect(used.filter((name) => !name.startsWith("mj-"))).toEqual([]);
  });

  it("take every colour from the skin, but for the monitors and what lies over a picture", () => {
    for (const name of COPIED) {
      const css = read(name);
      expect(css, name).not.toMatch(/rgba\(26, ?30, ?35/);
      expect(css, name).not.toMatch(/rgba\((69, ?191, ?174|242, ?165, ?60|236, ?235, ?229)/);
      expect(css, name).not.toMatch(/#ffb650/i);
    }
    const skin = read("skin");
    for (const token of ["--bg: var(--color-app)", "--paper: var(--color-menu)", "--amber: var(--color-warning)", "--teal: var(--color-success)", "--on-fill: var(--color-app)"]) expect(skin).toContain(token);
  });

  it("drop the mockup's top bar and web font", () => {
    expect(read("shell")).not.toMatch(/\.topbar|\.brand|\.top-actions|word-spacing|Noto Sans SC/);
  });

  it("stop every animation when the person or the app asks for less motion", () => {
    expect(read("additions")).toMatch(/\[data-reduced-motion="true"\] \.mj-board/);
  });
});
