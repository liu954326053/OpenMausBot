/**
 * The bots that ⌘⇧[ / ⌘⇧] step through, in the order the sidebar shows them. Sections, a custom bot order, collapsed
 * sections, pinned tiles and a search all change that order, so it is read from the rendered rows instead of being
 * rebuilt from `state.bots`.
 */
export function shownBotIds(root: ParentNode | null | undefined): string[] {
  return shownIds(root, "[data-sidebar-bot-row]", "sidebarBotRow");
}

/** The projects ⌘2…⌘9 open, in the order the sidebar shows them; a search leaves out the ones it does not match. */
export function shownProjectIds(root: ParentNode | null | undefined): string[] {
  return shownIds(root, "[data-sidebar-team-project]", "sidebarTeamProject");
}

function shownIds(root: ParentNode | null | undefined, selector: string, key: string): string[] {
  if (!root) return [];
  const ids = [...root.querySelectorAll<HTMLElement>(selector)].map((row) => row.dataset[key] ?? "");
  return [...new Set(ids.filter(Boolean))];
}

/** `items` in the sidebar's order; with none of them on screen, `items` as they are. */
export function inSidebarOrder<T extends { id: string }>(items: readonly T[], shownIds: readonly string[]): T[] {
  if (shownIds.length === 0) return [...items];
  const byId = new Map(items.map((item) => [item.id, item]));
  return shownIds.flatMap((id) => byId.get(id) ?? []);
}

/** What ⌘1…⌘9 opens: ⌘1 the main bot, ⌘2 to ⌘9 the first eight projects. */
export function numberShortcutTarget<B, P>(key: string, mainBot: B | undefined, projects: readonly P[]): { bot: B } | { project: P } | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  if (key === "1") return mainBot === undefined ? undefined : { bot: mainBot };
  const project = projects[Number(key) - 2];
  return project === undefined ? undefined : { project };
}

/**
 * The bot ⌘⇧] (`step` 1) or ⌘⇧[ (`step` -1) opens. A selected bot that is not in `bots`, such as one in a
 * collapsed section, counts as standing just outside the list: ] opens the first bot and [ the last.
 */
export function nextShortcutBot<T extends { id: string }>(bots: readonly T[], selectedId: string | null | undefined, step: 1 | -1): T | undefined {
  if (bots.length === 0) return undefined;
  const index = bots.findIndex((bot) => bot.id === selectedId);
  if (index === -1) return step > 0 ? bots[0] : bots.at(-1);
  return bots[(index + step + bots.length) % bots.length];
}
