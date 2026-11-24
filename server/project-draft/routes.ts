import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { userError } from "../user-errors.ts";
import type { ProjectDrafts } from "./drafts.ts";
import { draftRefusalOf } from "./refusal.ts";

const ROUTE = /^\/api\/team-projects\/([\w-]+)\/(timeline|draft\/open|final)$/;

/** `?episode=N`, or none for a drama made before episodes. */
function episodeOf(url: URL): number | undefined {
  const episode = Number(url.searchParams.get("episode"));
  return Number.isInteger(episode) && episode > 0 ? episode : undefined;
}

/** An episode's timeline, its JianYing draft and its finished film, for the owner and admins as the rest of a project is. */
export function createProjectDraftRoutes(drafts: ProjectDrafts): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    if (!ownerOrAdmin(auth)) {
      req.resume();
      return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    }
    const projectId = match[1]!;
    const part = match[2];
    try {
      if (part === "timeline" && method === "GET") return json(res, 200, await drafts.timeline(projectId, episodeOf(url)));
      if (part === "timeline" && method === "PUT") return json(res, 200, await drafts.setOrder(projectId, await readBody(req), episodeOf(url)));
      if (part === "draft/open" && method === "POST") {
        req.resume();
        return json(res, 200, await drafts.open(projectId, auth));
      }
      if (part === "final" && method === "POST") return json(res, 201, await drafts.final(projectId, await readBody(req)));
      req.resume();
      return json(res, 405, { error: `${method} is not answered at ${path}` });
    } catch (error) {
      const refused = draftRefusalOf(error);
      if (!refused) throw error;
      req.resume();
      return json(res, refused.status, refused.body);
    }
  };
}
