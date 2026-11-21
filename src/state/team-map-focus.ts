import { useSyncExternalStore } from "react";

import type { Action } from "./store";

/** What the team map brings into view when it opens: a bot or a department the person just made. */
export type TeamMapTarget = { botId: string } | { department: string };

const listeners = new Set<() => void>();
let target: TeamMapTarget | null = null;

const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const current = () => target;

export function showOnTeamMap(dispatch: (action: Action) => void, next: TeamMapTarget): void {
  target = next;
  notify();
  dispatch({ type: "showTeamMap" });
}

/** New bot from a place that manages the team: the bot is made where the person is, then the team map shows it. */
export function newBotOnTeamMap(dispatch: (action: Action) => void): Extract<Action, { type: "newBot" }> {
  return { type: "newBot", preserveSelection: true, onCreated: (bot) => showOnTeamMap(dispatch, { botId: bot.id }) };
}

export const useTeamMapTarget = (): TeamMapTarget | null => useSyncExternalStore(subscribe, current, current);

export function teamMapTargetShown(shown: TeamMapTarget): void {
  if (target !== shown) return;
  target = null;
  notify();
}
