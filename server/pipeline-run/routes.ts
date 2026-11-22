import { canvasRefusalOf } from "../project-canvas/service.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { userError } from "../user-errors.ts";
import type { PipelineRuns } from "./runs.ts";

const ROUTE = /^\/api\/team-projects\/([\w-]+)\/pipeline\/videos$/;

/** The person's answer to a project's videos, for the owner and admins as the rest of a project is. */
export function createPipelineRunRoutes(runs: Pick<PipelineRuns, "answerVideos">): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    if (!ownerOrAdmin(auth)) {
      req.resume();
      return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    }
    if (method !== "POST") {
      req.resume();
      return json(res, 405, { error: `${method} is not answered at ${path}` });
    }
    try {
      return json(res, 200, await runs.answerVideos(match[1]!, await readBody(req)));
    } catch (error) {
      const refused = canvasRefusalOf(error);
      if (!refused) throw error;
      req.resume();
      return json(res, refused.status, refused.body);
    }
  };
}
