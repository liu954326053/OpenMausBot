import { describe, expect, it } from "vitest";

import { fitWords, rankSkills } from "./skill-fit.ts";

const skill = (name: string, description: string) => ({ name, description });

describe("skills that fit a bot or a task", () => {
  it("meets a word in its other forms and leaves out the commonest", () => {
    expect(fitWords("Invoices, invoicing and the invoice")).toEqual(["invoic", "invoic", "invoic"]);
    expect(fitWords("Sales leads for a class")).toEqual(["sale", "lead", "class"]);
    expect(fitWords("Use this skill when you are in a PR")).toEqual([]);
    expect(fitWords("Revisar as faturas")).toEqual(["revisa", "fatura"]);
  });

  it("puts a skill named for the task first, and a word every skill shares counts for little", () => {
    const skills = [
      skill("file-expense", "Files an expense report in the company portal."),
      skill("invoice-reminders", "Chases unpaid invoices by email."),
      skill("pdf", "Reads and fills PDF files."),
      skill("company-wiki", "Searches the company wiki."),
    ];
    expect(rankSkills(skills, "chase the unpaid invoicing").map((one) => one.name)).toEqual(["invoice-reminders"]);
    expect(rankSkills(skills, "file my expenses with the company").map((one) => one.name)[0]).toBe("file-expense");
    expect(rankSkills(skills, "deploy a preview")).toEqual([]);
    expect(rankSkills(skills, "")).toEqual([]);
  });

  it("meets Chinese and Japanese text, which has no spaces, by each pair of neighbouring characters", () => {
    expect(fitWords("番茄漫剧选剧")).toEqual(["番茄", "茄漫", "漫剧", "剧选", "选剧"]);
    expect(fitWords("AI漫剧 skill")).toEqual(["漫剧"]);
    expect(fitWords("可以使用这个技能")).toEqual(["以使", "用这", "个技"]);
    expect(fitWords("剧")).toEqual([]);
    const skills = [
      skill("fanqie-manju", "按番茄平台的规则筛选漫剧，判断一部小说适不适合改编。"),
      skill("douyin-manju", "按抖音平台的规则筛选漫剧。"),
      skill("storyboard", "把剧本拆成分镜头脚本。"),
    ];
    expect(rankSkills(skills, "负责选书：从番茄小说里筛选适合改编成漫剧的作品").map((one) => one.name)[0]).toBe("fanqie-manju");
    expect(rankSkills(skills, "镜头脚本设计").map((one) => one.name)).toEqual(["storyboard"]);
    expect(rankSkills(skills, "抖音").map((one) => one.name)).toEqual(["douyin-manju"]);
  });

  it("does not let a long description outrank a short one that names the same thing", () => {
    const long = skill("notes", `Keeps meeting notes. ${Array.from({ length: 60 }, (_, i) => `topic${i}`).join(" ")} calendar.`);
    const short = skill("calendar", "Books calendar slots.");
    expect(rankSkills([long, short], "calendar meeting").map((one) => one.name)).toEqual(["calendar", "notes"]);
  });
});
