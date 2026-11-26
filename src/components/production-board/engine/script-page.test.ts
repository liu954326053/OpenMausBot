import { describe, expect, it } from "vitest";
import { scriptPage } from "./script-page";

describe("an episode's script as a script page", () => {
  it("reads headings as scene lines, a name and a colon as who speaks and what they say, and the rest as action", () => {
    const text = "## 场 1　外景　码头 — 夜\n\n浓雾里，一排灯柱一路熄到尽头。\n\n阿满（画外）：十年了，没人敢点这盏灯。\n\n**内景 灯铺**\n青梧擦亮一盏旧灯。";
    expect(scriptPage(text)).toEqual([
      { k: "slug", t: "场 1　外景　码头 — 夜" },
      { k: "act", t: "浓雾里，一排灯柱一路熄到尽头。" },
      { k: "who", t: "阿满（画外）" },
      { k: "dlg", t: "十年了，没人敢点这盏灯。" },
      { k: "slug", t: "内景 灯铺" },
      { k: "act", t: "青梧擦亮一盏旧灯。" },
    ]);
  });

  it("reads English headings and names, and does not take a long sentence with a colon for a line of dialogue", () => {
    expect(scriptPage("INT. LAMP SHOP - NIGHT\nMEI: Ten years.\nShe remembers what the keeper said: never light it again, whatever happens.")).toEqual([
      { k: "slug", t: "INT. LAMP SHOP - NIGHT" },
      { k: "who", t: "MEI" },
      { k: "dlg", t: "Ten years." },
      { k: "act", t: "She remembers what the keeper said: never light it again, whatever happens." },
    ]);
  });

  it("keeps the first lines only", () => {
    expect(scriptPage(Array.from({ length: 40 }, (_, at) => `Line ${at}`).join("\n"), 14)).toHaveLength(14);
    expect(scriptPage("")).toEqual([]);
  });

  it("reads the script's own labels and a time as action, not as someone speaking", () => {
    const text = "人物：阿满、青梧\n时间：夜\n地点：码头\n10:30 the harbour\nCast: Mei, Wu\nlocation: the pier\n旁白：那一夜，灯没有亮。";
    expect(scriptPage(text)).toEqual([
      { k: "act", t: "人物：阿满、青梧" },
      { k: "act", t: "时间：夜" },
      { k: "act", t: "地点：码头" },
      { k: "act", t: "10:30 the harbour" },
      { k: "act", t: "Cast: Mei, Wu" },
      { k: "act", t: "location: the pier" },
      { k: "who", t: "旁白" },
      { k: "dlg", t: "那一夜，灯没有亮。" },
    ]);
  });

  it("does not end on a name whose line the limit cuts off", () => {
    expect(scriptPage("A shop.\nThe lamp.\nMEI: Ten years.", 3)).toEqual([
      { k: "act", t: "A shop." },
      { k: "act", t: "The lamp." },
    ]);
  });
});
