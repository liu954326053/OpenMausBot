import { join } from "node:path";

import { rankSkills } from "../shared/skill-fit.ts";
import { FIT_MAX_SKILLS, type ImportedSkillView } from "./imported-skills.ts";
import { librarySkillDirectory, librarySkillsOnOffer, skillsLibraryRoot } from "./skill-library.ts";

/** Every switched-on library skill, as a turn sees it. The library is one shelf for every bot: nothing here asks which
 * bot is reading, only which names that bot's own skills already answer to (`owned`). */
export function offeredSkillViews(owned: ReadonlySet<string>): ImportedSkillView[] {
  const root = skillsLibraryRoot();
  return librarySkillsOnOffer(owned).map((skill) => {
    const folder = librarySkillDirectory(root, skill.name);
    return { name: skill.name, description: skill.description, folder, file: join(folder, "SKILL.md") };
  });
}

/** The ones of `offered` a bot's prompt lists: all of them while they are few, else the best matches to `about`. The bot
 * reads the rest with the `skill` tool, which answers with any skill's name. */
export function listedOffers<T extends { name: string; description: string }>(offered: readonly T[], about: string): T[] {
  if (offered.length <= FIT_MAX_SKILLS) return [...offered];
  const fit = new Set(rankSkills(offered, about).slice(0, FIT_MAX_SKILLS).map((skill) => skill.name));
  return offered.filter((skill) => fit.has(skill.name));
}
