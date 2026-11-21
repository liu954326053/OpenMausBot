import { viewersDefaultBot, type DefaultBotFields } from "../../shared/default-bot";
import { botShowsUnread } from "./bot-unread";
import { hiddenFromSidebar, someoneElsesDefaultBot } from "./default-bot";
import type { TeamProjectSide } from "./team-projects";

type ListedBot = DefaultBotFields & { id: string; hidden?: boolean };

/** The bot at the top of the sidebar: the viewer's MagicBot. Hidden from the sidebar in Settings, only a search finds it;
 * while its first welcome plays it is not listed. */
export function sidebarMainBot<T extends ListedBot>(bots: readonly T[], viewer: string | null | undefined, options: { welcoming?: string | null; searching?: boolean } = {}): T | undefined {
  const main = viewersDefaultBot(bots.filter((bot) => !bot.hidden), viewer ?? null);
  if (!main || main.id === options.welcoming) return undefined;
  return !hiddenFromSidebar(main, viewer) || options.searching ? main : undefined;
}

/** Whether a bot in no project, or a group chat outside the projects, has something unread: the sidebar lists neither,
 * so the team map's entry says so. The MagicBot the sidebar shows and other people's MagicBots don't count. */
export function unreadOutsideProjects(
  bots: readonly (ListedBot & Parameters<typeof botShowsUnread>[0])[],
  groups: readonly { unread?: boolean; section?: string; dm?: unknown }[],
  side: Pick<TeamProjectSide, "of" | "rooms">,
  options: { viewer: string | null | undefined; mainBotId?: string },
): boolean {
  const bot = bots.some((one) => !one.hidden && one.id !== options.mainBotId && !side.of(one) && !someoneElsesDefaultBot(one, options.viewer) && botShowsUnread(one));
  return bot || side.rooms([...groups]).some((group) => Boolean(group.unread));
}
