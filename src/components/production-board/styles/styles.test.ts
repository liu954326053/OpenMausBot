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

  it("leave Tailwind's grid class alone on app components inside the board", () => {
    for (const name of COPIED) expect(read(name), name).not.toMatch(/(^|[,{}])\s*\.grid\s*[,{]/m);
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

  it("keep a selected monitor's ring, and stop the skin's text colours short of the states that recolour them", () => {
    const skin = read("skin");
    expect(skin).toContain(".mj-board :is(.k-result, .k-final).is-sel:not([data-state='gen']) { box-shadow: 0 0 0 2px var(--color-ink), var(--shadow-node-sel); }");
    expect(skin).toMatch(/\.elabel\.t-dispatch:not\(\.s-wait\)[,)]/);
    expect(skin).toMatch(/\.rrow\[data-state='working'\] \.ava:not\(\.sm\)[,)]/);
    expect(skin).toMatch(/\.bc-send:not\(:disabled\)[,)]/);
  });

  it("follow the board's own size, not the window's", () => {
    expect(read("skin")).toMatch(/^\.mj-board \{[^}]*container-type: size;[^}]*container-name: board;/m);
    for (const name of COPIED) expect(read(name), name).not.toMatch(/@media \((max|min)-(width|height)/);
    for (const name of ["shell", "panels"]) expect(read(name), name).toMatch(/@container board \(max-(width|height): \d+px\)/);
  });

  it("give the stage the board's whole box", () => {
    expect(read("additions")).toContain(".mj-board .stage { position: absolute; inset: 0; }");
  });

  it("carry no section banners", () => {
    for (const name of COPIED) expect(read(name), name).not.toMatch(/\/\* -{3,}/);
  });

  it("drop the mockup's top bar and web font", () => {
    expect(read("shell")).not.toMatch(/\.topbar|\.brand|\.top-actions|word-spacing|Noto Sans SC/);
  });

  it("stacks the board's layers from one scale: content, chrome, the toast, then the overlay with chat, panel and details", () => {
    const tokens = Object.fromEntries([...all().matchAll(/(--z-[\w-]+):\s*(\d+);/g)].map(([, name, at]) => [name, Number(at)]));
    expect(tokens["--z-hint"]).toBeLessThan(tokens["--z-chrome"]!);
    expect(tokens["--z-chrome"]).toBeLessThan(tokens["--z-toast"]!);
    expect(tokens["--z-toast"]).toBeLessThan(tokens["--z-overlay"]!);
    for (const inside of ["--z-chat", "--z-panel", "--z-details"]) expect(tokens[inside], inside).toBeGreaterThan(0);
    expect(tokens["--z-chat"]).toBeLessThan(tokens["--z-panel"]!);
    expect(tokens["--z-panel"]).toBeLessThan(tokens["--z-details"]!);
    const rules = [
      ["shell", "stagebar", "--z-chrome"],
      ["shell", "caption", "--z-chrome"],
      ["shell", "toolbar", "--z-chrome"],
      ["shell", "minimap", "--z-chrome"],
      ["shell", "hint", "--z-hint"],
      ["shell", "toast", "--z-toast"],
      ["panels", "bchat", "--z-chat"],
      ["panels", "dm", "--z-details"],
      ["additions", "dm", "--z-details"],
      ["additions", "side", "--z-panel"],
      ["additions", "side-fold", "--z-panel"],
      ["additions", "ep-menu", "--z-popover"],
    ] as const;
    for (const [file, name, token] of rules) {
      const css = read(file);
      const at = css.search(new RegExp(`(^|[\\s,}])\\.${name}\\s*\\{[^}]*z-index:`));
      expect(at, `${file} .${name}`).toBeGreaterThan(-1);
      expect(css.slice(at).split("}")[0], `${file} .${name}`).toContain(`z-index: var(${token})`);
    }
    expect(read("additions")).toMatch(/\[data-board-overlay\] \{[^}]*z-index: var\(--z-overlay\)/);
    expect(tokens["--z-overlay"]).toBeGreaterThan(tokens["--z-toast"]!);
    expect(tokens["--z-popover"]).toBeGreaterThan(tokens["--z-overlay"]!);
  });

  it("stop every animation when the person or the app asks for less motion", () => {
    expect(read("additions")).toMatch(/\[data-reduced-motion="true"\] \.mj-board/);
  });
});
