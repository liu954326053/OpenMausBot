import { describe, expect, it } from "vitest";

import { hasSetupChoices, initialGreeting, initialGreetingMessage, setupChoices, setupRequestLine } from "./initial-greeting.ts";

describe("the line after Set me up", () => {
  it("is written in the app's language, by region, with English for any other", () => {
    expect(setupRequestLine("en")).toBe(
      "Great. Tell me what you'd like help with, in your own words, and I'll set myself up for it. For example: \"sort my inbox every morning\" or \"research our competitors every week\".",
    );
    expect(setupRequestLine("es-MX")).toMatch(/^Genial\. Cuéntame/);
    expect(setupRequestLine("pt-BR")).toMatch(/^Ótimo\. Me conte/);
    expect(setupRequestLine("fr")).toBe(setupRequestLine("en"));
    expect(setupRequestLine(undefined)).toBe(setupRequestLine("en"));
  });

  it("leaves the greeting itself as it was", () => {
    expect(initialGreeting("Ava", "en")).toBe("Hi, I'm Ava. What would you like me to do?");
  });
});

describe("a new bot's greeting", () => {
  it("names the person by their first name, in the app's language", () => {
    expect(initialGreeting("Scout", "en", "Milind Soni")).toBe("Hi Milind, I'm Scout. What would you like me to do?");
    expect(initialGreeting("Scout", "es-MX", "  Ana  María ")).toBe("Hola Ana, soy Scout. ¿Qué te gustaría que hiciera?");
    expect(initialGreeting("Scout", "pt-BR", "João")).toBe("Oi João, eu sou Scout. O que você gostaria que eu fizesse?");
    expect(initialGreeting("Scout", "zh-TW", "王小明")).toBe("嗨 王小明，我是 Scout。你想要我幫你做什麼？");
    expect(initialGreeting("Scout", "zh-Hant")).toBe("嗨，我是 Scout。你想要我幫你做什麼？");
  });

  it("names no one when the person has not given a name", () => {
    for (const person of [undefined, "", "   "]) {
      expect(initialGreeting("Scout", "en", person)).toBe("Hi, I'm Scout. What would you like me to do?");
    }
  });
});

describe("a new bot in Simplified Chinese", () => {
  const choices = ["调研和深挖各种主题", "帮我盯着一些事情", "邮件、日历和消息", "预订、购物和跑腿", "数据、表格和报告"];

  it("greets, answers Set me up and offers its setup card's answers in Chinese for zh, zh-CN and zh-Hans", () => {
    for (const language of ["zh", "zh-CN", "zh-Hans"]) {
      expect(initialGreeting("Pepper", language)).toBe("嗨，我是 Pepper。你想让我帮你做什么？");
      expect(initialGreeting("Scout", language, "王小明")).toBe("嗨 王小明，我是 Scout。你想让我帮你做什么？");
      expect(setupRequestLine(language)).toBe("好的。用你自己的话告诉我想让我帮什么忙，我会照着把自己设置好。例如：「每天早上整理我的收件箱」或「每周调研我们的竞争对手」。");
      expect(setupChoices(language)).toEqual(choices);
      expect(hasSetupChoices(language)).toBe(true);
      expect(initialGreetingMessage("Pepper", () => language, true)).toMatchObject({ text: "嗨，我是 Pepper。你想让我帮你做什么？", setupOffer: true, setupChoices: choices });
    }
  });

  it("leaves Traditional Chinese with its own lines", () => {
    for (const language of ["zh-TW", "zh-Hant", "zh-HK"]) {
      expect(initialGreeting("Pepper", language)).toBe("嗨，我是 Pepper。你想要我幫你做什麼？");
      expect(setupChoices(language)).toEqual(setupChoices("zh-tw"));
    }
  });
});
