import { describe, expect, it } from "vitest";

import { centredOn, menuPlacement, targetMark } from "./team-map-reveal";

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

describe("menuPlacement", () => {
  const menu = { gap: 40, height: 300, upper: 100, lower: 804 };

  it("opens a menu below while all of it stays above the message box", () => {
    expect(menuPlacement({ ...menu, top: 200, bottom: 232, scale: 1 })).toEqual({ above: false, room: 564 });
  });

  it("opens it above once its last item would sit under the message box and there is more room above", () => {
    expect(menuPlacement({ ...menu, top: 470, bottom: 502, scale: 1 })).toEqual({ above: true, room: 362 });
    expect(menuPlacement({ ...menu, top: 470, bottom: 502, scale: 1, lower: 900 })).toEqual({ above: false, room: 390 });
  });

  it("keeps it below when the map's top would cut off more of it, within the room there", () => {
    expect(menuPlacement({ ...menu, top: 300, bottom: 332, scale: 1, lower: 560 })).toEqual({ above: false, room: 220 });
  });

  it("measures the menu and its room at the map's zoom", () => {
    expect(menuPlacement({ ...menu, top: 470, bottom: 502, scale: 0.5 })).toEqual({ above: false, room: 628 });
    expect(menuPlacement({ ...menu, top: 470, bottom: 502, scale: 1.25 }).above).toBe(true);
  });
});
