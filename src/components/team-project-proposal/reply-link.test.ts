import { describe, expect, it } from "vitest";

import { resolveThreadRefs, type ThreadRefCandidate } from "@/lib/thread-refs";

const MAIN_BOT = "main-bot";
const handedOver: ThreadRefCandidate = { botId: "bot-pia", botName: "制片人", threadId: "pia-drama", title: "替嫁新娘", activeAt: 2 };
const toTheLead = { botId: "bot-pia", botName: "制片人", threadId: "pia-drama", title: "替嫁新娘", ambiguous: false };

describe("the project's name in the main bot's reply after Create", () => {
  it("links to the lead's thread on the request when it is written as #name with a space on each side", () => {
    expect(resolveThreadRefs("项目 #替嫁新娘 建好了，制片人已经收到你的要求。", [handedOver], MAIN_BOT)).toEqual([
      { text: "项目 " },
      { text: "#替嫁新娘", ref: toTheLead },
      { text: " 建好了，制片人已经收到你的要求。" },
    ]);
    expect(resolveThreadRefs("The project #替嫁新娘 is ready.", [handedOver], MAIN_BOT)).toEqual([
      { text: "The project " },
      { text: "#替嫁新娘", ref: toTheLead },
      { text: " is ready." },
    ]);
  });

  it("stays plain text when it runs into the words around it, as Chinese written without spaces does", () => {
    expect(resolveThreadRefs("项目#替嫁新娘建好了", [handedOver], MAIN_BOT)).toEqual([{ text: "项目#替嫁新娘建好了" }]);
    expect(resolveThreadRefs("项目 #替嫁新娘建好了", [handedOver], MAIN_BOT)).toEqual([{ text: "项目 #替嫁新娘建好了" }]);
  });
});
