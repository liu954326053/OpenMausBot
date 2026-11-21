import { describe, expect, it } from "vitest";

import { centredOn, targetMark } from "./team-map-reveal";

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
