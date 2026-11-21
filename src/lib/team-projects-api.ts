import type { CreateTeamProjectInput, ProjectTeamsWire, ProjectTeamWire, TeamProjectRefusal, TeamProjectsListWire, TeamProjectWire } from "../../shared/team-projects";
import { api, ApiError } from "@/state/api";
import { isTeamProjectRefusal } from "./team-projects";

const ROUTE = "/api/team-projects";

export const listTeamProjects = (init?: { background?: boolean; signal?: AbortSignal }): Promise<TeamProjectsListWire> => api<TeamProjectsListWire>(ROUTE, init);

/** Every team, the ones no project can be made from with the reason. */
export const listProjectTeams = async (): Promise<ProjectTeamWire[]> => {
  const { teams } = await api<ProjectTeamsWire>(`${ROUTE}/teams`);
  return Array.isArray(teams) ? teams : [];
};

/** The server's own sentence, in the app's language when the server names one of the app's; "" when it sent none. */
const sentence = (error: ApiError): string => (typeof error.body?.error === "string" || typeof error.body?.errorKey === "string" ? error.message : "");

/** `refused` is null when the server said no without a code this app knows; `error` is the server's own sentence, "" without one. */
export type CreateTeamProjectOutcome =
  | { project: TeamProjectWire }
  | { refused: TeamProjectRefusal | null; error: string };

export async function createTeamProject(input: CreateTeamProjectInput): Promise<CreateTeamProjectOutcome> {
  try {
    const made = await api<{ project: TeamProjectWire }>(ROUTE, { method: "POST", body: JSON.stringify(input) });
    return { project: made.project };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const code = error.body?.code;
    return { refused: isTeamProjectRefusal(code) ? code : null, error: sentence(error) };
  }
}

const change = async (id: string, verb: "archive" | "restore"): Promise<TeamProjectWire> =>
  (await api<{ project: TeamProjectWire }>(`${ROUTE}/${encodeURIComponent(id)}/${verb}`, { method: "POST" })).project;

export const archiveTeamProject = (id: string): Promise<TeamProjectWire> => change(id, "archive");
export const restoreTeamProject = (id: string): Promise<TeamProjectWire> => change(id, "restore");

/** `error` is the server's own sentence about a folder it refuses, "" without one. */
export async function saveTeamProjectsRoot(path: string): Promise<{ root: string } | { error: string }> {
  try {
    return await api<{ root: string }>(`${ROUTE}/root`, { method: "PUT", body: JSON.stringify({ path }) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return { error: sentence(error) };
    throw error;
  }
}
