import type { TeamProjectWire } from "../../shared/team-projects";
import { rememberDisclosure } from "@/lib/remembered-disclosure";
import type { Action, Bot } from "./store";
import { openBot } from "./thread-navigation";

export const projectDisclosure = (projectId: string): string => `project:${projectId}`;

/** Opens a project as a click on it in the sidebar does: its lead's conversation, with the project open in the sidebar
 * to show its lead. False while the lead is not among `bots` yet. */
export function openProjectChat(
  dispatch: (action: Action) => void,
  project: Pick<TeamProjectWire, "id" | "leadBotId">,
  bots: readonly Bot[],
  threadsShown: boolean,
): boolean {
  const lead = bots.find((bot) => bot.id === project.leadBotId && !bot.hidden);
  if (!lead) return false;
  rememberDisclosure(projectDisclosure(project.id), true);
  openBot(dispatch, lead, threadsShown);
  return true;
}

/** A project opened from somewhere other than the sidebar: its lead's conversation, else its canvas while the lead is
 * not listed. */
export function openProject(dispatch: (action: Action) => void, project: Pick<TeamProjectWire, "id" | "leadBotId">, bots: readonly Bot[], threadsShown: boolean): void {
  if (!openProjectChat(dispatch, project, bots, threadsShown)) dispatch({ type: "showProject", projectId: project.id });
}
