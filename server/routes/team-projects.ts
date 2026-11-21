import type { IncomingMessage } from "node:http";

import type {
  CreateTeamProjectInput, CreateTeamProjectResult, ProjectTeamWire, ProjectTeamsWire, TeamChangesInput, TeamChangesResult, TeamProjectRefusal,
  TeamProjectWire, TeamProjectsListWire,
} from "../../shared/team-projects.ts";
import { onParsedBody } from "../harness/http.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { teamChangesInput } from "../team-projects/team-changes.ts";
import { userError, userErrorThrown, type UserError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamProjectRouteHost {
  listWire(): TeamProjectsListWire;
  teams(): ProjectTeamWire[];
  create(input: CreateTeamProjectInput): Promise<CreateTeamProjectResult>;
  archive(id: string): TeamProjectWire | null;
  restore(id: string): TeamProjectWire | null;
  decideTeamChanges(id: string, input: TeamChangesInput): Promise<TeamChangesResult | null>;
  setRoot(path: unknown): { root: string } | UserError;
  moveRefusalFor(botId: string, to: string | null | undefined): UserError | null;
  departmentRefusal(section: string | null | undefined): UserError | null;
  copyRefusal(botId: string, fields: Iterable<string>): UserError | null;
  copyChangeRefusal(botId: string, changes: object): UserError | null;
  contextRefusal(section: string | null | undefined): UserError | null;
}

const REFUSAL_STATUS: Record<TeamProjectRefusal, number> = {
  no_root: 422, root_missing: 422, bad_name: 422, no_team: 422, team_unusable: 422, name_taken: 409, folder_exists: 409, failed: 500,
};

type Move = { botId: unknown; to: unknown };

const record = (body: unknown): Record<string, unknown> => (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** How to read, from a request's body, the bots it would move and where to; null for a request that moves none. */
function movesIn(method: string, path: string, section: string | undefined): ((body: Record<string, unknown>) => Move[]) | null {
  const bot = method === "PATCH" ? path.match(/^\/api\/bots\/([\w-]+)$/) : null;
  if (bot) return (body) => (Object.hasOwn(body, "section") ? [{ botId: bot[1], to: body.section }] : []);
  if (path !== "/api/sidebar-sections") return null;
  if (method === "POST") return (body) => list(body.botIds).map((botId) => ({ botId, to: body.name }));
  if (method === "PUT") return (body) => [...list(body.addBotIds).map((botId) => ({ botId, to: section })), ...list(body.removeBotIds).map((botId) => ({ botId, to: "" }))];
  return null;
}

/**
 * A project's department holds that project's bots and no others, under the project's name. A request that would move
 * a bot across that line, or rename or delete such a department, is refused here, before the route that carries it out.
 */
function guardDepartments(projects: TeamProjectRouteHost, req: IncomingMessage, method: string, path: string, section: string | undefined): UserError | null {
  if (path === "/api/sidebar-sections" && (method === "PATCH" || method === "DELETE")) return projects.departmentRefusal(section);
  const moves = movesIn(method, path, section);
  if (!moves) return null;
  onParsedBody(req, (body) => {
    for (const move of moves(record(body))) {
      if (typeof move.botId !== "string" || (typeof move.to !== "string" && move.to !== null && move.to !== undefined)) continue;
      const refused = projects.moveRefusalFor(move.botId, move.to);
      if (refused) throw Object.assign(userErrorThrown(refused.errorKey, refused.errorParams), { status: 409 });
    }
    return null;
  });
  return null;
}

type CopyChange = { botId: string; fields: readonly string[] } | { botId: string; changes(body: Record<string, unknown>): Record<string, unknown> };

/** What a request would change on a bot that a copy takes from its source; null for a request that changes none of it. */
function copyChangeIn(method: string, path: string): CopyChange | null {
  const match = path.match(/^\/api\/bots\/([\w-]+)(\/[\w/-]+)?$/);
  if (!match) return null;
  const [, botId = "", rest = ""] = match;
  if (method === "PATCH" && (rest === "" || rest === "/profile")) return { botId, changes: (body) => body };
  if (method === "PATCH" && rest === "/model") return { botId, changes: (body) => ({ modelSelection: body }) };
  if (method === "POST" && rest === "/avatar/generate") return { botId, fields: ["avatarUrl"] };
  if (method === "POST" && (rest === "/soul/apply-file" || rest === "/history/rollback")) return { botId, fields: ["soul"] };
  return null;
}

/**
 * A copy in a project shows what its source shows, and a project's department has its team's shared instructions. A
 * request that would change either here is refused before the route that carries it out.
 */
function guardCopies(projects: TeamProjectRouteHost, req: IncomingMessage, method: string, path: string, section: string | undefined): UserError | null {
  if (path === "/api/section-context" && method === "PUT") return projects.contextRefusal(section);
  const change = copyChangeIn(method, path);
  if (!change) return null;
  if ("fields" in change) return projects.copyRefusal(change.botId, change.fields);
  onParsedBody(req, (body) => {
    const refused = projects.copyChangeRefusal(change.botId, change.changes(record(body)));
    if (refused) throw Object.assign(userErrorThrown(refused.errorKey, refused.errorParams), { status: 409 });
    return null;
  });
  return null;
}

/**
 * The Projects page's routes, and the guard on the routes that move bots between departments. Projects are the
 * owner's or an admin's to list, make, archive and restore: the list names every project's folder.
 */
export function createTeamProjectRoutes(projects: TeamProjectRouteHost): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path.startsWith("/api/team-projects") && !ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    if (path === "/api/team-projects" && method === "GET") return json(res, 200, projects.listWire());
    if (path === "/api/team-projects/teams" && method === "GET") return json(res, 200, { teams: projects.teams() } satisfies ProjectTeamsWire);
    if (path === "/api/team-projects" && method === "POST") {
      const body = record(await readBody(req));
      const outcome = await projects.create({ name: body.name as string, team: body.team as string });
      return json(res, "project" in outcome ? 201 : REFUSAL_STATUS[outcome.code], outcome);
    }
    if (path === "/api/team-projects/root" && method === "PUT") {
      const outcome = projects.setRoot(record(await readBody(req)).path);
      return json(res, "root" in outcome ? 200 : 422, outcome);
    }
    const action = method === "POST" ? path.match(/^\/api\/team-projects\/([\w-]+)\/(archive|restore)$/) : null;
    if (action) {
      const project = action[2] === "archive" ? projects.archive(action[1]!) : projects.restore(action[1]!);
      return project ? json(res, 200, { project }) : json(res, 404, userError("serverError.teamProject.notFound"));
    }
    const decided = method === "POST" ? path.match(/^\/api\/team-projects\/([\w-]+)\/team-changes$/) : null;
    if (decided) {
      const input = teamChangesInput(await readBody(req));
      if (!input) return json(res, 422, userError("serverError.teamProject.teamChangesInvalid"));
      const outcome = await projects.decideTeamChanges(decided[1]!, input);
      return outcome ? json(res, 200, outcome) : json(res, 404, userError("serverError.teamProject.notFound"));
    }
    const section = url.searchParams.get("section")?.trim();
    const refused = guardDepartments(projects, req, method, path, section) ?? guardCopies(projects, req, method, path, section);
    if (!refused) return PASS;
    req.resume();
    return json(res, 409, refused);
  };
}
