// The one answer to "which bot is proactive here": it owns the "Keep an eye on my day" routine, the brief and the
// suggestion to add a helper-model key. That is the place's MagicBot, shown in the sidebar or not, and the main Chief of
// Staff only where there is no MagicBot. Every such decision goes through this function.
import { defaultBotPerson } from "../../shared/default-bot.ts";
import { sectionKey, type BotRecord, type Store } from "../store.ts";

/** The Chief of the whole workspace, or the first Chief there is. Never a team project's lead, which leads one project. */
export function mainChief(store: Pick<Store, "bots">): BotRecord | null {
  const chiefs = store.bots.filter((bot) => bot.chiefOfStaff && !bot.hidden && !bot.teamProject);
  return chiefs.find((bot) => sectionKey(bot.section) === "") ?? chiefs[0] ?? null;
}

/** Security invariant: never a Team Cloud member's MagicBot, which would read the inbox of the place it shares, and
 * never a team project's bot, which would carry the person's day into one project. */
export function proactiveOwner(store: Pick<Store, "bots">): BotRecord | null {
  return store.bots.find((bot) => bot.defaultBot && !defaultBotPerson(bot) && !bot.hidden && !bot.teamProject) ?? mainChief(store);
}
