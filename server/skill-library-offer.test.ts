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

const SKILL = (name: string, description = "Picks comics that suit a short drama.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo the thing.\n`;
const unique = (stem: string) => `${stem}-${Math.random().toString(36).slice(2, 10)}`;
const add = (name: string, extra: { source?: string; reviewState?: "approved" | "disabled"; description?: string } = {}) =>
  library.installLibrarySkill({ name, instructions: SKILL(name, extra.description), source: extra.source ?? "upload:pack.zip", reviewState: extra.reviewState ?? "approved" });
const offered = (botId: string, assigned: string[] = [], owned: string[] = []) =>
  library.librarySkillsOnOffer(botId, new Set(assigned), new Set(owned)).map((skill) => skill.name);

let bot: string;
beforeEach(() => {
  bot = unique("offer-bot");
});

describe("library skills on offer to every bot", () => {
  it("offers a skill the person added and switched on to a bot it was never assigned to", () => {
    const name = unique("on");
    add(name);
    expect(offered(bot)).toContain(name);
  });

  it("holds back a skill that is off, one a bot learned and shared, and one this bot already has another way", () => {
    const off = unique("off"), learned = unique("learned"), assigned = unique("assigned"), every = unique("every"), own = unique("own"), dropped = unique("dropped");
    add(off, { reviewState: "disabled" });
    add(learned, { source: "learn:how we cut trailers" });
    for (const name of [assigned, every, own, dropped]) add(name);
    library.setLibrarySkillEveryBot(every, true);
    library.setLibrarySkillOptOut(bot, dropped, true);
    const names = offered(bot, [assigned], [own]);
    for (const name of [off, learned, assigned, every, own, dropped]) expect(names, name).not.toContain(name);
    library.setLibrarySkillEveryBot(every, false);
  });

  it("names each offered skill's SKILL.md in the library", () => {
    const name = unique("view");
    add(name);
    const view = offer.offeredSkillViews(bot, [], new Set()).find((skill) => skill.name === name)!;
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

  it("writes them into the prompt with where to read each, and says how to find the rest", () => {
    const text = offer.libraryOfferPrompt([{ name: "fanqie-manju", description: "按番茄平台的规则筛选漫剧。", folder: "/lib/fanqie-manju", file: "/lib/fanqie-manju/SKILL.md" }], 3);
    expect(text).toContain("Skills from the skills library:");
    expect(text).toContain('- fanqie-manju: 按番茄平台的规则筛选漫剧。 Read "/lib/fanqie-manju/SKILL.md".');
    expect(text).toContain("3 more skills in the skills library are not listed here");
    expect(text).toContain("skills_list");
    expect(offer.libraryOfferPrompt([], 0)).toBe("");
  });
});

describe("a bot's turn with skills on offer", () => {
  const hostFor = (record: BotRecord, cfg: AppConfig = {} as AppConfig) => createSkillsLibraryHost({
    store: { bot: () => record, messagesFor: () => [], taskByThread: () => undefined } as unknown as Store,
    cfg,
    appendSkillRequestCard: () => ({ requestId: "", summary: "" }),
  });

  it("lists an offered skill in the turn's index, runs it from /name, and gives skills_list its path", () => {
    const name = unique("turn");
    add(name);
    const record = { id: bot, threadId: "main", name: "Picker", modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const host = hostFor(record);
    expect(host.skillsIndex(record, "main")).toContain(`- ${name}: Picks comics that suit a short drama. Read ${JSON.stringify(library.librarySkillFilePath(name))}.`);
    expect(host.expandSkillCommand(record, "main", `/${name}`, undefined, [], true)).toContain(`ran your ${name} skill`);
    const row = host.harnessSkills(record).find((skill) => skill.name === name);
    expect(row).toMatchObject({ enabled: true, editable: false, listed: true, file: library.librarySkillFilePath(name) });
  });

  it("lists every offered skill to the main bot, however many there are, and only the ones that fit to any other bot", () => {
    const names = Array.from({ length: FIT_MAX_SKILLS + 5 }, (_, i) => unique(`many-${i}`));
    for (const name of names) add(name, { description: `Topic ${name}.` });
    const main = { id: bot, threadId: "main", name: "MagicBot", defaultBot: {}, modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const index = hostFor(main).skillsIndex(main, "main");
    for (const name of names) expect(index, name).toContain(`- ${name}:`);
    expect(index).not.toContain("not listed here");
    const picker = { ...main, name: "Picker", defaultBot: undefined } as BotRecord;
    const capped = hostFor(picker).skillsIndex(picker, "main");
    expect(names.filter((name) => capped.includes(`- ${name}:`)).length).toBeLessThanOrEqual(FIT_MAX_SKILLS);
    expect(capped).toContain("not listed here");
  });

  it("offers nothing while the library is off, and never a skill the bot owns under the same name", () => {
    const name = unique("held");
    add(name);
    const record = { id: bot, threadId: "main", name: "Picker", modelSelection: { instanceId: "none" } } as unknown as BotRecord;
    const off = hostFor(record, { features: { skillsLibrary: false } } as AppConfig);
    expect(off.skillsIndex(record, "main")).not.toContain(name);
    expect(off.harnessSkills(record).some((skill) => skill.name === name)).toBe(false);
    skills.installSkill(bot, "private:test", [{ path: "SKILL.md", content: SKILL(name, "The bot's own copy.") }]);
    skills.setSkillEnabled(bot, name, true);
    const on = hostFor(record);
    expect(on.skillsIndex(record, "main")).toContain("The bot's own copy.");
    expect(on.skillsIndex(record, "main")).not.toContain(JSON.stringify(library.librarySkillFilePath(name)));
  });
});
