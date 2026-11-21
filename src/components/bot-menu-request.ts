import type { MenuState } from "./Sidebar";

/** A bot's actions menu asked for away from its sidebar row, with how that place renames the bot. */
export interface BotMenuRequest extends MenuState {
  rename: (botId: string) => void;
}

const listeners = new Set<(request: BotMenuRequest) => void>();

/** The sidebar answers here with its own menu, confirmations and Undo notice, so a bot shown elsewhere (a team map card) offers the same actions. */
export function onBotMenuRequest(listener: (request: BotMenuRequest) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestBotMenu(request: BotMenuRequest): void {
  for (const listener of Array.from(listeners)) listener(request);
}
