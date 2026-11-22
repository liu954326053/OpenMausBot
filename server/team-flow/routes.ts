import type { ProjectFlowWire, TeamFlowLineInput, TeamFlowsWire } from "../../shared/team-flow.ts";
import type { ProjectPipelineWire, TeamPipelineLineInput, TeamPipelineRestoreInput, TeamPipelinesWire } from "../../shared/team-pipeline.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { userError } from "../user-errors.ts";
import type { LineResult, PipelinesResult, RejudgeResult } from "./service.ts";

export interface TeamFlowRouteHost {
  pipelines(): TeamPipelinesWire;
  projectPipeline(projectId: string): ProjectPipelineWire;
  setLine(input: TeamPipelineLineInput): PipelinesResult;
  rejudge(section: string): RejudgeResult;
  restore(input: TeamPipelineRestoreInput): PipelinesResult | null;
  flowsWire(): TeamFlowsWire;
  projectFlowWire(projectId: string): ProjectFlowWire;
  setSuperior(input: TeamFlowLineInput): LineResult;
}

const fields = (body: unknown): Record<string, unknown> | null =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;

function lineInput(body: unknown): TeamPipelineLineInput | null {
  const { from, to, present } = fields(body) ?? {};
  return typeof from === "string" && from && typeof to === "string" && to && typeof present === "boolean" ? { from, to, present } : null;
}

function superiorInput(body: unknown): TeamFlowLineInput | null {
  const { botId, superiorId } = fields(body) ?? {};
  if (typeof botId !== "string" || !botId) return null;
  if (superiorId !== null && (typeof superiorId !== "string" || !superiorId)) return null;
  return { botId, superiorId };
}

const sectionOf = (body: unknown): string | null => {
  const section = fields(body)?.section;
  return typeof section === "string" ? section : null;
};

/** The team map's routes for reading and drawing pipelines, and the old tree's routes answered from them. A pipeline
 * is the owner's or an admin's to read and change. */
export function createTeamFlowRoutes(flows: TeamFlowRouteHost): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/team-pipelines") && !path.startsWith("/api/team-flows")) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    if (path === "/api/team-pipelines" && method === "GET") return json(res, 200, flows.pipelines());
    if (path === "/api/team-pipelines/line" && method === "PUT") {
      const input = lineInput(await readBody(req));
      if (!input) return json(res, 422, { error: "send from and to, two bots' ids, and present: true to draw the line or false to take it away" });
      const result = flows.setLine(input);
      return result.ok ? json(res, 200, result.pipelines) : json(res, result.status, result.error);
    }
    if (path === "/api/team-pipelines/rejudge" && method === "POST") {
      const section = sectionOf(await readBody(req));
      if (section === null) return json(res, 422, { error: "send section, the team's department" });
      const result = flows.rejudge(section);
      return result.ok ? json(res, 200, { pipelines: result.pipelines, undo: result.undo }) : json(res, result.status, result.error);
    }
    if (path === "/api/team-pipelines/restore" && method === "PUT") {
      const body = await readBody(req);
      const section = sectionOf(body);
      const result = section === null ? null : flows.restore({ section, state: fields(body)!.state });
      if (!result) return json(res, 422, { error: "send section and state, the undo a rejudge answered" });
      return result.ok ? json(res, 200, result.pipelines) : json(res, result.status, result.error);
    }
    const pipeline = method === "GET" ? path.match(/^\/api\/team-pipelines\/projects\/([\w-]+)$/) : null;
    if (pipeline) return json(res, 200, flows.projectPipeline(pipeline[1]!));

    if (path === "/api/team-flows" && method === "GET") return json(res, 200, flows.flowsWire());
    if (path === "/api/team-flows/line" && method === "PUT") {
      const input = superiorInput(await readBody(req));
      if (!input) return json(res, 422, { error: "send botId, and superiorId: a bot's id, or null to take the line away" });
      const result = flows.setSuperior(input);
      return result.ok ? json(res, 200, result.flows) : json(res, result.status, result.error);
    }
    const project = method === "GET" ? path.match(/^\/api\/team-flows\/projects\/([\w-]+)$/) : null;
    if (project) return json(res, 200, flows.projectFlowWire(project[1]!));
    return PASS;
  };
}
