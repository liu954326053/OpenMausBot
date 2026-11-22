import type { TeamProjectWire } from "../../shared/team-projects";
import { rememberDisclosure } from "@/lib/remembered-disclosure";
import type { Action, Bot, Group } from "./store";
import { openBot } from "./thread-navigation";

export const projectDisclosure = (projectId: string): string => `project:${projectId}`;

/** The bots and group chats a project is opened among. */
export interface ProjectLists {
  bots: readonly Bot[];
  groups: ReadonlyArray<Pick<Group, "id">>;
}

type OpenedProject = Pick<TeamProjectWire, "id" | "leadBotId" | "roomId">;

/** The project's own group chat, once the app lists it. */
export function projectRoomOf<T extends { id: string }>(project: Pick<TeamProjectWire, "roomId">, groups: readonly T[]): T | undefined {
  return project.roomId === undefined ? undefined : groups.find((group) => group.id === project.roomId);
}

/** Opens a project as a click on it in the sidebar does: its group chat, else its lead's conversation, with the project
 * open in the sidebar. False while neither is listed yet. */
export function openProjectChat(dispatch: (action: Action) => void, project: OpenedProject, lists: ProjectLists, threadsShown: boolean): boolean {
  const room = projectRoomOf(project, lists.groups);
  const lead = lists.bots.find((bot) => bot.id === project.leadBotId && !bot.hidden);
  if (!room && !lead) return false;
  rememberDisclosure(projectDisclosure(project.id), true);
  if (room) dispatch({ type: "select", id: room.id });
  else openBot(dispatch, lead!, threadsShown);
  return true;
}

/** A project opened from somewhere other than the sidebar: as a click there opens it, else its canvas while neither its
 * group chat nor its lead is listed. */
export function openProject(dispatch: (action: Action) => void, project: OpenedProject, lists: ProjectLists, threadsShown: boolean): void {
  if (!openProjectChat(dispatch, project, lists, threadsShown)) dispatch({ type: "showProject", projectId: project.id });
}
