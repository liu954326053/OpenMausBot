import { describe, expect, it } from "vitest";

import { centredOn, menuOpensAbove, targetMark } from "./team-map-reveal";

describe("centredOn", () => {
  it("puts the box in the middle of the area at the same zoom", () => {
    const view = centredOn({ x: 400, y: 200, width: 236, height: 126 }, { width: 1000, height: 600 }, { x: 40, y: 40, scale: 0.5 });
    expect(view.scale).toBe(0.5);
    expect(view.x + (400 + 118) * 0.5).toBe(500);
    expect(view.y + (200 + 63) * 0.5).toBe(300);
  });
});

describe("targetMark", () => {
  it("marks a bot by its id and a department by its name", () => {
    expect(targetMark({ botId: "pepper" })).toBe("pepper");
    expect(targetMark({ department: "Ops" })).toBe("Ops");
  });
});

describe("menuOpensAbove", () => {
  const menu = { gap: 40, height: 300, bottom: 900, inset: 96 };

  it("opens a menu below while all of it stays above the composer", () => {
    expect(menuOpensAbove({ ...menu, top: 200, scale: 1 })).toBe(false);
  });

  it("opens it above once its last item would sit under the composer", () => {
    expect(menuOpensAbove({ ...menu, top: 470, scale: 1 })).toBe(true);
    expect(menuOpensAbove({ ...menu, top: 470, scale: 1, inset: 0 })).toBe(false);
  });

  it("measures the menu at the map's zoom", () => {
    expect(menuOpensAbove({ ...menu, top: 470, scale: 0.6 })).toBe(false);
    expect(menuOpensAbove({ ...menu, top: 470, scale: 1.2 })).toBe(true);
  });
});
