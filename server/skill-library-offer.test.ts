import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import type { BotRecord, Store } from "./store.ts";

// config.ts resolves DATA_DIR at import time, so point this suite at a scratch dir before any module loads.
process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-skill-offer-"));

const library = await import("./skill-library.ts");
const skills = await import("./skills.ts");
const offer = await import("./skill-library-offer.ts");
const { FIT_MAX_SKILLS } = await import("./imported-skills.ts");
const { createSkillsLibraryHost } = await import("./host/skills-library.ts");
const { renderSkillsIndex } = await import("./skills-index.ts");

const SKILL = (name: string, description = "Picks comics that suit a short drama.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo the thing.\n`;
const unique = (stem: string) => `${stem}-${Math.random().toString(36).slice(2, 10)}`;
const add = (name: string, extra: { source?: string; reviewState?: "approved" | "disabled"; description?: string } = {}) =>
  library.installLibrarySkill({ name, instructions: SKILL(name, extra.description), source: extra.source ?? "upload:pack.zip", reviewState: extra.reviewState ?? "approved" });
const offered = (owned: string[] = []) =>
  library.librarySkillsOnOffer(new Set(owned)).map((skill) => skill.name);

let bot: string;
beforeEach(() => {
  bot = unique("offer-bot");
});

describe("library skills every bot may read", () => {
  it("offers a skill the person switched on, whatever bot asks", () => {
    const name = unique("on");
    add(name);
    expect(offered()).toContain(name);
  });

  it("holds back a skill that is off, and one this bot owns another way", () => {
    const off = unique("off"), own = unique("own");
    add(off, { reviewState: "disabled" });
    add(own);
    const names = offered([own]);
    expect(names).not.toContain(off);
    expect(names).not.toContain(own);
  });

  it("names each offered skill's SKILL.md in the library", () => {
    const name = unique("view");
    add(name);
    const view = offer.offeredSkillViews(new Set()).find((skill) => skill.name === name)!;
    expect(view.file).toBe(library.librarySkillFilePath(name));
    expect(view.description).toBe("Picks comics that suit a short drama.");
  });
});

describe("which offered skills a bot's prompt lists", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `skill-${String(i).padStart(2, "0")}`, description: i === 20 ? "按番茄平台的规则筛选漫剧。" : `Topic ${i}.` }));

  it("lists every one while they are few", () => {
    const few = many(FIT_MAX_SKILLS);
    expect(offer.listedOffers(few, "anything")).toEqual(few);
  });

  it("past the cap lists only the ones that fit what the bot is for", () => {
    const listed = offer.listedOffers(many(FIT_MAX_SKILLS + 10), "负责选书：从番茄小说里筛选适合改编成漫剧的作品");
    expect(listed.map((skill) => skill.name)).toEqual(["skill-20"]);
  });

  it("writes a short library list into the prompt by name, without the file path", () => {
    const text = renderSkillsIndex([{ name: "fanqie-manju", description: "按番茄平台的规则筛选漫剧。", source: "library" }]);
    expect(text).toContain("Skills:");
    expect(text).toContain("- fanqie-manju (the skills library): 按番茄平台的规则筛选漫剧。");
    expect(text).toContain("skill tool");
    expect(text).not.toContain("/lib/fanqie-manju/SKILL.md");
    expect(renderSkillsIndex([])).toBe("");
  });

  it("counts what the budget left out and what the bot's own list left out", () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({ name: `s-${i}`, description: "Does a thing.", source: "own" as const }));
    expect(renderSkillsIndex(entries, { budget: { skills: 2, bytes: 100_000 }, unlisted: 4 })).toContain("5 more skills are not listed here");
    expect(renderSkillsIndex([], { unlisted: 1 })).toContain("1 more skill is not listed here");
  });
});

describe("a bot's turn with library skills", () => {
  const hostFor = (record: BotRecord, cfg: AppConfig = {} as AppConfig) => createSkillsLibraryHost({
    store: { bot: () => record, messagesFor: () => [], taskByThread: () => undefined } as unknown as Store,
    cfg,
    appendSkillRequestCard: () => ({ requestId: "", summary: "" }),
  });

  it("lists a library skill in the turn's index, reads it in full through the tool, runs it from /name", () => {
    const name = unique("turn");
    add(name);
    const record = { id: bot, threadId: "main", name: "Picker", modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const host = hostFor(record);
    expect(host.skillsIndex(record, "main")).toContain(`- ${name} (the skills library): Picks comics that suit a short drama.`);
    expect(host.readSkill(record, name)).toBe(SKILL(name));
    expect(host.expandSkillCommand(record, "main", `/${name}`, undefined, [], true)).toContain(`ran your ${name} skill`);
    const row = host.harnessSkills(record).find((skill) => skill.name === name);
    expect(row).toMatchObject({ enabled: true, editable: false, file: library.librarySkillFilePath(name) });
  });

  it("lists every library skill to the main bot, however many there are, and only the ones that fit to any other bot", () => {
    const names = Array.from({ length: FIT_MAX_SKILLS + 5 }, (_, i) => unique(`many-${i}`));
    for (const name of names) add(name, { description: `Topic ${name}.` });
    const main = { id: bot, threadId: "main", name: "MagicBot", defaultBot: {}, modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const index = hostFor(main).skillsIndex(main, "main");
    for (const name of names) expect(index, name).toContain(`- ${name} (`);
    const picker = { ...main, name: "Picker", defaultBot: undefined } as BotRecord;
    const capped = hostFor(picker).skillsIndex(picker, "main");
    expect(names.filter((name) => capped.includes(`- ${name} (`)).length).toBeLessThanOrEqual(FIT_MAX_SKILLS);
    expect(capped).toContain("more skills are not listed here");
  });

  it("offers nothing while the library is off, and never a skill the bot owns under the same name", () => {
    const name = unique("held");
    add(name);
    const record = { id: bot, threadId: "main", name: "Picker", modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const off = hostFor(record, { features: { skillsLibrary: false } } as AppConfig);
    expect(off.skillsIndex(record, "main")).not.toContain(name);
    expect(off.harnessSkills(record).some((skill) => skill.name === name)).toBe(false);
    expect(off.readSkill(record, name)).toBeNull();
    skills.installSkill(bot, "private:test", [{ path: "SKILL.md", content: SKILL(name, "The bot's own copy.") }]);
    skills.setSkillEnabled(bot, name, true);
    const on = hostFor(record);
    expect(on.skillsIndex(record, "main")).toContain("- " + name + " (your own): The bot's own copy.");
    expect(on.readSkill(record, name)).toContain("The bot's own copy.");
  });

  it("answers an unknown name with the list a bot can read", () => {
    const name = unique("known");
    add(name);
    const record = { id: bot, threadId: "main", name: "Picker", modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const host = hostFor(record);
    expect(host.readSkill(record, "no-such-skill")).toBeNull();
    expect(host.skillCatalogue(record).map((skill) => skill.name)).toContain(name);
  });
});
