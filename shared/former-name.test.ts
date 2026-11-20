import { describe, expect, it } from "vitest";

import { inThisBuildsWords } from "./former-name";

describe("a line an OpenMausBot build stored", () => {
  it("reads as this build words it, under either name that build used", () => {
    expect(inThisBuildsWords("[From OpenMausBot · retry · requested by OpenMausBot, automatically"))
      .toBe("[From MagicBot · retry · requested by MagicBot, automatically");
    expect(inThisBuildsWords("MausBot can't use this computer yet — ")).toBe("MagicBot can't use this computer yet — ");
  });

  it("leaves this build's own lines, addresses and longer words alone", () => {
    for (const line of ["MagicBot restarted", "see openmausbot.com", "two MausBots", "OpenMausBotX"]) {
      expect(inThisBuildsWords(line)).toBe(line);
    }
  });
});
