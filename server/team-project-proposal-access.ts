import type { DefaultBotFields } from "../shared/default-bot.ts";
import { holdsMagicBotTools } from "./chief-level.ts";

type MainBotCandidate = { chiefOfStaff?: boolean; teamProject?: object } & DefaultBotFields;

/** The global main bot: the person's MagicBot, which belongs to no project. Only it proposes projects. */
export function proposesTeamProjects(bot: MainBotCandidate | null | undefined): boolean {
  return holdsMagicBotTools(bot) && !bot.teamProject;
}
