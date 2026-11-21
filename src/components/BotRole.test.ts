import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { botRoleLine, chiefTitle } from "./BotRole";

afterEach(() => { setLocale("en"); });

describe("a Chief of Staff's words", () => {
  it("name the role, but the main bot keeps its own description", () => {
    setLocale("zh");
    expect([chiefTitle({}), chiefTitle({ defaultBot: {} })]).toEqual(["参谋长", "总协调机器人"]);
    expect(botRoleLine({ title: "", chiefOfStaff: true })).toBe("参谋长");
    expect(botRoleLine({ title: "", chiefOfStaff: true, defaultBot: {} })).toBe("总协调机器人");
    expect(botRoleLine({ title: "", chiefOfStaff: false, defaultBot: {} })).toBe("总协调机器人");
  });

  it("give way to a bot's own title, and say nothing for a bot that is neither", () => {
    setLocale("zh");
    expect(botRoleLine({ title: "写每一集的剧本", chiefOfStaff: true })).toBe("写每一集的剧本");
    expect(botRoleLine({ title: " ", chiefOfStaff: false })).toBe("");
  });

  it("are one word in English", () => {
    expect([chiefTitle({}), chiefTitle({ defaultBot: {} })]).toEqual(["Chief of Staff", "Chief of Staff"]);
  });
});
