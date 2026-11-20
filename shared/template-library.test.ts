import { describe, expect, it } from "vitest";

import { isTemplateRoleKey, templateRoleKey } from "./template-library.ts";

describe("a role's key", () => {
  it("is lowercase letters, digits and dashes that a folder can be called on every system", () => {
    for (const key of ["a", "writer", "shot-designer", "role-12", "x".repeat(40), "2nd-unit"]) expect(isTemplateRoleKey(key), key).toBe(true);
    for (const key of ["", "Writer", "shot designer", "-writer", "writer-", "x".repeat(41), "选书", "a_b", "../etc", "con", "nul", "com1", "lpt9"]) {
      expect(isTemplateRoleKey(key), key).toBe(false);
    }
  });

  it("is made from the letters and digits of the role's name", () => {
    const none = new Set<string>();
    expect(templateRoleKey("Script writer", none)).toBe("script-writer");
    expect(templateRoleKey("  Café — Éditeur 2 ", none)).toBe("cafe-editeur-2");
    expect(templateRoleKey("选书 A", none)).toBe("a");
    expect(templateRoleKey(`${"long ".repeat(12)}name`, none)).toBe("long-long-long-long-long-long-long-l");
    expect(templateRoleKey(`${"long ".repeat(6)}abcde name`, none), "it never ends in a dash").toBe("long-long-long-long-long-long-abcde");
    expect(templateRoleKey("CON", none), "a device name is no folder name").toBe("role-1");
  });

  it("is numbered when another role has it, and when the name has no letters or digits", () => {
    expect(templateRoleKey("Director", new Set(["director"]))).toBe("director-2");
    expect(templateRoleKey("Director", new Set(["director", "director-2"]))).toBe("director-3");
    expect(templateRoleKey("选书", new Set())).toBe("role-1");
    expect(templateRoleKey("剧本编写", new Set(["role-1", "role-3"]))).toBe("role-2");
    expect(templateRoleKey("", new Set(["role-1", "role-2"]))).toBe("role-3");
  });
});
