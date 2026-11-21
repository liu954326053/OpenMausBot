import type { ProjectFlowWire, TeamFlowLineInput, TeamFlowsWire } from "../../shared/team-flow.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { userError } from "../user-errors.ts";
import type { LineResult } from "./service.ts";

export interface TeamFlowRouteHost {
  wire(): TeamFlowsWire;
  projectWire(projectId: string): ProjectFlowWire;
  setLine(input: TeamFlowLineInput): LineResult;
}

function lineInput(body: unknown): TeamFlowLineInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { botId, superiorId } = body as Record<string, unknown>;
  if (typeof botId !== "string" || !botId) return null;
  if (superiorId !== null && (typeof superiorId !== "string" || !superiorId)) return null;
  return { botId, superiorId };
}

/** The team map's routes for reading and drawing flows. A flow is the owner's or an admin's to read and change. */
export function createTeamFlowRoutes(flows: TeamFlowRouteHost): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/team-flows")) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    if (path === "/api/team-flows" && method === "GET") return json(res, 200, flows.wire());
    if (path === "/api/team-flows/line" && method === "PUT") {
      const input = lineInput(await readBody(req));
      if (!input) return json(res, 422, { error: "send botId, and superiorId: a bot's id, or null to take the line away" });
      const result = flows.setLine(input);
      return result.ok ? json(res, 200, result.flows) : json(res, result.status, result.error);
    }
    const project = method === "GET" ? path.match(/^\/api\/team-flows\/projects\/([\w-]+)$/) : null;
    if (project) return json(res, 200, flows.projectWire(project[1]!));
    return PASS;
  };
}
